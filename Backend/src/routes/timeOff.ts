import { Router, type NextFunction, type Request, type Response } from 'express';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireRole } from '../lib/auth.js';
import { inBackground, managerUserIds, notifyMany } from '../lib/notify.js';

const router = Router();
const anyManager = [requireAuth, requireRole('MANAGER', 'OWNER')] as const;

const DAY_MS = 86_400_000;
const MIN_DAYS = 7; // a notice must span at least a week
const LEAD_DAYS = 7; // and be filed at least a week before it starts

/** "YYYY-MM-DD" -> that date at UTC midnight, or null. */
function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

interface Row {
  id: number;
  employeeId: number;
  startDate: Date;
  endDate: Date;
  note: string | null;
  createdAt: Date;
  cancelledAt: Date | null;
  acknowledgedAt: Date | null;
  employee?: { name: string };
}

function shape(r: Row) {
  const today = todayUTC();
  const state = r.cancelledAt
    ? 'cancelled'
    : r.endDate < today
      ? 'past'
      : r.startDate <= today
        ? 'active'
        : 'upcoming';
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee?.name ?? null,
    startDate: r.startDate.toISOString().slice(0, 10),
    endDate: r.endDate.toISOString().slice(0, 10),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    state,
    acknowledged: r.acknowledgedAt != null,
  };
}

/** Load the request and check the caller manages a store the employee works at. */
async function requireManagerOfTimeOff(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const row = await prisma.timeOffRequest.findUnique({
    where: { id },
    include: { employee: { select: { employeeStores: { select: { storeId: true } } } } },
  });
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.employee.employeeStores.some((es) => canManageStore(req.user, es.storeId))) {
    return res.status(403).json({ error: "That worker isn't at one of your stores" });
  }
  next();
}

// GET /time-off/mine — the caller's own notices, newest first
router.get('/mine', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });
  const rows = await prisma.timeOffRequest.findMany({
    where: { employeeId },
    orderBy: { startDate: 'desc' },
  });
  res.json(rows.map(shape));
});

// POST /time-off  { startDate, endDate, note? } — post a vacation notice.
// It takes effect immediately (no approval); the manager just gets a heads-up.
router.post('/', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const start = parseDate(req.body?.startDate);
  const end = parseDate(req.body?.endDate);
  if (!start || !end) return res.status(400).json({ error: 'startDate and endDate must be "YYYY-MM-DD"' });
  if (end < start) return res.status(400).json({ error: 'End date is before the start date' });

  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days < MIN_DAYS) {
    return res.status(400).json({ error: 'Time off has to be at least a week long' });
  }
  const earliest = new Date(todayUTC().getTime() + LEAD_DAYS * DAY_MS);
  if (start < earliest) {
    return res.status(400).json({ error: 'Give at least a week’s notice before it starts' });
  }

  const clash = await prisma.timeOffRequest.findFirst({
    where: { employeeId, cancelledAt: null, startDate: { lte: end }, endDate: { gte: start } },
  });
  if (clash) return res.status(409).json({ error: 'You already have time off that overlaps those dates' });

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() || null : null;
  const row = await prisma.timeOffRequest.create({
    data: { employeeId, startDate: start, endDate: end, note },
  });
  inBackground(
    'timeOff.created',
    (async () => {
      const links = await prisma.employeeStore.findMany({ where: { employeeId }, select: { storeId: true } });
      const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      await notifyMany(await managerUserIds(links.map((l) => l.storeId)), {
        kind: 'GENERIC',
        topic: 'approvals',
        title: `${req.user!.name ?? 'A worker'} is taking time off`,
        body: `${fmt(start)} – ${fmt(end)}${note ? ` — "${note}"` : ''}. It's already blocked out of scheduling.`,
        link: '/requests',
      });
    })(),
  );
  res.status(201).json(shape(row));
});

// DELETE /time-off/:id — withdraw your own notice (only before it starts)
router.delete('/:id', requireAuth, async (req, res) => {
  const employeeId = req.user?.employeeId;
  const id = Number(req.params.id);
  if (!employeeId || !Number.isInteger(id)) return res.status(400).json({ error: 'Bad request' });
  const row = await prisma.timeOffRequest.findUnique({ where: { id } });
  if (!row || row.employeeId !== employeeId) return res.status(404).json({ error: 'Not found' });
  if (row.cancelledAt) return res.status(400).json({ error: 'Already withdrawn' });
  if (row.startDate <= todayUTC()) {
    return res.status(400).json({ error: "That time off has already started — tell your manager" });
  }
  await prisma.timeOffRequest.update({ where: { id }, data: { cancelledAt: new Date() } });
  res.json({ ok: true });
});

// GET /time-off?unacked=1  (manager) — current + upcoming notices for workers at
// their stores. `unacked=1` limits it to ones no manager has marked seen.
router.get('/', ...anyManager, async (req, res) => {
  const rows = await prisma.timeOffRequest.findMany({
    where: {
      cancelledAt: null,
      endDate: { gte: todayUTC() },
      employee: { employeeStores: { some: { storeId: { in: req.user!.storeIds } } } },
      ...(req.query.unacked === '1' ? { acknowledgedAt: null } : {}),
    },
    include: { employee: { select: { name: true } } },
    orderBy: { startDate: 'asc' },
  });
  res.json(rows.map(shape));
});

// POST /time-off/:id/ack  (manager) — mark a notice as seen
router.post('/:id/ack', requireAuth, requireManagerOfTimeOff, async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.timeOffRequest.update({
    where: { id },
    data: { acknowledgedAt: new Date(), acknowledgedById: req.user!.id },
    include: { employee: { select: { name: true } } },
  });
  res.json(shape(updated));
});

export default router;
