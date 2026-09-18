import { Router, type Request } from 'express';
import { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { requireAuth, requireManagerFor } from '../lib/auth.js';
import { mondayUTC } from '../lib/scheduleGen.js';
import { autoAssign, closingCrew, type DutyAssignment } from '../lib/closingDuties.js';

const router = Router();

// storeId comes in the query on GETs, the body on writes
const storeIdFrom = (req: Request) => Number(req.query.storeId ?? req.body?.storeId);
const manageStore = requireManagerFor(storeIdFrom);

function parseYMD(s: unknown): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function tracksClosing(storeId: number): Promise<boolean> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { tracksClosingDuties: true } });
  return store?.tracksClosingDuties ?? false;
}

function toRow(d: DutyAssignment) {
  return {
    closingEmployeeId: d.closingEmployeeId,
    bathroomEmployeeIds: d.bathroomEmployeeIds,
    sweepEmployeeId: d.sweepEmployeeId,
    mopEmployeeId: d.mopEmployeeId,
  };
}

// GET /closing-duties?storeId=&weekStart=YYYY-MM-DD
// One row per day: that day's closing crew (who's eligible to hold a duty) plus
// the current assignment — auto-computed and saved the first time a day is seen,
// left alone after that so manual edits stick.
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

  const existing = await prisma.closingDuty.findMany({ where: { storeId, weekStart } });
  const byDay = new Map(existing.map((r) => [r.day, r]));

  const days = await Promise.all(
    Object.values(DayOfWeek).map(async (day) => {
      const crew = await closingCrew(storeId, day);
      let row = byDay.get(day);
      if (!row && crew.length > 0) {
        row = await prisma.closingDuty.create({
          data: { storeId, weekStart, day, ...toRow(autoAssign(crew)) },
        });
      }
      return {
        day,
        crew,
        duty: row ? toRow(row) : null,
      };
    }),
  );

  res.json({ enabled: true, weekStart, days });
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

  const days = await Promise.all(
    Object.values(DayOfWeek).map(async (day) => {
      const crew = await closingCrew(storeId, day);
      const assignment = toRow(autoAssign(crew));
      const row = await prisma.closingDuty.upsert({
        where: { storeId_weekStart_day: { storeId, weekStart, day } },
        create: { storeId, weekStart, day, ...assignment },
        update: assignment,
      });
      return { day, crew, duty: toRow(row) };
    }),
  );

  res.json({ enabled: true, weekStart, days });
});

// PUT /closing-duties  { storeId, weekStart, day, closingEmployeeId, bathroomEmployeeIds, sweepEmployeeId, mopEmployeeId }
// A manager reassigning one day's duties (a "swap" is just changing two cells).
router.put('/', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const parsed = parseYMD(req.body?.weekStart);
  const day = req.body?.day as DayOfWeek | undefined;
  if (!parsed || !day || !Object.values(DayOfWeek).includes(day)) {
    return res.status(400).json({ error: 'weekStart ("YYYY-MM-DD") and a valid day are required' });
  }
  const weekStart = mondayUTC(parsed);

  if (!(await tracksClosing(storeId))) {
    return res.status(400).json({ error: 'This store doesn’t use closing duties' });
  }

  const crew = await closingCrew(storeId, day);
  const crewIds = new Set(crew.map((c) => c.employeeId));
  const okId = (v: unknown): number | null => (typeof v === 'number' && crewIds.has(v) ? v : null);
  const okIds = (v: unknown): number[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is number => typeof x === 'number' && crewIds.has(x)))] : [];

  const assignment: DutyAssignment = {
    closingEmployeeId: okId(req.body?.closingEmployeeId),
    bathroomEmployeeIds: okIds(req.body?.bathroomEmployeeIds),
    sweepEmployeeId: okId(req.body?.sweepEmployeeId),
    mopEmployeeId: okId(req.body?.mopEmployeeId),
  };

  const row = await prisma.closingDuty.upsert({
    where: { storeId_weekStart_day: { storeId, weekStart, day } },
    create: { storeId, weekStart, day, ...assignment },
    update: assignment,
  });

  res.json({ day, crew, duty: toRow(row) });
});

export default router;
