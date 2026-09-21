import { Router } from 'express';
import { DayOfWeek, Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { notifyMany } from '../lib/notify.js';
import { mondayUTC } from '../lib/scheduleGen.js';
import { toClock, toHHMM } from '../lib/time.js';

const router = Router();
const manager = [requireAuth, requireRole('MANAGER', 'OWNER')] as const;

const DAYS = new Set<string>(Object.values(DayOfWeek));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "YYYY-MM-DD" -> the Monday (UTC midnight) of that week, or null if unparseable. */
function parseWeekStart(q: unknown): Date | null {
  if (typeof q !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(q)) return null;
  const d = new Date(`${q}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return d;
}

interface Window {
  day: DayOfWeek;
  start: string;
  end: string;
}

/** Validate a { day, start:"HH:MM", end:"HH:MM" }[] body. Returns the cleaned list
 * or an error string. */
function cleanWindows(raw: unknown): Window[] | string {
  if (!Array.isArray(raw)) return 'windows must be an array';
  if (raw.length > 50) return 'Too many availability windows';
  const out: Window[] = [];
  for (const w of raw) {
    if (!DAYS.has(w?.day)) return `Invalid day: ${w?.day}`;
    if (!HHMM.test(w?.start) || !HHMM.test(w?.end)) return 'start and end must be "HH:MM"';
    if (w.start >= w.end) return 'start must be before end';
    out.push({ day: w.day, start: w.start, end: w.end });
  }
  return out;
}

// --- self-service: an employee's own weekly availability ---
// Placed before "/:id" so "mine" isn't parsed as an id.

router.get('/mine', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const windows = await prisma.recurringAvailability.findMany({
    where: { employeeId },
    orderBy: [{ day: 'asc' }, { start: 'asc' }],
  });
  res.json(windows);
});

// GET /availability/mine/hours — opening / closing time and a default night-shift
// window, derived from the shift requirements of the stores the caller works at.
// Feeds the availability editor's "+ hours" / "+ night" defaults.
router.get('/mine/hours', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const links = await prisma.employeeStore.findMany({
    where: { employeeId },
    select: {
      store: {
        select: {
          id: true,
          openTime: true,
          closeTime: true,
          nightStart: true,
          weekdayHours: true,
        },
      },
    },
  });
  const stores = links.map((l) => l.store);
  const storeIds = stores.map((s) => s.id);
  const reqs = storeIds.length
    ? await prisma.shiftRequirement.findMany({
        where: { storeId: { in: storeIds } },
        select: { storeId: true, day: true, start: true, end: true },
      })
    : [];

  const toMin = (hOrD: Date | string) =>
    typeof hOrD === 'string'
      ? Number(hOrD.slice(0, 2)) * 60 + Number(hOrD.slice(3, 5))
      : hOrD.getUTCHours() * 60 + hOrD.getUTCMinutes();
  const fromMin = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  const DOW = Object.values(DayOfWeek) as DayOfWeek[];
  const byDay: Record<
    string,
    { open: string; close: string; night: { start: string; end: string }; closed: boolean }
  > = {};

  for (const day of DOW) {
    const opens: number[] = [];
    const closes: number[] = [];
    const nights: number[] = [];
    let openStores = 0;

    for (const s of stores) {
      const wh = s.weekdayHours.find((w) => w.day === day);
      if (wh?.closed) continue; // this store is shut that weekday
      openStores++;
      const dReqs = reqs.filter((r) => r.storeId === s.id && r.day === day);
      const reqOpen = dReqs.length ? Math.min(...dReqs.map((r) => toMin(r.start))) : 9 * 60;
      const reqClose = dReqs.length ? Math.max(...dReqs.map((r) => toMin(r.end))) : 21 * 60;
      const openM = toMin(wh?.openTime ?? s.openTime ?? fromMin(reqOpen));
      const closeM = toMin(wh?.closeTime ?? s.closeTime ?? fromMin(reqClose));
      opens.push(openM);
      closes.push(closeM);
      nights.push(toMin(wh?.nightStart ?? s.nightStart ?? fromMin(Math.max(openM, closeM - 300))));
    }

    const openM = opens.length ? Math.min(...opens) : 9 * 60;
    const closeM = closes.length ? Math.max(...closes) : 21 * 60;
    const nightM = Math.min(nights.length ? Math.min(...nights) : closeM - 300, closeM - 30);
    byDay[day] = {
      open: fromMin(openM),
      close: fromMin(closeM),
      night: { start: fromMin(Math.max(openM, nightM)), end: fromMin(closeM) },
      closed: stores.length > 0 && openStores === 0,
    };
  }

  // keep the old flat shape too (Mon as the representative day) for any older client
  res.json({ ...byDay.MONDAY, byDay });
});

/** Replace the caller's entire weekly availability in one shot.
 * body: { windows: { day, start: "HH:MM", end: "HH:MM" }[] } */
router.put('/mine', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const windows = req.body?.windows;
  if (!Array.isArray(windows)) return res.status(400).json({ error: 'windows must be an array' });
  if (windows.length > 50) return res.status(400).json({ error: 'Too many availability windows' });

  const rows: { employeeId: number; day: DayOfWeek; start: Date; end: Date }[] = [];
  for (const w of windows) {
    if (!DAYS.has(w?.day)) return res.status(400).json({ error: `Invalid day: ${w?.day}` });
    if (!HHMM.test(w?.start) || !HHMM.test(w?.end)) {
      return res.status(400).json({ error: 'start and end must be "HH:MM"' });
    }
    if (w.start >= w.end) return res.status(400).json({ error: 'start must be before end' });
    rows.push({ employeeId, day: w.day, start: toClock(w.start), end: toClock(w.end) });
  }

  await prisma.$transaction([
    prisma.recurringAvailability.deleteMany({ where: { employeeId } }),
    prisma.recurringAvailability.createMany({ data: rows }),
  ]);

  const saved = await prisma.recurringAvailability.findMany({
    where: { employeeId },
    orderBy: [{ day: 'asc' }, { start: 'asc' }],
  });
  res.json(saved);
});

// --- one-week override of the caller's standing availability ---

// GET /availability/mine/week?weekStart=YYYY-MM-DD
// Returns the override for that week if one exists, otherwise the standing set as
// a starting point (hasOverride=false).
router.get('/mine/week', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });
  const weekStart = parseWeekStart(req.query.weekStart);
  if (!weekStart) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });

  const [row, confirm] = await Promise.all([
    prisma.weekAvailability.findUnique({
      where: { employeeId_weekStart: { employeeId, weekStart } },
    }),
    prisma.availabilityConfirmation.findUnique({
      where: { employeeId_weekStart: { employeeId, weekStart } },
    }),
  ]);
  const confirmed = !!confirm || !!row;
  if (row) {
    return res.json({
      weekStart: weekStart.toISOString().slice(0, 10),
      hasOverride: true,
      confirmed,
      windows: row.windows as unknown as Window[],
    });
  }
  const standing = await prisma.recurringAvailability.findMany({
    where: { employeeId },
    orderBy: [{ day: 'asc' }, { start: 'asc' }],
  });
  res.json({
    weekStart: weekStart.toISOString().slice(0, 10),
    hasOverride: false,
    confirmed,
    windows: standing.map((w) => ({ day: w.day, start: toHHMM(w.start), end: toHHMM(w.end) })),
  });
});

// GET /availability/mine/pending-weeks — every week currently "on the board" for a
// store the caller works, each with whether they've confirmed it yet. A worker at
// stores whose schedules aren't on the same week (one advanced, one hasn't) gets
// one entry per distinct week instead of a single guessed "next week".
router.get('/mine/pending-weeks', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.json({ weeks: [] });

  const links = await prisma.employeeStore.findMany({
    where: { employeeId },
    include: { store: { select: { name: true, schedule: { select: { weekStart: true } } } } },
  });
  const byWeek = new Map<string, string[]>();
  for (const l of links) {
    const ws = l.store.schedule?.weekStart;
    if (!ws) continue;
    const key = ws.toISOString().slice(0, 10);
    (byWeek.get(key) ?? byWeek.set(key, []).get(key)!).push(l.store.name);
  }
  const weekStarts = [...byWeek.keys()].sort();
  if (weekStarts.length === 0) return res.json({ weeks: [] });

  const confirms = await prisma.availabilityConfirmation.findMany({
    where: { employeeId, weekStart: { in: weekStarts.map((s) => new Date(`${s}T00:00:00.000Z`)) } },
    select: { weekStart: true },
  });
  const overrides = await prisma.weekAvailability.findMany({
    where: { employeeId, weekStart: { in: weekStarts.map((s) => new Date(`${s}T00:00:00.000Z`)) } },
    select: { weekStart: true },
  });
  const done = new Set([...confirms, ...overrides].map((c) => c.weekStart.toISOString().slice(0, 10)));

  res.json({
    weeks: weekStarts.map((weekStart) => ({
      weekStart,
      stores: [...new Set(byWeek.get(weekStart))],
      confirmed: done.has(weekStart),
    })),
  });
});

// POST /availability/mine/confirm  { weekStart } — "my hours are right for this week"
router.post('/mine/confirm', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });
  const weekStart = parseWeekStart(req.body?.weekStart);
  if (!weekStart) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });

  await prisma.availabilityConfirmation.upsert({
    where: { employeeId_weekStart: { employeeId, weekStart } },
    create: { employeeId, weekStart },
    update: { confirmedAt: new Date() },
  });
  res.json({ weekStart: weekStart.toISOString().slice(0, 10), confirmed: true });
});

// PUT /availability/mine/week  { weekStart, windows: [{day,start,end}] }
router.put('/mine/week', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });
  const weekStart = parseWeekStart(req.body?.weekStart);
  if (!weekStart) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
  const windows = cleanWindows(req.body?.windows);
  if (typeof windows === 'string') return res.status(400).json({ error: windows });

  await prisma.weekAvailability.upsert({
    where: { employeeId_weekStart: { employeeId, weekStart } },
    create: { employeeId, weekStart, windows: windows as unknown as Prisma.InputJsonValue },
    update: { windows: windows as unknown as Prisma.InputJsonValue },
  });
  // saving a one-week override counts as "I've checked this week"
  await prisma.availabilityConfirmation.upsert({
    where: { employeeId_weekStart: { employeeId, weekStart } },
    create: { employeeId, weekStart },
    update: { confirmedAt: new Date() },
  });

  // a change to a future week -> ping any manager who opted in (fire-and-forget)
  if (weekStart.getTime() > mondayUTC().getTime()) {
    void notifyManagersOfAvailabilityChange(employeeId, weekStart).catch((e) =>
      console.error('[availability] manager notify failed', e),
    );
  }

  res.json({ weekStart: weekStart.toISOString().slice(0, 10), hasOverride: true, windows });
});

/** Notify managers/owners who set notifyOnAvailabilityUpdate that this worker just
 * changed a future week's hours. */
async function notifyManagersOfAvailabilityChange(employeeId: number, weekStart: Date): Promise<void> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      name: true,
      employeeStores: { select: { store: { select: { id: true, orgId: true } } } },
    },
  });
  if (!emp || emp.employeeStores.length === 0) return;

  const storeIds = emp.employeeStores.map((es) => es.store.id);
  const orgIds = [...new Set(emp.employeeStores.map((es) => es.store.orgId))];

  const managers = await prisma.user.findMany({
    where: {
      notifyOnAvailabilityUpdate: true,
      OR: [
        { role: 'OWNER', orgId: { in: orgIds } },
        { managerStores: { some: { storeId: { in: storeIds } } } },
      ],
    },
    select: { id: true },
  });
  if (managers.length === 0) return;

  const sun = new Date(weekStart);
  sun.setUTCDate(sun.getUTCDate() + 6);
  const f = (x: Date) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const range = `${f(weekStart)} – ${f(sun)}`;

  await notifyMany(
    managers.map((m) => m.id),
    {
      kind: 'GENERIC',
      title: `${emp.name} updated their availability for ${range}`,
      body: `${emp.name} changed their hours for the week of ${range}. Check it before you build that week's schedule.`,
      link: '/schedule',
      email: true,
    },
  );
}

// DELETE /availability/mine/week?weekStart=YYYY-MM-DD  — revert that week to standing
router.delete('/mine/week', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });
  const weekStart = parseWeekStart(req.query.weekStart);
  if (!weekStart) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
  await prisma.weekAvailability.deleteMany({ where: { employeeId, weekStart } });
  res.json({ ok: true });
});

// GET /availability/week?weekStart=YYYY-MM-DD  (manager) — every override for that
// week, for employees at the caller's stores. Flattened to {employeeId,day,start,end}.
router.get('/week', ...manager, async (req, res) => {
  const weekStart = parseWeekStart(req.query.weekStart);
  if (!weekStart) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
  const rows = await prisma.weekAvailability.findMany({
    where: {
      weekStart,
      employee: { employeeStores: { some: { storeId: { in: req.user!.storeIds } } } },
    },
  });
  const flat: { employeeId: number; day: string; start: string; end: string }[] = [];
  for (const r of rows) {
    for (const w of r.windows as unknown as Window[]) {
      flat.push({ employeeId: r.employeeId, day: w.day, start: w.start, end: w.end });
    }
  }
  res.json({ overriddenEmployeeIds: rows.map((r) => r.employeeId), windows: flat });
});

// GET /availability/confirmations?weekStart=YYYY-MM-DD  (manager)
// Per worker at the caller's stores: their effective availability for that week
// (a one-week override if they set one, else their standing hours), the days
// they're on leave, and whether they've dealt with the weekly check:
//   'changed'   = saved a one-week override
//   'confirmed' = pressed "my hours are right"
//   'pending'   = neither
router.get('/confirmations', ...manager, async (req, res) => {
  const weekStart = parseWeekStart(req.query.weekStart);
  if (!weekStart) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
  const scope = { employee: { employeeStores: { some: { storeId: { in: req.user!.storeIds } } } } };
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const [employees, overrides, confirms, standing, vacations] = await Promise.all([
    prisma.employee.findMany({
      where: { standby: false, employeeStores: { some: { storeId: { in: req.user!.storeIds } } } },
      select: { id: true, name: true, employeeStores: { select: { storeId: true } } },
    }),
    prisma.weekAvailability.findMany({
      where: { weekStart, ...scope },
      select: { employeeId: true, updatedAt: true, windows: true },
    }),
    prisma.availabilityConfirmation.findMany({
      where: { weekStart, ...scope },
      select: { employeeId: true, confirmedAt: true },
    }),
    prisma.recurringAvailability.findMany({
      where: scope,
      orderBy: [{ day: 'asc' }, { start: 'asc' }],
    }),
    prisma.timeOffRequest.findMany({
      where: { cancelledAt: null, startDate: { lte: weekEnd }, endDate: { gte: weekStart }, ...scope },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
  ]);

  const changedAt = new Map(overrides.map((o) => [o.employeeId, o.updatedAt]));
  const confirmedAt = new Map(confirms.map((c) => [c.employeeId, c.confirmedAt]));
  const overrideWins = new Map(
    overrides.map((o) => [o.employeeId, o.windows as unknown as Window[]]),
  );

  const DOW = Object.values(DayOfWeek) as DayOfWeek[];
  const standingByEmp = new Map<number, Record<string, { start: string; end: string }[]>>();
  for (const r of standing) {
    const days = standingByEmp.get(r.employeeId) ?? {};
    (days[r.day] ??= []).push({ start: toHHMM(r.start), end: toHHMM(r.end) });
    standingByEmp.set(r.employeeId, days);
  }

  const offByEmp = new Map<number, Set<string>>();
  for (const v of vacations) {
    const set = offByEmp.get(v.employeeId) ?? new Set<string>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setUTCDate(d.getUTCDate() + i);
      if (d >= v.startDate && d <= v.endDate) set.add(DOW[i]!);
    }
    offByEmp.set(v.employeeId, set);
  }

  res.json({
    weekStart: weekStart.toISOString().slice(0, 10),
    workers: employees.map((e) => {
      const changed = changedAt.get(e.id);
      const confirmed = confirmedAt.get(e.id);
      const ov = overrideWins.get(e.id);
      const days: Record<string, { start: string; end: string }[]> = {};
      if (ov) {
        for (const w of ov) (days[w.day] ??= []).push({ start: w.start, end: w.end });
      } else {
        Object.assign(days, standingByEmp.get(e.id) ?? {});
      }
      return {
        employeeId: e.id,
        name: e.name,
        storeIds: e.employeeStores.map((s) => s.storeId),
        state: changed ? 'changed' : confirmed ? 'confirmed' : 'pending',
        at: (changed ?? confirmed ?? null)?.toISOString() ?? null,
        source: ov ? 'override' : 'standing',
        days,
        timeOff: [...(offByEmp.get(e.id) ?? [])],
      };
    }),
  });
});

// NOTE: raw create/update/delete of a single RecurringAvailability row by id used
// to live here (POST /, PUT /:id, DELETE /:id). They were unused by the app and
// only role-gated — a manager could edit/delete ANY employee's row by guessing an
// id, across stores and orgs. Removed. Workers manage their own hours through
// /availability/mine*; managers read them via GET / and GET /:id (both store-scoped).

// GET /availability — windows for employees at stores the caller manages (used by
// the manager board's candidate picker). Managers/owners only.
router.get('/', ...manager, async (req, res) => {
  const availability = await prisma.recurringAvailability.findMany({
    where: { employee: { employeeStores: { some: { storeId: { in: req.user!.storeIds } } } } },
  });
  res.json(availability);
});

router.get('/:id', ...manager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const row = await prisma.recurringAvailability.findUnique({
    where: { id },
    include: { employee: { select: { employeeStores: { select: { storeId: true } } } } },
  });
  if (!row || !row.employee.employeeStores.some((es) => req.user!.storeIds.includes(es.storeId))) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(row);
});

export default router;
