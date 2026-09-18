import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { supabaseAdmin, supabaseAnon } from '../lib/supabase.js';
import { bearerToken, requireAuth } from '../lib/auth.js';
import { alertError } from '../lib/errorAlert.js';


const router = Router();

function publicUser(u: {
  id: number;
  email: string;
  name: string | null;
  role: string;
  employeeId: number | null;
}) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, employeeId: u.employeeId };
}

const PIN_RE = /^\d{4}$/;

// POST /auth/register  { email, password, inviteCode }
// An Employee row must already exist with a matching, unclaimed inviteCode
// (a manager issues it). Registration creates the Supabase auth user, links a
// User row to that Employee, and consumes the code.
router.post('/register', async (req, res) => {
  const { email, password, inviteCode } = req.body ?? {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
  if (!email || !password || !inviteCode) {
    return res.status(400).json({ error: 'email, password, and inviteCode are required' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (pin && !PIN_RE.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4 digits' });
  }

  const employee = await prisma.employee.findUnique({
    where: { inviteCode },
    include: { user: true, employeeStores: { select: { storeId: true } } },
  });
  if (!employee) return res.status(400).json({ error: 'Invalid invite code' });
  if (employee.user) return res.status(409).json({ error: 'This invite has already been claimed' });

  // check the chosen PIN is free at every store this employee is at, before creating anything
  if (pin) {
    for (const { storeId } of employee.employeeStores) {
      const clash = await prisma.employeeStore.findUnique({
        where: { storeId_pin: { storeId, pin } },
      });
      if (clash && clash.employeeId !== employee.id) {
        return res.status(409).json({ error: 'That PIN is already taken at one of your stores' });
      }
    }
  }

  // email_confirm: true — we deliberately skip email verification for now
  const created = await supabaseAdmin().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    return res.status(400).json({ error: created.error?.message ?? 'Could not create account' });
  }

  try {
    const user = await prisma.user.create({
      data: {
        authId: created.data.user.id,
        email,
        name: name || null,
        phone: phone || null,
        role: 'EMPLOYEE',
        employeeId: employee.id,
      },
    });
    await prisma.employee.update({
      where: { id: employee.id },
      data: { inviteCode: null, ...(name ? { name } : {}) },
    });
    if (pin) {
      await prisma.employeeStore.updateMany({ where: { employeeId: employee.id }, data: { pin } });
    }

    const signIn = await supabaseAnon().auth.signInWithPassword({ email, password });
    return res.status(201).json({ user: publicUser(user), session: signIn.data.session });
  } catch {
    // undo the orphaned auth user so the invite code stays usable
    await supabaseAdmin().auth.admin.deleteUser(created.data.user.id).catch(() => {});
    return res.status(500).json({ error: 'Failed to finish registration' });
  }
});

// GET /auth/manager-invite/:code — public: what this link is for (drives the
// registration page's "you've been invited as ___ at ___" greeting)
router.get('/manager-invite/:code', async (req, res) => {
  const invite = await prisma.managerInvite.findUnique({
    where: { code: req.params.code },
    include: { org: { select: { name: true } } },
  });
  if (!invite || invite.usedAt) return res.status(404).json({ error: 'Invalid or already-used invite link' });

  const stores = invite.storeIds.length
    ? await prisma.store.findMany({ where: { id: { in: invite.storeIds } }, select: { name: true } })
    : [];
  res.json({
    role: invite.role,
    orgName: invite.org.name,
    storeNames: stores.map((s) => s.name),
  });
});

// POST /auth/register-manager  { email, password, code, name? }
// A ManagerInvite must exist, unclaimed, matching `code` (an owner issues it via
// POST /managers/invites). Creates the Supabase auth user, a User row with the
// invite's role + org + stores, and consumes the invite.
router.post('/register-manager', async (req, res) => {
  const { email, password, code } = req.body ?? {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!email || !password || !code) {
    return res.status(400).json({ error: 'email, password, and code are required' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const invite = await prisma.managerInvite.findUnique({ where: { code } });
  if (!invite) return res.status(400).json({ error: 'Invalid invite link' });
  if (invite.usedAt) return res.status(409).json({ error: 'This invite has already been claimed' });
  if (await prisma.user.findUnique({ where: { email } })) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const created = await supabaseAdmin().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    return res.status(400).json({ error: created.error?.message ?? 'Could not create account' });
  }

  try {
    const user = await prisma.user.create({
      data: {
        authId: created.data.user.id,
        email,
        name: name || null,
        role: invite.role,
        orgId: invite.orgId,
        ...(invite.role === 'MANAGER'
          ? { managerStores: { create: invite.storeIds.map((storeId) => ({ storeId })) } }
          : {}),
      },
    });
    await prisma.managerInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), usedByUserId: user.id },
    });

    const signIn = await supabaseAnon().auth.signInWithPassword({ email, password });
    return res.status(201).json({ user: publicUser(user), session: signIn.data.session });
  } catch {
    // undo the orphaned auth user so the invite link stays usable
    await supabaseAdmin().auth.admin.deleteUser(created.data.user.id).catch(() => {});
    return res.status(500).json({ error: 'Failed to finish registration' });
  }
});

// GET /auth/setup-status — is there an owner yet? drives the /setup page.

router.get('/setup-status', async (_req, res) => {
  const owners = await prisma.user.count({ where: { role: 'OWNER' } });
  return res.json({ needsSetup: owners === 0 });
});

// POST /auth/register-owner  { email, password, companyName }
// First-run only: creates (or promotes) the OWNER account and their Org. If the
// email already has a login, the password must match and that account is promoted.
// Refuses once any OWNER exists.
router.post('/register-owner', async (req, res) => {
  const { email, password, companyName } = req.body ?? {};
  const company = typeof companyName === 'string' ? companyName.trim() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  if (!email || !password || !company) {
    return res.status(400).json({ error: 'email, password, and companyName are required' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if ((await prisma.user.count({ where: { role: 'OWNER' } })) > 0) {
    return res.status(403).json({ error: 'Setup is already complete — an owner account exists.' });
  }

  // reuse an existing Supabase login if the password checks out, else make one
  let authId: string;
  let session: unknown = null;
  let createdAuthUser = false;

  const signIn = await supabaseAnon().auth.signInWithPassword({ email, password });
  if (signIn.data.session && signIn.data.user) {
    authId = signIn.data.user.id;
    session = signIn.data.session;
  } else {
    const created = await supabaseAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      const msg = created.error?.message ?? '';
      if (/already.*regist/i.test(msg)) {
        return res.status(401).json({ error: 'That email already has an account — check the password.' });
      }
      return res.status(400).json({ error: msg || 'Could not create account' });
    }
    authId = created.data.user.id;
    createdAuthUser = true;
    const fresh = await supabaseAnon().auth.signInWithPassword({ email, password });
    session = fresh.data.session ?? null;
  }

  try {
    const existing = await prisma.user.findUnique({ where: { authId } });
    const orgId =
      existing?.orgId ?? (await prisma.org.create({ data: { name: company } })).id;
    await prisma.org.update({ where: { id: orgId }, data: { name: company } });

    const nameData = { ...(name ? { name } : {}), ...(phone ? { phone } : {}) };
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { role: 'OWNER', orgId, ...nameData } })
      : await prisma.user.create({ data: { authId, email, role: 'OWNER', orgId, ...nameData } });

    await prisma.org.update({ where: { id: orgId }, data: { ownerId: user.id } });

    // stores already in the org (normally none at first run) get this owner + a schedule
    const stores = await prisma.store.findMany({ where: { orgId } });
    for (const s of stores) {
      await prisma.managerStore.upsert({
        where: { userId_storeId: { userId: user.id, storeId: s.id } },
        create: { userId: user.id, storeId: s.id },
        update: {},
      });
      await prisma.schedule.upsert({
        where: { storeId: s.id },
        create: { storeId: s.id },
        update: {},
      });
    }

    return res.status(201).json({ user: publicUser(user), session });
  } catch {
    if (createdAuthUser) await supabaseAdmin().auth.admin.deleteUser(authId).catch(() => {});
    return res.status(500).json({ error: 'Failed to finish setup' });
  }
});

// POST /auth/login  { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const { data, error } = await supabaseAnon().auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = await prisma.user.findUnique({ where: { authId: data.user.id } });
  if (!user) return res.status(403).json({ error: 'No app account is linked to this login' });

  return res.json({ user: publicUser(user), session: data.session });
});

// POST /auth/refresh  { refreshToken }
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });

  const { data, error } = await supabaseAnon().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return res.status(401).json({ error: 'Could not refresh session' });

  return res.json({ session: data.session });
});

// POST /auth/logout
// Revokes every refresh token for this login (scope 'global'), not just the
// one the client is holding — so a stolen token doesn't keep working after
// the real owner logs out. Best-effort: the client clears its local session
// either way, so a Supabase hiccup here shouldn't block logging out.
router.post('/logout', requireAuth, async (req, res) => {
  const token = bearerToken(req);
  if (token) {
    const { error } = await supabaseAdmin().auth.admin.signOut(token, 'global');
    if (error) alertError('auth.logout', error, { userId: req.user!.id });
  }
  return res.json({ ok: true });
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  return res.json({ user: req.user });
});

// GET /auth/profile — account (name, phone) + employee details (stores, tier, PIN, caps)
router.get('/profile', requireAuth, async (req, res) => {
  const u = req.user!;
  const account = await prisma.user.findUnique({
    where: { id: u.id },
    select: {
      name: true,
      phone: true,
      notifyOnAvailabilityUpdate: true,
      notifyOnChatMessage: true,
      notifyOnMarketplacePost: true,
      notifyOnMention: true,
    },
  });
  let employee = null;
  if (u.employeeId) {
    const e = await prisma.employee.findUnique({
      where: { id: u.employeeId },
      include: { employeeStores: { include: { store: true } } },
    });
    if (e) {
      employee = {
        id: e.id,
        name: e.name,
        hourLimit: e.hourLimit,
        maxShifts: e.maxShifts,
        eitherOrDays: (e.eitherOrDays as string[][] | null) ?? [],
        noConsecutiveDays: e.noConsecutiveDays,
        standby: e.standby,
        stores: e.employeeStores.map((s) => ({
          storeId: s.storeId,
          storeName: s.store.name,
          proficiency: s.proficiency,
          canOpen: s.canOpen,
          pin: s.pin,
        })),
      };
    }
  }
  return res.json({
    id: u.id,
    email: u.email,
    name: account?.name ?? null,
    phone: account?.phone ?? null,
    role: u.role,
    alerts: {
      availabilityUpdates: account?.notifyOnAvailabilityUpdate ?? false,
      chatMessages: account?.notifyOnChatMessage ?? false,
      marketplacePosts: account?.notifyOnMarketplacePost ?? true,
      mentions: account?.notifyOnMention ?? true,
    },
    employee,
  });
});

// PUT /auth/alerts  { availabilityUpdates?, chatMessages?, marketplacePosts? } — opt-ins
router.put('/alerts', requireAuth, async (req, res) => {
  const u = req.user!;
  const data: {
    notifyOnAvailabilityUpdate?: boolean;
    notifyOnChatMessage?: boolean;
    notifyOnMarketplacePost?: boolean;
    notifyOnMention?: boolean;
  } = {};
  if (req.body?.availabilityUpdates !== undefined) {
    if (typeof req.body.availabilityUpdates !== 'boolean') {
      return res.status(400).json({ error: 'availabilityUpdates must be true or false' });
    }
    data.notifyOnAvailabilityUpdate = req.body.availabilityUpdates;
  }
  if (req.body?.chatMessages !== undefined) {
    if (typeof req.body.chatMessages !== 'boolean') {
      return res.status(400).json({ error: 'chatMessages must be true or false' });
    }
    data.notifyOnChatMessage = req.body.chatMessages;
  }
  if (req.body?.marketplacePosts !== undefined) {
    if (typeof req.body.marketplacePosts !== 'boolean') {
      return res.status(400).json({ error: 'marketplacePosts must be true or false' });
    }
    data.notifyOnMarketplacePost = req.body.marketplacePosts;
  }
  if (req.body?.mentions !== undefined) {
    if (typeof req.body.mentions !== 'boolean') {
      return res.status(400).json({ error: 'mentions must be true or false' });
    }
    data.notifyOnMention = req.body.mentions;
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const updated = await prisma.user.update({ where: { id: u.id }, data });
  res.json({
    alerts: {
      availabilityUpdates: updated.notifyOnAvailabilityUpdate,
      chatMessages: updated.notifyOnChatMessage,
      marketplacePosts: updated.notifyOnMarketplacePost,
      mentions: updated.notifyOnMention,
    },
  });
});

// PUT /auth/profile  { name?, phone? } — edit your own name / contact number
router.put('/profile', requireAuth, async (req, res) => {
  const u = req.user!;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : undefined;
  if (name !== undefined && !name) return res.status(400).json({ error: 'Name cannot be empty' });

  await prisma.user.update({
    where: { id: u.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(phone !== undefined ? { phone: phone || null } : {}),
    },
  });
  // keep the roster row in sync when this account is also a worker
  if (u.employeeId && (name || phone !== undefined)) {
    await prisma.employee.update({
      where: { id: u.employeeId },
      data: {
        ...(name ? { name } : {}),
        ...(phone !== undefined ? { phone: phone || null } : {}),
      },
    });
  }
  res.json({ ok: true });
});

// POST /auth/change-password  { currentPassword, newPassword }
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }

  const check = await supabaseAnon().auth.signInWithPassword({
    email: req.user!.email,
    password: currentPassword,
  });
  if (check.error) return res.status(403).json({ error: 'Current password is incorrect' });

  const updated = await supabaseAdmin().auth.admin.updateUserById(req.user!.authId, {
    password: newPassword,
  });
  if (updated.error) return res.status(400).json({ error: updated.error.message });
  return res.json({ ok: true });
});

export default router;
