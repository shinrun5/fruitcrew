import { Router, type NextFunction, type Request, type Response } from 'express';
import { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor, requireRole } from '../lib/auth.js';

const router = Router();
const anyManager = [requireAuth, requireRole('MANAGER', 'OWNER')] as const;

/** guard for PUT/DELETE /:id — look up the requirement's store first */
async function requireManagerOfReq(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const row = await prisma.shiftRequirement.findUnique({ where: { id }, select: { storeId: true } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canManageStore(req.user, row.storeId)) {
    return res.status(403).json({ error: 'You do not manage that store' });
  }
  next();
}

const DAYS = new Set<string>(Object.values(DayOfWeek));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const clock = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

// The UI works in "people needed / seniors needed / allow new" terms; the model
// keeps a per-tier breakdown. Translate one to the other (manager folds into senior).
function tierFields(peopleNeeded: unknown, seniorsNeeded: unknown, allowNew: unknown) {
  const people = Math.max(0, Math.floor(Number(peopleNeeded) || 0));
  const seniors = Math.max(0, Math.min(Math.floor(Number(seniorsNeeded) || 0), people));
  const newN = allowNew && people - seniors > 0 ? 1 : 0;
  return {
    managerRequired: 0,
    seniorRequired: seniors,
    newRequired: newN,
    regularRequired: Math.max(0, people - seniors - newN),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateFriendly(b: any): string | null {
  if (!DAYS.has(b?.day)) return 'day is invalid';
  if (!HHMM.test(b?.start) || !HHMM.test(b?.end)) return 'start and end must be "HH:MM"';
  if (b.start >= b.end) return 'start must be before end';
  if (!(Number(b?.peopleNeeded) >= 1)) return 'peopleNeeded must be at least 1';
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function friendlyData(b: any) {
  return {
    day: b.day as DayOfWeek,
    start: clock(b.start),
    end: clock(b.end),
    needOpen: Boolean(b.needOpen),
    graceMinutes: Math.max(0, Math.floor(Number(b.graceMinutes) || 0)),
    ...tierFields(b.peopleNeeded, b.seniorsNeeded, b.allowNew),
  };
}

// The per-tier editor sends the four proficiency counts directly instead of the
// folded-together "people / seniors / allow new" shape above.
const nonNeg = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tierCounts(b: any) {
  return {
    managerRequired: nonNeg(b.managerRequired),
    seniorRequired: nonNeg(b.seniorRequired),
    regularRequired: nonNeg(b.regularRequired),
    newRequired: nonNeg(b.newRequired),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateTiers(b: any): string | null {
  if (!DAYS.has(b?.day)) return 'day is invalid';
  if (!HHMM.test(b?.start) || !HHMM.test(b?.end)) return 'start and end must be "HH:MM"';
  if (b.start >= b.end) return 'start must be before end';
  const t = tierCounts(b);
  if (t.managerRequired + t.seniorRequired + t.regularRequired + t.newRequired < 1) {
    return 'At least one person is needed';
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tierData(b: any) {
  return {
    day: b.day as DayOfWeek,
    start: clock(b.start),
    end: clock(b.end),
    needOpen: Boolean(b.needOpen),
    graceMinutes: Math.max(0, Math.floor(Number(b.graceMinutes) || 0)),
    ...tierCounts(b),
  };
}

// GET /shiftrequirements?storeId=  (scoped to stores the caller can manage)
router.get('/', ...anyManager, async (req, res) => {
  const storeId = Number(req.query.storeId);
  const where = Number.isInteger(storeId)
    ? { storeId: req.user!.storeIds.includes(storeId) ? storeId : -1 }
    : { storeId: { in: req.user!.storeIds } };
  const rows = await prisma.shiftRequirement.findMany({
    where,
    orderBy: [{ day: 'asc' }, { start: 'asc' }],
  });
  res.json(rows);
});

router.get('/:id', ...anyManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const row = await prisma.shiftRequirement.findUnique({ where: { id } });
  if (!row || !req.user!.storeIds.includes(row.storeId)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(row);
});

// POST /shiftrequirements (manager of that store)
// Either the friendly shape { peopleNeeded, seniorsNeeded?, allowNew? } or the
// per-tier shape { managerRequired, seniorRequired, regularRequired, newRequired }
// — both alongside { storeId, day, start:"HH:MM", end:"HH:MM", needOpen?, graceMinutes? }.
router.post('/', ...requireManagerFor((req) => Number(req.body?.storeId)), async (req, res) => {
  const b = req.body ?? {};
  if (!Number.isInteger(b.storeId)) return res.status(400).json({ error: 'storeId is required' });
  const useFriendly = b.peopleNeeded !== undefined;
  const bad = useFriendly ? validateFriendly(b) : validateTiers(b);
  if (bad) return res.status(400).json({ error: bad });

  try {
    const created = await prisma.shiftRequirement.create({
      data: { storeId: b.storeId, ...(useFriendly ? friendlyData(b) : tierData(b)) },
    });
    res.json(created);
  } catch {
    res.status(500).json({ error: 'Failed to create shift requirement' });
  }
});

// PUT /shiftrequirements/:id (manager)
// Friendly shape when `peopleNeeded` is present; the per-tier shape (day/start/end
// present) for a full replace from that editor; otherwise a legacy partial patch
// of whichever of managerRequired/seniorRequired/regularRequired/newRequired/
// needOpen/graceMinutes are present.
router.put('/:id', requireAuth, requireManagerOfReq, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const b = req.body ?? {};

  let data: Record<string, unknown>;
  if (b.peopleNeeded !== undefined) {
    const bad = validateFriendly(b);
    if (bad) return res.status(400).json({ error: bad });
    data = friendlyData(b);
  } else if (b.day !== undefined || b.start !== undefined || b.end !== undefined) {
    const bad = validateTiers(b);
    if (bad) return res.status(400).json({ error: bad });
    data = tierData(b);
  } else {
    data = {};
    for (const k of [
      'managerRequired',
      'seniorRequired',
      'regularRequired',
      'newRequired',
      'needOpen',
      'graceMinutes',
    ]) {
      if (b[k] !== undefined) data[k] = b[k];
    }
  }

  try {
    const updated = await prisma.shiftRequirement.update({ where: { id }, data });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update shift requirement' });
  }
});

router.delete('/:id', requireAuth, requireManagerOfReq, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  try {
    const row = await prisma.shiftRequirement.delete({ where: { id } });
    res.json({ message: `Shift requirement ${row.id} deleted` });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

export default router;
