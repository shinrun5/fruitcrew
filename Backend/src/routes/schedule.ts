import { Router } from 'express';
import { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor, storeIdFrom } from '../lib/auth.js';
import {
  editableCutoffUTC,
  freezeShifts,
  type FrozenShift,
  generateScheduleForStore,
  isRunningWeek,
  mondayUTC,
  PostedWeekError,
  retireDraftWeek,
  retirePostedWeek,
  weekChanges,
} from '../lib/scheduleGen.js';
import { alertError } from '../lib/errorAlert.js';
import { storeSections } from '../lib/responsibilities.js';
import { inBackground, notify } from '../lib/notify.js';
import { tellOpenShifts } from '../lib/openShifts.js';
import { dateOfDay, hhmmToMinutes, parseYMD, to12h, toClock, toHHMM, WEEK_DAYS } from '../lib/time.js';

const router = Router();


/** Tell everyone with a login at this store that the week is up, with their
 * own shift count — bell, phone and email. A repost of the same week goes
 * through tellScheduleChanged instead. */
async function tellSchedulePosted(
  storeId: number,
  weekStart: Date,
  shifts: { employeeId: number | null; start: string; end: string }[],
): Promise<void> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } });
  const users = await prisma.user.findMany({
    where: { employee: { is: { employeeStores: { some: { storeId } } } } },
    select: { id: true, employeeId: true },
  });
  const week = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const title = `The ${store?.name ?? ''} schedule for the week of ${week} is up`;
  for (const u of users) {
    const mine = shifts.filter((s) => s.employeeId === u.employeeId);
    const hours = Math.round(mine.reduce((n, s) => n + (hhmmToMinutes(s.end) - hhmmToMinutes(s.start)) / 60, 0) * 10) / 10;
    await notify(u.id, {
      kind: 'GENERIC',
      topic: 'schedule',
      title,
      body: mine.length
        ? `You're on ${mine.length} shift${mine.length === 1 ? '' : 's'} (${hours}h).`
        : "You're not on the schedule this week.",
      link: '/my-shifts',
      email: true,
    });
  }
}

/** A repost of the week the crew already has: only the people whose days
 * changed hear about it, with what each of those days is now. */
async function tellScheduleChanged(storeId: number, weekStart: Date, changes: ReturnType<typeof weekChanges>): Promise<void> {
  const byEmployee = new Map<number, typeof changes>();
  for (const c of changes) if (c.employeeId != null) byEmployee.set(c.employeeId, [...(byEmployee.get(c.employeeId) ?? []), c]);
  if (byEmployee.size === 0) return;
  const [store, users] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    prisma.user.findMany({ where: { employeeId: { in: [...byEmployee.keys()] } }, select: { id: true, employeeId: true } }),
  ]);
  const hours = (rows: FrozenShift[]) =>
    rows
      .slice()
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((r) => `${to12h(hhmmToMinutes(r.start))}–${to12h(hhmmToMinutes(r.end))}${r.sectionName ? ` (${r.sectionName})` : ''}`)
      .join(', ');
  for (const u of users) {
    const days = byEmployee
      .get(u.employeeId!)!
      .sort((a, b) => WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day))
      .map((c) => {
        const date = dateOfDay(weekStart, c.day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
        return `${date}: ${c.after.length ? hours(c.after) : 'off'}`;
      });
    await notify(u.id, {
      kind: 'GENERIC',
      topic: 'schedule',
      title: `Your ${store?.name ?? ''} schedule changed`,
      body: days.join(' · '),
      link: '/my-shifts',
    });
  }
}

// storeId comes in the query on GETs, the body on writes
const manageStore = requireManagerFor(storeIdFrom);

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
  // weeks the crew already has that are still going while the board drafts a
  // later one — edited straight on the board, no resume needed
  const liveRows = await prisma.shift.findMany({
    where: { storeId, weekStart: { gte: today } },
    distinct: ['weekStart'],
    select: { weekStart: true },
  });
  const liveWeeks = liveRows
    .map((r) => r.weekStart)
    .filter((w) => isRunningWeek(schedule, w))
    .sort((a, b) => a.getTime() - b.getTime());
  // edits to the posted week that workers don't have yet (they see the posted
  // copy until a repost) — person by day, for the board to mark and count
  let unpostedChanges: { employeeId: number | null; day: DayOfWeek; kind: string }[] = [];
  if (
    schedule?.postedSnapshotId &&
    !schedule.publishedAt &&
    schedule.postedWeekStart?.getTime() === curWeek.getTime()
  ) {
    const posted = await prisma.scheduleSnapshot.findUnique({ where: { id: schedule.postedSnapshotId }, select: { shifts: true } });
    if (posted) {
      unpostedChanges = weekChanges(posted.shifts as FrozenShift[], await freezeShifts(storeId, curWeek)).map(
        ({ employeeId, day, kind }) => ({ employeeId, day, kind }),
      );
    }
  }

  res.json({
    publishedAt: schedule?.publishedAt ?? null,
    weekStart: curWeek,
    // the week workers currently see and can act on — independent of whatever
    // week the board is currently drafting
    postedWeekStart: schedule?.postedWeekStart ?? null,
    pastWeeks,
    liveWeeks,
    unpostedChanges,
    // the board is showing a week whose dates have already passed — nobody's
    // advanced it yet, so it's stale even though nothing has "locked" it
    liveWeekStale: curWeekIsStale,
    // a past week on/after this date is still editable (via resume, with a
    // confirm popup); strictly before it, the board is read-only
    editableCutoff: editableCutoffUTC(today),
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
  const [snap, schedule] = await Promise.all([
    prisma.scheduleSnapshot.findFirst({ where: { storeId, weekStart }, orderBy: { savedAt: 'desc' } }),
    prisma.schedule.findUnique({ where: { storeId }, select: { weekStart: true, postedWeekStart: true } }),
  ]);
  if (snap) {
    // the posted week, while next week's draft is on the board: its rows are still
    // the live schedule, so show those — swaps approved since posting included —
    // not the copy saved when it went up
    const livePosted =
      !!schedule?.postedWeekStart &&
      schedule.postedWeekStart.getTime() === weekStart.getTime() &&
      schedule.weekStart?.getTime() !== weekStart.getTime();
    if (livePosted) return res.json({ ...snap, shifts: await freezeShifts(storeId, weekStart), live: true });
    return res.json(snap);
  }

  // No snapshot yet — if this is the store's current draft or posted week and
  // its calendar week has already ended, freeze it now instead of saying
  // "nothing here".
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

// POST /schedule/publish  { storeId, notify? }  — notify: false posts it without
// telling anyone (a typo fix nobody needs a buzz about)
router.post('/publish', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const quiet = req.body?.notify === false;
  const existing = await prisma.schedule.findUnique({ where: { storeId } });
  const weekStart = existing?.weekStart ?? mondayUTC();
  const oldPostedWeek = existing?.postedWeekStart ?? null;

  // Freeze what workers will now see. Kept as the store's single 'posted' snapshot
  // (reused in place) so a later regenerate can't take this week away from them.
  const shifts = await freezeShifts(storeId, weekStart);
  let postedSnapshotId = existing?.postedSnapshotId ?? null;
  // the copy workers already have of this same week, when this is a repost
  let wasPosted: FrozenShift[] | null = null;
  if (postedSnapshotId) {
    const prev = await prisma.scheduleSnapshot.findUnique({
      where: { id: postedSnapshotId },
      select: { id: true, weekStart: true, shifts: true },
    });
    if (!prev) {
      postedSnapshotId = null;
    } else if (prev.weekStart.getTime() === weekStart.getTime()) {
      wasPosted = prev.shifts as FrozenShift[];
    } else {
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

  // the just-superseded posted week's live Shift rows: archived if it's over,
  // kept live until it ends if it's still running (see retirePostedWeek)
  if (oldPostedWeek && oldPostedWeek.getTime() !== weekStart.getTime()) {
    await retirePostedWeek(storeId, oldPostedWeek, weekStart);
  }

  if (!quiet) {
    if (wasPosted) inBackground('schedule.changed', tellScheduleChanged(storeId, weekStart, weekChanges(wasPosted, shifts)));
    else inBackground('schedule.posted', tellSchedulePosted(storeId, weekStart, shifts));
    // open shifts the crew is seeing for the first time
    const key = (f: FrozenShift) => `${f.day}|${f.start}|${f.end}`;
    const had = new Set((wasPosted ?? []).filter((f) => f.employeeId == null).map(key));
    const open = shifts.filter((f) => f.employeeId == null && !had.has(key(f)));
    inBackground('schedule.open', tellOpenShifts(storeId, weekStart, open));
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
  // Editable up to PAST_WEEK_EDITABLE_WEEKS back — someone leaving early, a
  // no-show, etc. often isn't noticed until the following week, so this isn't
  // locked the instant a week ends. The frontend already warns before
  // restoring a past week within that window; past it, the board doesn't
  // even offer the option, but a stale tab (or the nightly prune sweep
  // racing a click) shouldn't be trusted to the client alone.
  if (snap.weekStart.getTime() < editableCutoffUTC().getTime()) {
    return res.status(400).json({ error: 'That week is more than 4 weeks old and can no longer be edited.' });
  }
  const frozen = snap.shifts as {
    employeeId: number | null;
    day: DayOfWeek;
    start: string;
    end: string;
    sectionId?: number | null; // absent on copies saved before shifts had sections
  }[];
  // scoped to this store, not the whole platform — an id from someone who's
  // since left (or was only ever at another store) shouldn't come back either way
  const [links, sections] = await Promise.all([
    prisma.employeeStore.findMany({ where: { storeId }, select: { employeeId: true } }),
    storeSections(storeId),
  ]);
  const empIds = new Set(links.map((e) => e.employeeId));

  const rows = frozen.map((f) => ({
    employeeId: f.employeeId && empIds.has(f.employeeId) ? f.employeeId : null,
    storeId,
    weekStart: snap.weekStart,
    day: f.day,
    start: toClock(f.start),
    end: toClock(f.end),
    // a section deleted since doesn't come back
    sectionId: f.sectionId != null && sections.has(f.sectionId) ? f.sectionId : null,
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
    // the posted week's rows are still live (that's what /week-view showed) —
    // rebuilding them from the copy saved at posting would undo swaps approved since
    ...(touchesPosted
      ? []
      : [
          prisma.shift.deleteMany({ where: { storeId, weekStart: snap.weekStart } }),
          prisma.shift.createMany({ data: rows }),
        ]),
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
    if (err instanceof PostedWeekError) return res.status(409).json({ error: err.message });
    alertError('schedule.generate', err, { storeId });
    res.status(500).json({ error: 'Failed to generate the schedule' });
  }
});

/**
 * POST /schedule/copy-week  { storeId }
 * Start the draft from last week as it ended up — its live shifts if it still
 * has them, otherwise the copy saved of it. Like a regenerate: draft only,
 * and whatever was on the draft is kept as a saved version first. People no
 * longer at the store are left off; a deleted section is dropped.
 */
router.post('/copy-week', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const schedule = await prisma.schedule.findUnique({ where: { storeId } });
  const weekStart = schedule?.weekStart ?? mondayUTC();
  if (schedule?.postedWeekStart && schedule.postedWeekStart.getTime() === weekStart.getTime()) {
    return res.status(409).json({ error: "This week is already posted — change it on the board, or start next week to copy into it." });
  }
  const from = new Date(weekStart);
  from.setUTCDate(from.getUTCDate() - 7);

  const live = await prisma.shift.findMany({ where: { storeId, weekStart: from } });
  let source: FrozenShift[] = live.map((r) => ({
    employeeId: r.employeeId,
    day: r.day,
    start: toHHMM(r.start),
    end: toHHMM(r.end),
    sectionId: r.sectionId,
  }));
  if (source.length === 0) {
    // the copy it ended with — not one saved before a regenerate or a copy
    const snaps = await prisma.scheduleSnapshot.findMany({
      where: { storeId, weekStart: from },
      orderBy: { savedAt: 'desc' },
      select: { label: true, shifts: true },
    });
    const snap = snaps.find((x) => !x.label?.startsWith('before')) ?? snaps[0];
    source = (snap?.shifts as FrozenShift[] | undefined) ?? [];
  }
  if (source.length === 0) return res.status(404).json({ error: 'Last week has no shifts to copy.' });

  const [links, sections] = await Promise.all([
    prisma.employeeStore.findMany({ where: { storeId }, select: { employeeId: true } }),
    storeSections(storeId),
  ]);
  const here = new Set(links.map((l) => l.employeeId));
  const rows = source
    .filter((f) => f.employeeId != null && here.has(f.employeeId))
    .map((f) => ({
      employeeId: f.employeeId,
      storeId,
      weekStart,
      day: f.day,
      start: toClock(f.start),
      end: toClock(f.end),
      sectionId: f.sectionId != null && sections.has(f.sectionId) ? f.sectionId : null,
    }));

  const existing = await freezeShifts(storeId, weekStart);
  await prisma.$transaction([
    ...(existing.length > 0
      ? [prisma.scheduleSnapshot.create({ data: { storeId, weekStart, label: 'before copying last week', savedById: req.user!.id, shifts: existing } })]
      : []),
    prisma.shift.deleteMany({ where: { storeId, weekStart } }),
    prisma.shift.createMany({ data: rows }),
    prisma.schedule.upsert({ where: { storeId }, create: { storeId, weekStart }, update: {} }),
  ]);
  res.json({ copied: rows.length, leftOff: source.filter((f) => f.employeeId != null).length - rows.length });
});

export default router;
