import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { storeShortBy } from '../lib/gaps.js';
import { mondayUTC, WEEK_DAYS } from '../lib/scheduleGen.js';
import type { DayOfWeek } from '@prisma/client';

const router = Router();
const anyManager = [requireAuth, requireRole('MANAGER', 'OWNER')] as const;

const hours = (start: Date, end: Date) => (end.getTime() - start.getTime()) / 3_600_000;

// GET /home — a manager's landing screen in one round trip: what's waiting on
// them across every store they run, then a card per schedulable store.
router.get('/', ...anyManager, async (req, res) => {
  const storeIds = req.user!.storeIds;
  const inMyStores = { employeeStores: { some: { storeId: { in: storeIds } } } };
  const nextWeek = mondayUTC();
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [allStores, pending, timeOff, signups, staff, confirmed, overridden, openNotes] = await Promise.all([
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
    prisma.shiftNote.count({ where: { storeId: { in: storeIds }, resolvedAt: null } }),
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
      requirementCount: s.shiftRequirement.length,
      gapCount: shortBy,
      pendingRequests: actionable.filter((p) => p.shift.storeId === s.id).length,
    };
  });

  res.json({
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
  });
});

export default router;
