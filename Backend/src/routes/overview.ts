import { Router } from 'express';
import type { DayOfWeek, Shift, ShiftRequirement } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { requireOwner } from '../lib/auth.js';

const router = Router();

const hours = (start: Date, end: Date) => (end.getTime() - start.getTime()) / 3_600_000;
const minOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

/**
 * Coverage shortfall for one store, summed across all its requirements —
 * checking each requirement in isolation let the same handful of shifts
 * double as "coverage" for every overlapping requirement they happened to
 * touch, hiding real gaps whenever requirements overlap (e.g. a 4pm-start and
 * a 5pm-start night requirement both needing their own dedicated person).
 * Overlapping requirements are separate needs that add up, so headcount is
 * swept per day here, same as the manager schedule board's own gap check
 * (Frontend/src/lib/gaps.ts) — keep the two in sync if this changes. A
 * shortfall that spans several tick-intervals (e.g. one missing person for a
 * whole evening) is one gap, not one per interval it happens to cross.
 */
function coverageShortfall(requirements: ShiftRequirement[], shifts: Shift[]): number {
  const assigned = shifts.filter((sh) => sh.employeeId !== null);
  const byDay = new Map<DayOfWeek, ShiftRequirement[]>();
  for (const r of requirements) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);

  let gapCount = 0;
  for (const [day, reqs] of byDay) {
    const bounds = reqs.map((r) => ({
      r0: minOf(r.start),
      r1: minOf(r.end),
      head: r.managerRequired + r.seniorRequired + r.regularRequired + r.newRequired,
    }));
    const dayShifts = assigned.filter((sh) => sh.day === day);

    const ticks = new Set<number>();
    for (const b of bounds) {
      ticks.add(b.r0);
      ticks.add(b.r1);
    }
    for (const sh of dayShifts) {
      ticks.add(minOf(sh.start));
      ticks.add(minOf(sh.end));
    }
    const sorted = [...ticks].sort((a, b) => a - b);

    let openGapEnd: number | null = null;
    for (let i = 0; i < sorted.length - 1; i++) {
      const t0 = sorted[i]!;
      const t1 = sorted[i + 1]!;
      const required = bounds.filter((b) => b.r0 <= t0 && b.r1 >= t1).reduce((sum, b) => sum + b.head, 0);
      const present = new Set(
        dayShifts.filter((sh) => minOf(sh.start) <= t0 && minOf(sh.end) >= t1).map((sh) => sh.employeeId),
      ).size;
      if (required > 0 && present < required) {
        if (openGapEnd !== t0) gapCount += 1; // a new shortfall stretch, not a continuation
        openGapEnd = t1;
      } else {
        openGapEnd = null;
      }
    }
  }
  return gapCount;
}

// GET /overview — one row per store in the owner's org, for the portfolio view.
router.get('/', ...requireOwner, async (req, res) => {
  const orgId = req.user!.orgId;
  if (orgId == null) return res.status(400).json({ error: 'Your account has no org' });

  const stores = await prisma.store.findMany({
    where: { orgId },
    orderBy: { name: 'asc' },
    include: {
      schedule: true,
      shifts: true,
      shiftRequirement: true,
    },
  });

  const storeIds = stores.map((s) => s.id);
  const pending = await prisma.shiftChangeRequest.findMany({
    where: { status: 'PENDING', shift: { storeId: { in: storeIds } } },
    include: { shift: { select: { storeId: true } } },
  });

  const rows = stores.map((s) => {
    const assigned = s.shifts.filter((sh) => sh.employeeId !== null);
    const openShifts = s.shifts.length - assigned.length;
    const staffHours = assigned.reduce((n, sh) => n + hours(sh.start, sh.end), 0);
    const gapCount = coverageShortfall(s.shiftRequirement, s.shifts);

    const pendingRequests = pending.filter(
      (p) =>
        p.shift.storeId === s.id &&
        !(p.openOffer && p.targetEmployeeId === null), // unclaimed offers aren't actionable
    ).length;

    return {
      storeId: s.id,
      name: s.name,
      publishedAt: s.schedule?.publishedAt ?? null,
      weekStart: s.schedule?.weekStart ?? null,
      shiftCount: s.shifts.length,
      openShifts,
      staffHours: Math.round(staffHours),
      requirementCount: s.shiftRequirement.length,
      gapCount,
      pendingRequests,
    };
  });

  res.json({ stores: rows });
});

export default router;
