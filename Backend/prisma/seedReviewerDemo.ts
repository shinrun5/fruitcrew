// Demo business for Apple / Google app reviewers — they can't sign up
// themselves (every sign-up path needs an invite code), so App Store Connect's
// "App Review Information" and Play Console's "App access" get these logins.
//
//   REVIEWER_DEMO_PASSWORD='<12+ chars>' npm run seed:reviewer
//
// Creates (or refreshes) "Fruit Crew Demo Café" with:
//   demo.owner@fruitcrew.app  — the owner: schedule, team, requests, payroll…
//   demo.worker@fruitcrew.app — a worker: my shifts, marketplace, availability…
// both with REVIEWER_DEMO_PASSWORD. Safe to re-run, and meant to be: run it
// again right before each submission so the schedule is for the current dates
// (and to restore the accounts if a reviewer tried "Delete my account"). It
// only ever touches this one demo business — it refuses to run if either
// demo email belongs to some other business.
//
// The business is comped (billingExempt), so it's never billed or locked out.

import prisma from '../src/lib/prisma.js';
import { supabaseAdmin } from '../src/lib/supabase.js';
import { mondayUTC } from '../src/lib/scheduleGen.js';
import { toClock } from '../src/lib/time.js';
import type { DayOfWeek, Experience } from '@prisma/client';

const ORG_NAME = 'Fruit Crew Demo Café';
const STORE_NAME = 'Main Street';
const OWNER = { email: 'demo.owner@fruitcrew.app', name: 'Morgan Reyes' };
const WORKER = { email: 'demo.worker@fruitcrew.app', name: 'Jamie Chen' };
const DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const TEAM: { name: string; tier: Experience; hireDate: string }[] = [
  { name: 'Ana Lopez', tier: 'SENIOR', hireDate: '2023-04-10' },
  { name: 'Sam Ortiz', tier: 'SENIOR', hireDate: '2024-01-22' },
  { name: 'Ben Carter', tier: 'REGULAR', hireDate: '2024-06-03' },
  { name: 'Priya Shah', tier: 'REGULAR', hireDate: '2025-02-17' },
  { name: WORKER.name, tier: 'REGULAR', hireDate: '2025-05-05' },
  { name: 'Leo Kim', tier: 'REGULAR', hireDate: '2025-09-01' },
  { name: 'Taylor Brooks', tier: 'REGULAR', hireDate: '2026-03-09' },
];

const password = process.env.REVIEWER_DEMO_PASSWORD ?? '';
if (password.length < 12) {
  console.error("Set REVIEWER_DEMO_PASSWORD (12+ characters): REVIEWER_DEMO_PASSWORD='…' npm run seed:reviewer");
  process.exit(1);
}

// --- guard: never touch a real business
for (const who of [OWNER, WORKER]) {
  const u = await prisma.user.findUnique({ where: { email: who.email }, include: { org: true } });
  if (u?.org && u.org.name !== ORG_NAME) {
    console.error(`${who.email} belongs to "${u.org.name}", not the demo business — stopping without changes.`);
    process.exit(1);
  }
}

// --- logins: create the Supabase auth user, or reset its password if it exists
async function authUser(email: string): Promise<string> {
  const admin = supabaseAdmin();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.data.user) return created.data.user.id;
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const match = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!match) throw new Error(`Could not create ${email}: ${created.error?.message ?? 'unknown error'}`);
  const upd = await admin.auth.admin.updateUserById(match.id, { password, email_confirm: true });
  if (upd.error) throw new Error(`Could not reset the password for ${email}: ${upd.error.message}`);
  return match.id;
}
const ownerAuthId = await authUser(OWNER.email);
const workerAuthId = await authUser(WORKER.email);

// --- business, owner, store
// a reviewer deleting the owner account closes the business (and the owner
// login is gone) — find it through the worker or by name and reopen it,
// rather than starting a second demo business
const existingOwner = await prisma.user.findUnique({ where: { email: OWNER.email } });
const existingWorker = await prisma.user.findUnique({ where: { email: WORKER.email } });
const knownOrgId = existingOwner?.orgId ?? existingWorker?.orgId;
let org = knownOrgId ? await prisma.org.findUnique({ where: { id: knownOrgId } }) : null;
org ??= await prisma.org.findFirst({ where: { name: ORG_NAME }, orderBy: { id: 'asc' } });
org ??= await prisma.org.create({ data: { name: ORG_NAME } });
org = await prisma.org.update({
  where: { id: org.id },
  data: { name: ORG_NAME, billingExempt: true, storeLimit: null, pausedAt: null, deletedAt: null, payPeriodType: 'WEEKLY' },
});

const owner = await prisma.user.upsert({
  where: { email: OWNER.email },
  create: { authId: ownerAuthId, email: OWNER.email, name: OWNER.name, role: 'OWNER', orgId: org.id },
  update: { authId: ownerAuthId, name: OWNER.name, role: 'OWNER', orgId: org.id, approved: true },
});
await prisma.org.update({ where: { id: org.id }, data: { ownerId: owner.id } });

let store = await prisma.store.findFirst({ where: { orgId: org.id, name: STORE_NAME } });
store ??= await prisma.store.create({ data: { name: STORE_NAME, orgId: org.id } });
store = await prisma.store.update({ where: { id: store.id }, data: { requiresOpenerSkill: false, tracksClosingDuties: false } });
await prisma.schedule.upsert({ where: { storeId: store.id }, create: { storeId: store.id }, update: {} });
await prisma.managerStore.upsert({
  where: { userId_storeId: { userId: owner.id, storeId: store.id } },
  create: { userId: owner.id, storeId: store.id },
  update: {},
});

// --- shift needs: an 8-hour morning (a senior + a regular) and a 7-hour evening (two regulars), every day
await prisma.shiftRequirement.deleteMany({ where: { storeId: store.id } });
for (const day of DAYS) {
  await prisma.shiftRequirement.createMany({
    data: [
      { storeId: store.id, day, start: toClock('07:00'), end: toClock('15:00'), seniorRequired: 1, regularRequired: 1 },
      { storeId: store.id, day, start: toClock('15:00'), end: toClock('22:00'), regularRequired: 2 },
    ],
  });
}

// --- the team (kept across re-runs, matched by name within the demo store)
const emp: Record<string, number> = {};
for (const m of TEAM) {
  const link = await prisma.employeeStore.findFirst({ where: { storeId: store.id, employee: { name: m.name } } });
  const id =
    link?.employeeId ??
    (await prisma.employee.create({ data: { name: m.name, hourLimit: 40, maxShifts: 5, hireDate: new Date(m.hireDate) } })).id;
  await prisma.employee.update({ where: { id }, data: { hourLimit: 40, maxShifts: 5, standby: false, hireDate: new Date(m.hireDate) } });
  await prisma.employeeStore.upsert({
    where: { employeeId_storeId: { employeeId: id, storeId: store.id } },
    create: { employeeId: id, storeId: store.id, proficiency: m.tier },
    update: { proficiency: m.tier },
  });
  emp[m.name] = id;
}
await prisma.user.upsert({
  where: { email: WORKER.email },
  create: { authId: workerAuthId, email: WORKER.email, name: WORKER.name, role: 'EMPLOYEE', orgId: org.id, employeeId: emp[WORKER.name]! },
  update: { authId: workerAuthId, name: WORKER.name, role: 'EMPLOYEE', orgId: org.id, employeeId: emp[WORKER.name]!, approved: true },
});

// --- everything dated gets rebuilt from today, so re-running keeps it current
const teamIds = Object.values(emp);
await prisma.shift.deleteMany({ where: { storeId: store.id } }); // cascades to their swap/drop requests
await prisma.scheduleSnapshot.deleteMany({ where: { storeId: store.id } });
await prisma.message.deleteMany({ where: { storeId: store.id } });
await prisma.shiftNote.deleteMany({ where: { storeId: store.id } });
await prisma.timeOffRequest.deleteMany({ where: { employeeId: { in: teamIds } } });
await prisma.recurringAvailability.deleteMany({ where: { employeeId: { in: teamIds } } });
await prisma.notification.deleteMany({ where: { userId: { in: [owner.id] } } });
await prisma.availabilityConfirmation.deleteMany({ where: { employeeId: { in: teamIds } } });

// everyone's usual availability covers opening to close every day, so the
// schedule below never shows anyone working outside their hours
for (const id of teamIds) {
  for (const day of DAYS) {
    await prisma.recurringAvailability.create({ data: { employeeId: id, day, start: toClock('06:30'), end: toClock('22:30') } });
  }
}

// this week (already worked / in progress) and next week (posted): every slot filled
const thisWeek = mondayUTC();
const nextWeek = new Date(thisWeek.getTime() + 7 * 86_400_000);
const regulars = ['Ben Carter', 'Priya Shah', WORKER.name, 'Leo Kim', 'Taylor Brooks'];
const shiftIds: Record<string, number> = {}; // `${week}|${name}|${day}` → id
for (const weekStart of [thisWeek, nextWeek]) {
  for (const [d, day] of DAYS.entries()) {
    const slots: [string, string, string][] = [
      [d < 5 ? 'Ana Lopez' : 'Sam Ortiz', '07:00', '15:00'],
      [regulars[d % 5]!, '07:00', '15:00'],
      [regulars[(d + 1) % 5]!, '15:00', '22:00'],
      [regulars[(d + 2) % 5]!, '15:00', '22:00'],
    ];
    for (const [name, start, end] of slots) {
      const s = await prisma.shift.create({
        data: { storeId: store.id, employeeId: emp[name]!, weekStart, day, start: toClock(start), end: toClock(end) },
      });
      shiftIds[`${weekStart.getTime()}|${name}|${day}`] = s.id;
    }
  }
}
await prisma.schedule.update({
  where: { storeId: store.id },
  data: { weekStart: nextWeek, postedWeekStart: nextWeek, postedSnapshotId: null, publishedAt: new Date(), publishedById: owner.id },
});

// the worker has already confirmed their hours for the posted week
await prisma.availabilityConfirmation.create({ data: { employeeId: emp[WORKER.name]!, weekStart: nextWeek } });

// something in the marketplace for the worker, and something for the owner to approve
const next = (name: string, day: DayOfWeek) => shiftIds[`${nextWeek.getTime()}|${name}|${day}`];
const benFri = next('Ben Carter', 'FRIDAY') ?? Object.entries(shiftIds).find(([k]) => k.includes('|Ben Carter|') && k.startsWith(String(nextWeek.getTime())))![1];
await prisma.shiftChangeRequest.create({
  data: { type: 'DROP', openOffer: true, shiftId: benFri, requestedById: emp['Ben Carter']!, note: 'Family thing — can anyone grab this?' },
});
const leoDays = new Set(DAYS.filter((day) => next('Leo Kim', day)));
const priyaDay = DAYS.find((day) => next('Priya Shah', day) && !leoDays.has(day))!;
await prisma.shiftChangeRequest.create({
  data: { type: 'DROP', openOffer: true, shiftId: next('Priya Shah', priyaDay)!, requestedById: emp['Priya Shah']!, targetEmployeeId: emp['Leo Kim']!, note: 'Leo offered to cover.' },
});

// a time-off notice, a store chat, and an open shift note
const inThreeWeeks = new Date(nextWeek.getTime() + 14 * 86_400_000 + 4 * 86_400_000); // a Friday
await prisma.timeOffRequest.create({
  data: { employeeId: emp['Taylor Brooks']!, startDate: inThreeWeeks, endDate: new Date(inThreeWeeks.getTime() + 2 * 86_400_000), note: "Cousin's wedding" },
});
const worker = await prisma.user.findUniqueOrThrow({ where: { email: WORKER.email } });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
await prisma.message.createMany({
  data: [
    { storeId: store.id, userId: owner.id, authorName: OWNER.name, body: "Next week's schedule is up — have a look and swap in the app if anything doesn't work.", createdAt: minutesAgo(180) },
    { storeId: store.id, userId: null, authorName: 'Ana Lopez', body: 'New oat milk delivery is in the back fridge 🥛', createdAt: minutesAgo(95) },
    { storeId: store.id, userId: worker.id, authorName: WORKER.name, body: 'Thanks! I can take an extra evening if someone needs it.', createdAt: minutesAgo(40) },
  ],
});
await prisma.shiftNote.create({
  data: { storeId: store.id, userId: owner.id, authorName: OWNER.name, category: 'REFUND', body: 'Refunded a latte made with the wrong milk — customer was happy after.', customerName: 'Walk-in' },
});

// a direct message the worker can report and block (App Store 1.2), with any
// block left over from a previous review undone
const pair = [owner.id, worker.id];
await prisma.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: pair } }, { blockedId: { in: pair } }] } });
await prisma.directMessage.deleteMany({ where: { senderId: { in: pair }, recipientId: { in: pair } } });
await prisma.directMessage.create({
  data: { senderId: owner.id, recipientId: worker.id, body: 'Hi Jamie — could you open on Saturday? Ana asked for the morning off.', createdAt: minutesAgo(25) },
});

console.log(`Ready: "${ORG_NAME}" (business ${org.id}, store ${store.id})
  Owner:  ${OWNER.email}
  Worker: ${WORKER.email}
  Password: the REVIEWER_DEMO_PASSWORD you ran this with.
  Schedule posted for the week of ${nextWeek.toISOString().slice(0, 10)}; this week's shifts are in place too.`);
await prisma.$disconnect();
