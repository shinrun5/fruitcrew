import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManager, requireManagerFor } from '../lib/auth.js';
import { sectionLabel, storeSections, usualSections } from '../lib/responsibilities.js';
import { isRunningWeek, isTradableWeek, mondayUTC } from '../lib/scheduleGen.js';
import { announceIfOpen, markUnposted, noticeHandEdit } from '../lib/shiftEdits.js';
import { HHMM, hhmmToMinutes, minuteOfDay, minutesToHHMM, parseYMD, toClock } from '../lib/time.js';

const router = Router();

/** A shift time from the client: "HH:MM", or the ISO wall-clock the board
 * sends. undefined passes through (field not being changed); anything
 * unparseable is null, so the caller can answer 400 instead of crashing. */
function clockFrom(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return null;
  const d = HHMM.test(v) ? toClock(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** sectionId from the client: undefined = not changing it, null = none,
 * otherwise one of this store's sections — false when it isn't. */
async function sectionFrom(v: unknown, storeId: number): Promise<number | null | undefined | false> {
  if (v === undefined || v === null) return v;
  return typeof v === 'number' && (await storeSections(storeId)).has(v) ? v : false;
}

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

const clockIso = (hhmm: string) => `1970-01-01T${hhmm}:00.000Z`;
const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

interface Coworker {
  name: string;
  avatarKey: number; // employeeId — feeds the deterministic default fruit
  avatarFruit: string | null;
  section: string | null; // the part of the store they're on for that shift
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
  section: string | null;
}

const sectionSelect = { select: { name: true, scope: true, archivedAt: true } } as const;

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
    include: { store: { include: { schedule: true, parent: { select: { tradeCutoffHours: true } } } } },
  });
  // a section follows its parent's trade rules (see Store.tradeCutoffHours)
  const cutoffOf = (l: (typeof links)[number]) => l.store.parent?.tradeCutoffHours ?? l.store.tradeCutoffHours;

  const shiftsOut: {
    id: number;
    employeeId: number | null;
    storeId: number;
    day: DayOfWeek;
    start: string;
    end: string;
    section: string | null;
    coworkers: Coworker[];
  }[] = [];
  const stores: { storeId: number; storeName: string; publishedAt: Date | null; weekStart: Date | null; live: boolean; tradeCutoffHours: number }[] = [];
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
          section: sectionSelect,
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
          section: sectionLabel(s.section),
        });
      }
      for (const r of all.filter((s) => s.employeeId === employeeId)) {
        const mS = minuteOfDay(r.start);
        const mE = minuteOfDay(r.end);
        const coworkers: Coworker[] = all
          .filter(
            (o) =>
              o.employeeId != null &&
              o.employeeId !== employeeId &&
              o.day === r.day &&
              overlaps(mS, mE, minuteOfDay(o.start), minuteOfDay(o.end)),
          )
          .map((o) => ({
            name: o.employee?.name ?? 'A coworker',
            avatarKey: o.employeeId ?? 0,
            avatarFruit: o.employee?.avatarFruit ?? null,
            section: sectionLabel(o.section),
          }));
        shiftsOut.push({
          id: r.id,
          employeeId: r.employeeId,
          storeId: l.storeId,
          day: r.day,
          start: r.start.toISOString(),
          end: r.end.toISOString(),
          section: sectionLabel(r.section),
          coworkers,
        });
      }
      stores.push({
        storeId: l.storeId,
        storeName: l.store.name,
        publishedAt: sched.publishedAt,
        weekStart: sched.postedWeekStart,
        live: true,
        tradeCutoffHours: cutoffOf(l),
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
        sectionName?: string | null;
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
          section: f.sectionName ?? null,
        });
      }
      for (const f of frozen) {
        if (f.employeeId !== employeeId) continue;
        const mS = hhmmToMinutes(f.start);
        const mE = hhmmToMinutes(f.end);
        const coworkers: Coworker[] = frozen
          .filter(
            (o) =>
              o.employeeId != null &&
              o.employeeId !== employeeId &&
              o.day === f.day &&
              overlaps(mS, mE, hhmmToMinutes(o.start), hhmmToMinutes(o.end)),
          )
          .map((o) => ({
            name: o.employeeName ?? 'A coworker',
            avatarKey: o.employeeId ?? 0,
            avatarFruit: fruitById.get(o.employeeId!) ?? null,
            section: o.sectionName ?? null,
          }));
        shiftsOut.push({
          id: -++synthetic, // read-only; no marketplace actions in this state
          employeeId,
          storeId: l.storeId,
          day: f.day,
          start: clockIso(f.start),
          end: clockIso(f.end),
          section: f.sectionName ?? null,
          coworkers,
        });
      }
      stores.push({
        storeId: l.storeId,
        storeName: l.store.name,
        publishedAt: snap.savedAt,
        weekStart: snap.weekStart,
        live: false,
        tradeCutoffHours: cutoffOf(l),
      });
    }
  }

  shiftsOut.sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start));
  team.sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name));

  // Every week between this one and the posted week, read-only. Posting a
  // later week archives the previously posted one even if it hasn't happened
  // yet (see retirePostedWeek) — e.g. posting the week of the 19th while the
  // 12th's is still to come — so read those from their archived copy rather
  // than let them vanish from people's phones. This calendar week is the
  // common case: Saturday's shift mustn't disappear on Friday.
  const thisMonday = mondayUTC();
  const WEEK_MS = 7 * 86_400_000;
  const betweenOut = new Map<number, typeof shiftsOut>(); // weekStart ms → shifts
  const betweenTeam = new Map<number, TeamShift[]>();
  // weeks still running live (see isRunningWeek): real shift ids, so
  // Sunday can be swapped after next week is posted
  const betweenLive = new Set<number>();
  for (const l of links) {
    const sched = l.store.schedule;
    if (!sched?.postedWeekStart || sched.postedWeekStart.getTime() <= thisMonday.getTime()) continue;
    // a week that's only being re-drafted right now: its posted copy, never the draft
    const draftOnly = sched.weekStart && sched.weekStart.getTime() !== sched.postedWeekStart.getTime() ? sched.weekStart.getTime() : null;
    for (let t = thisMonday.getTime(); t < sched.postedWeekStart.getTime(); t += WEEK_MS) {
      const weekStart = new Date(t);
      const live =
        t === draftOnly
          ? []
          : await prisma.shift.findMany({
              where: { storeId: l.storeId, weekStart },
              select: { id: true, employeeId: true, day: true, start: true, end: true, employee: { select: { name: true, avatarFruit: true } }, section: sectionSelect },
            });
      let rows: { id: number | null; employeeId: number | null; name: string | null; avatarFruit: string | null; day: DayOfWeek; s: number; e: number; section: string | null }[];
      const tradable = live.length > 0 && isTradableWeek(sched, weekStart);
      if (tradable) betweenLive.add(t);
      if (live.length) {
        rows = live.map((r) => ({ id: tradable ? r.id : null, employeeId: r.employeeId, name: r.employee?.name ?? null, avatarFruit: r.employee?.avatarFruit ?? null, day: r.day, s: minuteOfDay(r.start), e: minuteOfDay(r.end), section: sectionLabel(r.section) }));
      } else {
        const snap = await prisma.scheduleSnapshot.findFirst({ where: { storeId: l.storeId, weekStart }, orderBy: { savedAt: 'desc' } });
        const frozen = (snap?.shifts ?? []) as { employeeId: number | null; employeeName: string | null; day: DayOfWeek; start: string; end: string; sectionName?: string | null }[];
        rows = frozen.map((f) => ({ id: null, employeeId: f.employeeId, name: f.employeeName, avatarFruit: null, day: f.day, s: hhmmToMinutes(f.start), e: hhmmToMinutes(f.end), section: f.sectionName ?? null }));
      }
      const team = betweenTeam.get(t) ?? [];
      for (const r of rows) {
        team.push({
          storeId: l.storeId,
          day: r.day,
          start: clockIso(minutesToHHMM(r.s)),
          end: clockIso(minutesToHHMM(r.e)),
          employeeId: r.employeeId,
          name: r.name ?? (r.employeeId == null ? 'Open shift' : 'A coworker'),
          avatarKey: r.employeeId ?? 0,
          avatarFruit: r.avatarFruit,
          section: r.section,
        });
      }
      if (team.length) betweenTeam.set(t, team);
      const out = betweenOut.get(t) ?? [];
      for (const r of rows.filter((x) => x.employeeId === employeeId)) {
        out.push({
          id: r.id ?? -++synthetic, // synthetic = read-only (an archived copy)
          employeeId,
          storeId: l.storeId,
          day: r.day,
          start: clockIso(minutesToHHMM(r.s)),
          end: clockIso(minutesToHHMM(r.e)),
          section: r.section,
          coworkers: rows
            .filter((o) => o.employeeId != null && o.employeeId !== employeeId && o.day === r.day && overlaps(r.s, r.e, o.s, o.e))
            .map((o) => ({ name: o.name ?? 'A coworker', avatarKey: o.employeeId!, avatarFruit: o.avatarFruit, section: o.section })),
        });
      }
      if (out.length) betweenOut.set(t, out);
    }
  }
  const thisWeekOut = betweenOut.get(thisMonday.getTime()) ?? [];
  const weekEntry = (t: number, shifts: typeof shiftsOut) => ({
    weekStart: new Date(t),
    shifts,
    team: (betweenTeam.get(t) ?? []).sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name)),
    // swaps/drops/pickups work here too, not just in the posted week
    live: betweenLive.has(t),
  });
  const upcomingWeeks = [...betweenOut.entries()]
    .filter(([t]) => t > thisMonday.getTime())
    .sort(([a], [b]) => a - b)
    .map(([t, shifts]) => weekEntry(t, shifts));

  res.json({
    thisWeek: thisWeekOut.length || betweenTeam.has(thisMonday.getTime()) ? weekEntry(thisMonday.getTime(), thisWeekOut) : null,
    // weeks after this one but before the posted week (see above) — read-only
    upcomingWeeks,
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
  const postedLinks = links.filter((l) => l.store.schedule?.postedWeekStart);
  if (postedLinks.length === 0) return res.json([]);

  // the posted week and any running week before it (see isTradableWeek)
  const shifts = await prisma.shift.findMany({
    where: {
      employeeId: null,
      OR: postedLinks.map((l) => ({ storeId: l.storeId, weekStart: { gte: mondayUTC(), lte: l.store.schedule!.postedWeekStart! } })),
    },
    orderBy: [{ weekStart: 'asc' }, { day: 'asc' }, { start: 'asc' }],
  });
  const schedOf = new Map(postedLinks.map((l) => [l.storeId, l.store.schedule]));
  res.json(shifts.filter((s) => isTradableWeek(schedOf.get(s.storeId) ?? null, s.weekStart)));
});

// POST /shifts  { employeeId?, storeId, day, start, end, sectionId?, weekStart? }  (manager of that store)
// No employeeId → an open shift for the crew to pick up in their Market. No
// sectionId → the person's usual section, if they have one. No weekStart →
// the board's week; a running week (see isRunningWeek) can be named instead.
router.post('/', ...requireManagerFor((req) => Number(req.body?.storeId)), async (req, res) => {
  const { employeeId, storeId, day } = req.body;
  const start = clockFrom(req.body?.start);
  const end = clockFrom(req.body?.end);
  if (!storeId || !day || !start || !end) {
    return res.status(400).json({ error: 'storeId, day, start, and end are required' });
  }
  if (minuteOfDay(start) >= minuteOfDay(end)) return res.status(400).json({ error: 'A shift has to end after it starts' });
  if (employeeId != null) {
    const link = await prisma.employeeStore.findUnique({ where: { employeeId_storeId: { employeeId, storeId } } });
    if (!link) return res.status(400).json({ error: "That worker isn't assigned to this store" });
  }
  const picked = await sectionFrom(req.body?.sectionId, storeId);
  if (picked === false) return res.status(400).json({ error: "That section isn't one of this store's" });
  const sectionId =
    picked !== undefined ? picked : employeeId != null ? ((await usualSections(storeId)).get(employeeId) ?? null) : null;
  const schedule = await prisma.schedule.findUnique({ where: { storeId } });
  let weekStart = schedule?.weekStart ?? mondayUTC();
  if (req.body?.weekStart !== undefined) {
    const asked = parseYMD(req.body.weekStart);
    if (!asked) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
    const week = mondayUTC(asked);
    if (week.getTime() !== weekStart.getTime() && !isRunningWeek(schedule, week)) {
      return res.status(400).json({ error: "That week can't be changed from the board" });
    }
    weekStart = week;
  }
  try {
    await noticeHandEdit(storeId, weekStart, [{ day, employeeId: employeeId ?? null }]);
    const newShift = await prisma.shift.create({ data: { employeeId, storeId, weekStart, day, start, end, sectionId } });
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
    await announceIfOpen(newShift);
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
router.get('/', ...requireManager, async (req, res) => {
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

router.get('/:id', ...requireManager, async (req, res) => {
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
    const cur = await prisma.shift.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
    await noticeHandEdit(cur.storeId, cur.weekStart, [cur]);
    const shift = await prisma.shift.delete({ where: { id: cur.id } });
    await markUnposted(shift.storeId, shift.weekStart);
    res.json({ message: `Shift ${shift.id} deleted successfully` });
  } catch {
    res.status(500).json({ error: 'Failed to delete shift' });
  }
});

router.put('/:id', requireAuth, requireManagerOfShift, async (req, res) => {
  // no storeId here on purpose — a shift can't be moved to another store (the
  // guard only checked the CURRENT store), only its people/time/section can
  // change. A new person keeps the shift's section: it's the same slot.
  const { employeeId, day } = req.body;
  const start = clockFrom(req.body?.start);
  const end = clockFrom(req.body?.end);
  if (start === null || end === null) return res.status(400).json({ error: 'start and end must be times like "09:00"' });
  const cur = await prisma.shift.findUnique({
    where: { id: Number(req.params.id) },
    select: { storeId: true, weekStart: true, day: true, employeeId: true, start: true, end: true },
  });
  if (!cur) return res.status(404).json({ error: 'Not found' });
  if ((start !== undefined || end !== undefined) && minuteOfDay(start ?? cur.start) >= minuteOfDay(end ?? cur.end)) {
    return res.status(400).json({ error: 'A shift has to end after it starts' });
  }
  if (employeeId != null) {
    const link = await prisma.employeeStore.findUnique({
      where: { employeeId_storeId: { employeeId, storeId: cur.storeId } },
    });
    if (!link) return res.status(400).json({ error: "That worker isn't assigned to this store" });
  }
  const sectionId = await sectionFrom(req.body?.sectionId, cur.storeId);
  if (sectionId === false) return res.status(400).json({ error: "That section isn't one of this store's" });
  try {
    await noticeHandEdit(cur.storeId, cur.weekStart, [
      cur,
      { day: day ?? cur.day, employeeId: employeeId === undefined ? cur.employeeId : employeeId },
    ]);
    const updatedShift = await prisma.shift.update({
      where: { id: Number(req.params.id) },
      data: { employeeId, day, ...(sectionId !== undefined ? { sectionId } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) },
    });
    await markUnposted(updatedShift.storeId, updatedShift.weekStart);
    // someone taken off and the shift left for the crew to pick up
    if (employeeId === null && cur.employeeId != null) await announceIfOpen(updatedShift, cur.employeeId);
    res.json(updatedShift);
  } catch {
    res.status(500).json({ error: 'Failed to update shift' });
  }
});

export default router;
