import prisma from './prisma.js';
import { editableCutoffUTC, mondayUTC } from './scheduleGen.js';

// What gets cleared, and when. Anything payroll can be asked about (posted
// schedules, the edit log, time off) is kept for KEEP_RECORDS_YEARS — US
// labor rules generally expect 2–3 years of time records — while stuff that's
// only ever useful in the moment goes much sooner.
const DAY = 86_400_000;
const KEEP_RECORDS_YEARS = 3;
const READ_NOTIFICATION_DAYS = 90;
const ANY_NOTIFICATION_DAYS = 365;
const DONE_NOTE_DAYS = 365;
const CLOSING_DUTY_DAYS = 365;
const AVAILABILITY_WEEKS = 4;
const JOB_RUN_DAYS = 90;

export interface CleanupResult {
  notifications: number;
  shiftNotes: number;
  weekAvailability: number;
  availabilityConfirmations: number;
  closingDuties: number;
  draftSnapshots: number;
  expiredSnapshots: number;
  editLog: number;
  timeOff: number;
  jobRuns: number;
}

export async function cleanUpOldData(now = new Date()): Promise<CleanupResult> {
  const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
  const recordsCutoff = new Date(now);
  recordsCutoff.setUTCFullYear(recordsCutoff.getUTCFullYear() - KEEP_RECORDS_YEARS);
  const availabilityCutoff = mondayUTC(now);
  availabilityCutoff.setUTCDate(availabilityCutoff.getUTCDate() - AVAILABILITY_WEEKS * 7);
  const closingCutoff = daysAgo(CLOSING_DUTY_DAYS);

  // the copy each store's workers are looking at right now is never touched
  const inUse = new Set(
    (await prisma.schedule.findMany({ where: { postedSnapshotId: { not: null } }, select: { postedSnapshotId: true } }))
      .map((s) => s.postedSnapshotId!),
  );

  // A finished week (past the editable window) can pile up several saved copies
  // — every regenerate, restore and archive makes one. Payroll and the history
  // view only ever read the newest copy of a week, so the rest are dead weight.
  const past = await prisma.scheduleSnapshot.findMany({
    where: { weekStart: { lt: editableCutoffUTC(mondayUTC(now)), gte: recordsCutoff } },
    select: { id: true, storeId: true, weekStart: true },
    orderBy: [{ savedAt: 'desc' }, { id: 'desc' }],
  });
  const newestSeen = new Set<string>();
  const superseded: number[] = [];
  for (const s of past) {
    const key = `${s.storeId}|${s.weekStart.getTime()}`;
    if (newestSeen.has(key)) {
      if (!inUse.has(s.id)) superseded.push(s.id);
    } else {
      newestSeen.add(key);
    }
  }

  const [notifications, shiftNotes, weekAvailability, availabilityConfirmations, draftSnapshots, expiredSnapshots, editLog, timeOff, jobRuns] =
    await prisma.$transaction([
      prisma.notification.deleteMany({
        where: {
          OR: [
            { readAt: { not: null }, createdAt: { lt: daysAgo(READ_NOTIFICATION_DAYS) } },
            { createdAt: { lt: daysAgo(ANY_NOTIFICATION_DAYS) } },
          ],
        },
      }),
      prisma.shiftNote.deleteMany({ where: { resolvedAt: { lt: daysAgo(DONE_NOTE_DAYS) } } }),
      prisma.weekAvailability.deleteMany({ where: { weekStart: { lt: availabilityCutoff } } }),
      prisma.availabilityConfirmation.deleteMany({ where: { weekStart: { lt: availabilityCutoff } } }),
      prisma.scheduleSnapshot.deleteMany({ where: { id: { in: superseded } } }),
      prisma.scheduleSnapshot.deleteMany({ where: { weekStart: { lt: recordsCutoff }, id: { notIn: [...inUse] } } }),
      prisma.scheduleEditLog.deleteMany({ where: { weekStart: { lt: recordsCutoff } } }),
      prisma.timeOffRequest.deleteMany({ where: { endDate: { lt: recordsCutoff } } }),
      prisma.jobRun.deleteMany({ where: { ranAt: { lt: daysAgo(JOB_RUN_DAYS) } } }),
    ]);

  // assignments have no cascade, so they go first
  const oldDuties = await prisma.closingDuty.findMany({ where: { weekStart: { lt: closingCutoff } }, select: { id: true } });
  const dutyIds = oldDuties.map((d) => d.id);
  if (dutyIds.length) {
    await prisma.$transaction([
      prisma.closingDutyAssignment.deleteMany({ where: { closingDutyId: { in: dutyIds } } }),
      prisma.closingDuty.deleteMany({ where: { id: { in: dutyIds } } }),
    ]);
  }

  return {
    notifications: notifications.count,
    shiftNotes: shiftNotes.count,
    weekAvailability: weekAvailability.count,
    availabilityConfirmations: availabilityConfirmations.count,
    closingDuties: dutyIds.length,
    draftSnapshots: draftSnapshots.count,
    expiredSnapshots: expiredSnapshots.count,
    editLog: editLog.count,
    timeOff: timeOff.count,
    jobRuns: jobRuns.count,
  };
}
