import cron from 'node-cron';
import prisma from './lib/prisma.js';
import { generateScheduleForStore, mondayUTC } from './lib/scheduleGen.js';
import { notifyMany } from './lib/notify.js';
import { alertError } from './lib/errorAlert.js';

const TZ = process.env.CRON_TZ || 'America/New_York';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Midnight UTC of next week's Monday. */
function nextMondayUTC(): Date {
  const d = mondayUTC();
  d.setUTCDate(d.getUTCDate() + 7);
  return d;
}
function weekRange(monday: Date): string {
  const sun = new Date(monday);
  sun.setUTCDate(sun.getUTCDate() + 6);
  const f = (x: Date) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(monday)} – ${f(sun)}`;
}

/** True once we've claimed (job,key); subsequent calls for the same key are no-ops.
 * Lets Fri be a catch-up for Thu, Sun for Sat. */
async function claim(job: string, key: string): Promise<boolean> {
  try {
    await prisma.jobRun.create({ data: { job, key } });
    return true;
  } catch {
    return false; // unique violation -> already ran
  }
}

// --- Thu/Fri: remind workers to check next week's availability ---
async function availabilityReminder(): Promise<void> {
  const monday = nextMondayUTC();
  const key = ymd(monday);
  if (!(await claim('avail-reminder', key))) return;

  const users = await prisma.user.findMany({
    where: { employee: { is: { employeeStores: { some: {} } } } },
    select: { id: true },
  });
  const range = weekRange(monday);
  await notifyMany(
    users.map((u) => u.id),
    {
      kind: 'AVAILABILITY_REMINDER',
      title: `Check your availability for next week (${range})`,
      body: `Next week's schedule gets built this weekend. Make sure your hours are right — if anything's different just that week, set a one-week change on the Availability screen.`,
      link: '/availability',
      email: true,
    },
  );
  console.log(`[cron] availability reminder sent to ${users.length} workers for ${key}`);
}

// --- daily (except Fri, which has the reminder above): nag whoever still
// hasn't confirmed availability for the week a store is currently building.
// Stops the moment that store's schedule is posted — not when the week
// starts — so an early publish quiets it down and a late one keeps it going. ---
async function dailyConfirmReminder(): Promise<void> {
  const key = ymd(new Date()); // real calendar day -> actually runs once per day
  if (!(await claim('daily-confirm-reminder', key))) return;

  const thisMonday = mondayUTC();
  // every store whose board is on this week or later and hasn't been posted yet
  const schedules = await prisma.schedule.findMany({
    where: { weekStart: { gte: thisMonday }, publishedAt: null },
    select: { storeId: true, weekStart: true },
  });
  if (schedules.length === 0) return;

  // employeeId -> the week range(s) they still haven't dealt with
  const pending = new Map<number, Set<string>>();
  for (const sched of schedules) {
    const weekStart = sched.weekStart;
    if (!weekStart) continue;
    const links = await prisma.employeeStore.findMany({
      where: { storeId: sched.storeId },
      select: { employeeId: true },
    });
    const empIds = links.map((l) => l.employeeId);
    if (empIds.length === 0) continue;

    const [confirms, overrides] = await Promise.all([
      prisma.availabilityConfirmation.findMany({
        where: { weekStart, employeeId: { in: empIds } },
        select: { employeeId: true },
      }),
      prisma.weekAvailability.findMany({
        where: { weekStart, employeeId: { in: empIds } },
        select: { employeeId: true },
      }),
    ]);
    const done = new Set([...confirms, ...overrides].map((c) => c.employeeId));
    const range = weekRange(weekStart);
    for (const id of empIds) {
      if (done.has(id)) continue;
      (pending.get(id) ?? pending.set(id, new Set<string>()).get(id)!).add(range);
    }
  }
  if (pending.size === 0) return;

  const users = await prisma.user.findMany({
    where: { employeeId: { in: [...pending.keys()] } },
    select: { id: true, employeeId: true },
  });
  let sent = 0;
  for (const u of users) {
    const ranges = u.employeeId != null ? pending.get(u.employeeId) : undefined;
    if (!ranges || ranges.size === 0) continue;
    const list = [...ranges].join(', ');
    await notifyMany([u.id], {
      kind: 'AVAILABILITY_REMINDER',
      title: `Still need your availability — ${list}`,
      body: `You haven't confirmed your hours are right for ${list} yet — do it on the Availability screen before that week starts.`,
      link: '/availability',
      email: true,
    });
    sent++;
  }
  console.log(`[cron] daily confirm reminder sent to ${sent} workers for ${key}`);
}

// --- Sat/Sun: auto-generate next week's schedule as a draft for each store ---
async function autoGenerate(): Promise<void> {
  const monday = nextMondayUTC();
  const range = weekRange(monday);
  const stores = await prisma.store.findMany({ select: { id: true, name: true, orgId: true } });

  for (const store of stores) {
    if (!(await claim('auto-generate', `${store.id}:${ymd(monday)}`))) continue;

    // point the store's schedule at next week, then solve it (draft — not published)
    await prisma.schedule.upsert({
      where: { storeId: store.id },
      create: { storeId: store.id, weekStart: monday },
      update: { weekStart: monday, publishedAt: null },
    });

    const managers = await prisma.user.findMany({
      where: {
        OR: [
          { role: 'OWNER', orgId: store.orgId },
          { managerStores: { some: { storeId: store.id } } },
        ],
      },
      select: { id: true },
    });

    let body: string;
    try {
      const r = await generateScheduleForStore(store.id, { replace: true, snapshotLabel: 'before auto-generate' });
      body = r.feasible
        ? `${r.created} shifts drafted for ${range}${r.unfilled ? `, ${r.unfilled} slot(s) still open` : ''}. Review it and post it when it looks right.`
        : `The solver couldn't cover ${range} — check requirements and who's available, then generate again.`;
    } catch (e) {
      body = `Couldn't auto-generate ${range} for ${store.name}: ${(e as Error).message}. Try generating it by hand.`;
      // the manager-facing message above is a heads-up, not a substitute for
      // knowing the solver itself is broken (vs. just infeasible for this store)
      alertError('cron.autoGenerate', e, { storeId: store.id, storeName: store.name });
    }
    await notifyMany(managers.map((m) => m.id), {
      kind: 'SCHEDULE_DRAFTED',
      title: `Next week's schedule is drafted — ${store.name}`,
      body,
      link: '/schedule',
      email: true,
    });
    console.log(`[cron] auto-generated ${store.name} for ${ymd(monday)}`);
  }
}

export function startCron(): void {
  if (process.env.CRON_ENABLED !== '1') {
    console.log('[cron] disabled (set CRON_ENABLED=1 to enable)');
    return;
  }
  // Availability reminder: Friday 12:00 (one weekly nudge before the weekend build).
  // Change the hour in '0 12 * * 5' to move it earlier/later; add ',6' for a Sat catch-up.
  cron.schedule(
    '0 12 * * 5',
    () => void availabilityReminder().catch((e) => alertError('cron.availabilityReminder', e)),
    { timezone: TZ },
  );
  // Auto-generate next week's draft: Sat & Sun 08:00 (the second day is a catch-up).
  cron.schedule('0 8 * * 6,0', () => void autoGenerate().catch((e) => alertError('cron.autoGenerate', e)), {
    timezone: TZ,
  });
  // Daily nag for anyone still unconfirmed, until that store's schedule is
  // posted — every day except Friday (already covered above), 09:00.
  cron.schedule(
    '0 9 * * 0,1,2,3,4,6',
    () => void dailyConfirmReminder().catch((e) => alertError('cron.dailyConfirmReminder', e)),
    { timezone: TZ },
  );
  console.log(`[cron] started (timezone ${TZ})`);
}

// exported for manual/testing invocation
export const _jobs = { availabilityReminder, autoGenerate, dailyConfirmReminder };
