// Demo business for sales calls: two stores with a believable crew, real
// generated schedules and something in every screen, so a walkthrough never
// lands on an empty page.
//
//   SALES_DEMO_EMAIL='you@gmail.com' SALES_DEMO_PASSWORD='…' npm run seed:sales-demo
//
// Logins (same password):
//   SALES_DEMO_EMAIL            — the owner
//   <name>+worker@<domain>      — a worker (Jamie Chen); Gmail delivers +anything
//                                 to the same inbox, so no second account needed
//
// Re-run it before a call: everything dated is rebuilt around the current week.
// Schedules come from the real generator, so the solver must be reachable at
// SOLVER_URL (default http://localhost:8000 — `cd Solver && .venv/bin/python -m
// uvicorn service:app --port 8000`). The business is comped (billingExempt),
// so it's never billed or locked out. It refuses to touch any login that
// belongs to a live business other than this demo.

import prisma from '../src/lib/prisma.js';
import { supabaseAdmin } from '../src/lib/supabase.js';
import { generateScheduleForStore, mondayUTC } from '../src/lib/scheduleGen.js';
import { ensureOpenerResponsibility } from '../src/lib/responsibilities.js';
import { toClock } from '../src/lib/time.js';
import type { DayOfWeek, Experience } from '@prisma/client';

const ORG_NAME = 'Sunrise Tea House';
const DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const WEEKDAYS = DAYS.slice(0, 5);
const WEEKEND: DayOfWeek[] = ['SATURDAY', 'SUNDAY'];

const ownerEmail = (process.env.SALES_DEMO_EMAIL ?? '').trim().toLowerCase();
const password = process.env.SALES_DEMO_PASSWORD ?? '';
if (!ownerEmail.includes('@') || password.length < 8) {
  console.error("Set SALES_DEMO_EMAIL and SALES_DEMO_PASSWORD (8+ chars): SALES_DEMO_EMAIL='you@gmail.com' SALES_DEMO_PASSWORD='…' npm run seed:sales-demo");
  process.exit(1);
}
const [local, domain] = ownerEmail.split('@') as [string, string];
const workerEmail = `${local.split('+')[0]}+worker@${domain}`;
const OWNER_NAME = 'Daniel He';
const WORKER_NAME = 'Jamie Chen';

// --- the crew -------------------------------------------------------------
// avail: standing weekly hours. 'all' = open to close every day.
type Avail = 'all' | 'weekdays' | 'evenings+weekends' | 'mornings' | 'weekends' | 'no-mondays';
interface Member {
  name: string;
  phone: string;
  hireDate: string;
  hourLimit: number;
  maxShifts: number;
  targetHours?: number;
  avail: Avail;
  stores: { store: 'Downtown' | 'Riverside'; tier: Experience; primary?: boolean; opener?: boolean; closer?: string[] }[];
}
const CREW: Member[] = [
  { name: 'Maya Patel', phone: '+12015550101', hireDate: '2022-08-15', hourLimit: 40, maxShifts: 5, targetHours: 38, avail: 'all', stores: [{ store: 'Downtown', tier: 'MANAGER', opener: true, closer: ['Count the register'] }] },
  { name: 'Diego Ramirez', phone: '+12015550102', hireDate: '2023-03-01', hourLimit: 40, maxShifts: 5, targetHours: 32, avail: 'no-mondays', stores: [{ store: 'Downtown', tier: 'SENIOR', opener: true, closer: ['Count the register', 'Clean the machines'] }] },
  { name: WORKER_NAME, phone: '+12015550103', hireDate: '2025-05-05', hourLimit: 30, maxShifts: 4, avail: 'evenings+weekends', stores: [{ store: 'Downtown', tier: 'REGULAR', closer: ['Mop the floors', 'Restock cups & lids'] }] },
  { name: 'Chloe Nguyen', phone: '+12015550104', hireDate: '2024-09-09', hourLimit: 32, maxShifts: 5, avail: 'all', stores: [{ store: 'Downtown', tier: 'REGULAR', closer: ['Clean the machines'] }, { store: 'Riverside', tier: 'REGULAR', primary: false, closer: ['Clean the machines'] }] },
  { name: 'Marcus Lee', phone: '+12015550105', hireDate: '2024-02-12', hourLimit: 40, maxShifts: 5, avail: 'all', stores: [{ store: 'Downtown', tier: 'REGULAR', opener: true, closer: ['Take out trash & recycling'] }, { store: 'Riverside', tier: 'REGULAR', primary: false }] },
  { name: 'Sofia Garcia', phone: '+12015550106', hireDate: '2025-01-20', hourLimit: 25, maxShifts: 4, avail: 'evenings+weekends', stores: [{ store: 'Downtown', tier: 'REGULAR', closer: ['Mop the floors', 'Take out trash & recycling'] }] },
  { name: 'Ethan Brooks', phone: '+12015550107', hireDate: '2026-08-24', hourLimit: 20, maxShifts: 3, avail: 'weekends', stores: [{ store: 'Downtown', tier: 'NEW', closer: ['Restock cups & lids'] }] },
  { name: 'Hannah Kim', phone: '+12015550108', hireDate: '2025-10-06', hourLimit: 28, maxShifts: 4, avail: 'mornings', stores: [{ store: 'Downtown', tier: 'REGULAR', opener: true }] },
  { name: 'Priya Shah', phone: '+12015550109', hireDate: '2022-11-14', hourLimit: 40, maxShifts: 5, targetHours: 36, avail: 'all', stores: [{ store: 'Riverside', tier: 'MANAGER', opener: true, closer: ['Count the register'] }] },
  { name: 'Omar Hassan', phone: '+12015550110', hireDate: '2023-06-19', hourLimit: 38, maxShifts: 5, avail: 'all', stores: [{ store: 'Riverside', tier: 'SENIOR', opener: true, closer: ['Count the register', 'Clean the machines'] }] },
  { name: 'Ava Thompson', phone: '+12015550111', hireDate: '2024-07-08', hourLimit: 30, maxShifts: 4, avail: 'evenings+weekends', stores: [{ store: 'Riverside', tier: 'REGULAR', closer: ['Mop the floors'] }] },
  { name: 'Noah Wilson', phone: '+12015550112', hireDate: '2025-03-03', hourLimit: 30, maxShifts: 4, avail: 'all', stores: [{ store: 'Riverside', tier: 'REGULAR', opener: true, closer: ['Take out trash & recycling'] }] },
  { name: 'Zoe Martinez', phone: '+12015550113', hireDate: '2026-09-02', hourLimit: 20, maxShifts: 3, avail: 'weekends', stores: [{ store: 'Riverside', tier: 'NEW', closer: ['Restock cups & lids'] }] },
  { name: 'Liam Carter', phone: '+12015550114', hireDate: '2025-06-16', hourLimit: 28, maxShifts: 4, avail: 'evenings+weekends', stores: [{ store: 'Riverside', tier: 'REGULAR', closer: ['Mop the floors', 'Take out trash & recycling'] }] },
];
const CLOSING_TASKS = ['Count the register', 'Clean the machines', 'Mop the floors', 'Take out trash & recycling', 'Restock cups & lids'];

function windowsFor(a: Avail): { day: DayOfWeek; start: string; end: string }[] {
  const all = (days: DayOfWeek[], start: string, end: string) => days.map((day) => ({ day, start, end }));
  switch (a) {
    case 'all': return all(DAYS, '09:00', '23:30');
    case 'weekdays': return all(WEEKDAYS, '09:00', '23:30');
    case 'no-mondays': return all(DAYS.slice(1), '09:00', '23:30');
    case 'mornings': return all(DAYS, '09:00', '16:30');
    case 'weekends': return all(WEEKEND, '09:00', '23:30');
    case 'evenings+weekends': return [...all(WEEKDAYS, '15:30', '23:30'), ...all(WEEKEND, '09:00', '23:30')];
  }
}

// --- guard: never touch a real business ---------------------------------------
for (const email of [ownerEmail, workerEmail]) {
  const u = await prisma.user.findUnique({ where: { email }, include: { org: true } });
  if (u?.isSuperAdmin) {
    console.error(`${email} is a platform admin login — use a different email for the demo. Nothing changed.`);
    process.exit(1);
  }
  if (u?.org && u.org.name !== ORG_NAME && !u.org.deletedAt) {
    console.error(`${email} belongs to the live business "${u.org.name}" — stopping without changes.`);
    process.exit(1);
  }
}

// --- logins: create the Supabase auth user, or reset its password if it exists
async function authUser(email: string): Promise<string> {
  const admin = supabaseAdmin();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.data.user) return created.data.user.id;
  for (let page = 1; page < 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) {
      const upd = await admin.auth.admin.updateUserById(match.id, { password, email_confirm: true });
      if (upd.error) throw new Error(`Could not reset the password for ${email}: ${upd.error.message}`);
      return match.id;
    }
    if (data.users.length < 1000) break;
  }
  throw new Error(`Could not create ${email}: ${created.error?.message ?? 'unknown error'}`);
}
const ownerAuthId = await authUser(ownerEmail);
const workerAuthId = await authUser(workerEmail);

// --- business + owner ------------------------------------------------------------
const existingOwner = await prisma.user.findUnique({ where: { email: ownerEmail }, include: { org: true } });
let org = existingOwner?.org?.name === ORG_NAME ? existingOwner.org : null;
org ??= await prisma.org.findFirst({ where: { name: ORG_NAME, deletedAt: null } });
org ??= await prisma.org.create({ data: { name: ORG_NAME } });
org = await prisma.org.update({
  where: { id: org.id },
  data: { name: ORG_NAME, billingExempt: true, storeLimit: null, pausedAt: null, deletedAt: null, payPeriodType: 'WEEKLY', addons: ['chat', 'notes', 'closing'] },
});
const owner = await prisma.user.upsert({
  where: { email: ownerEmail },
  create: { authId: ownerAuthId, email: ownerEmail, name: OWNER_NAME, phone: '+12015550100', role: 'OWNER', orgId: org.id },
  // employeeId cleared: a profile from some earlier test business shouldn't follow this login in
  update: { authId: ownerAuthId, name: OWNER_NAME, phone: '+12015550100', role: 'OWNER', orgId: org.id, approved: true, employeeId: null, pushMuted: [] },
});
await prisma.org.update({ where: { id: org.id }, data: { ownerId: owner.id } });

// --- stores --------------------------------------------------------------------------
async function store(name: string, opts: { noBackToBackDays: DayOfWeek[] }) {
  let s = await prisma.store.findFirst({ where: { orgId: org!.id, name } });
  s ??= await prisma.store.create({ data: { name, orgId: org!.id } });
  s = await prisma.store.update({
    where: { id: s.id },
    data: { requiresOpenerSkill: true, pairNewWorkers: true, tracksClosingDuties: true, noBackToBackDays: opts.noBackToBackDays },
  });
  await prisma.schedule.upsert({ where: { storeId: s.id }, create: { storeId: s.id }, update: {} });
  await prisma.managerStore.upsert({ where: { userId_storeId: { userId: owner.id, storeId: s.id } }, create: { userId: owner.id, storeId: s.id }, update: {} });
  return s;
}
// Downtown's 6-7h shifts would make a back-to-back day 12-13 hours, so nobody doubles up there
const downtown = await store('Downtown', { noBackToBackDays: DAYS });
// two morning people + two *different* evening people on weekends
const riverside = await store('Riverside', { noBackToBackDays: WEEKEND });
const storeId = { Downtown: downtown.id, Riverside: riverside.id } as const;

// sections someone added while trying things out on a call: a store with
// sections can't be scheduled itself, so they'd leave that store's demo blank
const sections = await prisma.store.findMany({ where: { parentStoreId: { in: [downtown.id, riverside.id] } }, select: { id: true } });
if (sections.length) {
  const ids = sections.map((s) => s.id);
  const where = { storeId: { in: ids } };
  await prisma.employeeResponsibility.deleteMany({ where });
  await prisma.closingDutyAssignment.deleteMany({ where: { closingDuty: where } });
  await prisma.closingDuty.deleteMany({ where });
  await prisma.responsibility.deleteMany({ where });
  await prisma.managerStore.deleteMany({ where });
  await prisma.employeeStore.deleteMany({ where });
  await prisma.shiftRequirement.deleteMany({ where });
  await prisma.shift.deleteMany({ where });
  await prisma.fixedShift.deleteMany({ where });
  await prisma.scheduleSnapshot.deleteMany({ where });
  await prisma.scheduleEditLog.deleteMany({ where });
  await prisma.schedule.deleteMany({ where });
  await prisma.messageRead.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.shiftNote.deleteMany({ where });
  await prisma.storeInvite.deleteMany({ where });
  await prisma.storeHours.deleteMany({ where });
  await prisma.storeHoliday.deleteMany({ where });
  await prisma.store.deleteMany({ where: { id: { in: ids } } });
}

// shift needs — Downtown is the busier one
const need = (sid: number, days: DayOfWeek[], start: string, end: string, t: { senior?: number; regular?: number; newbies?: number; open?: boolean }) =>
  days.map((day) => ({
    storeId: sid, day, start: toClock(start), end: toClock(end),
    seniorRequired: t.senior ?? 0, regularRequired: t.regular ?? 0, newRequired: t.newbies ?? 0, needOpen: !!t.open,
  }));
await prisma.shiftRequirement.deleteMany({ where: { storeId: { in: [downtown.id, riverside.id] } } });
await prisma.shiftRequirement.createMany({
  data: [
    ...need(downtown.id, WEEKDAYS, '10:00', '16:00', { senior: 1, regular: 1, open: true }),
    ...need(downtown.id, WEEKDAYS, '16:00', '22:00', { regular: 2 }),
    ...need(downtown.id, WEEKEND, '10:00', '16:00', { senior: 1, regular: 2, open: true }),
    ...need(downtown.id, WEEKEND, '16:00', '23:00', { senior: 1, regular: 1, newbies: 1 }),
    ...need(riverside.id, WEEKDAYS, '11:00', '17:00', { senior: 1, regular: 1, open: true }),
    ...need(riverside.id, WEEKDAYS, '17:00', '21:00', { regular: 1 }),
    ...need(riverside.id, WEEKEND, '11:00', '17:00', { senior: 1, regular: 1, open: true }),
    ...need(riverside.id, WEEKEND, '17:00', '22:00', { regular: 1, newbies: 1 }),
  ],
});

// opener + closing-duty roles at each store
const openerId = { Downtown: await ensureOpenerResponsibility(downtown.id), Riverside: await ensureOpenerResponsibility(riverside.id) };
const closingId: Record<string, Record<string, number>> = { Downtown: {}, Riverside: {} };
for (const [sName, sid] of Object.entries(storeId)) {
  for (const [i, task] of CLOSING_TASKS.entries()) {
    const r = await prisma.responsibility.upsert({
      where: { storeId_name: { storeId: sid, name: task } },
      create: { storeId: sid, name: task, scope: 'CLOSING', sortOrder: i + 1 },
      update: { scope: 'CLOSING', sortOrder: i + 1, archivedAt: null },
    });
    closingId[sName]![task] = r.id;
  }
}

// --- the crew (kept across re-runs, matched by name within the demo stores) ------------------
const emp: Record<string, number> = {};
for (const m of CREW) {
  const link = await prisma.employeeStore.findFirst({ where: { storeId: { in: Object.values(storeId) }, employee: { name: m.name } } });
  const data = { name: m.name, phone: m.phone, hourLimit: m.hourLimit, maxShifts: m.maxShifts, targetHours: m.targetHours ?? null, standby: false, hireDate: new Date(m.hireDate), fullDayOnly: false, noConsecutiveDays: false };
  const id = link?.employeeId ?? (await prisma.employee.create({ data })).id;
  await prisma.employee.update({ where: { id }, data });
  emp[m.name] = id;
  await prisma.employeeResponsibility.deleteMany({ where: { employeeId: id, storeId: { in: Object.values(storeId) } } });
  for (const s of m.stores) {
    const sid = storeId[s.store];
    await prisma.employeeStore.upsert({
      where: { employeeId_storeId: { employeeId: id, storeId: sid } },
      create: { employeeId: id, storeId: sid, proficiency: s.tier, primary: s.primary ?? true },
      update: { proficiency: s.tier, primary: s.primary ?? true },
    });
    const grants = [...(s.opener ? [openerId[s.store]] : []), ...(s.closer ?? []).map((t) => closingId[s.store]![t]!)];
    if (grants.length) {
      await prisma.employeeResponsibility.createMany({ data: grants.map((responsibilityId) => ({ employeeId: id, storeId: sid, responsibilityId })) });
    }
  }
}
const teamIds = Object.values(emp);
await prisma.user.upsert({
  where: { email: workerEmail },
  create: { authId: workerAuthId, email: workerEmail, name: WORKER_NAME, phone: '+12015550103', role: 'EMPLOYEE', orgId: org.id, employeeId: emp[WORKER_NAME]! },
  update: { authId: workerAuthId, name: WORKER_NAME, phone: '+12015550103', role: 'EMPLOYEE', orgId: org.id, employeeId: emp[WORKER_NAME]!, approved: true, pushMuted: [] },
});
const worker = await prisma.user.findUniqueOrThrow({ where: { email: workerEmail } });

// --- wipe everything dated, then rebuild around this week ---------------------------------------
const sids = Object.values(storeId);
await prisma.shift.deleteMany({ where: { storeId: { in: sids } } }); // cascades to swap/drop requests
await prisma.scheduleSnapshot.deleteMany({ where: { storeId: { in: sids } } });
await prisma.scheduleEditLog.deleteMany({ where: { storeId: { in: sids } } });
await prisma.closingDutyAssignment.deleteMany({ where: { closingDuty: { storeId: { in: sids } } } });
await prisma.closingDuty.deleteMany({ where: { storeId: { in: sids } } });
await prisma.messageRead.deleteMany({ where: { storeId: { in: sids } } });
await prisma.message.deleteMany({ where: { storeId: { in: sids } } });
await prisma.shiftNote.deleteMany({ where: { storeId: { in: sids } } });
await prisma.timeOffRequest.deleteMany({ where: { employeeId: { in: teamIds } } });
await prisma.recurringAvailability.deleteMany({ where: { employeeId: { in: teamIds } } });
await prisma.weekAvailability.deleteMany({ where: { employeeId: { in: teamIds } } });
await prisma.availabilityConfirmation.deleteMany({ where: { employeeId: { in: teamIds } } });
await prisma.fixedShift.deleteMany({ where: { storeId: { in: sids } } });
await prisma.directMessage.deleteMany({ where: { OR: [{ senderId: { in: [owner.id, worker.id] } }, { recipientId: { in: [owner.id, worker.id] } }] } });
await prisma.notification.deleteMany({ where: { userId: { in: [owner.id, worker.id] } } });
await prisma.deviceToken.deleteMany({ where: { userId: { in: [owner.id, worker.id] } } });

for (const m of CREW) {
  await prisma.recurringAvailability.createMany({
    data: windowsFor(m.avail).map((w) => ({ employeeId: emp[m.name]!, day: w.day, start: toClock(w.start), end: toClock(w.end) })),
  });
}

// real schedules from the generator: this week (in progress) and next week (posted)
const thisWeek = mondayUTC();
const nextWeek = new Date(thisWeek.getTime() + 7 * 86_400_000);
const gaps: string[] = [];
for (const [sName, sid] of Object.entries(storeId)) {
  for (const week of [thisWeek, nextWeek]) {
    await prisma.schedule.update({ where: { storeId: sid }, data: { weekStart: week, postedWeekStart: null, publishedAt: null } });
    const r = await generateScheduleForStore(sid, { solveSeconds: 8 });
    if (!r.feasible) throw new Error(`The generator couldn't build ${sName}'s week of ${week.toISOString().slice(0, 10)}`);
    const short = (r.gaps as { shortBy: number }[]).reduce((n, g) => n + g.shortBy, 0);
    if (short) gaps.push(`${sName} ${week.toISOString().slice(0, 10)}: ${short} short`);
  }
  await prisma.schedule.update({
    where: { storeId: sid },
    data: { weekStart: nextWeek, postedWeekStart: nextWeek, postedSnapshotId: null, publishedAt: new Date(Date.now() - 26 * 3_600_000), publishedById: owner.id },
  });
}

// most of the crew have confirmed next week's hours; a couple haven't yet
for (const name of CREW.map((m) => m.name).filter((n) => !['Ethan Brooks', 'Liam Carter'].includes(n))) {
  await prisma.availabilityConfirmation.create({ data: { employeeId: emp[name]!, weekStart: nextWeek } });
}

// --- marketplace + requests, on next week's posted shifts ---------------------------------------
const nextShift = async (name: string, sid: number, avoidDays: DayOfWeek[] = []) =>
  prisma.shift.findFirst({ where: { storeId: sid, weekStart: nextWeek, employeeId: emp[name]!, day: { notIn: avoidDays } }, orderBy: { day: 'desc' } });
const drop = await nextShift('Sofia Garcia', downtown.id);
if (drop) {
  await prisma.shiftChangeRequest.create({ data: { type: 'DROP', openOffer: true, shiftId: drop.id, requestedById: emp['Sofia Garcia']!, note: 'Midterm that night — can anyone grab this?' } });
}
// a shift someone's handing to a coworker, waiting for the manager's OK
const give = await nextShift('Chloe Nguyen', downtown.id);
const markusDays = (await prisma.shift.findMany({ where: { weekStart: nextWeek, employeeId: emp['Marcus Lee']! }, select: { day: true } })).map((s) => s.day);
const giveFree = give && !markusDays.includes(give.day) ? give : await nextShift('Chloe Nguyen', downtown.id, markusDays);
if (giveFree) {
  await prisma.shiftChangeRequest.create({
    data: { type: 'DROP', openOffer: true, shiftId: giveFree.id, requestedById: emp['Chloe Nguyen']!, targetEmployeeId: emp['Marcus Lee']!, note: 'Marcus said he can cover for me.' },
  });
}
const riverDrop = await nextShift('Ava Thompson', riverside.id);
if (riverDrop) {
  await prisma.shiftChangeRequest.create({ data: { type: 'DROP', openOffer: true, shiftId: riverDrop.id, requestedById: emp['Ava Thompson']!, note: 'Concert tickets 🎶 anyone?' } });
}

// --- time off, chat, DMs, shift notes, the owner's bell ------------------------------------
const day = 86_400_000;
const twoWeeksOut = new Date(nextWeek.getTime() + 7 * day + 3 * day); // a Thursday
await prisma.timeOffRequest.create({ data: { employeeId: emp['Omar Hassan']!, startDate: twoWeeksOut, endDate: new Date(twoWeeksOut.getTime() + 3 * day), note: "Sister's wedding in Chicago" } });
await prisma.timeOffRequest.create({ data: { employeeId: emp['Hannah Kim']!, startDate: new Date(nextWeek.getTime() + 21 * day), endDate: new Date(nextWeek.getTime() + 27 * day), note: 'Family trip' } });

const ago = (min: number) => new Date(Date.now() - min * 60_000);
await prisma.message.createMany({
  data: [
    { storeId: downtown.id, userId: owner.id, authorName: OWNER_NAME, body: "Next week's schedule is posted 🎉 Swap in the app if anything doesn't work — no group texts needed.", createdAt: ago(26 * 60) },
    { storeId: downtown.id, userId: null, authorName: 'Maya Patel', body: 'New brown sugar boba is in the walk-in, top shelf. Use the old batch first!', createdAt: ago(300) },
    { storeId: downtown.id, userId: null, authorName: 'Diego Ramirez', body: 'Ice machine is making a weird noise again — I put in a maintenance note.', createdAt: ago(140) },
    { storeId: downtown.id, userId: worker.id, authorName: WORKER_NAME, body: 'I can take an extra evening this week if anyone needs it 🙋', createdAt: ago(45) },
    { storeId: riverside.id, userId: owner.id, authorName: OWNER_NAME, body: 'Welcome Zoe! She starts weekends with us — say hi 👋', createdAt: ago(48 * 60) },
    { storeId: riverside.id, userId: null, authorName: 'Priya Shah', body: 'Reminder: fall menu launches Friday. Taro + pumpkin spice milk tea.', createdAt: ago(200) },
    { storeId: riverside.id, userId: null, authorName: 'Noah Wilson', body: 'Who has the spare key this week?', createdAt: ago(60) },
  ],
});
await prisma.directMessage.createMany({
  data: [
    { senderId: worker.id, recipientId: owner.id, body: 'Hi! Could I get more weekend hours next month? Happy to train on opening.', createdAt: ago(90) },
    { senderId: owner.id, recipientId: worker.id, body: "Sounds good — I'll add you to the opener training on Saturday.", createdAt: ago(70), readAt: ago(60) },
    { senderId: worker.id, recipientId: owner.id, body: 'Thank you!! 🙏', createdAt: ago(65) },
  ],
});
await prisma.shiftNote.createMany({
  data: [
    { storeId: downtown.id, userId: null, authorName: 'Diego Ramirez', category: 'MAINTENANCE', body: 'Ice machine is rattling and slow to refill. Might need a service call.', createdAt: ago(150) },
    { storeId: downtown.id, userId: null, authorName: 'Maya Patel', category: 'REFUND', body: 'Refunded a large taro milk tea — made with whole milk instead of oat.', customerName: 'Walk-in', orderDetails: 'Large taro, oat milk, 50% sugar', createdAt: ago(400) },
    { storeId: downtown.id, userId: null, authorName: 'Sofia Garcia', category: 'LOST_FOUND', body: 'Blue water bottle left on the counter — it’s in the office.', createdAt: ago(30 * 60), resolvedAt: ago(20 * 60), resolvedById: owner.id, resolvedName: OWNER_NAME },
    { storeId: riverside.id, userId: null, authorName: 'Omar Hassan', category: 'STOCK', body: 'Low on large cups and lids — about two days left.', createdAt: ago(240) },
  ],
});
await prisma.notification.createMany({
  data: [
    { userId: owner.id, kind: 'GENERIC', title: 'A shift change needs your OK', body: 'Chloe Nguyen wants to give a shift to Marcus Lee.', link: '/requests', createdAt: ago(55) },
    { userId: owner.id, kind: 'GENERIC', title: 'Omar Hassan is taking time off', body: "Sister's wedding in Chicago", link: '/requests', createdAt: ago(180) },
    { userId: owner.id, kind: 'GENERIC', title: 'Ava Thompson posted a shift to the marketplace', link: '/requests', createdAt: ago(240) },
    { userId: worker.id, kind: 'GENERIC', title: `The Downtown schedule for the week of ${nextWeek.toISOString().slice(5, 10)} is up`, body: "You're on the schedule — check My Shifts.", link: '/my-shifts', createdAt: ago(26 * 60) },
  ],
});

console.log(`Ready: "${ORG_NAME}" (business ${org.id}) — Downtown (store ${downtown.id}) and Riverside (store ${riverside.id}), ${CREW.length} people
  Owner:  ${ownerEmail}
  Worker: ${workerEmail} (${WORKER_NAME})
  Next week (${nextWeek.toISOString().slice(0, 10)}) is posted; this week's shifts are in place.
  ${gaps.length ? `Gaps left by the generator: ${gaps.join('; ')}` : 'Every shift is covered.'}`);
await prisma.$disconnect();
