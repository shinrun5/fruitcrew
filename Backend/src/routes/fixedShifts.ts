import { Router } from 'express';
import { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireRole } from '../lib/auth.js';
import { toClock, toHHMM } from '../lib/time.js';

const router = Router();
const anyManager = [requireAuth, requireRole('MANAGER', 'OWNER')] as const;

const DAYS = new Set<string>(Object.values(DayOfWeek));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function shape(r: { id: number; employeeId: number; storeId: number; day: DayOfWeek; start: Date; end: Date; employee?: { name: string } }) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee?.name ?? null,
    storeId: r.storeId,
    day: r.day,
    start: toHHMM(r.start),
    end: toHHMM(r.end),
  };
}

// GET /fixed-shifts?storeId=  (manager of that store) — all standing shifts there
router.get('/', ...anyManager, async (req, res) => {
  const storeId = Number(req.query.storeId);
  if (!Number.isInteger(storeId)) return res.status(400).json({ error: 'storeId is required' });
  if (!canManageStore(req.user, storeId)) return res.status(403).json({ error: 'You do not manage that store' });
  const rows = await prisma.fixedShift.findMany({
    where: { storeId },
    include: { employee: { select: { name: true } } },
    orderBy: [{ day: 'asc' }, { start: 'asc' }],
  });
  res.json(rows.map(shape));
});

// POST /fixed-shifts  { employeeId, storeId, day, start:"HH:MM", end:"HH:MM" }  (manager)
router.post('/', ...anyManager, async (req, res) => {
  const { employeeId, storeId, day, start, end } = req.body ?? {};
  if (!Number.isInteger(employeeId) || !Number.isInteger(storeId)) {
    return res.status(400).json({ error: 'employeeId and storeId are required' });
  }
  if (!canManageStore(req.user, storeId)) return res.status(403).json({ error: 'You do not manage that store' });
  if (!DAYS.has(day)) return res.status(400).json({ error: 'day is invalid' });
  if (!HHMM.test(start) || !HHMM.test(end)) return res.status(400).json({ error: 'start and end must be "HH:MM"' });
  if (start >= end) return res.status(400).json({ error: 'start must be before end' });

  const link = await prisma.employeeStore.findUnique({
    where: { employeeId_storeId: { employeeId, storeId } },
  });
  if (!link) return res.status(400).json({ error: "That worker isn't assigned to this store" });

  try {
    const row = await prisma.fixedShift.create({
      data: { employeeId, storeId, day, start: toClock(start), end: toClock(end) },
      include: { employee: { select: { name: true } } },
    });
    res.status(201).json(shape(row));
  } catch {
    res.status(409).json({ error: 'That exact fixed shift already exists' });
  }
});

// DELETE /fixed-shifts/:id  (manager of its store)
router.delete('/:id', ...anyManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const row = await prisma.fixedShift.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canManageStore(req.user, row.storeId)) return res.status(403).json({ error: 'You do not manage that store' });
  await prisma.fixedShift.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
