/**
 * Next week's roster for Mango Mango / Ciao Poke (availability supplied by the owner).
 *
 *   npx tsx prisma/seed.ts   (or: npm run seed)
 *
 * Store rules are unchanged from the real-roster seed (see git history); only the
 * people and their availability differ.
 *
 * Soft preferences that the engine CANNOT model, applied by hand here:
 *  - Daniel: "preferably not" Sat/Sun -> those days left out of his availability.
 *    If that leaves a weekend slot short, the gap is the signal that he's needed.
 *  - Rey: "no consecutive shifts" -> not enforceable; "2-3 days max" -> maxShifts 3.
 *  - Cynthia: "wishes to work Friday with Rey" -> both are free Friday; not pinned.
 *  - Kai: "one shift, no full day" -> maxShifts 1 + only a single window on each of
 *    his two possible days, so he physically can't be given a full day.
 * Also unchanged: no back-to-back / min-shifts / full-half-day caps, no locked shifts.
 */
import prisma from '../src/lib/prisma.js';
import { ensureOpenerResponsibility } from '../src/lib/responsibilities.js';

// DateTime columns hold a wall-clock time; store it as a fixed date in UTC.
const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

const ALL_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
const WEEKDAYS = ALL_DAYS.slice(0, 5);
type Day = (typeof ALL_DAYS)[number];
type Tier = 'NEW' | 'REGULAR' | 'SENIOR' | 'MANAGER';

// reusable availability windows
const FULL_M: [string, string] = ['11:30', '23:30']; // whole day at Mango
const FULL_C: [string, string] = ['10:45', '22:30']; // whole day at Ciao
const FULL_B: [string, string] = ['10:00', '23:30']; // whole day, either store
const NIGHT: [string, string] = ['16:30', '23:30']; // a night shift (grace covers the 17:00 / 16:00 starts)
const AFTER_530: [string, string] = ['17:30', '23:30'];
const MORNING: [string, string] = ['10:00', '17:00']; // covers Mango opener + Ciao morning
const TIL_4: [string, string] = ['10:00', '16:00'];

interface EmployeeSeed {
  name: string;
  maxShifts?: number;
  standby?: boolean; // on-call: solver ignores them, manager can still assign by hand
  links: Array<{ store: 'Mango' | 'Ciao'; tier: Tier; canOpen?: boolean; primary?: boolean }>;
  avail: Partial<Record<Day, [string, string][]>>;
}

const ALL_WEEK_WIDE: Partial<Record<Day, [string, string][]>> = Object.fromEntries(
  ALL_DAYS.map((d) => [d, [['10:00', '22:30']] as [string, string][]]),
);

const EMPLOYEES: EmployeeSeed[] = [
  // --- Mango ---
  {
    name: 'Jasmine',
    links: [{ store: 'Mango', tier: 'REGULAR' }],
    avail: { TUESDAY: [AFTER_530], WEDNESDAY: [AFTER_530], THURSDAY: [AFTER_530], SUNDAY: [FULL_M] },
  },
  {
    name: 'Julia',
    links: [{ store: 'Mango', tier: 'SENIOR', canOpen: true }],
    avail: { WEDNESDAY: [NIGHT], FRIDAY: [NIGHT] },
  },
  {
    name: 'Mysha',
    maxShifts: 1,
    links: [{ store: 'Mango', tier: 'REGULAR' }],
    avail: { MONDAY: [NIGHT] },
  },
  {
    name: 'Owen',
    links: [{ store: 'Mango', tier: 'SENIOR', canOpen: true }],
    avail: { WEDNESDAY: [NIGHT], FRIDAY: [FULL_M], SATURDAY: [FULL_M], SUNDAY: [FULL_M] },
  },
  {
    name: 'Rachel L.',
    links: [{ store: 'Mango', tier: 'NEW' }],
    avail: { FRIDAY: [FULL_M], SATURDAY: [FULL_M], SUNDAY: [MORNING] },
  },
  {
    name: 'Rey', // "2-3 days max"; "no consecutive shifts" not enforceable
    maxShifts: 3,
    links: [{ store: 'Mango', tier: 'SENIOR', canOpen: true }],
    avail: {
      MONDAY: [FULL_M], TUESDAY: [FULL_M], WEDNESDAY: [FULL_M],
      THURSDAY: [['11:30', '17:00']], // whole week EXCEPT Thursday night
      FRIDAY: [FULL_M], SATURDAY: [FULL_M], SUNDAY: [FULL_M],
    },
  },
  {
    name: 'Cynthia', // senior, can open; wishes to work Friday with Rey.
    // Can cover Poke too, but Mango is her home -- the solver only sends her to Poke to close a gap.
    links: [
      { store: 'Mango', tier: 'SENIOR', canOpen: true },
      { store: 'Ciao', tier: 'REGULAR', primary: false },
    ],
    avail: { WEDNESDAY: [FULL_M], THURSDAY: [['11:30', '22:30']], FRIDAY: [FULL_M], SATURDAY: [FULL_M] },
  },
  {
    name: 'Yuxin', // new hire at Mango. As a trainee: night shifts only, no opening,
    // and barred from the weekend whole-day slot -- so "full Sat" / "Sun after 4" go unused.
    links: [{ store: 'Mango', tier: 'NEW' }],
    avail: {
      TUESDAY: [['15:00', '22:30']], FRIDAY: [['15:00', '23:00']],
      SATURDAY: [['11:30', '23:00']], SUNDAY: [['16:00', '22:30']],
    },
  },
  // --- Ciao Poke ---
  {
    name: 'Kai', // Friday OR Saturday, one shift, no full day
    maxShifts: 1,
    links: [{ store: 'Ciao', tier: 'REGULAR' }],
    avail: { FRIDAY: [['16:00', '22:00']], SATURDAY: [['10:45', '16:00']] },
  },
  {
    name: 'Abby', // Mon & Thu mornings
    links: [{ store: 'Ciao', tier: 'REGULAR' }],
    avail: { MONDAY: [['10:45', '16:00']], THURSDAY: [['10:45', '16:00']] },
  },
  {
    name: 'Leo', // Mon morning; Wed 2:30->close; Fri 2:00->close; Sunday
    links: [{ store: 'Ciao', tier: 'REGULAR' }],
    avail: {
      MONDAY: [['10:45', '16:00']],
      WEDNESDAY: [['14:30', '21:30']], // Ciao closes 21:30
      FRIDAY: [['14:00', '22:00']], // Ciao closes 22:00 Fri
      SUNDAY: [['10:45', '21:30']],
    },
  },
  {
    name: 'Michael',
    links: [{ store: 'Ciao', tier: 'REGULAR' }],
    avail: { THURSDAY: [FULL_C], SATURDAY: [FULL_C] },
  },
  {
    name: 'Danny', // on-call backup for Poke -- never auto-scheduled, always in the manual picker
    standby: true,
    links: [{ store: 'Ciao', tier: 'REGULAR' }],
    avail: ALL_WEEK_WIDE,
  },
  // --- both stores ---
  {
    name: 'Cindy',
    links: [
      { store: 'Mango', tier: 'REGULAR', canOpen: true },
      { store: 'Ciao', tier: 'REGULAR' },
    ],
    avail: { MONDAY: [FULL_B], WEDNESDAY: [NIGHT], THURSDAY: [MORNING], FRIDAY: [TIL_4] },
  },
  {
    name: 'Daniel', // owner; "preferably not" Sat/Sun -> omitted
    links: [
      { store: 'Mango', tier: 'MANAGER', canOpen: true },
      { store: 'Ciao', tier: 'MANAGER' },
    ],
    avail: { MONDAY: [FULL_B], TUESDAY: [FULL_B], THURSDAY: [FULL_B] },
  },
];

const MANGO_CLOSE: Partial<Record<Day, string>> = { FRIDAY: '23:00', SATURDAY: '23:00' };
const mangoClose = (day: Day) => MANGO_CLOSE[day] ?? '22:30';

const CIAO_CLOSE: Partial<Record<Day, string>> = { FRIDAY: '22:00', SATURDAY: '22:00' };
const ciaoClose = (day: Day) => CIAO_CLOSE[day] ?? '21:30';

async function main() {
  // Re-seeding wipes every Employee, and User.employeeId is ON DELETE SET NULL, so
  // it would silently orphan every login. Refuse unless explicitly forced.
  const userCount = await prisma.user.count();
  if (userCount > 0 && process.env.SEED_FORCE !== '1') {
    console.error(
      `Refusing to seed: ${userCount} User account(s) exist and re-seeding would unlink them ` +
        `from their employee record. Run with SEED_FORCE=1 to seed anyway.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.shiftChangeRequest.deleteMany();
  await prisma.scheduleSnapshot.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.recurringAvailability.deleteMany();
  await prisma.shiftRequirement.deleteMany();
  await prisma.managerStore.deleteMany();
  await prisma.employeeStore.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.store.deleteMany();
  await prisma.org.deleteMany();

  const org = await prisma.org.create({ data: { name: 'My Company' } });
  const mango = await prisma.store.create({
    data: { name: 'Mango', orgId: org.id, schedule: { create: {} } },
  });
  const ciao = await prisma.store.create({
    data: { name: 'Ciao', orgId: org.id, requiresOpenerSkill: false, schedule: { create: {} } },
  });
  const storeId = { Mango: mango.id, Ciao: ciao.id };
  const openerId = {
    Mango: await ensureOpenerResponsibility(mango.id),
    Ciao: await ensureOpenerResponsibility(ciao.id),
  };

  for (const p of EMPLOYEES) {
    const emp = await prisma.employee.create({
      data: { name: p.name, hourLimit: 60, maxShifts: p.maxShifts ?? 6, standby: p.standby ?? false },
    });
    for (const link of p.links) {
      await prisma.employeeStore.create({
        data: {
          employeeId: emp.id,
          storeId: storeId[link.store],
          proficiency: link.tier,
          primary: link.primary ?? true,
        },
      });
      if (link.canOpen) {
        await prisma.employeeResponsibility.create({
          data: { employeeId: emp.id, storeId: storeId[link.store], responsibilityId: openerId[link.store] },
        });
      }
    }
    const availRows = Object.entries(p.avail).flatMap(([day, windows]) =>
      (windows ?? []).map(([start, end]) => ({ employeeId: emp.id, day: day as Day, start: t(start), end: t(end) })),
    );
    if (availRows.length) await prisma.recurringAvailability.createMany({ data: availRows });
  }

  const reqs: Array<{
    storeId: number; day: Day; start: Date; end: Date;
    managerRequired?: number; seniorRequired?: number; regularRequired?: number; newRequired?: number;
    needOpen?: boolean; graceMinutes?: number;
  }> = [];

  // night shifts: arriving up to an hour late is fine (matches scheduler_real.py)
  const NIGHT_GRACE = 60;

  for (const day of WEEKDAYS) {
    // opener block -- 1 person Mon-Thu, 2 on Friday; at least one can open, on time (no grace)
    reqs.push({
      storeId: mango.id, day, start: t('11:30'), end: t('17:00'),
      regularRequired: day === 'FRIDAY' ? 2 : 1, needOpen: true,
    });

    // night: Thursday wants 2 seniors + a new; other weekdays just want a new allowed
    const nightEnd = mangoClose(day);
    const nHead = day === 'FRIDAY' ? 4 : 3;
    if (day === 'THURSDAY') {
      reqs.push({ storeId: mango.id, day, start: t('17:00'), end: t(nightEnd), seniorRequired: 2, newRequired: 1, graceMinutes: NIGHT_GRACE });
    } else {
      reqs.push({ storeId: mango.id, day, start: t('17:00'), end: t(nightEnd), regularRequired: nHead - 1, newRequired: 1, graceMinutes: NIGHT_GRACE });
    }
  }
  for (const day of ['SATURDAY', 'SUNDAY'] as const) {
    reqs.push({
      storeId: mango.id, day, start: t('11:30'), end: t(mangoClose(day)),
      seniorRequired: 1, regularRequired: 3, needOpen: true,
    });
  }
  for (const day of ALL_DAYS) {
    const head = day === 'FRIDAY' ? 2 : 1;
    reqs.push({ storeId: ciao.id, day, start: t('10:45'), end: t('16:00'), regularRequired: head });
    reqs.push({ storeId: ciao.id, day, start: t('16:00'), end: t(ciaoClose(day)), regularRequired: head, graceMinutes: NIGHT_GRACE });
  }

  await prisma.shiftRequirement.createMany({ data: reqs });

  const counts = {
    stores: await prisma.store.count(),
    employees: await prisma.employee.count(),
    employeeStores: await prisma.employeeStore.count(),
    availability: await prisma.recurringAvailability.count(),
    shiftRequirements: await prisma.shiftRequirement.count(),
  };
  console.log('seeded', counts);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
