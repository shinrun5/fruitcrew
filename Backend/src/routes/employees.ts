import { randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import prisma from "../lib/prisma.js";
import { normalizePhone } from "../lib/phone.js";
import { Prisma } from "@prisma/client";
import { canManageStore, requireAuth, requireManager } from "../lib/auth.js";
import { firstFreeFruit, fruitFor, isFruit } from "../lib/fruits.js";
import { deleteUserAccount } from "../lib/accountDeletion.js";
import { ensureOpenerResponsibility } from "../lib/responsibilities.js";
import { hoursFromMinutes, minutesByEmployeeForPeriod, periodContaining } from "../lib/payPeriod.js";
import { parseYMD, todayUTC } from "../lib/time.js";

const router = Router();
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days

/** Can this user manage this employee? The employee must be linked to a store the
 * caller can act on — for an OWNER that's every store in their org, for a MANAGER
 * their assigned stores (both already resolved into req.user.storeIds). */
async function canManageEmployee(req: Request, employeeId: number): Promise<boolean> {
  const link = await prisma.employeeStore.findFirst({
    where: { employeeId, storeId: { in: req.user?.storeIds ?? [] } },
    select: { employeeId: true },
  });
  return !!link;
}

/** Middleware wrapper around canManageEmployee for the /:id routes. */
async function requireManagerOfEmployee(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "A valid numeric id is required" });
  const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true } });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  if (!(await canManageEmployee(req, id))) {
    return res.status(403).json({ error: "That worker isn't at one of your stores" });
  }
  next();
}

/** Fruits already claimed by OTHER people who share a store with `employeeId`
 * (a fruit is unique per store; a multi-store person must be free at all of theirs). */
async function takenFruits(employeeId: number): Promise<string[]> {
  const links = await prisma.employeeStore.findMany({
    where: { employeeId },
    select: { storeId: true },
  });
  const storeIds = links.map((l) => l.storeId);
  if (storeIds.length === 0) return [];
  const others = await prisma.employee.findMany({
    where: {
      id: { not: employeeId },
      avatarFruit: { not: null },
      employeeStores: { some: { storeId: { in: storeIds } } },
    },
    select: { avatarFruit: true },
  });
  return [...new Set(others.map((o) => o.avatarFruit as string))];
}

/** { id, avatarFruit } for everyone (bar `exceptId`) sharing any of `storeIds`. */
async function storeMates(storeIds: number[], exceptId: number) {
  if (storeIds.length === 0) return [];
  return prisma.employee.findMany({
    where: { id: { not: exceptId }, employeeStores: { some: { storeId: { in: storeIds } } } },
    select: { id: true, avatarFruit: true },
  });
}

/** True if `fruit` is already in use (chosen or as a default) by someone at `storeIds`. */
async function fruitTakenAt(fruit: string, storeIds: number[], exceptId: number): Promise<boolean> {
  const mates = await storeMates(storeIds, exceptId);
  return mates.some((m) => (m.avatarFruit ?? fruitFor(m.id)) === fruit);
}

interface RosterRow {
  id: number;
  name: string;
  phone: string | null;
  hourLimit: number;
  maxShifts: number;
  standby: boolean;
  avatarFruit: string | null;
  inviteCode: string | null;
  hireDate: string | null;
  // "one of these days only" groups, e.g. [["SATURDAY","SUNDAY"]]
  eitherOrDays: string[][];
  // never two back-to-back days in a week
  noConsecutiveDays: boolean;
  // never a partial/split day — every requirement window a store has that day, or none
  fullDayOnly: boolean;
  // weekly hours to aim for (soft); null = none
  targetHours: number | null;
  account: { email: string; approved: boolean } | null;
  stores: {
    storeId: number;
    proficiency: string;
    canOpen: boolean;
    primary: boolean;
    responsibilityIds: number[];
  }[];
}

// include shape shared by roster()/rosterRow() below
const ROSTER_INCLUDE = {
  employeeStores: true,
  // archived responsibilities are excluded so a removed custom role doesn't
  // linger in a worker's checklist client-side
  employeeResponsibilities: {
    where: { responsibility: { archivedAt: null } },
    select: { storeId: true, responsibilityId: true, responsibility: { select: { name: true } } },
  },
  user: { select: { email: true, approved: true } },
} as const;

function toRosterRow(e: {
  id: number;
  name: string;
  phone: string | null;
  hourLimit: number;
  maxShifts: number;
  standby: boolean;
  avatarFruit: string | null;
  inviteCode: string | null;
  hireDate: Date | null;
  eitherOrDays: unknown;
  noConsecutiveDays: boolean;
  fullDayOnly: boolean;
  targetHours: number | null;
  user: { email: string; approved: boolean } | null;
  employeeStores: { storeId: number; proficiency: string; primary: boolean }[];
  employeeResponsibilities: { storeId: number; responsibilityId: number; responsibility: { name: string } }[];
}): RosterRow {
  const byStore = new Map<number, { ids: number[]; names: Set<string> }>();
  for (const er of e.employeeResponsibilities) {
    const entry = byStore.get(er.storeId) ?? { ids: [], names: new Set<string>() };
    entry.ids.push(er.responsibilityId);
    entry.names.add(er.responsibility.name);
    byStore.set(er.storeId, entry);
  }
  return {
    id: e.id,
    name: e.name,
    phone: e.phone,
    hourLimit: e.hourLimit,
    maxShifts: e.maxShifts,
    standby: e.standby,
    avatarFruit: e.avatarFruit,
    inviteCode: e.inviteCode,
    hireDate: e.hireDate ? e.hireDate.toISOString().slice(0, 10) : null,
    eitherOrDays: (e.eitherOrDays as string[][] | null) ?? [],
    noConsecutiveDays: e.noConsecutiveDays,
    fullDayOnly: e.fullDayOnly,
    targetHours: e.targetHours,
    account: e.user ? { email: e.user.email, approved: e.user.approved } : null,
    stores: e.employeeStores.map((s) => {
      const entry = byStore.get(s.storeId);
      return {
        storeId: s.storeId,
        proficiency: s.proficiency,
        // "Opener" is the one built-in responsibility (see lib/responsibilities.ts)
        // — kept as a boolean here too for the Workers page's star badge; every
        // other responsibility (including the old canClose-gated "Closing" role)
        // is just membership in responsibilityIds now, no more special flags
        canOpen: entry?.names.has("Opener") ?? false,
        primary: s.primary,
        responsibilityIds: entry?.ids ?? [],
      };
    }),
  };
}

/** The roster, optionally limited to employees linked to `storeIds`. */
async function roster(storeIds?: number[]): Promise<RosterRow[]> {
  const employees = await prisma.employee.findMany({
    ...(storeIds ? { where: { employeeStores: { some: { storeId: { in: storeIds } } } } } : {}),
    orderBy: { name: "asc" },
    include: ROSTER_INCLUDE,
  });
  return employees.map(toRosterRow);
}

/** One roster row by id — for handlers that already know exactly who they just
 * touched, so they don't have to pull the whole platform's roster to find them. */
async function rosterRow(id: number): Promise<RosterRow | null> {
  const e = await prisma.employee.findUnique({
    where: { id },
    include: ROSTER_INCLUDE,
  });
  return e ? toRosterRow(e) : null;
}

// GET /employees/roster — workers at the caller's stores (all, for an OWNER)
router.get("/roster", ...requireManager, async (req, res) => {
  res.json(await roster(req.user!.storeIds));
});

// GET /employees/hours-summary?anchor=YYYY-MM-DD — every worker at the
// caller's stores, with their total hours (summed across ALL of their
// stores, not just the caller's — same whole-person rule Dashboard.tsx's
// weekly cap already uses) for the org's pay period containing `anchor`
// (defaults to today). periodEnd is exclusive, so the frontend can navigate
// with zero period-length math: Prev -> anchor = periodStart - 1 day,
// Next -> anchor = periodEnd.
router.get("/hours-summary", ...requireManager, async (req, res) => {
  const orgId = req.user!.orgId;
  if (orgId == null) return res.status(400).json({ error: "Your account has no org" });
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { payPeriodType: true, payPeriodAnchor: true },
  });
  if (!org) return res.status(404).json({ error: "Org not found" });

  // ?from=&to= (both inclusive) totals any date range a manager picks instead
  // of a whole pay period — capped so one request can't sweep years of weeks
  const from = parseYMD(req.query.from);
  const to = parseYMD(req.query.to);
  let period;
  if (req.query.from !== undefined || req.query.to !== undefined) {
    if (!from || !to) return res.status(400).json({ error: 'from and to must both be "YYYY-MM-DD"' });
    if (to < from) return res.status(400).json({ error: "The end date is before the start date" });
    const end = new Date(to);
    end.setUTCDate(end.getUTCDate() + 1);
    if (end.getTime() - from.getTime() > 366 * 86_400_000) {
      return res.status(400).json({ error: "Pick a range of a year or less" });
    }
    period = { start: from, end };
  } else {
    const anchorParam = typeof req.query.anchor === "string" ? parseYMD(req.query.anchor) : null;
    period = periodContaining(org.payPeriodType, org.payPeriodAnchor, anchorParam ?? new Date());
  }

  const [rows, totals] = await Promise.all([
    roster(req.user!.storeIds),
    minutesByEmployeeForPeriod(req.user!.storeIds, period),
  ]);

  res.json({
    periodStart: period.start.toISOString().slice(0, 10),
    periodEnd: period.end.toISOString().slice(0, 10),
    payPeriodType: org.payPeriodType,
    rows: rows
      .map((e) => {
        const minutes = totals.get(e.id) ?? 0;
        return { employeeId: e.id, name: e.name, minutes, hours: hoursFromMinutes(minutes) };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});

// POST /employees/me  { storeIds?: number[] } — the calling manager/owner adds
// themselves as a schedulable worker: an Employee row, a link to whichever
// store(s) they picked (or every store they run, if none given), and
// user.employeeId. Idempotent — a no-op if they're already linked.
router.post("/me", ...requireManager, async (req, res) => {
  const me = req.user!;
  if (me.employeeId) {
    const e = await prisma.employee.findUnique({
      where: { id: me.employeeId },
      include: { employeeStores: { select: { storeId: true } } },
    });
    return res.json({ employeeId: me.employeeId, created: false, stores: e?.employeeStores.length ?? 0 });
  }

  const { name, hourLimit, maxShifts } = req.body ?? {};
  const displayName =
    (typeof name === "string" && name.trim()) || me.email.split("@")[0] || "Me";
  // a manager/owner picks which store(s) they'll actually work — defaults to
  // every store they manage (the old behavior) when none are given, but
  // anything requested must be somewhere they actually manage
  const requested: number[] = Array.isArray(req.body?.storeIds) ? req.body.storeIds.map(Number) : [];
  const storeIds = requested.length > 0 ? requested.filter((id) => me.storeIds.includes(id)) : me.storeIds;
  if (storeIds.length === 0) {
    return res
      .status(400)
      .json({ error: requested.length > 0 ? "Pick at least one store you manage" : "You're not assigned to any store yet" });
  }

  const employee = await prisma.employee.create({
    data: {
      name: displayName,
      hourLimit: Number.isFinite(Number(hourLimit)) ? Number(hourLimit) : 40,
      maxShifts: Number.isFinite(Number(maxShifts)) ? Number(maxShifts) : 5,
      standby: false,
      hireDate: todayUTC(),
    },
  });
  for (const [i, storeId] of storeIds.entries()) {
    const openerId = await ensureOpenerResponsibility(storeId);
    await prisma.employeeStore.create({
      data: { employeeId: employee.id, storeId, proficiency: "MANAGER", primary: i === 0 },
    });
    // trusted with whatever this store's roles are, same spirit as the old
    // unconditional canOpen/canClose=true for a self-added manager — Opener
    // always exists; "Closing" only for stores that use Closing Duties at all
    const closing = await prisma.responsibility.findUnique({ where: { storeId_name: { storeId, name: "Closing" } } });
    await prisma.employeeResponsibility.createMany({
      data: [
        { employeeId: employee.id, storeId, responsibilityId: openerId },
        ...(closing ? [{ employeeId: employee.id, storeId, responsibilityId: closing.id }] : []),
      ],
      skipDuplicates: true,
    });
  }
  await prisma.user.update({ where: { id: me.id }, data: { employeeId: employee.id } });
  res.status(201).json({ employeeId: employee.id, created: true, stores: storeIds.length });
});

// GET /employees/mine/fruit — the caller's chosen fruit + which are taken at their store(s)
router.get("/mine/fruit", requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });
  const me = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { avatarFruit: true },
  });
  res.json({ mine: me?.avatarFruit ?? null, taken: await takenFruits(employeeId) });
});

// PUT /employees/mine/fruit  { fruit: string | null } — pick a fruit (or null to reset)
router.put("/mine/fruit", requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const fruit = req.body?.fruit ?? null;
  if (fruit !== null && !isFruit(fruit)) {
    return res.status(400).json({ error: "Not a known fruit" });
  }
  if (fruit !== null && (await takenFruits(employeeId)).includes(fruit)) {
    return res.status(409).json({ error: "Someone at your store already has that one" });
  }

  await prisma.employee.update({ where: { id: employeeId }, data: { avatarFruit: fruit } });
  res.json({ fruit });
});

// PUT /employees/mine/limits  { hourLimit?, maxShifts? } — the caller sets their own caps
router.put("/mine/limits", requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const data: { hourLimit?: number; maxShifts?: number } = {};
  if (req.body?.hourLimit !== undefined) {
    const h = Math.round(Number(req.body.hourLimit));
    if (!Number.isFinite(h) || h < 1 || h > 80) {
      return res.status(400).json({ error: "Max hours must be between 1 and 80" });
    }
    data.hourLimit = h;
  }
  if (req.body?.maxShifts !== undefined) {
    const d = Math.round(Number(req.body.maxShifts));
    if (!Number.isFinite(d) || d < 1 || d > 7) {
      return res.status(400).json({ error: "Max days must be between 1 and 7" });
    }
    data.maxShifts = d;
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });

  const e = await prisma.employee.update({ where: { id: employeeId }, data });
  res.json({ hourLimit: e.hourLimit, maxShifts: e.maxShifts });
});

const DAY_SET = new Set([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

/** Shared by the self-service and manager either-or routes below: "schedule me
 * at most one of these days" groups — max 5 groups, each 2-7 distinct valid days. */
function validateEitherOrGroups(raw: unknown): string[][] | { error: string } {
  if (!Array.isArray(raw) || raw.length > 5) {
    return { error: "groups must be an array (max 5)" };
  }
  const groups: string[][] = [];
  for (const g of raw) {
    if (!Array.isArray(g)) return { error: "each group must be an array of days" };
    const days = [...new Set(g)];
    if (days.length < 2 || days.length > 7 || days.some((d) => !DAY_SET.has(d))) {
      return { error: "each group needs 2–7 valid days" };
    }
    groups.push(days as string[]);
  }
  return groups;
}

// PUT /employees/mine/either-or  { groups: DayOfWeek[][] }
// Each group = "schedule me at most one of these days". Replaces the whole set.
router.put("/mine/either-or", requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const groups = validateEitherOrGroups(req.body?.groups);
  if ("error" in groups) return res.status(400).json({ error: groups.error });

  await prisma.employee.update({
    where: { id: employeeId },
    data: { eitherOrDays: groups.length ? (groups as unknown as object) : Prisma.JsonNull },
  });
  res.json({ groups });
});

// PUT /employees/mine/no-consecutive  { on: boolean }
// on => the solver never schedules the caller on two back-to-back days.
router.put("/mine/no-consecutive", requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });
  if (typeof req.body?.on !== "boolean") return res.status(400).json({ error: "on must be true or false" });

  const e = await prisma.employee.update({
    where: { id: employeeId },
    data: { noConsecutiveDays: req.body.on },
  });
  res.json({ noConsecutiveDays: e.noConsecutiveDays });
});

// POST /employees/:id/invite
router.post("/:id/invite", requireAuth, requireManagerOfEmployee, async (req, res) => {
  const id = Number(req.params.id);
  const employee = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  if (employee.user) return res.status(409).json({ error: "This employee already has an account" });

  const inviteCode = randomBytes(9).toString("base64url");
  const inviteCodeExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await prisma.employee.update({ where: { id }, data: { inviteCode, inviteCodeExpiresAt } });
  res.json({ employeeId: id, inviteCode, inviteCodeExpiresAt });
});

// POST /employees/:id/approve — clears the pending-approval flag on a worker who
// self-registered via an invite code (see lib/auth.ts's requireAuth gate).
router.post("/:id/approve", requireAuth, requireManagerOfEmployee, async (req, res) => {
  const id = Number(req.params.id);
  const employee = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
  if (!employee?.user) return res.status(404).json({ error: "This worker has no account to approve" });
  if (employee.user.approved) return res.status(409).json({ error: "Already approved" });

  await prisma.user.update({ where: { id: employee.user.id }, data: { approved: true } });
  res.json(await rosterRow(id));
});

// POST /employees/:id/reject — revokes a not-yet-approved self-registered account
// (e.g. it wasn't actually this worker, or was a mistaken sign-up). The Employee
// row itself is left alone — same as any other account deletion — so a manager
// can still re-invite the real person or remove the worker entirely afterward.
router.post("/:id/reject", requireAuth, requireManagerOfEmployee, async (req, res) => {
  const id = Number(req.params.id);
  const employee = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
  if (!employee?.user) return res.status(404).json({ error: "This worker has no account to reject" });
  if (employee.user.approved) {
    return res.status(409).json({ error: "Already approved — remove the worker instead if you want them gone" });
  }

  const result = await deleteUserAccount(employee.user.id);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json(await rosterRow(id));
});

// POST /employees — create a worker, with a first store link (must manage that store)
router.post("/", ...requireManager, async (req, res) => {
  const { name, hourLimit, maxShifts, standby, store, hireDate } = req.body ?? {};
  if (!name || hourLimit === undefined) {
    return res.status(400).json({ error: "name and hourLimit are required" });
  }
  const storeId = store?.storeId;
  if (storeId !== undefined) {
    if (!canManageStore(req.user, storeId)) {
      return res.status(403).json({ error: "You do not manage that store" });
    }
  } else if (req.user!.role !== "OWNER") {
    return res.status(400).json({ error: "Pick a store for this worker" });
  }
  const hireDateVal = hireDate !== undefined ? parseYMD(hireDate) ?? todayUTC() : todayUTC();

  try {
    const employee = await prisma.employee.create({
      data: { name, hourLimit, maxShifts: maxShifts ?? 6, standby: standby ?? false, hireDate: hireDateVal },
    });
    if (storeId && store?.proficiency) {
      await prisma.employeeStore.create({
        data: {
          employeeId: employee.id,
          storeId,
          proficiency: store.proficiency,
          primary: store.primary ?? true,
        },
      });
      const responsibilityIds: number[] = Array.isArray(store.responsibilityIds)
        ? store.responsibilityIds.filter(Number.isInteger)
        : [];
      if (responsibilityIds.length > 0) {
        await prisma.employeeResponsibility.createMany({
          data: responsibilityIds.map((responsibilityId: number) => ({
            employeeId: employee.id,
            storeId,
            responsibilityId,
          })),
          skipDuplicates: true,
        });
      }
      // give them a fruit that's actually free at this store (the id-hash default
      // can collide with a coworker's chosen or defaulted one)
      const fruit = firstFreeFruit(employee.id, await storeMates([storeId], employee.id));
      await prisma.employee.update({ where: { id: employee.id }, data: { avatarFruit: fruit } });
    }
    res.json(await rosterRow(employee.id));
  } catch {
    res.status(500).json({ error: "Failed to create employee" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  // scoped to the caller's stores — for an OWNER that's their whole org, for a
  // MANAGER their assigned stores (both resolved into req.user.storeIds)
  const employees = await prisma.employee.findMany({
    where: { employeeStores: { some: { storeId: { in: req.user!.storeIds } } } },
  });
  res.json(employees);
});

// GET /employees/:id/hours — one worker's hours this week and this pay
// period, across every store the caller runs (for their Team profile)
router.get("/:id/hours", requireAuth, requireManagerOfEmployee, async (req, res) => {
  const id = Number(req.params.id);
  const orgId = req.user!.orgId;
  const org = orgId == null
    ? null
    : await prisma.org.findUnique({ where: { id: orgId }, select: { payPeriodType: true, payPeriodAnchor: true } });
  if (!org) return res.status(400).json({ error: "Your account has no org" });

  const week = periodContaining("WEEKLY", org.payPeriodAnchor);
  const period = periodContaining(org.payPeriodType, org.payPeriodAnchor);
  const [wk, pp] = await Promise.all([
    minutesByEmployeeForPeriod(req.user!.storeIds, week),
    minutesByEmployeeForPeriod(req.user!.storeIds, period),
  ]);
  res.json({
    weekMinutes: wk.get(id) ?? 0,
    periodMinutes: pp.get(id) ?? 0,
    week: hoursFromMinutes(wk.get(id) ?? 0),
    period: hoursFromMinutes(pp.get(id) ?? 0),
    periodStart: period.start.toISOString().slice(0, 10),
    periodEnd: period.end.toISOString().slice(0, 10),
  });
});

router.get("/:id", requireAuth, requireManagerOfEmployee, async (req, res) => {
  const employee = await prisma.employee.findUnique({ where: { id: Number(req.params.id) } });
  res.json(employee);
});

router.put("/:id", requireAuth, requireManagerOfEmployee, async (req, res) => {
  const id = Number(req.params.id);
  const { hourLimit, maxShifts, standby, phone, noConsecutiveDays, fullDayOnly, targetHours } = req.body ?? {};
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || hourLimit === undefined) {
    return res.status(400).json({ error: "name and hourLimit are required" });
  }
  const h = Math.round(Number(hourLimit));
  if (!Number.isFinite(h) || h < 1 || h > 80) {
    return res.status(400).json({ error: "Weekly hours must be between 1 and 80" });
  }
  let d: number | undefined;
  if (maxShifts !== undefined) {
    d = Math.round(Number(maxShifts));
    if (!Number.isFinite(d) || d < 1 || d > 7) {
      return res.status(400).json({ error: "Max days must be between 1 and 7" });
    }
  }
  // optional weekly target: a whole number of hours, at most the hour limit; null clears it
  let target: number | null | undefined;
  if (targetHours !== undefined) {
    if (targetHours === null || targetHours === "") target = null;
    else {
      target = Math.round(Number(targetHours));
      if (!Number.isFinite(target) || target < 1 || target > h) {
        return res.status(400).json({ error: `Hours to aim for must be between 1 and the weekly limit (${h})` });
      }
    }
  }
  const phoneVal =
    phone === undefined ? undefined : typeof phone === "string" && phone.trim() ? normalizePhone(phone) : null;

  // optional hire date change ("YYYY-MM-DD" | null | undefined-means-unchanged)
  const hireDateRaw = req.body?.hireDate;
  let hireDateVal: Date | null | undefined;
  if (hireDateRaw !== undefined) {
    if (hireDateRaw === null) hireDateVal = null;
    else {
      const parsed = parseYMD(hireDateRaw);
      if (!parsed) return res.status(400).json({ error: 'hireDate must be "YYYY-MM-DD"' });
      hireDateVal = parsed;
    }
  }

  // optional avatar fruit change (must be free at the worker's store(s))
  const rawFruit = req.body?.avatarFruit;
  let fruitVal: string | null | undefined;
  if (rawFruit !== undefined) {
    if (rawFruit !== null && !isFruit(rawFruit)) {
      return res.status(400).json({ error: "Not a known fruit" });
    }
    if (rawFruit !== null) {
      const links = await prisma.employeeStore.findMany({ where: { employeeId: id }, select: { storeId: true } });
      if (await fruitTakenAt(rawFruit, links.map((l) => l.storeId), id)) {
        return res.status(409).json({ error: "Someone at that store already has that fruit" });
      }
    }
    fruitVal = rawFruit;
  }

  // optional either-or day groups (same rules as the self-service route)
  let eitherOrGroups: string[][] | undefined;
  if (req.body?.eitherOrDays !== undefined) {
    const validated = validateEitherOrGroups(req.body.eitherOrDays);
    if ("error" in validated) return res.status(400).json({ error: validated.error });
    eitherOrGroups = validated;
  }

  try {
    const updated = await prisma.employee.update({
      where: { id },
      data: {
        name,
        hourLimit: h,
        ...(d !== undefined ? { maxShifts: d } : {}),
        ...(standby !== undefined ? { standby: !!standby } : {}),
        ...(phoneVal !== undefined ? { phone: phoneVal } : {}),
        ...(fruitVal !== undefined ? { avatarFruit: fruitVal } : {}),
        ...(noConsecutiveDays !== undefined ? { noConsecutiveDays: !!noConsecutiveDays } : {}),
        ...(fullDayOnly !== undefined ? { fullDayOnly: !!fullDayOnly } : {}),
        ...(target !== undefined ? { targetHours: target } : {}),
        ...(hireDateVal !== undefined ? { hireDate: hireDateVal } : {}),
        ...(eitherOrGroups !== undefined
          ? { eitherOrDays: eitherOrGroups.length ? (eitherOrGroups as unknown as object) : Prisma.JsonNull }
          : {}),
      },
      include: { user: { select: { id: true } } },
    });
    // keep a linked login's name/phone in step with the roster
    if (updated.user) {
      await prisma.user.update({
        where: { id: updated.user.id },
        data: { name, ...(phoneVal !== undefined ? { phone: phoneVal } : {}) },
      });
    }
    res.json(await rosterRow(id));
  } catch {
    res.status(500).json({ error: "Failed to update employee" });
  }
});

// DELETE /employees/:id — drops availability + store links + requests, frees shifts.
router.delete("/:id", requireAuth, requireManagerOfEmployee, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const employee = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    await prisma.$transaction([
      prisma.shiftChangeRequest.deleteMany({ where: { requestedById: id } }),
      prisma.recurringAvailability.deleteMany({ where: { employeeId: id } }),
      prisma.employeeResponsibility.deleteMany({ where: { employeeId: id } }),
      prisma.employeeStore.deleteMany({ where: { employeeId: id } }),
      prisma.shift.updateMany({ where: { employeeId: id }, data: { employeeId: null } }),
      prisma.employee.delete({ where: { id } }),
    ]);

    res.json({
      message: `Employee ${employee.name} removed`,
      accountLeftUnlinked: employee.user?.email ?? null,
    });
  } catch {
    res.status(500).json({ error: "Failed to delete employee" });
  }
});

export default router;
