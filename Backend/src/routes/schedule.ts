import { Router, type Request } from 'express';
import { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor } from '../lib/auth.js';
import { freezeShifts, generateScheduleForStore, mondayUTC } from '../lib/scheduleGen.js';
import { alertError } from '../lib/errorAlert.js';

const router = Router();

// storeId comes in the query on GETs, the body on writes
const storeIdFrom = (req: Request) => Number(req.query.storeId ?? req.body?.storeId);
const manageStore = requireManagerFor(storeIdFrom);

function parseYMD(s: unknown): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- one Schedule row per store ---

// GET /schedule/status?storeId=
router.get('/status', requireAuth, async (req, res) => {
  const storeId = Number(req.query.storeId);
  if (!Number.isInteger(storeId)) return res.status(400).json({ error: 'storeId is required' });
  if (!req.user!.storeIds.includes(storeId)) {
    return res.status(403).json({ error: 'No access to that store' });
  }
  const schedule = await prisma.schedule.findUnique({ where: { storeId } });
  const curWeek = schedule?.weekStart ?? mondayUTC();
  const today = mondayUTC();
  const postedSnap = schedule?.postedSnapshotId
    ? await prisma.scheduleSnapshot.findUnique({
        where: { id: schedule.postedSnapshotId },
        select: { weekStart: true },
      })
    : null;
  // Every week that has ever been frozen (published, archived on advance, or
  // manually saved) — a manager can look back at any of them, not just the ones
  // before wherever the board's pointer happens to be right now.
  const snapRows = await prisma.scheduleSnapshot.findMany({
    where: { storeId },
    orderBy: { weekStart: 'desc' },
    distinct: ['weekStart'],
    select: { weekStart: true },
  });
  const weeks = new Set(snapRows.map((r) => r.weekStart.getTime()));
  // The board's own week counts as "past" too once its calendar week has
  // actually ended, even if nobody has advanced past it yet — it'll be frozen
  // on first view (see /week-view below).
  const curWeekIsStale = curWeek.getTime() < today.getTime();
  if (curWeekIsStale) weeks.add(curWeek.getTime());
  const pastWeeks = [...weeks].sort((a, b) => b - a).map((t) => new Date(t));

  res.json({
    publishedAt: schedule?.publishedAt ?? null,
    weekStart: curWeek,
    // the week workers currently see (may lag the working week while a draft is in progress)
    postedWeekStart: postedSnap?.weekStart ?? null,
    pastWeeks,
    // the board is showing a week whose dates have already passed — nobody's
    // advanced it yet, so it's stale even though nothing has "locked" it
    liveWeekStale: curWeekIsStale,
  });
});

// GET /schedule/week-view?storeId=&weekStart=YYYY-MM-DD
// The frozen roster for a past week (posted, archived, or the live board itself
// once its calendar week has ended) — read-only display only.
router.get('/week-view', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const parsed = parseYMD(req.query.weekStart);
  if (!parsed) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
  const weekStart = mondayUTC(parsed);
  const snap = await prisma.scheduleSnapshot.findFirst({
    where: { storeId, weekStart },
    orderBy: { savedAt: 'desc' },
  });
  if (snap) return res.json(snap);

  // No snapshot yet — if this is the store's own current week and its calendar
  // week has already ended, freeze it now instead of saying "nothing here".
  const schedule = await prisma.schedule.findUnique({ where: { storeId }, select: { weekStart: true } });
  const isLiveWeek = !!schedule?.weekStart && schedule.weekStart.getTime() === weekStart.getTime();
  if (!isLiveWeek || weekStart.getTime() >= mondayUTC().getTime()) {
    return res.status(404).json({ error: 'No saved schedule for that week' });
  }
  const shifts = await freezeShifts(storeId);
  const fresh = await prisma.scheduleSnapshot.create({
    data: { storeId, weekStart, label: null, savedById: req.user!.id, shifts },
  });
  res.json(fresh);
});

router.post('/publish', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const existing = await prisma.schedule.findUnique({ where: { storeId } });
  const weekStart = existing?.weekStart ?? mondayUTC();

  // Freeze what workers will now see. Kept as the store's single 'posted' snapshot
  // (reused in place) so a later regenerate can't take this week away from them.
  const shifts = await freezeShifts(storeId);
  let postedSnapshotId = existing?.postedSnapshotId ?? null;
  if (postedSnapshotId) {
    const prev = await prisma.scheduleSnapshot.findUnique({
      where: { id: postedSnapshotId },
      select: { id: true, weekStart: true },
    });
    if (!prev) {
      postedSnapshotId = null;
    } else if (prev.weekStart.getTime() !== weekStart.getTime()) {
      // last posted week is a different week — keep it in history (drop the
      // 'posted' label) and start a fresh 'posted' snapshot for this week
      await prisma.scheduleSnapshot.update({ where: { id: prev.id }, data: { label: null } });
      postedSnapshotId = null;
    }
  }
  if (postedSnapshotId) {
    await prisma.scheduleSnapshot.update({
      where: { id: postedSnapshotId },
      data: { shifts, weekStart, label: 'posted', savedAt: new Date(), savedById: req.user!.id },
    });
  } else {
    const snap = await prisma.scheduleSnapshot.create({
      data: { storeId, weekStart, label: 'posted', savedById: req.user!.id, shifts },
    });
    postedSnapshotId = snap.id;
  }

  const schedule = await prisma.schedule.upsert({
    where: { storeId },
    create: { storeId, publishedAt: new Date(), publishedById: req.user!.id, postedSnapshotId },
    update: { publishedAt: new Date(), publishedById: req.user!.id, postedSnapshotId },
  });
  res.json({ publishedAt: schedule.publishedAt });
});

router.post('/unpublish', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const existing = await prisma.schedule.findUnique({ where: { storeId } });
  const schedule = await prisma.schedule.upsert({
    where: { storeId },
    create: { storeId, publishedAt: null },
    update: { publishedAt: null, postedSnapshotId: null },
  });
  // taking it down means workers should see nothing — drop the frozen copy too
  if (existing?.postedSnapshotId) {
    await prisma.scheduleSnapshot.deleteMany({ where: { id: existing.postedSnapshotId } });
  }
  res.json({ publishedAt: schedule.publishedAt });
});

// PUT /schedule/week  { storeId, weekStart: "YYYY-MM-DD" }
router.put('/week', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const parsed = parseYMD(req.body?.weekStart);
  if (!parsed) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
  const weekStart = mondayUTC(parsed);

  const cur = await prisma.schedule.findUnique({ where: { storeId } });
  const prevWeek = cur?.weekStart ?? null;
  const changed = !prevWeek || prevWeek.getTime() !== weekStart.getTime();

  // Moving to a different week freezes the outgoing one: archive its roster so
  // it stays viewable in history, and clear the 'posted' flag so workers keep
  // seeing the last posted week until the new one is posted. Archived even with
  // zero shifts, so a blank week doesn't just vanish from history. If it was
  // already archived (e.g. the manager restored this week to fix something and
  // is now moving on again), refresh it with the latest edits instead of
  // silently keeping the stale copy.
  if (changed && prevWeek) {
    const shifts = await freezeShifts(storeId);
    const already = await prisma.scheduleSnapshot.findFirst({
      where: { storeId, weekStart: prevWeek },
      orderBy: { savedAt: 'desc' },
      select: { id: true },
    });
    if (already) {
      await prisma.scheduleSnapshot.update({
        where: { id: already.id },
        data: { shifts, savedAt: new Date(), savedById: req.user!.id },
      });
    } else {
      await prisma.scheduleSnapshot.create({
        data: { storeId, weekStart: prevWeek, label: null, savedById: req.user!.id, shifts },
      });
    }
  }

  const schedule = await prisma.schedule.upsert({
    where: { storeId },
    create: { storeId, weekStart },
    update: { weekStart, ...(changed ? { publishedAt: null } : {}) },
  });
  res.json({ weekStart: schedule.weekStart });
});

// --- history (per-store frozen snapshots) ---

router.post('/snapshots', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const shifts = await freezeShifts(storeId);
  if (shifts.length === 0) {
    return res.status(400).json({ error: 'Nothing to save — this store has no shifts' });
  }
  const schedule = await prisma.schedule.findUnique({ where: { storeId } });
  const label =
    typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim() : null;
  const snap = await prisma.scheduleSnapshot.create({
    data: { storeId, weekStart: schedule?.weekStart ?? mondayUTC(), label, savedById: req.user!.id, shifts },
  });
  res.status(201).json({
    id: snap.id,
    storeId: snap.storeId,
    weekStart: snap.weekStart,
    label: snap.label,
    savedAt: snap.savedAt,
    shiftCount: shifts.length,
  });
});

// GET /schedule/snapshots?storeId=&limit=
router.get('/snapshots', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const rows = await prisma.scheduleSnapshot.findMany({
    // the live 'posted' snapshot is the current schedule, not history — hide it
    where: { storeId, NOT: { label: 'posted' } },
    orderBy: { savedAt: 'desc' },
    take: limit,
    select: { id: true, storeId: true, weekStart: true, label: true, savedAt: true },
  });
  res.json(rows);
});

// GET /schedule/snapshots/:id?storeId=
router.get('/snapshots/:id', ...manageStore, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const snap = await prisma.scheduleSnapshot.findUnique({ where: { id } });
  if (!snap || (snap.storeId !== null && !canManageStore(req.user, snap.storeId))) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(snap);
});

// POST /schedule/snapshots/:id/restore  { storeId }
router.post('/snapshots/:id/restore', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const snap = await prisma.scheduleSnapshot.findUnique({ where: { id } });
  if (!snap) return res.status(404).json({ error: 'Not found' });
  if (snap.storeId !== storeId) {
    return res.status(400).json({ error: 'That snapshot belongs to a different store' });
  }
  // Locked only once its calendar week has actually ended — not merely because
  // the board has moved on to a later week. A manager who got ahead and started
  // (or even posted) next week's schedule can still come back and fix this one
  // right up until its own week is over.
  if (snap.weekStart.getTime() < mondayUTC().getTime()) {
    return res.status(409).json({
      error: 'That week is locked — its dates have already passed.',
    });
  }

  const frozen = snap.shifts as {
    employeeId: number | null;
    day: DayOfWeek;
    start: string;
    end: string;
  }[];
  // scoped to this store, not the whole platform — an id from someone who's
  // since left (or was only ever at another store) shouldn't come back either way
  const empIds = new Set(
    (await prisma.employeeStore.findMany({ where: { storeId }, select: { employeeId: true } })).map(
      (e) => e.employeeId,
    ),
  );

  const rows = frozen.map((f) => ({
    employeeId: f.employeeId && empIds.has(f.employeeId) ? f.employeeId : null,
    storeId,
    day: f.day,
    start: new Date(`1970-01-01T${f.start}:00.000Z`),
    end: new Date(`1970-01-01T${f.end}:00.000Z`),
  }));

  await prisma.$transaction([
    prisma.shift.deleteMany({ where: { storeId } }),
    prisma.shift.createMany({ data: rows }),
    prisma.schedule.upsert({
      where: { storeId },
      create: { storeId, weekStart: snap.weekStart, publishedAt: null },
      update: { weekStart: snap.weekStart, publishedAt: null },
    }),
  ]);
  res.json({ restored: rows.length, weekStart: snap.weekStart });
});

router.delete('/snapshots/:id', ...manageStore, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const snap = await prisma.scheduleSnapshot.findUnique({ where: { id } });
  if (!snap || (snap.storeId !== null && !canManageStore(req.user, snap.storeId))) {
    return res.status(404).json({ error: 'Not found' });
  }
  await prisma.scheduleSnapshot.delete({ where: { id } });
  res.json({ message: 'Snapshot deleted' });
});

/**
 * POST /schedule/generate  { storeId, solveSeconds?, replace?, saveFirst?, saveLabel? }
 * Solves one store for whatever week its schedule points at. Draft only.
 */
router.post('/generate', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const saveLabel =
    typeof req.body?.saveLabel === 'string' && req.body.saveLabel.trim()
      ? req.body.saveLabel.trim()
      : 'before regenerate';
  try {
    const r = await generateScheduleForStore(storeId, {
      solveSeconds: Number(req.body?.solveSeconds ?? 5),
      replace: req.body?.replace !== false,
      ...(req.body?.saveFirst ? { snapshotLabel: saveLabel } : {}),
    });
    if (!r.feasible) {
      return res.status(422).json({ error: 'Solver found no feasible schedule', result: r });
    }
    res.json({
      created: r.created,
      optimal: r.optimal,
      objective: r.objective,
      unfilled: r.unfilled,
      spread: r.spread,
      shiftsPerEmployee: r.shiftsPerEmployee,
      gaps: r.gaps,
    });
  } catch (err) {
    alertError('schedule.generate', err, { storeId });
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
