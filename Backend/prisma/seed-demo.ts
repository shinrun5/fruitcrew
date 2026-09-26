/**
 * Small demo roster for exercising POST /schedule/generate end to end.
 *
 *   npx tsx prisma/seed.ts
 *
 * Wipes the scheduling tables and recreates: 2 stores, 6 employees, weekday
 * availability, and a week of shift requirements (plus one Saturday requirement
 * nobody is available for, so the solver's `gaps` output is non-empty).
 */
import prisma from '../src/lib/prisma.js';

// DateTime columns hold a wall-clock time; store it as a fixed date in UTC.
const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;

async function main() {
  await prisma.shift.deleteMany();
  await prisma.recurringAvailability.deleteMany();
  await prisma.shiftRequirement.deleteMany();
  await prisma.managerStore.deleteMany();
  await prisma.employeeStore.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.store.deleteMany();
  await prisma.org.deleteMany();

  const org = await prisma.org.create({ data: { name: 'Demo Co' } });
  const mango = await prisma.store.create({
    data: { name: 'Mango', orgId: org.id, schedule: { create: {} } },
  });
  // at Ciao, opening isn't a gated skill -> anyone who works there can open
  const ciao = await prisma.store.create({
    data: { name: 'Ciao', orgId: org.id, requiresOpenerSkill: false, schedule: { create: {} } },
  });

  // name -> [stores + tier], availability window (weekdays)
  const people: Array<{
    name: string;
    hourLimit: number;
    maxShifts?: number;
    links: Array<{
      storeId: number;
      tier: 'NEW' | 'REGULAR' | 'SENIOR' | 'MANAGER';
      canOpen?: boolean;
    }>;
    avail: [string, string];
  }> = [
    { name: 'Ana',  hourLimit: 40, links: [{ storeId: mango.id, tier: 'SENIOR',  canOpen: true }],  avail: ['10:00', '23:00'] },
    // Ben is a Regular but trusted to open -- canOpen is not derived from tier
    { name: 'Ben',  hourLimit: 40, links: [{ storeId: mango.id, tier: 'REGULAR', canOpen: true }],  avail: ['10:00', '23:00'] },
    { name: 'Cleo', hourLimit: 30, maxShifts: 3, links: [{ storeId: mango.id, tier: 'NEW' }],       avail: ['16:00', '23:00'] },
    { name: 'Dan',  hourLimit: 40, links: [{ storeId: ciao.id,  tier: 'MANAGER' }],                 avail: ['10:00', '22:00'] },
    // Eve's canOpen is false, but Ciao.requiresOpenerSkill is false so she still opens there
    { name: 'Eve',  hourLimit: 40, links: [{ storeId: ciao.id,  tier: 'REGULAR' }],                 avail: ['10:00', '22:00'] },
    {
      name: 'Finn', hourLimit: 40,
      links: [
        { storeId: mango.id, tier: 'SENIOR', canOpen: true },
        { storeId: ciao.id,  tier: 'SENIOR' }, // opener via Ciao.requiresOpenerSkill=false
      ],
      avail: ['10:00', '23:00'],
    },
  ];

  for (const p of people) {
    const emp = await prisma.employee.create({
      data: { name: p.name, hourLimit: p.hourLimit, maxShifts: p.maxShifts ?? 6 },
    });
    for (const link of p.links) {
      await prisma.employeeStore.create({
        data: {
          employeeId: emp.id,
          storeId: link.storeId,
          proficiency: link.tier,
          canOpen: link.canOpen ?? false,
        },
      });
    }
    await prisma.recurringAvailability.createMany({
      data: WEEKDAYS.map((day) => ({
        employeeId: emp.id,
        day,
        start: t(p.avail[0]),
        end: t(p.avail[1]),
      })),
    });
  }

  for (const day of WEEKDAYS) {
    await prisma.shiftRequirement.createMany({
      data: [
        // Mango opener block -- needs someone who can open
        { storeId: mango.id, day, start: t('11:00'), end: t('17:00'), regularRequired: 1, needOpen: true },
        // Mango night: a regular + a trainee
        { storeId: mango.id, day, start: t('17:00'), end: t('22:30'), regularRequired: 1, newRequired: 1 },
        // Ciao: a senior + another hand all day. needOpen is set but never binds --
        // every Ciao employee is an opener (Ciao.requiresOpenerSkill = false).
        { storeId: ciao.id, day, start: t('10:00'), end: t('22:00'), seniorRequired: 1, regularRequired: 1, needOpen: true },
      ],
    });
  }

  // nobody has Saturday availability -> shows up in the solver's gaps list
  await prisma.shiftRequirement.create({
    data: { storeId: mango.id, day: 'SATURDAY', start: t('11:00'), end: t('17:00'), regularRequired: 1, needOpen: true },
  });

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

main();
