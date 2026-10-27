import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor, storeIdFrom } from '../lib/auth.js';
import { mondayUTC } from '../lib/scheduleGen.js';
import { parseYMD, todayUTC } from '../lib/time.js';
import {
  clockModes,
  clockNow,
  entryDay,
  readTimes,
  scheduledShifts,
  shapeEntry,
  toStamp,
} from '../lib/timeClock.js';

// The time clock (a store's Settings › Time clock): people clocking in and
// out on their phones where it's FruitCrew's (APP), stretches brought in from
// the register's export where it's the POS's — and either way, a manager's
// weekly timesheet that Payroll's hours come from. Off (the default) = none
// of this shows anywhere and Payroll goes by the schedule.

const router = Router();

const DAY_MS = 86_400_000;
const unique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Stores this worker can clock in at: theirs, with the FruitCrew clock on. */
async function clockStores(employeeId: number) {
  const links = await prisma.employeeStore.findMany({
    where: { employeeId },
    select: {
      store: { select: { id: true, name: true, timeClock: true, parent: { select: { name: true, timeClock: true } } } },
    },
  });
  return links
    .filter((l) => (l.store.parent?.timeClock ?? l.store.timeClock) === 'APP')
    .map((l) => ({ storeId: l.store.id, name: l.store.parent ? `${l.store.parent.name} · ${l.store.name}` : l.store.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- the worker

// GET /time/me — the clock card: where they can clock in, whether they're on
// the clock (and on a break), and what they've already done today
router.get('/me', requireAuth, async (req, res) => {
  const employeeId = req.user!.employeeId;
  const now = clockNow();
  if (!employeeId) return res.json({ stores: [], open: null, today: [], now: toStamp(now) });
  const day = entryDay(now);
  const [stores, open, today] = await Promise.all([
    clockStores(employeeId),
    prisma.timeEntry.findFirst({ where: { employeeId, clockOut: null }, orderBy: { clockIn: 'desc' } }),
    prisma.timeEntry.findMany({
      where: { employeeId, clockIn: { gte: day, lt: new Date(day.getTime() + DAY_MS) }, clockOut: { not: null } },
      orderBy: { clockIn: 'asc' },
    }),
  ]);
  res.json({ stores, open: open ? shapeEntry(open) : null, today: today.map(shapeEntry), now: toStamp(now) });
});

// POST /time/clock-in { storeId }
router.post('/clock-in', requireAuth, async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) return res.status(403).json({ error: 'Your account isn’t on a team yet' });
  const storeId = Number(req.body?.storeId);
  const stores = await clockStores(employeeId);
  if (!stores.some((s) => s.storeId === storeId)) {
    return res.status(400).json({ error: 'That store doesn’t use the FruitCrew time clock' });
  }
  const open = await prisma.timeEntry.findFirst({ where: { employeeId, clockOut: null } });
  if (open) return res.status(409).json({ error: 'You’re already on the clock' });
  try {
    const entry = await prisma.timeEntry.create({
      data: { employeeId, storeId, clockIn: clockNow(), source: 'CLOCK' },
    });
    res.json(shapeEntry(entry));
  } catch (e) {
    if (unique(e)) return res.status(409).json({ error: 'You just clocked out — give it a minute, then clock back in' });
    throw e;
  }
});

/** The caller's stretch on the clock right now, or a 409 saying they aren't on one. */
async function openEntryOf(employeeId: number | null) {
  if (!employeeId) return null;
  return prisma.timeEntry.findFirst({ where: { employeeId, clockOut: null }, orderBy: { clockIn: 'desc' } });
}

// POST /time/clock-out — ends a break first if they're on one
router.post('/clock-out', requireAuth, async (req, res) => {
  const open = await openEntryOf(req.user!.employeeId);
  if (!open) return res.status(409).json({ error: 'You’re not on the clock' });
  const now = clockNow();
  const onBreak = open.breakStartedAt ? Math.round((now.getTime() - open.breakStartedAt.getTime()) / 60_000) : 0;
  const entry = await prisma.timeEntry.update({
    where: { id: open.id },
    data: { clockOut: now, breakMinutes: open.breakMinutes + onBreak, breakStartedAt: null },
  });
  res.json(shapeEntry(entry));
});

// POST /time/break { on: boolean } — start or end an unpaid break
router.post('/break', requireAuth, async (req, res) => {
  const on = req.body?.on;
  if (typeof on !== 'boolean') return res.status(400).json({ error: 'on must be true or false' });
  const open = await openEntryOf(req.user!.employeeId);
  if (!open) return res.status(409).json({ error: 'You’re not on the clock' });
  const now = clockNow();
  if (on === !!open.breakStartedAt) {
    return res.status(409).json({ error: on ? 'You’re already on a break' : 'You’re not on a break' });
  }
  const entry = await prisma.timeEntry.update({
    where: { id: open.id },
    data: on
      ? { breakStartedAt: now }
      : {
          breakStartedAt: null,
          breakMinutes: open.breakMinutes + Math.round((now.getTime() - open.breakStartedAt!.getTime()) / 60_000),
        },
  });
  res.json(shapeEntry(entry));
});

// ---------------------------------------------------------------- managers

/** The week (Monday) a "YYYY-MM-DD" falls in — this week when it's missing. */
const weekOf = (v: unknown) => mondayUTC(parseYMD(v) ?? todayUTC());

/** 409 unless this store has a time clock — nothing to keep when it's off. */
async function clockOn(storeId: number) {
  return ((await clockModes([storeId])).get(storeId) ?? 'OFF') !== 'OFF';
}

/** Whether this person works at this store. */
const worksAt = async (employeeId: number, storeId: number) =>
  !!(await prisma.employeeStore.findUnique({ where: { employeeId_storeId: { employeeId, storeId } } }));

// GET /time/week?storeId=&weekStart=YYYY-MM-DD — one store's timesheet:
// everyone's stretches that week next to what they were scheduled for, plus
// whoever's on the clock right now
router.get('/week', ...requireManagerFor(storeIdFrom), async (req, res) => {
  const storeId = storeIdFrom(req);
  const weekStart = weekOf(req.query.weekStart);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
  const [modes, linked, entries, openNow, scheduled] = await Promise.all([
    clockModes([storeId]),
    prisma.employee.findMany({
      where: { employeeStores: { some: { storeId } } },
      select: { id: true, name: true, avatarFruit: true, posName: true },
    }),
    prisma.timeEntry.findMany({ where: { storeId, clockIn: { gte: weekStart, lt: weekEnd } }, orderBy: { clockIn: 'asc' } }),
    prisma.timeEntry.findMany({ where: { storeId, clockOut: null }, orderBy: { clockIn: 'asc' } }),
    scheduledShifts(storeId, weekStart),
  ]);
  // anyone with hours here who's since moved on still shows, so nothing goes missing from payroll
  const known = new Set(linked.map((p) => p.id));
  const gone = [...new Set([...entries, ...openNow].map((e) => e.employeeId).filter((id) => !known.has(id)))];
  const former = gone.length
    ? await prisma.employee.findMany({ where: { id: { in: gone } }, select: { id: true, name: true, avatarFruit: true, posName: true } })
    : [];
  res.json({
    storeId,
    mode: modes.get(storeId) ?? 'OFF',
    weekStart: weekStart.toISOString().slice(0, 10),
    now: toStamp(clockNow()),
    people: [...linked, ...former].sort((a, b) => a.name.localeCompare(b.name)),
    entries: entries.map(shapeEntry),
    openNow: openNow.map(shapeEntry),
    scheduled,
  });
});

// POST /time/entries { storeId, employeeId, clockIn, clockOut?, breakMinutes? } — a
// manager adds a stretch someone forgot to clock (no clockOut = still on now)
router.post('/entries', ...requireManagerFor(storeIdFrom), async (req, res) => {
  const storeId = storeIdFrom(req);
  const employeeId = Number(req.body?.employeeId);
  if (!(await clockOn(storeId))) return res.status(409).json({ error: 'This store’s time clock is off' });
  if (!Number.isInteger(employeeId) || !(await worksAt(employeeId, storeId))) {
    return res.status(400).json({ error: 'They don’t work at this store' });
  }
  const times = readTimes(req.body ?? {});
  if ('error' in times) return res.status(400).json({ error: times.error });
  if (!times.clockOut && (await prisma.timeEntry.findFirst({ where: { employeeId, clockOut: null } }))) {
    return res.status(409).json({ error: 'They’re already on the clock' });
  }
  try {
    const entry = await prisma.timeEntry.create({
      data: { employeeId, storeId, ...times, source: 'MANUAL', editedById: req.user!.id },
    });
    res.json(shapeEntry(entry));
  } catch (e) {
    if (unique(e)) return res.status(409).json({ error: 'They already have hours starting then' });
    throw e;
  }
});

/** A stretch the caller may change, or why not. */
async function manageableEntry(req: Request) {
  const id = Number(req.params.id);
  const entry = Number.isInteger(id) ? await prisma.timeEntry.findUnique({ where: { id } }) : null;
  if (!entry || !canManageStore(req.user, entry.storeId)) return null;
  return entry;
}

// PUT /time/entries/:id { clockIn, clockOut?, breakMinutes? } — fixing a
// stretch takes it back out of approved, so the change gets looked at again
router.put('/entries/:id', requireAuth, async (req, res) => {
  const entry = await manageableEntry(req);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const times = readTimes(req.body ?? {});
  if ('error' in times) return res.status(400).json({ error: times.error });
  if (!times.clockOut && entry.clockOut) {
    return res.status(400).json({ error: 'Pick when they clocked out' });
  }
  try {
    const updated = await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        ...times,
        // closing it out ends any break that was running
        ...(times.clockOut ? { breakStartedAt: null } : {}),
        editedById: req.user!.id,
        approvedAt: null,
        approvedById: null,
      },
    });
    res.json(shapeEntry(updated));
  } catch (e) {
    if (unique(e)) return res.status(409).json({ error: 'They already have hours starting then' });
    throw e;
  }
});

router.delete('/entries/:id', requireAuth, async (req, res) => {
  const entry = await manageableEntry(req);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  await prisma.timeEntry.delete({ where: { id: entry.id } });
  res.json({ ok: true });
});

// POST /time/approve { storeId, weekStart } — signs off every finished
// stretch that week for payroll (still-open ones wait until they're closed)
router.post('/approve', ...requireManagerFor(storeIdFrom), async (req, res) => {
  const storeId = storeIdFrom(req);
  const weekStart = weekOf(req.body?.weekStart);
  const { count } = await prisma.timeEntry.updateMany({
    where: {
      storeId,
      clockIn: { gte: weekStart, lt: new Date(weekStart.getTime() + 7 * DAY_MS) },
      clockOut: { not: null },
      approvedAt: null,
    },
    data: { approvedAt: new Date(), approvedById: req.user!.id },
  });
  res.json({ approved: count });
});

const IMPORT_MAX_ROWS = 500;

// POST /time/import { storeId, rows: [{ employeeId, clockIn, clockOut, breakMinutes }],
//   names?: [{ employeeId, name }] } — stretches from the POS's time-entries
// export, already read and matched to people by the app. Importing the same
// export again updates instead of doubling up, but leaves alone anything a
// manager has fixed by hand. `names` remembers how the POS spells someone.
router.post('/import', ...requireManagerFor(storeIdFrom), async (req, res) => {
  const storeId = storeIdFrom(req);
  if (!(await clockOn(storeId))) return res.status(409).json({ error: 'This store’s time clock is off' });
  const rows: unknown[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'Nothing to import' });
  if (rows.length > IMPORT_MAX_ROWS) return res.status(400).json({ error: `Send at most ${IMPORT_MAX_ROWS} at a time` });

  const staff = new Set(
    (await prisma.employeeStore.findMany({ where: { storeId }, select: { employeeId: true } })).map((l) => l.employeeId),
  );
  const now = clockNow();
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const employeeId = Number(r.employeeId);
    const times = readTimes(r, now);
    // a stretch still open in the export comes in once it's closed
    if (!staff.has(employeeId) || 'error' in times || !times.clockOut) {
      skipped++;
      continue;
    }
    const key = { employeeId_storeId_clockIn: { employeeId, storeId, clockIn: times.clockIn } };
    const existing = await prisma.timeEntry.findUnique({ where: key });
    if (!existing) {
      await prisma.timeEntry.create({ data: { employeeId, storeId, ...times, source: 'IMPORT' } });
      added++;
    } else if (
      existing.editedById != null ||
      (existing.clockOut?.getTime() === times.clockOut.getTime() && existing.breakMinutes === times.breakMinutes)
    ) {
      unchanged++;
    } else {
      await prisma.timeEntry.update({
        where: { id: existing.id },
        data: { clockOut: times.clockOut, breakMinutes: times.breakMinutes, breakStartedAt: null, approvedAt: null, approvedById: null },
      });
      updated++;
    }
  }

  const names: unknown[] = Array.isArray(req.body?.names) ? req.body.names : [];
  for (const raw of names) {
    const n = (raw ?? {}) as Record<string, unknown>;
    const employeeId = Number(n.employeeId);
    const name = typeof n.name === 'string' ? n.name.trim().slice(0, 100) : '';
    if (staff.has(employeeId) && name) await prisma.employee.update({ where: { id: employeeId }, data: { posName: name } });
  }
  res.json({ added, updated, unchanged, skipped });
});

export default router;
