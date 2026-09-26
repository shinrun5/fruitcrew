import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor, requireRole } from '../lib/auth.js';
import { mondayUTC } from '../lib/scheduleGen.js';

const router = Router();
const anyManager = [requireAuth, requireRole('MANAGER', 'OWNER')] as const;

/** guard for PUT/DELETE /:id — the store isn't in the request, so load the shift first */
async function requireManagerOfShift(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const shift = await prisma.shift.findUnique({ where: { id }, select: { storeId: true } });
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  if (!canManageStore(req.user, shift.storeId)) {
    return res.status(403).json({ error: 'You do not manage that store' });
  }
  next();
}

/** A hand edit to the live board (not a solver regenerate, not an approved
 * swap — those already handle this themselves) shouldn't reach workers until
 * the manager reposts — but only when the edited shift is actually part of
 * the currently POSTED week. Hand-editing a next-week draft never affects
 * what's posted; workers keep seeing exactly what they saw before. */
async function markUnposted(storeId: number, shiftWeekStart: Date): Promise<void> {
  const schedule = await prisma.schedule.findUnique({ where: { storeId }, select: { postedWeekStart: true } });
  if (!schedule?.postedWeekStart || schedule.postedWeekStart.getTime() !== shiftWeekStart.getTime()) return;
  await prisma.schedule.updateMany({
    where: { storeId, publishedAt: { not: null } },
    data: { publishedAt: null },
  });
}

const clockIso = (hhmm: string) => `1970-01-01T${hhmm}:00.000Z`;
const minOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
const minHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

interface Coworker {
  name: string;
  avatarKey: number; // employeeId — feeds the deterministic default fruit
  avatarFruit: string | null;
}

interface TeamShift {
  storeId: number;
  day: DayOfWeek;
  start: string;
  end: string;
  employeeId: number | null; // null = an open (unassigned) slot
  name: string;
  avatarKey: number;
  avatarFruit: string | null;
}

// The signed-in employee's own shifts, per store.
//   - store's schedule is published  -> live Shift rows (marketplace actions work)
//   - a draft is in progress but the store has a posted snapshot -> that frozen
//     week, read-only ("live: false"), so workers keep seeing last posted week
//   - neither -> nothing
router.get('/mine', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const links = await prisma.employeeStore.findMany({
    where: { employeeId },
    include: { store: { include: { schedule: true } } },
  });

  const shiftsOut: {
    id: number;
    employeeId: number | null;
    storeId: number;
    day: DayOfWeek;
    start: string;
    end: string;
    coworkers: Coworker[];
  }[] = [];
  const stores: { storeId: number; storeName: string; publishedAt: Date | null; weekStart: Date | null; live: boolean }[] = [];
  const team: TeamShift[] = [];
  let synthetic = 0;

  for (const l of links) {
    const sched = l.store.schedule;
    if (!sched) continue;

    // "live" whenever there's a posted week at all — independent of whatever
    // week the manager's board happens to be drafting in parallel. The posted
    // week's own live Shift rows are never touched by a coexisting draft.
    const liveNow = !!sched.publishedAt && !!sched.postedWeekStart;

    if (liveNow) {
      const all = await prisma.shift.findMany({
        where: { storeId: l.storeId, weekStart: sched.postedWeekStart! },
        select: {
          id: true,
          employeeId: true,
          day: true,
          start: true,
          end: true,
          employee: { select: { name: true, avatarFruit: true } },
        },
        orderBy: [{ day: 'asc' }, { start: 'asc' }],
      });
      for (const s of all) {
        team.push({
          storeId: l.storeId,
          day: s.day,
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          employeeId: s.employeeId,
          name: s.employee?.name ?? 'Open shift',
          avatarKey: s.employeeId ?? 0,
          avatarFruit: s.employee?.avatarFruit ?? null,
        });
      }
      for (const r of all.filter((s) => s.employeeId === employeeId)) {
        const mS = minOf(r.start);
        const mE = minOf(r.end);
        const coworkers: Coworker[] = all
          .filter(
            (o) =>
              o.employeeId != null &&
              o.employeeId !== employeeId &&
              o.day === r.day &&
              overlaps(mS, mE, minOf(o.start), minOf(o.end)),
          )
          .map((o) => ({
            name: o.employee?.name ?? 'A coworker',
            avatarKey: o.employeeId ?? 0,
            avatarFruit: o.employee?.avatarFruit ?? null,
          }));
        shiftsOut.push({
          id: r.id,
          employeeId: r.employeeId,
          storeId: l.storeId,
          day: r.day,
          start: r.start.toISOString(),
          end: r.end.toISOString(),
          coworkers,
        });
      }
      stores.push({
        storeId: l.storeId,
        storeName: l.store.name,
        publishedAt: sched.publishedAt,
        weekStart: sched.postedWeekStart,
        live: true,
      });
      continue;
    }

    const postedSnap = sched.postedSnapshotId
      ? await prisma.scheduleSnapshot.findUnique({ where: { id: sched.postedSnapshotId } })
      : null;
    if (postedSnap) {
      const snap = postedSnap;
      const frozen = snap.shifts as {
        employeeId: number | null;
        employeeName: string | null;
        day: DayOfWeek;
        start: string;
        end: string;
      }[];
      // current fruit for everyone on the frozen week
      const otherIds = [
        ...new Set(frozen.filter((f) => f.employeeId != null).map((f) => f.employeeId!)),
      ];
      const fruitById = new Map(
        (
          await prisma.employee.findMany({
            where: { id: { in: otherIds } },
            select: { id: true, avatarFruit: true },
          })
        ).map((e) => [e.id, e.avatarFruit]),
      );
      for (const f of frozen) {
        team.push({
          storeId: l.storeId,
          day: f.day,
          start: clockIso(f.start),
          end: clockIso(f.end),
          employeeId: f.employeeId,
          name: f.employeeName ?? (f.employeeId == null ? 'Open shift' : 'A coworker'),
          avatarKey: f.employeeId ?? 0,
          avatarFruit: f.employeeId != null ? fruitById.get(f.employeeId) ?? null : null,
        });
      }
      for (const f of frozen) {
        if (f.employeeId !== employeeId) continue;
        const mS = minHHMM(f.start);
        const mE = minHHMM(f.end);
        const coworkers: Coworker[] = frozen
          .filter(
            (o) =>
              o.employeeId != null &&
              o.employeeId !== employeeId &&
              o.day === f.day &&
              overlaps(mS, mE, minHHMM(o.start), minHHMM(o.end)),
          )
          .map((o) => ({
            name: o.employeeName ?? 'A coworker',
            avatarKey: o.employeeId ?? 0,
            avatarFruit: fruitById.get(o.employeeId!) ?? null,
          }));
        shiftsOut.push({
          id: -++synthetic, // read-only; no marketplace actions in this state
          employeeId,
          storeId: l.storeId,
          day: f.day,
          start: clockIso(f.start),
          end: clockIso(f.end),
          coworkers,
        });
      }
      stores.push({
        storeId: l.storeId,
        storeName: l.store.name,
        publishedAt: snap.savedAt,
        weekStart: snap.weekStart,
        live: false,
      });
    }
  }

  shiftsOut.sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start));
  team.sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name));

  res.json({
    published: stores.length > 0,
    // marketplace is only offered when every shown store is on its live schedule
    live: stores.length > 0 && stores.every((s) => s.live),
    publishedAt: stores[0]?.publishedAt ?? null,
    weekStart: stores[0]?.weekStart ?? null,
    shifts: shiftsOut,
    team,
    stores,
  });
});

// Unassigned shifts the caller could pick up — at a posted store they work.
router.get('/open', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const links = await prisma.employeeStore.findMany({
    where: { employeeId },
    include: { store: { include: { schedule: true } } },
  });
  const postedLinks = links.filter((l) => l.store.schedule?.publishedAt && l.store.schedule?.postedWeekStart);
  if (postedLinks.length === 0) return res.json([]);

  const shifts = await prisma.shift.findMany({
    where: {
      employeeId: null,
      OR: postedLinks.map((l) => ({ storeId: l.storeId, weekStart: l.store.schedule!.postedWeekStart! })),
    },
    orderBy: [{ day: 'asc' }, { start: 'asc' }],
  });
  res.json(shifts);
});

// POST /shifts  { employeeId?, storeId, day, start, end }  (manager of that store)
router.post('/', ...requireManagerFor((req) => Number(req.body?.storeId)), async (req, res) => {
  const { employeeId, storeId, day, start, end } = req.body;
  if (!storeId || !day || !start || !end) {
    return res.status(400).json({ error: 'storeId, day, start, and end are required' });
  }
  if (employeeId != null) {
    const link = await prisma.employeeStore.findUnique({ where: { employeeId_storeId: { employeeId, storeId } } });
    if (!link) return res.status(400).json({ error: "That worker isn't assigned to this store" });
  }
  const schedule = await prisma.schedule.findUnique({ where: { storeId } });
  const weekStart = schedule?.weekStart ?? mondayUTC();
  try {
    const newShift = await prisma.shift.create({ data: { employeeId, storeId, weekStart, day, start, end } });
    // same reason as generateScheduleForStore's persistWeekOp: a store that's
    // never had an explicit PUT /schedule/week or generate needs this written
    // for real, not just computed as a fallback each time it's read
    if (!schedule?.weekStart) {
      await prisma.schedule.upsert({
        where: { storeId },
        create: { storeId, weekStart },
        update: { weekStart },
      });
    }
    await markUnposted(storeId, weekStart);
    res.json(newShift);
  } catch {
    res.status(500).json({ error: 'Failed to create shift' });
  }
});

// GET /shifts?weekStart=   — the manager board's read. With no weekStart
// given, each store is scoped to ITS OWN current draft week (Schedule.weekStart)
// — not a single week applied across every managed store, since two stores
// can independently be drafting different weeks at once. Pass an explicit
// weekStart to instead pull one specific week across every managed store.
router.get('/', ...anyManager, async (req, res) => {
  const raw = req.query.weekStart;
  const explicitWeek = typeof raw === 'string' && !Number.isNaN(new Date(raw).getTime()) ? new Date(raw) : undefined;

  if (explicitWeek) {
    const shifts = await prisma.shift.findMany({
      where: { storeId: { in: req.user!.storeIds }, weekStart: explicitWeek },
    });
    return res.json(shifts);
  }

  const schedules = await prisma.schedule.findMany({
    where: { storeId: { in: req.user!.storeIds }, weekStart: { not: null } },
    select: { storeId: true, weekStart: true },
  });
  if (schedules.length === 0) return res.json([]);
  const shifts = await prisma.shift.findMany({
    where: { OR: schedules.map((s) => ({ storeId: s.storeId, weekStart: s.weekStart! })) },
  });
  res.json(shifts);
});

router.get('/:id', ...anyManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const shift = await prisma.shift.findUnique({ where: { id } });
  if (!shift || !req.user!.storeIds.includes(shift.storeId)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(shift);
});

router.delete('/:id', requireAuth, requireManagerOfShift, async (req, res) => {
  try {
    const shift = await prisma.shift.delete({ where: { id: Number(req.params.id) } });
    await markUnposted(shift.storeId, shift.weekStart);
    res.json({ message: `Shift ${shift.id} deleted successfully` });
  } catch {
    res.status(500).json({ error: 'Failed to delete shift' });
  }
});

router.put('/:id', requireAuth, requireManagerOfShift, async (req, res) => {
  // no storeId here on purpose — a shift can't be moved to another store (the
  // guard only checked the CURRENT store), only its people/time can change
  const { employeeId, day, start, end } = req.body;
  if (employeeId != null) {
    const shift = await prisma.shift.findUnique({ where: { id: Number(req.params.id) }, select: { storeId: true } });
    if (!shift) return res.status(404).json({ error: 'Not found' });
    const link = await prisma.employeeStore.findUnique({
      where: { employeeId_storeId: { employeeId, storeId: shift.storeId } },
    });
    if (!link) return res.status(400).json({ error: "That worker isn't assigned to this store" });
  }
  try {
    const updatedShift = await prisma.shift.update({
      where: { id: Number(req.params.id) },
      data: { employeeId, day, start, end },
    });
    await markUnposted(updatedShift.storeId, updatedShift.weekStart);
    res.json(updatedShift);
  } catch {
    res.status(500).json({ error: 'Failed to update shift' });
  }
});

export default router;
