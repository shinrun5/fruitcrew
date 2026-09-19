import { Router, type Request } from 'express';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth } from '../lib/auth.js';

const router = Router();

const MAX_LEN = 1000;
const CATEGORIES = new Set(['GENERAL', 'REFUND', 'COMPLAINT', 'REMAKE', 'LOST_FOUND', 'STOCK', 'MAINTENANCE']);
const RECENT_DONE_DAYS = 7;
const NAME_MAX = 100;
const PHONE_MAX = 30;
const ORDER_MAX = 500;

const canSee = (req: Request, storeId: number) =>
  Number.isInteger(storeId) && !!req.user?.storeIds.includes(storeId);

interface WireNote {
  id: number;
  storeId: number;
  category: string;
  body: string;
  issueAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  orderDetails: string | null;
  createdAt: string;
  authorName: string;
  authorKey: number; // employeeId, else userId — feeds the deterministic fruit
  authorFruit: string | null;
  mine: boolean;
  resolvedAt: string | null;
  resolvedName: string | null;
}

/** employeeId + chosen fruit, keyed by userId. */
async function avatarLookup(userIds: number[]): Promise<Map<number, { key: number; fruit: string | null }>> {
  const ids = [...new Set(userIds.filter((n) => n > 0))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, employeeId: true, employee: { select: { avatarFruit: true } } },
  });
  return new Map(
    users.map((u) => [u.id, { key: u.employeeId ?? u.id, fruit: u.employee?.avatarFruit ?? null }]),
  );
}

function toWire(
  n: {
    id: number;
    storeId: number;
    category: string;
    body: string;
    issueAt: Date | null;
    customerName: string | null;
    customerPhone: string | null;
    orderDetails: string | null;
    createdAt: Date;
    authorName: string;
    userId: number | null;
    resolvedAt: Date | null;
    resolvedName: string | null;
  },
  meUserId: number,
  keyFruit: Map<number, { key: number; fruit: string | null }>,
): WireNote {
  const kf = n.userId != null ? keyFruit.get(n.userId) : undefined;
  return {
    id: n.id,
    storeId: n.storeId,
    category: n.category,
    body: n.body,
    issueAt: n.issueAt?.toISOString() ?? null,
    customerName: n.customerName,
    customerPhone: n.customerPhone,
    orderDetails: n.orderDetails,
    createdAt: n.createdAt.toISOString(),
    authorName: n.authorName,
    authorKey: kf?.key ?? n.userId ?? 0,
    authorFruit: kf?.fruit ?? null,
    mine: n.userId === meUserId,
    resolvedAt: n.resolvedAt?.toISOString() ?? null,
    resolvedName: n.resolvedName,
  };
}

// GET /notes?storeId= — open notes (newest first) + a few recently-done ones
router.get('/', requireAuth, async (req, res) => {
  const storeId = Number(req.query.storeId);
  if (!canSee(req, storeId)) return res.status(403).json({ error: 'Not your store' });

  const doneCutoff = new Date(Date.now() - RECENT_DONE_DAYS * 86_400_000);
  const [open, recentlyDone] = await Promise.all([
    prisma.shiftNote.findMany({ where: { storeId, resolvedAt: null }, orderBy: { id: 'desc' } }),
    prisma.shiftNote.findMany({
      where: { storeId, resolvedAt: { not: null, gte: doneCutoff } },
      orderBy: { resolvedAt: 'desc' },
      take: 8,
    }),
  ]);

  const keyFruit = await avatarLookup([...open, ...recentlyDone].map((n) => n.userId ?? 0));
  res.json({
    open: open.map((n) => toWire(n, req.user!.id, keyFruit)),
    recentlyDone: recentlyDone.map((n) => toWire(n, req.user!.id, keyFruit)),
  });
});

// GET /notes/counts — open-note count per store the caller belongs to
router.get('/counts', requireAuth, async (req, res) => {
  const storeIds = req.user!.storeIds;
  if (storeIds.length === 0) return res.json({ total: 0, byStore: {} });
  const grouped = await prisma.shiftNote.groupBy({
    by: ['storeId'],
    where: { storeId: { in: storeIds }, resolvedAt: null },
    _count: { _all: true },
  });
  const byStore: Record<number, number> = {};
  let total = 0;
  for (const g of grouped) {
    byStore[g.storeId] = g._count._all;
    total += g._count._all;
  }
  res.json({ total, byStore });
});

// POST /notes  { storeId, body, category?, issueAt?, customerName?, customerPhone?, orderDetails? }
// The customer/order fields are optional and only ever surfaced in the UI for
// REFUND / COMPLAINT / REMAKE, but accepted regardless of category — they're
// harmless extra context either way.
router.post('/', requireAuth, async (req, res) => {
  const storeId = Number(req.body?.storeId);
  if (!canSee(req, storeId)) return res.status(403).json({ error: 'Not your store' });

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Note is empty' });
  if (body.length > MAX_LEN) return res.status(400).json({ error: `Note is too long (max ${MAX_LEN})` });
  const category =
    typeof req.body?.category === 'string' && CATEGORIES.has(req.body.category) ? req.body.category : 'GENERAL';

  const customerName = typeof req.body?.customerName === 'string' ? req.body.customerName.trim() : '';
  const customerPhone = typeof req.body?.customerPhone === 'string' ? req.body.customerPhone.trim() : '';
  const orderDetails = typeof req.body?.orderDetails === 'string' ? req.body.orderDetails.trim() : '';
  if (customerName.length > NAME_MAX) return res.status(400).json({ error: `Customer name is too long (max ${NAME_MAX})` });
  if (customerPhone.length > PHONE_MAX) return res.status(400).json({ error: `Phone number is too long (max ${PHONE_MAX})` });
  if (orderDetails.length > ORDER_MAX) return res.status(400).json({ error: `Order is too long (max ${ORDER_MAX})` });

  let issueAt: Date | undefined;
  if (typeof req.body?.issueAt === 'string' && req.body.issueAt) {
    const parsed = new Date(req.body.issueAt);
    if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'issueAt is not a valid date' });
    issueAt = parsed;
  }

  const me = req.user!;
  const note = await prisma.shiftNote.create({
    data: {
      storeId,
      userId: me.id,
      authorName: me.name ?? me.email,
      body,
      category,
      ...(issueAt ? { issueAt } : {}),
      ...(customerName ? { customerName } : {}),
      ...(customerPhone ? { customerPhone } : {}),
      ...(orderDetails ? { orderDetails } : {}),
    },
  });
  const keyFruit = await avatarLookup([me.id]);
  res.status(201).json({ note: toWire(note, me.id, keyFruit) });
});

// POST /notes/:id/resolve  { resolved: boolean }
router.post('/:id/resolve', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const existing = await prisma.shiftNote.findUnique({ where: { id }, select: { storeId: true } });
  if (!existing || !canSee(req, existing.storeId)) return res.status(404).json({ error: 'Not found' });

  const me = req.user!;
  const resolved = req.body?.resolved !== false;
  const note = await prisma.shiftNote.update({
    where: { id },
    data: resolved
      ? { resolvedAt: new Date(), resolvedById: me.id, resolvedName: me.name ?? me.email }
      : { resolvedAt: null, resolvedById: null, resolvedName: null },
  });
  const keyFruit = await avatarLookup([note.userId ?? 0]);
  res.json({ note: toWire(note, me.id, keyFruit) });
});

// DELETE /notes/:id — the author, or a manager of that store
router.delete('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const note = await prisma.shiftNote.findUnique({ where: { id }, select: { userId: true, storeId: true } });
  if (!note || !canSee(req, note.storeId)) return res.status(404).json({ error: 'Not found' });
  if (note.userId !== req.user!.id && !canManageStore(req.user, note.storeId)) {
    return res.status(403).json({ error: 'Only the author or a manager can delete this' });
  }
  await prisma.shiftNote.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
