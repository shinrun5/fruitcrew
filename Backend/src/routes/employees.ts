import { randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import prisma from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { canManageStore, requireAuth, requireRole } from "../lib/auth.js";
import { firstFreeFruit, fruitFor, isFruit } from "../lib/fruits.js";

const router = Router();
const anyManager = [requireAuth, requireRole("MANAGER", "OWNER")] as const;

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

async function freePin(storeId: number): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const clash = await prisma.employeeStore.findUnique({ where: { storeId_pin: { storeId, pin } } });
    if (!clash) return pin;
  }
  throw new Error("Could not allocate a free PIN for this store");
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
  account: { email: string } | null;
  stores: { storeId: number; proficiency: string; canOpen: boolean; canClose: boolean; primary: boolean; pin: string }[];
}

/** The roster, optionally limited to employees linked to `storeIds`. */
async function roster(storeIds?: number[]): Promise<RosterRow[]> {
  const employees = await prisma.employee.findMany({
    ...(storeIds ? { where: { employeeStores: { some: { storeId: { in: storeIds } } } } } : {}),
    orderBy: { name: "asc" },
    include: { employeeStores: true, user: { select: { email: true } } },
  });
  return employees.map((e) => ({
    id: e.id,
    name: e.name,
    phone: e.phone,
    hourLimit: e.hourLimit,
    maxShifts: e.maxShifts,
    standby: e.standby,
    avatarFruit: e.avatarFruit,
    inviteCode: e.inviteCode,
    account: e.user ? { email: e.user.email } : null,
    stores: e.employeeStores.map((s) => ({
      storeId: s.storeId,
      proficiency: s.proficiency,
      canOpen: s.canOpen,
      canClose: s.canClose,
      primary: s.primary,
      pin: s.pin,
    })),
  }));
}

// GET /employees/roster — workers at the caller's stores (all, for an OWNER)
router.get("/roster", ...anyManager, async (req, res) => {
  res.json(await roster(req.user!.storeIds));
});

// POST /employees/me — the calling manager/owner adds themselves as a schedulable
// worker: an Employee row, a link to every store they run, and user.employeeId.
// Idempotent — a no-op if they're already linked.
router.post("/me", ...anyManager, async (req, res) => {
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
  const storeIds = me.storeIds;
  if (storeIds.length === 0) {
    return res.status(400).json({ error: "You're not assigned to any store yet" });
  }

  const employee = await prisma.employee.create({
    data: {
      name: displayName,
      hourLimit: Number.isFinite(Number(hourLimit)) ? Number(hourLimit) : 40,
      maxShifts: Number.isFinite(Number(maxShifts)) ? Number(maxShifts) : 5,
      standby: false,
    },
  });
  for (const [i, storeId] of storeIds.entries()) {
    await prisma.employeeStore.create({
      data: {
        employeeId: employee.id,
        storeId,
        pin: await freePin(storeId),
        proficiency: "MANAGER",
        canOpen: true,
        canClose: true,
        primary: i === 0,
      },
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

// PUT /employees/mine/either-or  { groups: DayOfWeek[][] }
// Each group = "schedule me at most one of these days". Replaces the whole set.
router.put("/mine/either-or", requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const raw = req.body?.groups;
  if (!Array.isArray(raw) || raw.length > 5) {
    return res.status(400).json({ error: "groups must be an array (max 5)" });
  }
  const groups: string[][] = [];
  for (const g of raw) {
    if (!Array.isArray(g)) return res.status(400).json({ error: "each group must be an array of days" });
    const days = [...new Set(g)];
    if (days.length < 2 || days.length > 7 || days.some((d) => !DAY_SET.has(d))) {
      return res.status(400).json({ error: "each group needs 2–7 valid days" });
    }
    groups.push(days as string[]);
  }

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
  await prisma.employee.update({ where: { id }, data: { inviteCode } });
  res.json({ employeeId: id, inviteCode });
});

// POST /employees — create a worker, with a first store link (must manage that store)
router.post("/", ...anyManager, async (req, res) => {
  const { name, hourLimit, maxShifts, standby, store } = req.body ?? {};
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

  try {
    const employee = await prisma.employee.create({
      data: { name, hourLimit, maxShifts: maxShifts ?? 6, standby: standby ?? false },
    });
    if (storeId && store?.proficiency) {
      await prisma.employeeStore.create({
        data: {
          employeeId: employee.id,
          storeId,
          pin: await freePin(storeId),
          proficiency: store.proficiency,
          canOpen: store.canOpen ?? false,
          canClose: store.canClose ?? false,
          primary: store.primary ?? true,
        },
      });
      // give them a fruit that's actually free at this store (the id-hash default
      // can collide with a coworker's chosen or defaulted one)
      const fruit = firstFreeFruit(employee.id, await storeMates([storeId], employee.id));
      await prisma.employee.update({ where: { id: employee.id }, data: { avatarFruit: fruit } });
    }
    const rows = await roster();
    res.json(rows.find((r) => r.id === employee.id));
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

router.get("/:id", requireAuth, requireManagerOfEmployee, async (req, res) => {
  const employee = await prisma.employee.findUnique({ where: { id: Number(req.params.id) } });
  res.json(employee);
});

router.put("/:id", requireAuth, requireManagerOfEmployee, async (req, res) => {
  const id = Number(req.params.id);
  const { hourLimit, maxShifts, standby, phone } = req.body ?? {};
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
  const phoneVal =
    phone === undefined ? undefined : typeof phone === "string" && phone.trim() ? phone.trim() : null;

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
    const rows = await roster();
    res.json(rows.find((r) => r.id === id));
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
