import { Router } from 'express';
import type { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor, storeIdFrom } from '../lib/auth.js';
import { mondayUTC } from '../lib/scheduleGen.js';
import { isDayOfWeek, parseYMD, WEEK_DAYS } from '../lib/time.js';
import { autoAssign, closingCrews, closingResponsibilities, type CrewMember, type ResponsibilityAssignment } from '../lib/closingDuties.js';

const router = Router();

const manageStore = requireManagerFor(storeIdFrom);

async function tracksClosing(storeId: number): Promise<boolean> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { tracksClosingDuties: true } });
  return store?.tracksClosingDuties ?? false;
}

/** Recomputes one day's assignments from scratch and persists them, replacing
 * whatever was there — the shared "auto-fill on first view" / "stale" / "regenerate"
 * path below. */
async function regenerateDay(
  storeId: number,
  weekStart: Date,
  day: DayOfWeek,
  crew: CrewMember[],
  responsibilities: { id: number; name: string }[],
): Promise<ResponsibilityAssignment[]> {
  const computed = autoAssign(crew, responsibilities);
  const row = await prisma.closingDuty.upsert({
    where: { storeId_weekStart_day: { storeId, weekStart, day } },
    create: { storeId, weekStart, day },
    update: {},
  });
  await prisma.closingDutyAssignment.deleteMany({ where: { closingDutyId: row.id } });
  const toWrite = computed.filter((a) => a.employeeIds.length > 0);
  if (toWrite.length > 0) {
    await prisma.closingDutyAssignment.createMany({
      data: toWrite.map((a) => ({ closingDutyId: row.id, responsibilityId: a.responsibilityId, employeeIds: a.employeeIds })),
    });
  }
  return computed;
}

/** The day's assignments, one entry per store's current closing responsibility
 * (unassigned ones included as an empty array) — so the UI always has a row to
 * render even for a responsibility added after this day was first computed. */
function toDuty(
  responsibilities: { id: number; name: string }[],
  rows: { responsibilityId: number; employeeIds: number[] }[],
): { assignments: ResponsibilityAssignment[] } {
  const byResp = new Map(rows.map((r) => [r.responsibilityId, r.employeeIds]));
  return {
    assignments: responsibilities.map((r) => ({ responsibilityId: r.id, employeeIds: byResp.get(r.id) ?? [] })),
  };
}

/** True if any current assignment points at someone no longer on the day's crew
 * — e.g. the schedule was edited after this row was first computed/hand-edited.
 * Such a reference isn't a choice worth keeping; it just shows up as an unfilled
 * slot in the UI, so the whole day is worth recomputing instead of leaving it stale. */
function isStale(rows: { employeeIds: number[] }[], crewIds: Set<number>): boolean {
  return rows.some((r) => r.employeeIds.some((id) => !crewIds.has(id)));
}

// GET /closing-duties?storeId=&weekStart=YYYY-MM-DD
// One row per day: that day's closing crew (who's eligible to hold a duty) plus
// the current assignment per store-defined closing responsibility — auto-computed
// and saved the first time a day is seen, then left alone so manual edits stick,
// EXCEPT when the schedule has since changed underneath it and a slot now points
// at someone no longer on that day's crew (see isStale) — that gets recomputed.
// Workers only get weeks that have been posted: next week's draft (the weekend
// auto-draft, or a manager planning ahead) stays off their phones until it's up.
router.get('/', requireAuth, async (req, res) => {
  const storeId = storeIdFrom(req);
  if (!Number.isInteger(storeId) || !req.user!.storeIds.includes(storeId)) {
    return res.status(403).json({ error: 'No access to that store' });
  }
  const parsed = parseYMD(req.query.weekStart);
  if (!parsed) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
  const weekStart = mondayUTC(parsed);

  if (!(await tracksClosing(storeId))) {
    return res.json({ enabled: false, weekStart, days: [] });
  }

  const responsibilities = await closingResponsibilities(storeId);
  if (!canManageStore(req.user, storeId)) {
    const schedule = await prisma.schedule.findUnique({ where: { storeId }, select: { postedWeekStart: true } });
    if (!schedule?.postedWeekStart || weekStart.getTime() > schedule.postedWeekStart.getTime()) {
      const days = WEEK_DAYS.map((day) => ({ day, crew: [], duty: null }));
      return res.json({ enabled: true, weekStart, responsibilities, days, unposted: true });
    }
  }

  const [existing, crews] = await Promise.all([
    prisma.closingDuty.findMany({ where: { storeId, weekStart }, include: { assignments: true } }),
    closingCrews(storeId, weekStart),
  ]);
  const byDay = new Map(existing.map((r) => [r.day, r]));

  const days = await Promise.all(
    WEEK_DAYS.map(async (day) => {
      const crew = crews.get(day) ?? [];
      // nobody's actually closing that day (anymore) — a leftover row from
      // before the schedule changed shouldn't make this look scheduled
      if (crew.length === 0) return { day, crew, duty: null };

      const crewIds = new Set(crew.map((c) => c.employeeId));
      const row = byDay.get(day);
      let assignmentRows: ResponsibilityAssignment[] = row?.assignments ?? [];
      if (!row || isStale(assignmentRows, crewIds)) {
        assignmentRows = await regenerateDay(storeId, weekStart, day, crew, responsibilities);
      }
      return { day, crew, duty: toDuty(responsibilities, assignmentRows) };
    }),
  );

  res.json({ enabled: true, weekStart, responsibilities, days });
});

// POST /closing-duties/generate  { storeId, weekStart }
// Recomputes every day of the week from the current closing crews, overwriting
// any manual edits — the "start over" button.
router.post('/generate', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const parsed = parseYMD(req.body?.weekStart);
  if (!parsed) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
  const weekStart = mondayUTC(parsed);

  if (!(await tracksClosing(storeId))) {
    return res.status(400).json({ error: 'This store doesn’t use closing duties' });
  }

  const [responsibilities, crews] = await Promise.all([closingResponsibilities(storeId), closingCrews(storeId, weekStart)]);
  const days = await Promise.all(
    WEEK_DAYS.map(async (day) => {
      const crew = crews.get(day) ?? [];
      const assignmentRows = await regenerateDay(storeId, weekStart, day, crew, responsibilities);
      return { day, crew, duty: toDuty(responsibilities, assignmentRows) };
    }),
  );

  res.json({ enabled: true, weekStart, responsibilities, days });
});

// PUT /closing-duties  { storeId, weekStart, day, assignments: {responsibilityId, employeeIds}[] }
// A manager reassigning one day's duties (a "swap" is just changing two entries).
router.put('/', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const parsed = parseYMD(req.body?.weekStart);
  const day = req.body?.day as DayOfWeek | undefined;
  if (!parsed || !day || !isDayOfWeek(day)) {
    return res.status(400).json({ error: 'weekStart ("YYYY-MM-DD") and a valid day are required' });
  }
  const weekStart = mondayUTC(parsed);

  if (!(await tracksClosing(storeId))) {
    return res.status(400).json({ error: 'This store doesn’t use closing duties' });
  }

  const [crews, responsibilities] = await Promise.all([
    closingCrews(storeId, weekStart),
    closingResponsibilities(storeId),
  ]);
  const crew = crews.get(day) ?? [];
  const crewIds = new Set(crew.map((c) => c.employeeId));
  const respIds = new Set(responsibilities.map((r) => r.id));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawAssignments: any[] = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  const clean = new Map<number, number[]>();
  for (const a of rawAssignments) {
    const responsibilityId = Number(a?.responsibilityId);
    if (!respIds.has(responsibilityId)) continue; // not one of this store's closing roles — ignore
    const rawIds: unknown[] = Array.isArray(a?.employeeIds) ? a.employeeIds : [];
    const ids = [...new Set(rawIds.filter((x): x is number => typeof x === 'number' && crewIds.has(x)))];
    clean.set(responsibilityId, ids);
  }

  const row = await prisma.closingDuty.upsert({
    where: { storeId_weekStart_day: { storeId, weekStart, day } },
    create: { storeId, weekStart, day },
    update: {},
  });
  await prisma.closingDutyAssignment.deleteMany({ where: { closingDutyId: row.id } });
  const toWrite = [...clean.entries()].filter(([, ids]) => ids.length > 0);
  if (toWrite.length > 0) {
    await prisma.closingDutyAssignment.createMany({
      data: toWrite.map(([responsibilityId, employeeIds]) => ({ closingDutyId: row.id, responsibilityId, employeeIds })),
    });
  }

  const assignmentRows = toWrite.map(([responsibilityId, employeeIds]) => ({ responsibilityId, employeeIds }));
  res.json({ day, crew, duty: toDuty(responsibilities, assignmentRows) });
});

export default router;
