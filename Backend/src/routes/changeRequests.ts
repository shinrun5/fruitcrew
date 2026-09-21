import { Router, type NextFunction, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireRole } from '../lib/auth.js';
import { notifyMany } from '../lib/notify.js';
import { toClock } from '../lib/time.js';

const router = Router();
const anyManager = [requireAuth, requireRole('MANAGER', 'OWNER')] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const min = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
const to12 = (d: Date) => {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h < 12 ? 'AM' : 'PM';
  return `${((h % 12) || 12)}:${String(m).padStart(2, '0')} ${ap}`;
};
const DAY_TITLE: Record<string, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};
const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

/** Midnight-UTC date of `day` within the week starting at `weekStart`. */
function shiftDate(weekStart: Date, day: string): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + DAY_ORDER.indexOf(day as (typeof DAY_ORDER)[number]));
  return d;
}

/** guard for approve/deny — the request's shift must be at a store the caller manages */
async function requireManagerOfRequest(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const r = await prisma.shiftChangeRequest.findUnique({
    where: { id },
    include: { shift: { select: { storeId: true } } },
  });
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!canManageStore(req.user, r.shift.storeId)) {
    return res.status(403).json({ error: 'You do not manage that store' });
  }
  next();
}

const INCLUDE = { shift: true, requestedBy: true, targetEmployee: true } as const;
type FullRequest = Prisma.ShiftChangeRequestGetPayload<{ include: typeof INCLUDE }>;

/** Flatten a request + its relations into the shape the frontend uses. */
function shape(r: FullRequest) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    openOffer: r.openOffer,
    note: r.note,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    shift: {
      id: r.shift.id,
      storeId: r.shift.storeId,
      day: r.shift.day,
      start: r.shift.start,
      end: r.shift.end,
      employeeId: r.shift.employeeId,
    },
    // set when only part of the shift is being handed off (ISO like shift.start/end)
    handoffStart: r.handoffStart,
    handoffEnd: r.handoffEnd,
    requestedBy: { id: r.requestedBy.id, name: r.requestedBy.name },
    targetEmployee: r.targetEmployee ? { id: r.targetEmployee.id, name: r.targetEmployee.name } : null,
  };
}

async function linkExists(employeeId: number, storeId: number) {
  return prisma.employeeStore.findUnique({ where: { employeeId_storeId: { employeeId, storeId } } });
}

// GET /change-requests/swap-targets?shiftId=  -- coworkers at that shift's store
router.get('/swap-targets', requireAuth, async (req, res) => {
  const me = req.user?.employeeId ?? -1;
  const shiftId = Number(req.query.shiftId);
  if (!Number.isInteger(shiftId)) return res.status(400).json({ error: 'shiftId is required' });

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  // must be your shift, or at a store you work
  if (shift.employeeId !== me && !(await linkExists(me, shift.storeId))) {
    return res.status(403).json({ error: 'Not your shift' });
  }

  const links = await prisma.employeeStore.findMany({
    where: { storeId: shift.storeId, employeeId: { not: me } },
    include: { employee: { select: { id: true, name: true } } },
    orderBy: { employee: { name: 'asc' } },
  });
  res.json(links.map((l) => ({ id: l.employee.id, name: l.employee.name })));
});

// GET /change-requests/mine  -- the caller's own requests
router.get('/mine', requireAuth, async (req, res) => {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const rows = await prisma.shiftChangeRequest.findMany({
    where: { requestedById: me },
    orderBy: { createdAt: 'desc' },
    include: INCLUDE,
  });
  res.json(rows.map(shape));
});

// GET /change-requests/marketplace  -- open offers to claim + the caller's own posts
router.get('/marketplace', requireAuth, async (req, res) => {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const myStoreIds = (
    await prisma.employeeStore.findMany({ where: { employeeId: me }, select: { storeId: true } })
  ).map((s) => s.storeId);

  const [open, claimed, posted] = await Promise.all([
    prisma.shiftChangeRequest.findMany({
      where: {
        type: 'SWAP',
        openOffer: true,
        status: 'PENDING',
        targetEmployeeId: null,
        requestedById: { not: me },
        shift: { storeId: { in: myStoreIds } },
      },
      orderBy: { createdAt: 'desc' },
      include: INCLUDE,
    }),
    prisma.shiftChangeRequest.findMany({
      where: { type: 'SWAP', openOffer: true, status: 'PENDING', targetEmployeeId: me },
      orderBy: { createdAt: 'desc' },
      include: INCLUDE,
    }),
    prisma.shiftChangeRequest.findMany({
      where: { type: 'SWAP', openOffer: true, status: 'PENDING', requestedById: me },
      orderBy: { createdAt: 'desc' },
      include: INCLUDE,
    }),
  ]);
  res.json({ available: open.map(shape), claimed: claimed.map(shape), posted: posted.map(shape) });
});

// POST /change-requests  { type, shiftId, targetEmployeeId?, note? }  (employee)
router.post('/', requireAuth, async (req, res) => {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ error: "Your account isn't linked to an employee" });

  const { type, shiftId, targetEmployeeId, note } = req.body ?? {};
  if (type === 'DROP') {
    return res.status(400).json({
      error: 'Shifts can’t just be dropped — swap it with a coworker, or ask a manager to move it.',
    });
  }
  if (!['SWAP', 'PICKUP'].includes(type)) {
    return res.status(400).json({ error: 'type must be SWAP or PICKUP' });
  }
  if (!Number.isInteger(shiftId)) return res.status(400).json({ error: 'shiftId is required' });

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  // optional: hand off only part of the shift (SWAP only)
  let handoffStart: Date | null = null;
  let handoffEnd: Date | null = null;
  const hs = req.body?.handoffStart;
  const he = req.body?.handoffEnd;
  if (hs !== undefined || he !== undefined) {
    if (type === 'PICKUP') return res.status(400).json({ error: "Can't part-pick-up an open shift" });
    if (typeof hs !== 'string' || typeof he !== 'string' || !HHMM.test(hs) || !HHMM.test(he)) {
      return res.status(400).json({ error: 'handoffStart/handoffEnd must be "HH:MM"' });
    }
    const a = toClock(hs);
    const b = toClock(he);
    if (min(a) >= min(b)) return res.status(400).json({ error: 'handoff start must be before end' });
    if (min(a) < min(shift.start) || min(b) > min(shift.end)) {
      return res.status(400).json({ error: 'That window is outside your shift' });
    }
    // a window covering the whole shift is just a normal (whole-shift) request
    if (!(min(a) === min(shift.start) && min(b) === min(shift.end))) {
      handoffStart = a;
      handoffEnd = b;
    }
  }

  // no swaps/pickups while the schedule for that store is only a draft
  const sched = await prisma.schedule.findUnique({
    where: { storeId: shift.storeId },
    select: { publishedAt: true, weekStart: true },
  });
  if (!sched?.publishedAt) {
    return res
      .status(409)
      .json({ error: "This week's schedule isn't live right now — changes are paused while it's being finalised." });
  }

  // no changes to a shift that's already been worked. Times are stored wall-clock
  // with no timezone, so a day-granularity check against today's UTC date is the
  // safe comparison — it never trips on today's or a future shift.
  if (sched.weekStart) {
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (shiftDate(sched.weekStart, shift.day).getTime() < todayUTC) {
      return res
        .status(409)
        .json({ error: "That shift has already passed — ask a manager if it still needs sorting out." });
    }
  }

  const openPending = await prisma.shiftChangeRequest.findFirst({ where: { shiftId, status: 'PENDING' } });
  if (openPending) return res.status(409).json({ error: 'There is already a pending request for this shift' });

  let target: number | null = null;
  let openOffer = false;

  if (type === 'SWAP') {
    if (shift.employeeId !== me) return res.status(403).json({ error: 'That is not your shift' });
    if (targetEmployeeId === undefined || targetEmployeeId === null) {
      openOffer = true; // posted to the marketplace — no target until a coworker claims it
    } else {
      if (!Number.isInteger(targetEmployeeId)) {
        return res.status(400).json({ error: 'targetEmployeeId must be a number' });
      }
      if (!(await linkExists(targetEmployeeId, shift.storeId))) {
        return res.status(400).json({ error: "That coworker doesn't work at this store" });
      }
      target = targetEmployeeId;
    }
  }
  if (type === 'PICKUP') {
    if (shift.employeeId !== null) return res.status(409).json({ error: 'That shift is already assigned' });
    if (!(await linkExists(me, shift.storeId))) {
      return res.status(400).json({ error: "You don't work at this store" });
    }
  }

  const created = await prisma.shiftChangeRequest.create({
    data: {
      type,
      shiftId,
      requestedById: me,
      targetEmployeeId: target,
      openOffer,
      handoffStart,
      handoffEnd,
      note: note ?? null,
    },
    include: INCLUDE,
  });

  // a marketplace post -> tell the whole store (in-app always, email opt-out)
  if (openOffer) {
    void emailMarketplacePost(created).catch((e) =>
      console.error('[change-requests] marketplace notify failed', e),
    );
  }

  res.status(201).json(shape(created));
});

/** In-app + email everyone at the shift's store (bar the poster) that a shift is
 * up for grabs. Email respects User.notifyOnMarketplacePost (default on). */
async function emailMarketplacePost(r: FullRequest): Promise<void> {
  const store = await prisma.store.findUnique({
    where: { id: r.shift.storeId },
    select: { name: true, orgId: true },
  });
  if (!store) return;

  const recips = await prisma.user.findMany({
    where: {
      employeeId: { not: r.requestedById },
      OR: [
        { role: 'OWNER', orgId: store.orgId },
        { managerStores: { some: { storeId: r.shift.storeId } } },
        { employee: { is: { employeeStores: { some: { storeId: r.shift.storeId } } } } },
      ],
    },
    select: { id: true, notifyOnMarketplacePost: true },
  });
  if (recips.length === 0) return;

  const start = r.handoffStart ?? r.shift.start;
  const end = r.handoffEnd ?? r.shift.end;
  const window = `${DAY_TITLE[r.shift.day]} ${to12(start)}–${to12(end)}`;
  const partial = r.handoffStart ? ' (part of a shift)' : '';
  const title = `${r.requestedBy.name ?? 'A coworker'} put a shift on the marketplace`;
  const body = `${window}${partial} at ${store.name} is up for grabs.${
    r.note ? ` "${r.note}"` : ''
  } Open Market to claim it.`;

  // in-app for everyone; email only for those who haven't opted out
  await notifyMany(
    recips.filter((u) => !u.notifyOnMarketplacePost).map((u) => u.id),
    { kind: 'GENERIC', title, body, link: '/marketplace', email: false },
  );
  await notifyMany(
    recips.filter((u) => u.notifyOnMarketplacePost).map((u) => u.id),
    { kind: 'GENERIC', title, body, link: '/marketplace', email: true },
  );
}

// POST /change-requests/:id/renotify  -- re-send the marketplace alert for a still-open post
// (manager/owner of that store). Handy when the first send failed, e.g. email wasn't set up yet.
router.post('/:id/renotify', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const r = await prisma.shiftChangeRequest.findUnique({ where: { id }, include: INCLUDE });
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!canManageStore(req.user, r.shift.storeId)) {
    return res.status(403).json({ error: 'You do not manage that store' });
  }
  if (!(r.type === 'SWAP' && r.openOffer && r.status === 'PENDING' && !r.targetEmployeeId)) {
    return res.status(409).json({ error: 'That post is not open on the marketplace' });
  }
  await emailMarketplacePost(r);
  res.json({ ok: true });
});

// POST /change-requests/:id/cancel  (the requester, while still pending)
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const me = req.user?.employeeId;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const r = await prisma.shiftChangeRequest.findUnique({ where: { id } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.requestedById !== me) return res.status(403).json({ error: 'Not your request' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: 'That request is already resolved' });

  const updated = await prisma.shiftChangeRequest.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: INCLUDE,
  });
  res.json(shape(updated));
});

// POST /change-requests/:id/claim  -- a coworker claims an open marketplace offer
router.post('/:id/claim', requireAuth, async (req, res) => {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ error: "Your account isn't linked to an employee" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const r = await prisma.shiftChangeRequest.findUnique({ where: { id }, include: { shift: true } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!(r.type === 'SWAP' && r.openOffer) || r.status !== 'PENDING') {
    return res.status(409).json({ error: "That offer isn't open" });
  }
  if (r.targetEmployeeId) return res.status(409).json({ error: 'Someone already claimed that shift' });
  if (r.requestedById === me) return res.status(400).json({ error: "That's your own shift" });
  if (!(await linkExists(me, r.shift.storeId))) {
    return res.status(400).json({ error: "You don't work at this store" });
  }

  // can't claim a shift whose day has already passed
  const sched = await prisma.schedule.findUnique({
    where: { storeId: r.shift.storeId },
    select: { weekStart: true },
  });
  if (sched?.weekStart) {
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (shiftDate(sched.weekStart, r.shift.day).getTime() < todayUTC) {
      return res.status(409).json({ error: 'That shift has already passed' });
    }
  }

  const wStart = r.handoffStart ?? r.shift.start;
  const wEnd = r.handoffEnd ?? r.shift.end;
  const sameDay = await prisma.shift.findMany({ where: { employeeId: me, day: r.shift.day } });
  if (sameDay.some((s) => s.start < wEnd && wStart < s.end)) {
    return res.status(409).json({ error: "You're already working then" });
  }

  // Compare-and-swap on targetEmployeeId: the checks above already confirmed
  // it was null, but two coworkers can pass that check in the same instant —
  // only the update whose WHERE still matches (i.e. nobody beat it) takes
  // effect, so the loser gets a clean 409 instead of silently overwriting
  // the winner's claim.
  const result = await prisma.shiftChangeRequest.updateMany({
    where: { id, status: 'PENDING', targetEmployeeId: null },
    data: { targetEmployeeId: me },
  });
  if (result.count === 0) {
    return res.status(409).json({ error: 'Someone already claimed that shift' });
  }
  const updated = await prisma.shiftChangeRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  res.json(shape(updated));
});

// POST /change-requests/:id/unclaim  -- the claimer backs out (offer goes back on the board)
router.post('/:id/unclaim', requireAuth, async (req, res) => {
  const me = req.user?.employeeId;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const r = await prisma.shiftChangeRequest.findUnique({ where: { id } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.targetEmployeeId !== me) return res.status(403).json({ error: "You haven't claimed that" });
  if (r.status !== 'PENDING') return res.status(409).json({ error: 'That request is already resolved' });

  const updated = await prisma.shiftChangeRequest.update({
    where: { id },
    data: { targetEmployeeId: null },
    include: INCLUDE,
  });
  res.json(shape(updated));
});

// GET /change-requests?status=PENDING  (manager/owner — only their stores' requests)
router.get('/', ...anyManager, async (req, res) => {
  const status = req.query.status;
  const valid = ['PENDING', 'APPROVED', 'DENIED', 'CANCELLED'];
  const where: Prisma.ShiftChangeRequestWhereInput = {
    shift: { storeId: { in: req.user!.storeIds } },
    ...(typeof status === 'string' && valid.includes(status) ? { status: status as never } : {}),
  };

  const rows = await prisma.shiftChangeRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: INCLUDE,
  });
  res.json(rows.map(shape));
});

type RequestWithShift = Prisma.ShiftChangeRequestGetPayload<{ include: { shift: true } }>;

/** Mark a request APPROVED and push the change onto the Shift rows. Splits the
 * shift when a partial hand-off window is set. Shared by /approve and /assign. */
async function applyApproval(r: RequestWithShift, managerId: number): Promise<void> {
  const newEmployeeId =
    r.type === 'DROP' ? null : r.type === 'SWAP' ? r.targetEmployeeId : r.requestedById;

  const resolveOp = prisma.shiftChangeRequest.update({
    where: { id: r.id },
    data: { status: 'APPROVED', resolvedAt: new Date(), resolvedById: managerId },
  });

  if (r.handoffStart && r.handoffEnd) {
    // Partial hand-off: the original row becomes the handed-off slice; the
    // requester keeps the leftover piece(s) as new rows.
    const { storeId, day, start: s, end: e } = r.shift;
    const keep: Prisma.ShiftCreateManyInput[] = [];
    if (min(s) < min(r.handoffStart)) {
      keep.push({ employeeId: r.requestedById, storeId, day, start: s, end: r.handoffStart });
    }
    if (min(r.handoffEnd) < min(e)) {
      keep.push({ employeeId: r.requestedById, storeId, day, start: r.handoffEnd, end: e });
    }
    await prisma.$transaction([
      prisma.shift.update({
        where: { id: r.shiftId },
        data: { start: r.handoffStart, end: r.handoffEnd, employeeId: newEmployeeId },
      }),
      ...(keep.length ? [prisma.shift.createMany({ data: keep })] : []),
      resolveOp,
    ]);
  } else {
    await prisma.$transaction([
      prisma.shift.update({ where: { id: r.shiftId }, data: { employeeId: newEmployeeId } }),
      resolveOp,
    ]);
  }
}

// GET /change-requests/:id/assignable  (manager) — everyone at that shift's store
router.get('/:id/assignable', requireAuth, requireManagerOfRequest, async (req, res) => {
  const id = Number(req.params.id);
  const r = await prisma.shiftChangeRequest.findUnique({
    where: { id },
    select: { shift: { select: { storeId: true } } },
  });
  if (!r) return res.status(404).json({ error: 'Not found' });
  const links = await prisma.employeeStore.findMany({
    where: { storeId: r.shift.storeId },
    include: { employee: { select: { id: true, name: true } } },
    orderBy: { employee: { name: 'asc' } },
  });
  res.json(links.map((l) => ({ id: l.employee.id, name: l.employee.name })));
});

// POST /change-requests/:id/assign  { employeeId }  (manager) — hand an open
// marketplace post straight to someone (incl. the manager) and apply it in one step.
router.post('/:id/assign', requireAuth, requireManagerOfRequest, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const employeeId = Number(req.body?.employeeId);
  if (!Number.isInteger(employeeId)) return res.status(400).json({ error: 'employeeId is required' });

  const r = await prisma.shiftChangeRequest.findUnique({ where: { id }, include: { shift: true } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!(r.type === 'SWAP' && r.openOffer && r.status === 'PENDING' && !r.targetEmployeeId)) {
    return res.status(409).json({ error: 'That is not an open marketplace post' });
  }
  if (r.shift.employeeId !== r.requestedById) {
    return res.status(409).json({ error: 'The poster no longer holds this shift' });
  }
  if (employeeId === r.requestedById) {
    return res.status(400).json({ error: "That's the person who posted it" });
  }
  if (!(await linkExists(employeeId, r.shift.storeId))) {
    return res.status(400).json({ error: "That person doesn't work at this store" });
  }

  await prisma.shiftChangeRequest.update({ where: { id }, data: { targetEmployeeId: employeeId } });
  const withTarget = await prisma.shiftChangeRequest.findUnique({
    where: { id },
    include: { shift: true },
  });
  await applyApproval(withTarget!, req.user!.id);

  const updated = await prisma.shiftChangeRequest.findUnique({ where: { id }, include: INCLUDE });
  res.json(shape(updated!));
});

// POST /change-requests/:id/approve  (manager) — re-validates, then mutates the Shift
router.post('/:id/approve', requireAuth, requireManagerOfRequest, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const r = await prisma.shiftChangeRequest.findUnique({ where: { id }, include: { shift: true } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: 'That request is already resolved' });

  if ((r.type === 'DROP' || r.type === 'SWAP') && r.shift.employeeId !== r.requestedById) {
    return res.status(409).json({ error: 'The requester no longer holds this shift' });
  }
  if (r.type === 'PICKUP' && r.shift.employeeId !== null) {
    return res.status(409).json({ error: 'That shift is no longer open' });
  }

  await applyApproval(r, req.user!.id);

  const updated = await prisma.shiftChangeRequest.findUnique({ where: { id }, include: INCLUDE });
  res.json(shape(updated!));
});

// POST /change-requests/:id/deny  (manager)
router.post('/:id/deny', requireAuth, requireManagerOfRequest, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const r = await prisma.shiftChangeRequest.findUnique({ where: { id } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: 'That request is already resolved' });

  // denying a claimed marketplace offer just clears the claim -- it stays on the board
  if (r.openOffer && r.targetEmployeeId) {
    const back = await prisma.shiftChangeRequest.update({
      where: { id },
      data: { targetEmployeeId: null },
      include: INCLUDE,
    });
    return res.json(shape(back));
  }

  const updated = await prisma.shiftChangeRequest.update({
    where: { id },
    data: { status: 'DENIED', resolvedAt: new Date(), resolvedById: req.user!.id },
    include: INCLUDE,
  });
  res.json(shape(updated));
});

export default router;
