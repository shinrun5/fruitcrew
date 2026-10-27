import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireManager } from '../lib/auth.js';
import { storeShortBy } from '../lib/gaps.js';
import { canSeePay, payRates, weekPayCents } from '../lib/pay.js';
import { mondayUTC } from '../lib/scheduleGen.js';
import { sectionLabel } from '../lib/responsibilities.js';
import { minuteOfDay, minutesToHHMM, storeClockNow, todayUTC, WEEK_DAYS } from '../lib/time.js';
import type { DayOfWeek } from '@prisma/client';

const router = Router();

const hours = (start: Date, end: Date) => (end.getTime() - start.getTime()) / 3_600_000;

// GET /home — a manager's landing screen in one round trip: what's waiting on
// them across every store they run, then a card per schedulable store.
router.get('/', ...requireManager, async (req, res) => {
  const storeIds = req.user!.storeIds;
  const inMyStores = { employeeStores: { some: { storeId: { in: storeIds } } } };
  const nextWeek = mondayUTC();
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const today = todayUTC();

  const [allStores, pending, timeOff, signups, staff, confirmed, overridden, openNotes, teamSize, onApp, everShift, everSnapshot] = await Promise.all([
    prisma.store.findMany({
      where: { id: { in: storeIds } },
      orderBy: { name: 'asc' },
      include: {
        schedule: true,
        shiftRequirement: true,
        parent: { select: { name: true } },
        employeeStores: { select: { employeeId: true, proficiency: true } },
        employeeResponsibilities: {
          where: { responsibility: { name: 'Opener', archivedAt: null } },
          select: { employeeId: true },
        },
        _count: { select: { sections: true } },
      },
    }),
    prisma.shiftChangeRequest.findMany({
      where: { status: 'PENDING', shift: { storeId: { in: storeIds } } },
      select: { openOffer: true, targetEmployeeId: true, shift: { select: { storeId: true } } },
    }),
    prisma.timeOffRequest.count({
      where: { cancelledAt: null, acknowledgedAt: null, endDate: { gte: today }, employee: inMyStores },
    }),
    prisma.user.count({ where: { role: 'EMPLOYEE', approved: false, employee: { is: inMyStores } } }),
    // only people who can actually answer the weekly check (an approved login)
    prisma.employee.findMany({
      where: { standby: false, ...inMyStores, user: { is: { approved: true } } },
      select: { id: true },
    }),
    prisma.availabilityConfirmation.findMany({
      where: { weekStart: nextWeek, employee: inMyStores },
      select: { employeeId: true },
    }),
    prisma.weekAvailability.findMany({
      where: { weekStart: nextWeek, employee: inMyStores },
      select: { employeeId: true },
    }),
    req.user!.addons.includes('notes')
      ? prisma.shiftNote.count({ where: { storeId: { in: storeIds }, resolvedAt: null } })
      : Promise.resolve(0),
    // --- getting-started checklist ---
    prisma.employee.count({ where: inMyStores }),
    prisma.user.count({ where: { role: 'EMPLOYEE', employee: { is: inMyStores } } }),
    prisma.shift.count({ where: { storeId: { in: storeIds } }, take: 1 }),
    prisma.scheduleSnapshot.count({ where: { storeId: { in: storeIds } }, take: 1 }),
  ]);

  // a store that's been split into sections isn't scheduled itself — its
  // sections are, so those get the cards
  const schedulable = allStores.filter((s) => s._count.sections === 0);
  const weekShifts = await prisma.shift.findMany({
    where: {
      OR: schedulable
        .filter((s) => s.schedule?.weekStart)
        .map((s) => ({ storeId: s.id, weekStart: s.schedule!.weekStart! })),
    },
  });

  // unclaimed marketplace posts aren't waiting on a manager yet
  const actionable = pending.filter((p) => !(p.openOffer && p.targetEmployeeId === null));
  const staffIds = new Set(staff.map((e) => e.id));
  const answered = new Set(
    [...confirmed, ...overridden].map((c) => c.employeeId).filter((id) => staffIds.has(id)),
  );

  // labor cost on each store's week, for whoever may see pay — each person's
  // hours there (overtime past 40) at their rate; people with no rate set are
  // counted, not guessed at
  const seePay = await canSeePay(req.user);
  const rates = seePay
    ? await payRates([...new Set(weekShifts.filter((sh) => sh.employeeId !== null).map((sh) => sh.employeeId!))])
    : new Map<number, number>();
  const labor = (shifts: typeof weekShifts) => {
    const mins = new Map<number, number>();
    for (const sh of shifts) if (sh.employeeId !== null) mins.set(sh.employeeId, (mins.get(sh.employeeId) ?? 0) + hours(sh.start, sh.end) * 60);
    let cents = 0;
    let unrated = 0;
    for (const [id, m] of mins) {
      const rate = rates.get(id);
      if (rate === undefined) unrated++;
      else cents += weekPayCents(Math.round(m), rate);
    }
    return { laborCents: cents, unratedCount: unrated };
  };

  const stores = schedulable.map((s) => {
    const shifts = s.schedule?.weekStart
      ? weekShifts.filter((sh) => sh.storeId === s.id && sh.weekStart.getTime() === s.schedule!.weekStart!.getTime())
      : [];
    const assigned = shifts.filter((sh) => sh.employeeId !== null);
    const openers = new Set(s.employeeResponsibilities.map((r) => r.employeeId));
    // days of this week that are already over can't be staffed any more
    const passed = new Set<DayOfWeek>();
    if (s.schedule?.weekStart) {
      const daysIn = Math.floor((today.getTime() - s.schedule.weekStart.getTime()) / 86_400_000);
      WEEK_DAYS.forEach((d, i) => i < daysIn && passed.add(d));
    }
    const shortBy = storeShortBy(
      s.shiftRequirement,
      shifts,
      s.employeeStores.map((l) => ({ ...l, canOpen: openers.has(l.employeeId) })),
      s.requiresOpenerSkill,
      passed,
    );
    const posted =
      !!s.schedule?.publishedAt &&
      s.schedule.postedWeekStart?.getTime() === s.schedule.weekStart?.getTime();
    return {
      storeId: s.id,
      name: s.parent ? `${s.parent.name} · ${s.name}` : s.name,
      publishedAt: s.schedule?.publishedAt ?? null,
      weekStart: s.schedule?.weekStart ?? null,
      // the week being edited has shifts but isn't what workers see yet
      draftReady: !posted && assigned.length > 0,
      shiftCount: shifts.length,
      openShifts: shifts.length - assigned.length,
      staffHours: Math.round(assigned.reduce((n, sh) => n + hours(sh.start, sh.end), 0)),
      staffMinutes: Math.round(assigned.reduce((n, sh) => n + hours(sh.start, sh.end), 0) * 60),
      requirementCount: s.shiftRequirement.length,
      gapCount: shortBy,
      pendingRequests: actionable.filter((p) => p.shift.storeId === s.id).length,
      ...(seePay ? labor(assigned) : {}),
    };
  });

  // who's on the floor today, back-to-back rows as one stretch — the client
  // splits them into "on now" and "later today" against the stores' clock
  const thisMonday = mondayUTC();
  const day = WEEK_DAYS[Math.round((today.getTime() - thisMonday.getTime()) / 86_400_000)]!;
  const todayRows = await prisma.shift.findMany({
    where: { storeId: { in: storeIds }, weekStart: thisMonday, day, employeeId: { not: null } },
    orderBy: [{ employeeId: 'asc' }, { start: 'asc' }],
    select: {
      storeId: true,
      start: true,
      end: true,
      employee: { select: { id: true, name: true, avatarFruit: true } },
      section: { select: { name: true, scope: true, archivedAt: true } },
    },
  });
  const storeNameOf = new Map(allStores.map((st) => [st.id, st.parent ? `${st.parent.name} · ${st.name}` : st.name]));
  const onToday: { storeId: number; storeName: string; employeeId: number; name: string; avatarFruit: string | null; start: number; end: number; section: string | null }[] = [];
  for (const r of todayRows) {
    const last = onToday[onToday.length - 1];
    const s0 = minuteOfDay(r.start);
    const section = sectionLabel(r.section);
    if (last && last.employeeId === r.employee!.id && last.storeId === r.storeId && s0 <= last.end && last.section === section) {
      last.end = Math.max(last.end, minuteOfDay(r.end));
    } else {
      onToday.push({ storeId: r.storeId, storeName: storeNameOf.get(r.storeId) ?? '', employeeId: r.employee!.id, name: r.employee!.name, avatarFruit: r.employee!.avatarFruit, start: s0, end: minuteOfDay(r.end), section });
    }
  }
  onToday.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));

  res.json({
    today: {
      date: today.toISOString().slice(0, 10),
      nowMinute: Math.floor((storeClockNow() % 86_400_000) / 60_000),
      shifts: onToday.map((x) => ({ ...x, start: minutesToHHMM(x.start), end: minutesToHHMM(x.end) })),
    },
    attention: {
      approvals: actionable.length,
      timeOff,
      signups,
      availability: { weekStart: nextWeek.toISOString().slice(0, 10), answered: answered.size, total: staffIds.size },
      gaps: stores.reduce((n, s) => n + s.gapCount, 0),
      draftsReady: stores.filter((s) => s.draftReady).map((s) => ({ storeId: s.storeId, name: s.name })),
      openNotes,
      needsSetup: stores.filter((s) => s.requirementCount === 0).map((s) => ({ storeId: s.storeId, name: s.name })),
    },
    stores,
    // what a brand-new business still has to do before its first posted
    // schedule — the Home checklist ticks each off as it becomes true
    setup: {
      hasStore: allStores.length > 0,
      hasShiftNeeds: schedulable.length > 0 && schedulable.every((s) => s.shiftRequirement.length > 0),
      hasTeam: teamSize > 0,
      teamOnApp: onApp > 0,
      generated: everShift + everSnapshot > 0,
      posted: allStores.some((s) => s.schedule?.postedWeekStart != null),
    },
  });
});

export default router;
