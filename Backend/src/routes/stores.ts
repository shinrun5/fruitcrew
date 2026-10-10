import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth } from '../lib/auth.js';
import { auditLog } from '../lib/auditLog.js';
import { inBackground, notifyAdmins } from '../lib/notify.js';
import { ensureOpenerResponsibility } from '../lib/responsibilities.js';
import { HHMM, isDayOfWeek, parseYMD } from '../lib/time.js';

const router = Router();

/** After requireAuth: the caller must manage store :id. Leaves it on req for reuse. */
function requireManagerOfParamStore(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  if (!canManageStore(req.user, id)) return res.status(403).json({ error: 'You do not manage that store' });
  next();
}

/** undefined = leave alone, null = clear, string = validated "HH:MM" (or an error). */
function hhmmPatch(v: unknown): undefined | null | string {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return typeof v === 'string' && HHMM.test(v) ? v : 'ERR';
}

// POST /stores  { name, requiresOpenerSkill?, parentStoreId? } — created with
// an empty Schedule row and the caller as a manager. A brand-new top-level
// store (no parentStoreId) is owner-only, same as always. parentStoreId
// instead makes this a *section* of a store the caller already manages (e.g.
// "Front of House") — owner or an assigned manager can add one; it's
// otherwise a completely ordinary store, just nested for the store
// switcher/list, and gets its own independent schedule/requirements/
// responsibilities/hours for free since all of that already hangs off storeId.
router.post('/', requireAuth, async (req, res) => {
  const { name, requiresOpenerSkill, pairNewWorkers, tracksClosingDuties } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const parentStoreIdRaw = req.body?.parentStoreId;
  let parentStoreId: number | undefined;
  let orgId: number;

  if (parentStoreIdRaw !== undefined && parentStoreIdRaw !== null) {
    parentStoreId = Number(parentStoreIdRaw);
    if (!Number.isInteger(parentStoreId)) {
      return res.status(400).json({ error: 'parentStoreId must be a valid id' });
    }
    if (!canManageStore(req.user, parentStoreId)) {
      return res.status(403).json({ error: 'You do not manage that store' });
    }
    const parent = await prisma.store.findUnique({
      where: { id: parentStoreId },
      select: { orgId: true, parentStoreId: true },
    });
    if (!parent) return res.status(404).json({ error: 'Parent store not found' });
    if (parent.parentStoreId != null) {
      return res.status(400).json({ error: 'A section cannot itself have sections' });
    }
    orgId = parent.orgId;
  } else {
    if (req.user!.role !== 'OWNER') {
      return res.status(403).json({ error: 'Only an owner can add a new store' });
    }
    if (req.user!.orgId == null) return res.status(400).json({ error: 'Your account has no org' });
    orgId = req.user!.orgId;
    // the plan's store cap — sections are part of a store, so they don't count
    const [org, count] = await Promise.all([
      prisma.org.findUnique({ where: { id: orgId }, select: { storeLimit: true } }),
      prisma.store.count({ where: { orgId, parentStoreId: null } }),
    ]);
    if (org?.storeLimit != null && count >= org.storeLimit) {
      return res.status(403).json({
        error: `Your plan includes ${org.storeLimit} store${org.storeLimit === 1 ? '' : 's'}. Add another store to your plan first.`,
        code: 'STORE_LIMIT',
      });
    }
  }

  try {
    const store = await prisma.store.create({
      data: {
        name,
        orgId,
        ...(parentStoreId !== undefined ? { parentStoreId } : {}),
        ...(requiresOpenerSkill !== undefined ? { requiresOpenerSkill } : {}),
        ...(pairNewWorkers !== undefined ? { pairNewWorkers } : {}),
        ...(tracksClosingDuties !== undefined ? { tracksClosingDuties } : {}),
        schedule: { create: {} },
        managers: { create: { userId: req.user!.id } },
      },
    });
    await ensureOpenerResponsibility(store.id);
    if (parentStoreId === undefined) {
      inBackground(
        'storeAdded',
        Promise.all([
          prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
          prisma.store.count({ where: { orgId, parentStoreId: null } }),
        ]).then(([org, count]) =>
          notifyAdmins({
            title: `${org?.name ?? 'A business'} added a store: ${store.name}`,
            body: count === 1 ? 'Their first store — they’re setting up.' : `They now have ${count} stores.`,
          }),
        ),
      );
    }
    // whoever already manages the parent keeps access to its new section by
    // default — otherwise adding a section would silently cut a non-owner
    // manager off from scheduling it until someone remembers to re-add them
    if (parentStoreId !== undefined) {
      const parentManagers = await prisma.managerStore.findMany({
        where: { storeId: parentStoreId, userId: { not: req.user!.id } },
        select: { userId: true },
      });
      if (parentManagers.length) {
        await prisma.managerStore.createMany({
          data: parentManagers.map((m) => ({ userId: m.userId, storeId: store.id })),
          skipDuplicates: true,
        });
      }
    }
    res.json(store);
  } catch {
    res.status(500).json({ error: 'Failed to create store' });
  }
});

// GET /stores — the stores the caller can see
router.get('/', requireAuth, async (req, res) => {
  const stores = await prisma.store.findMany({
    where: { id: { in: req.user!.storeIds } },
    orderBy: { name: 'asc' },
  });
  res.json(stores);
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  if (!req.user!.storeIds.includes(id)) return res.status(404).json({ error: 'Not found' });
  const store = await prisma.store.findUnique({ where: { id } });
  res.json(store);
});

/** undefined = leave alone; a valid "HH:MM" string = use it; anything else =
 * an error. Unlike hhmmPatch, no null/clear case — availabilityReminderTime
 * and autoGenerateTime are NOT NULL columns (every store needs some value
 * for the cron tick to compare against). */
function hhmmRequired(v: unknown): undefined | string | 'ERR' {
  if (v === undefined) return undefined;
  return typeof v === 'string' && HHMM.test(v) ? v : 'ERR';
}

// PUT /stores/:id  (owner or a manager of it)
// { name, requiresOpenerSkill?, pairNewWorkers?, openTime?, closeTime?, nightStart?,
//   availabilityReminderDay?, availabilityReminderTime?, autoGenerateDay?, autoGenerateTime? }
router.put('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { name, requiresOpenerSkill, pairNewWorkers, tracksClosingDuties } = req.body ?? {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  if (!canManageStore(req.user, id)) return res.status(403).json({ error: 'You do not manage that store' });
  if (!name) return res.status(400).json({ error: 'name is required' });

  const openTime = hhmmPatch(req.body?.openTime);
  const closeTime = hhmmPatch(req.body?.closeTime);
  const nightStart = hhmmPatch(req.body?.nightStart);
  if ([openTime, closeTime, nightStart].includes('ERR')) {
    return res.status(400).json({ error: 'Times must be "HH:MM" (24-hour)' });
  }

  const availabilityReminderTime = hhmmRequired(req.body?.availabilityReminderTime);
  const autoGenerateTime = hhmmRequired(req.body?.autoGenerateTime);
  if ([availabilityReminderTime, autoGenerateTime].includes('ERR')) {
    return res.status(400).json({ error: 'Reminder/auto-generate times must be "HH:MM" (24-hour)' });
  }
  const { availabilityReminderDay, autoGenerateDay } = req.body ?? {};
  if (availabilityReminderDay !== undefined && !isDayOfWeek(availabilityReminderDay)) {
    return res.status(400).json({ error: `Invalid day: ${availabilityReminderDay}` });
  }
  if (autoGenerateDay !== undefined && !isDayOfWeek(autoGenerateDay)) {
    return res.status(400).json({ error: `Invalid day: ${autoGenerateDay}` });
  }

  try {
    const store = await prisma.store.update({
      where: { id },
      data: {
        name,
        ...(requiresOpenerSkill !== undefined ? { requiresOpenerSkill } : {}),
        ...(pairNewWorkers !== undefined ? { pairNewWorkers } : {}),
        ...(tracksClosingDuties !== undefined ? { tracksClosingDuties } : {}),
        ...(openTime !== undefined ? { openTime: openTime as string | null } : {}),
        ...(closeTime !== undefined ? { closeTime: closeTime as string | null } : {}),
        ...(nightStart !== undefined ? { nightStart: nightStart as string | null } : {}),
        ...(availabilityReminderDay !== undefined ? { availabilityReminderDay } : {}),
        ...(availabilityReminderTime !== undefined ? { availabilityReminderTime } : {}),
        ...(autoGenerateDay !== undefined ? { autoGenerateDay } : {}),
        ...(autoGenerateTime !== undefined ? { autoGenerateTime } : {}),
      },
    });
    res.json(store);
  } catch {
    res.status(500).json({ error: 'Failed to update store' });
  }
});

// POST /stores/:id/no-back-to-back  { day, on } (owner or a manager of it) —
// turns one weekday's "nobody works more than one shift here" rule on or off
router.post('/:id/no-back-to-back', requireAuth, requireManagerOfParamStore, async (req, res) => {
  const id = Number(req.params.id);
  const { day, on } = req.body ?? {};
  if (!isDayOfWeek(day)) return res.status(400).json({ error: `Invalid day: ${day}` });
  if (typeof on !== 'boolean') return res.status(400).json({ error: 'on must be true or false' });

  const store = await prisma.store.findUnique({ where: { id }, select: { noBackToBackDays: true } });
  if (!store) return res.status(404).json({ error: 'Not found' });
  const days = new Set(store.noBackToBackDays);
  if (on) days.add(day as DayOfWeek);
  else days.delete(day as DayOfWeek);
  const updated = await prisma.store.update({
    where: { id },
    data: { noBackToBackDays: [...days] },
    select: { noBackToBackDays: true },
  });
  res.json(updated);
});

// --- per-weekday + per-date store hours -------------------------------------

// GET /stores/:id/hours — default hours + weekday exceptions + holidays
router.get('/:id/hours', requireAuth, requireManagerOfParamStore, async (req, res) => {
  const storeId = Number(req.params.id);
  const [store, weekday, holidays] = await Promise.all([
    prisma.store.findUnique({
      where: { id: storeId },
      select: { openTime: true, closeTime: true, nightStart: true },
    }),
    prisma.storeHours.findMany({ where: { storeId }, orderBy: { day: 'asc' } }),
    prisma.storeHoliday.findMany({ where: { storeId }, orderBy: { date: 'asc' } }),
  ]);
  res.json({
    default: { openTime: store?.openTime ?? null, closeTime: store?.closeTime ?? null, nightStart: store?.nightStart ?? null },
    weekday: weekday.map((w) => ({
      day: w.day,
      closed: w.closed,
      openTime: w.openTime,
      closeTime: w.closeTime,
      nightStart: w.nightStart,
    })),
    holidays: holidays.map((h) => ({
      id: h.id,
      date: h.date.toISOString().slice(0, 10),
      label: h.label,
      closed: h.closed,
      openTime: h.openTime,
      closeTime: h.closeTime,
      nightStart: h.nightStart,
    })),
  });
});

const hhmmOrNull = (v: unknown): string | null | 'ERR' => {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'string' && HHMM.test(v) ? v : 'ERR';
};

// PUT /stores/:id/hours  { weekday: [{ day, closed, openTime, closeTime, nightStart }] }
// Replaces the whole weekday-exception set (send only the days that differ).
router.put('/:id/hours', requireAuth, requireManagerOfParamStore, async (req, res) => {
  const storeId = Number(req.params.id);
  const raw = req.body?.weekday;
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'weekday must be an array' });

  const rows: { storeId: number; day: DayOfWeek; closed: boolean; openTime: string | null; closeTime: string | null; nightStart: string | null }[] = [];
  const seen = new Set<string>();
  for (const w of raw) {
    if (!isDayOfWeek(w?.day)) return res.status(400).json({ error: `Invalid day: ${w?.day}` });
    if (seen.has(w.day)) return res.status(400).json({ error: `Duplicate day: ${w.day}` });
    seen.add(w.day);
    const o = hhmmOrNull(w.openTime);
    const c = hhmmOrNull(w.closeTime);
    const n = hhmmOrNull(w.nightStart);
    if ([o, c, n].includes('ERR')) return res.status(400).json({ error: 'Times must be "HH:MM" (24-hour)' });
    rows.push({ storeId, day: w.day, closed: !!w.closed, openTime: o as string | null, closeTime: c as string | null, nightStart: n as string | null });
  }

  await prisma.$transaction([
    prisma.storeHours.deleteMany({ where: { storeId } }),
    prisma.storeHours.createMany({ data: rows }),
  ]);
  res.json({ ok: true });
});

// POST /stores/:id/holidays  { date, label?, closed?, openTime?, closeTime?, nightStart? }
router.post('/:id/holidays', requireAuth, requireManagerOfParamStore, async (req, res) => {
  const storeId = Number(req.params.id);
  const date = parseYMD(req.body?.date);
  if (!date) return res.status(400).json({ error: 'date must be "YYYY-MM-DD"' });
  const o = hhmmOrNull(req.body?.openTime);
  const c = hhmmOrNull(req.body?.closeTime);
  const n = hhmmOrNull(req.body?.nightStart);
  if ([o, c, n].includes('ERR')) return res.status(400).json({ error: 'Times must be "HH:MM" (24-hour)' });
  const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim() : null;
  const closed = req.body?.closed === undefined ? true : !!req.body.closed;

  const h = await prisma.storeHoliday.upsert({
    where: { storeId_date: { storeId, date } },
    create: { storeId, date, label, closed, openTime: o as string | null, closeTime: c as string | null, nightStart: n as string | null },
    update: { label, closed, openTime: o as string | null, closeTime: c as string | null, nightStart: n as string | null },
  });
  res.status(201).json({ id: h.id, date: h.date.toISOString().slice(0, 10), label: h.label, closed: h.closed });
});

// DELETE /stores/:id/holidays/:hid
router.delete('/:id/holidays/:hid', requireAuth, requireManagerOfParamStore, async (req, res) => {
  const storeId = Number(req.params.id);
  const hid = Number(req.params.hid);
  if (!Number.isInteger(hid)) return res.status(400).json({ error: 'A valid numeric id is required' });
  await prisma.storeHoliday.deleteMany({ where: { id: hid, storeId } });
  res.json({ ok: true });
});

// --- store sign-up link (reusable, unlike ManagerInvite / Employee.inviteCode) --

// A standing link still needs periodic refresh so a copy leaked once (a flyer,
// an old group-chat message) doesn't stay valid forever — regenerating (below)
// resets this the same way it already invalidates the old code.
const STORE_INVITE_TTL_MS = 90 * 24 * 60 * 60_000; // 90 days

// GET /stores/:id/invite — the store's current sign-up link, if any
router.get('/:id/invite', requireAuth, requireManagerOfParamStore, async (req, res) => {
  const storeId = Number(req.params.id);
  const invite = await prisma.storeInvite.findUnique({ where: { storeId } });
  res.json(
    invite && !(invite.expiresAt && invite.expiresAt < new Date())
      ? { code: invite.code, createdAt: invite.createdAt, expiresAt: invite.expiresAt }
      : null,
  );
});

// POST /stores/:id/invite — (re)generate the link; replaces any existing code,
// which invalidates copies already shared
router.post('/:id/invite', requireAuth, requireManagerOfParamStore, async (req, res) => {
  const storeId = Number(req.params.id);
  const code = randomBytes(9).toString('base64url');
  const expiresAt = new Date(Date.now() + STORE_INVITE_TTL_MS);
  const invite = await prisma.storeInvite.upsert({
    where: { storeId },
    create: { storeId, code, createdById: req.user!.id, expiresAt },
    update: { code, createdById: req.user!.id, expiresAt },
  });
  res.status(201).json({ code: invite.code, createdAt: invite.createdAt, expiresAt: invite.expiresAt });
});

// DELETE /stores/:id/invite — turn the link off
router.delete('/:id/invite', requireAuth, requireManagerOfParamStore, async (req, res) => {
  const storeId = Number(req.params.id);
  await prisma.storeInvite.deleteMany({ where: { storeId } });
  res.json({ ok: true });
});

// DELETE /stores/:id — refuses while anything still points at it. A section
// can be removed by whoever manages it (owner or an assigned manager), same
// as adding one; deleting a top-level store stays owner-only — a bigger,
// more structural action than removing one of its sections.
router.delete('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  if (!req.user!.storeIds.includes(id)) return res.status(404).json({ error: 'Not found' });

  const target = await prisma.store.findUnique({ where: { id }, select: { parentStoreId: true } });
  if (!target) return res.status(404).json({ error: 'Not found' });
  const isSection = target.parentStoreId != null;
  if (isSection ? !canManageStore(req.user, id) : req.user!.role !== 'OWNER') {
    return res.status(403).json({ error: isSection ? 'You do not manage that store' : 'Only an owner can remove a store' });
  }

  const [links, reqs, shifts, sections] = await Promise.all([
    prisma.employeeStore.count({ where: { storeId: id } }),
    prisma.shiftRequirement.count({ where: { storeId: id } }),
    prisma.shift.count({ where: { storeId: id } }),
    prisma.store.count({ where: { parentStoreId: id } }),
  ]);
  if (sections) {
    return res.status(409).json({ error: 'Remove this store’s sections first' });
  }
  if (links || reqs || shifts) {
    return res
      .status(409)
      .json({ error: 'Remove this store’s workers, shift requirements and shifts first' });
  }

  try {
    const [, , , , , , , , , , deleted] = await prisma.$transaction([
      prisma.scheduleSnapshot.deleteMany({ where: { storeId: id } }),
      prisma.schedule.deleteMany({ where: { storeId: id } }),
      prisma.managerStore.deleteMany({ where: { storeId: id } }),
      prisma.storeHours.deleteMany({ where: { storeId: id } }),
      prisma.storeHoliday.deleteMany({ where: { storeId: id } }),
      prisma.storeInvite.deleteMany({ where: { storeId: id } }),
      // closing-duty history + the store's responsibility definitions/grants —
      // previously missing here, which made deleting a store that ever had
      // closing-duty history 500 on ClosingDuty's FK (ON DELETE RESTRICT)
      prisma.closingDutyAssignment.deleteMany({ where: { closingDuty: { storeId: id } } }),
      prisma.closingDuty.deleteMany({ where: { storeId: id } }),
      prisma.employeeResponsibility.deleteMany({ where: { storeId: id } }),
      prisma.responsibility.deleteMany({ where: { storeId: id } }),
      prisma.store.delete({ where: { id } }),
    ]);
    auditLog('Store deleted', req.user!, { storeId: id, storeName: deleted.name });
    res.json({ message: 'Store deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete store' });
  }
});

export default router;
