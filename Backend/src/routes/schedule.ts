import { Router, type Request } from 'express';
import { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor } from '../lib/auth.js';
import { freezeShifts, generateScheduleForStore, mondayUTC, retireDraftWeek, retirePostedWeek } from '../lib/scheduleGen.js';
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
    // the week workers currently see and can act on — independent of whatever
    // week the board is currently drafting
    postedWeekStart: schedule?.postedWeekStart ?? null,
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

  // No snapshot yet — if this is the store's current draft or posted week and
  // its calendar week has already ended, freeze it now instead of saying
  // "nothing here".
  const schedule = await prisma.schedule.findUnique({
    where: { storeId },
    select: { weekStart: true, postedWeekStart: true },
  });
  const isResidentWeek =
    (!!schedule?.weekStart && schedule.weekStart.getTime() === weekStart.getTime()) ||
    (!!schedule?.postedWeekStart && schedule.postedWeekStart.getTime() === weekStart.getTime());
  if (!isResidentWeek || weekStart.getTime() >= mondayUTC().getTime()) {
    return res.status(404).json({ error: 'No saved schedule for that week' });
  }
  const shifts = await freezeShifts(storeId, weekStart);
  const fresh = await prisma.scheduleSnapshot.create({
    data: { storeId, weekStart, label: null, savedById: req.user!.id, shifts },
  });
  res.json(fresh);
});

router.post('/publish', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const existing = await prisma.schedule.findUnique({ where: { storeId } });
  const weekStart = existing?.weekStart ?? mondayUTC();
  const oldPostedWeek = existing?.postedWeekStart ?? null;

  // Freeze what workers will now see. Kept as the store's single 'posted' snapshot
  // (reused in place) so a later regenerate can't take this week away from them.
  const shifts = await freezeShifts(storeId, weekStart);
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
    create: { storeId, publishedAt: new Date(), publishedById: req.user!.id, postedSnapshotId, postedWeekStart: weekStart },
    update: { publishedAt: new Date(), publishedById: req.user!.id, postedSnapshotId, postedWeekStart: weekStart },
  });

  // the just-superseded posted week's live Shift rows are no longer needed —
  // archive+prune them (guarded: never touches whichever week is still resident)
  if (oldPostedWeek && oldPostedWeek.getTime() !== weekStart.getTime()) {
    await retirePostedWeek(storeId, oldPostedWeek, weekStart);
  }

  res.json({ publishedAt: schedule.publishedAt });
});

router.post('/unpublish', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const existing = await prisma.schedule.findUnique({ where: { storeId } });
  // publishedAt/postedSnapshotId only — postedWeekStart stays put, since the
  // manager will likely republish this same week shortly and its live Shift
  // rows are still exactly what they were
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

  // Moving the draft pointer never affects what's posted — the posted week's
  // own live Shift rows are untouched by this, so employees keep seeing
  // exactly what they saw before.
  const schedule = await prisma.schedule.upsert({
    where: { storeId },
    create: { storeId, weekStart },
    update: { weekStart },
  });

  // Archive+prune the outgoing draft week (guarded: a no-op if it's still the
  // posted week, e.g. the manager hadn't actually changed anything there).
  if (changed && prevWeek) {
    await retireDraftWeek(storeId, prevWeek);
  }

  res.json({ weekStart: schedule.weekStart });
});

// --- history (per-store frozen snapshots) ---

router.post('/snapshots', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const schedule = await prisma.schedule.findUnique({ where: { storeId } });
  const weekStart = schedule?.weekStart ?? mondayUTC();
  const shifts = await freezeShifts(storeId, weekStart);
  if (shifts.length === 0) {
    return res.status(400).json({ error: 'Nothing to save — this store has no shifts' });
  }
  const label =
    typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim() : null;
  const snap = await prisma.scheduleSnapshot.create({
    data: { storeId, weekStart, label, savedById: req.user!.id, shifts },
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

// GET /schedule/edit-log?storeId=&weekStart=  (weekStart optional — omit for the whole store's history)
router.get('/edit-log', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const weekStart = parseYMD(req.query.weekStart);
  if (req.query.weekStart && !weekStart) {
    return res.status(400).json({ error: 'weekStart must be YYYY-MM-DD' });
  }
  const rows = await prisma.scheduleEditLog.findMany({
    where: { storeId, ...(weekStart ? { weekStart } : {}) },
    orderBy: { editedAt: 'desc' },
    take: 50,
  });
  const editors = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.editedById))] } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(editors.map((u) => [u.id, u]));
  res.json(
    rows.map((r) => ({
      id: r.id,
      weekStart: r.weekStart,
      editedAt: r.editedAt,
      editedBy: byId.get(r.editedById) ?? null,
    })),
  );
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
  // No hard lock on how far back a manager can reach — someone leaving early,
  // a no-show, etc. often isn't noticed until the following week. The
  // frontend warns before restoring a past week; this endpoint just trusts
  // that confirmation rather than re-blocking it here.
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
    weekStart: snap.weekStart,
    day: f.day,
    start: new Date(`1970-01-01T${f.start}:00.000Z`),
    end: new Date(`1970-01-01T${f.end}:00.000Z`),
  }));

  const cur = await prisma.schedule.findUnique({ where: { storeId } });
  const outgoingDraft = cur?.weekStart ?? null;
  // Restoring into the draft slot is a hand-edit like any other: only affects
  // employees' view if this happens to be the currently posted week too.
  const touchesPosted = !!cur?.postedWeekStart && cur.postedWeekStart.getTime() === snap.weekStart.getTime();
  // this week's dates have already passed — log who reached back and touched
  // it, since nothing else distinguishes a retroactive edit from an original one
  const isRetroactive = snap.weekStart.getTime() < mondayUTC().getTime();

  await prisma.$transaction([
    prisma.shift.deleteMany({ where: { storeId, weekStart: snap.weekStart } }),
    prisma.shift.createMany({ data: rows }),
    prisma.schedule.upsert({
      where: { storeId },
      create: { storeId, weekStart: snap.weekStart, ...(touchesPosted ? { publishedAt: null } : {}) },
      update: { weekStart: snap.weekStart, ...(touchesPosted ? { publishedAt: null } : {}) },
    }),
    ...(isRetroactive
      ? [prisma.scheduleEditLog.create({ data: { storeId, weekStart: snap.weekStart, editedById: req.user!.id } })]
      : []),
  ]);

  if (outgoingDraft && outgoingDraft.getTime() !== snap.weekStart.getTime()) {
    await retireDraftWeek(storeId, outgoingDraft);
  }

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
 * Solves one store for whatever week its schedule points at. Draft only —
 * never touches the posted week's own live shifts.
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
    res.status(500).json({ error: 'Failed to generate the schedule' });
  }
});

export default router;
