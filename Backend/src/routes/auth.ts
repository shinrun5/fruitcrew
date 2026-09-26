import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma.js';
import { supabaseAdmin, supabaseAnon } from '../lib/supabase.js';
import { bearerToken, requireAuth } from '../lib/auth.js';
import { alertError } from '../lib/errorAlert.js';
import { deleteUserAccount } from '../lib/accountDeletion.js';


const router = Router();

// Login is the highest-value brute-force target under /auth (the shared authLimiter
// on the whole router budgets 50 failures/15min across register/login/etc. combined);
// this tightens just that one endpoint further. Same "only failures count" shape.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

function publicUser(u: {
  id: number;
  email: string;
  name: string | null;
  role: string;
  employeeId: number | null;
  approved: boolean;
}) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, employeeId: u.employeeId, approved: u.approved };
}

/** Supabase models email+password sign-up as an "email" identity on the auth
 * user, alongside "google"/"apple" for OAuth sign-ins — a person who only
 * ever used Google/Apple has no "email" identity and so no password to check
 * against (change-password and delete-account both need to know this). */
async function hasPasswordIdentity(authId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(authId);
  return data.user?.identities?.some((i) => i.provider === 'email') ?? false;
}

/** Exchanges a WeChat Mini Program wx.login() code for that user's openid.
 * Server-side only — WECHAT_APPSECRET must never reach the client, unlike
 * the Mini Program's own AppID (a public identifier, already in its
 * project.config.json). */
async function wechatCode2Session(code: string): Promise<{ openid: string; unionid?: string }> {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;
  if (!appid || !secret) throw new Error('WeChat login is not configured on this server');

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await fetch(url);
  const data = (await res.json()) as { openid?: string; unionid?: string; errcode?: number; errmsg?: string };
  if (!data.openid) throw new Error(data.errmsg || 'WeChat could not verify that login');
  return { openid: data.openid, ...(data.unionid ? { unionid: data.unionid } : {}) };
}

/** Mints a real Supabase session for an EXISTING user, server-side, with no
 * password and no email actually sent — used to re-authenticate a WeChat
 * login that's already linked to an account. `generateLink` creates a
 * one-time verification token for the given email (Supabase's own passwordless
 * "magic link" mechanism); `verifyOtp` immediately redeems it for a session,
 * so nothing ever goes out over email — we just use the same primitive
 * Supabase built for that flow to skip straight to a session. */
async function mintSessionForUser(email: string) {
  const generated = await supabaseAdmin().auth.admin.generateLink({ type: 'magiclink', email });
  const hashedToken = generated.data?.properties?.hashed_token;
  if (generated.error || !hashedToken) {
    throw new Error(generated.error?.message ?? 'Could not create a session');
  }
  const verified = await supabaseAnon().auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' });
  if (verified.error || !verified.data.session) {
    throw new Error(verified.error?.message ?? 'Could not create a session');
  }
  return verified.data.session;
}

// POST /auth/register  { email, password, inviteCode }
// An Employee row must already exist with a matching, unclaimed inviteCode
// (a manager issues it). Registration creates the Supabase auth user, links a
// User row to that Employee, and consumes the code.
router.post('/register', async (req, res) => {
  const { email, password, inviteCode } = req.body ?? {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  if (!email || !password || !inviteCode) {
    return res.status(400).json({ error: 'email, password, and inviteCode are required' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const employee = await prisma.employee.findUnique({
    where: { inviteCode },
    include: { user: true, employeeStores: { select: { storeId: true } } },
  });
  if (!employee) return res.status(400).json({ error: 'Invalid invite code' });
  if (employee.user) return res.status(409).json({ error: 'This invite has already been claimed' });
  if (employee.inviteCodeExpiresAt && employee.inviteCodeExpiresAt < new Date()) {
    return res.status(410).json({ error: 'This invite link has expired — ask your manager to send a new one' });
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
        // unverified email + self-claimed identity — a manager/owner reviews
        // before this login counts as the real person (see lib/auth.ts)
        approved: false,
      },
    });
    await prisma.employee.update({
      where: { id: employee.id },
      data: { inviteCode: null, inviteCodeExpiresAt: null, ...(name ? { name } : {}) },
    });

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
  if (!invite || invite.usedAt || (invite.expiresAt && invite.expiresAt < new Date())) {
    return res.status(404).json({ error: 'Invalid or already-used invite link' });
  }

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
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return res.status(410).json({ error: 'This invite link has expired — ask the owner to send a new one' });
  }
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

// GET /auth/store-invite/:code — public: what this link is for (drives the
// registration page's "you're joining ___ at ___" greeting). Unlike
// manager-invite, a StoreInvite is reusable — no usedAt to check.
router.get('/store-invite/:code', async (req, res) => {
  const invite = await prisma.storeInvite.findUnique({
    where: { code: req.params.code },
    include: { store: { select: { name: true, org: { select: { name: true } } } } },
  });
  if (!invite || (invite.expiresAt && invite.expiresAt < new Date())) {
    return res.status(404).json({ error: 'Invalid sign-up link' });
  }
  res.json({ storeName: invite.store.name, orgName: invite.store.org.name });
});

// POST /auth/register-store  { email, password, code, name, phone? }
// A StoreInvite must exist matching `code` (a manager generates it from the
// Stores page). Unlike /register (claims a pre-made Employee row) or
// /register-manager (single-use), this creates a brand-new Employee +
// EmployeeStore + User all at once, with safe defaults for anything the
// self-signing-up worker isn't asked for (hours/tier/open-close trust) — a
// manager can adjust those afterward from Workers. The link itself is never
// consumed, so the next worker can use the same one.
router.post('/register-store', async (req, res) => {
  const { email, password, code } = req.body ?? {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  if (!email || !password || !code || !name) {
    return res.status(400).json({ error: 'email, password, name, and code are required' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const invite = await prisma.storeInvite.findUnique({ where: { code } });
  if (!invite) return res.status(400).json({ error: 'Invalid sign-up link' });
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return res.status(410).json({ error: 'This sign-up link has expired — ask your manager for a new one' });
  }
  if (await prisma.user.findUnique({ where: { email } })) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const created = await supabaseAdmin().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    return res.status(400).json({ error: created.error?.message ?? 'Could not create account' });
  }

  try {
    const user = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          name,
          phone: phone || null,
          hourLimit: 40,
          employeeStores: {
            create: { storeId: invite.storeId, proficiency: 'NEW', canOpen: false, canClose: false },
          },
        },
      });
      return tx.user.create({
        data: {
          authId: created.data.user!.id,
          email,
          name,
          phone: phone || null,
          role: 'EMPLOYEE',
          employeeId: employee.id,
          // unverified email + no manager-issued invite tied to a known person —
          // a manager/owner reviews before this login counts as staff
          approved: false,
        },
      });
    });

    const signIn = await supabaseAnon().auth.signInWithPassword({ email, password });
    return res.status(201).json({ user: publicUser(user), session: signIn.data.session });
  } catch {
    // undo the orphaned auth user so they can just retry the same link
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
router.post('/login', loginLimiter, async (req, res) => {
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

// POST /auth/oauth  { provider: 'google'|'apple', idToken, inviteCode? }
// The client gets an ID token directly from Google/Apple's own SDK (native or
// web) rather than a redirect round-trip — keeps the same "client only ever
// talks to our API" shape every other auth route already has. Supabase
// verifies the token and gives back its own auth user (creating one on first
// use of that Google/Apple identity); we still gate a *new* FruitCrew account
// behind an invite code exactly like /register does, so this only ever
// short-circuits which identity provider proves who they are, not the
// invite-only signup model itself. Always 200/201 on a well-formed request —
// "not linked yet" is a normal outcome the client is meant to react to, not
// an error.
router.post('/oauth', async (req, res) => {
  const { provider, idToken, inviteCode, name: clientName } = req.body ?? {};
  if ((provider !== 'google' && provider !== 'apple') || typeof idToken !== 'string' || !idToken) {
    return res.status(400).json({ error: 'provider ("google" or "apple") and idToken are required' });
  }

  const { data, error } = await supabaseAnon().auth.signInWithIdToken({ provider, token: idToken });
  if (error || !data.session || !data.user) {
    return res.status(401).json({ error: 'Could not verify that sign-in' });
  }

  const existing = await prisma.user.findUnique({ where: { authId: data.user.id } });
  if (existing) {
    return res.json({ user: publicUser(existing), session: data.session });
  }

  if (!inviteCode) {
    return res.json({ needsInvite: true });
  }

  const employee = await prisma.employee.findUnique({
    where: { inviteCode },
    include: { user: true },
  });
  if (!employee) return res.status(400).json({ error: 'Invalid invite code' });
  if (employee.user) return res.status(409).json({ error: 'This invite has already been claimed' });
  if (employee.inviteCodeExpiresAt && employee.inviteCodeExpiresAt < new Date()) {
    return res.status(410).json({ error: 'This invite link has expired — ask your manager to send a new one' });
  }

  // Apple's id_token carries no name claim at all — it's handed to the
  // client, once, only on that identity's very first authorization, so the
  // client passes it along here. Google's does come through in the verified
  // token's own metadata, which takes priority over anything client-supplied.
  const name =
    (typeof data.user.user_metadata?.full_name === 'string' && data.user.user_metadata.full_name) ||
    (typeof data.user.user_metadata?.name === 'string' && data.user.user_metadata.name) ||
    (typeof clientName === 'string' && clientName.trim()) ||
    null;

  const user = await prisma.user.create({
    data: {
      authId: data.user.id,
      email: data.user.email ?? '',
      name,
      role: 'EMPLOYEE',
      employeeId: employee.id,
      approved: false,
    },
  });
  await prisma.employee.update({
    where: { id: employee.id },
    data: { inviteCode: null, inviteCodeExpiresAt: null, ...(name ? { name } : {}) },
  });

  return res.status(201).json({ user: publicUser(user), session: data.session });
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
  return res.json({ user: { ...req.user, hasPassword: await hasPasswordIdentity(req.user!.authId) } });
});

// GET /auth/profile — account (name, phone) + employee details (stores, tier, caps)
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
      wechatOpenId: true,
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
    wechatLinked: Boolean(account?.wechatOpenId),
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
  if (updated.error) {
    alertError('auth.changePassword', updated.error, { userId: req.user!.id });
    return res.status(400).json({ error: 'Could not update password' });
  }
  return res.json({ ok: true });
});

// DELETE /auth/account  { password } — in-app self-service account deletion
// (App Store 5.1.1(v) / Play's account-deletion policy both require this).
// Password-gated the same way change-password is, since this is irreversible
// — except a Google/Apple-only sign-in has no password to check, so for that
// case the already-verified bearer token (requireAuth) stands on its own.
router.delete('/account', requireAuth, async (req, res) => {
  const { password } = req.body ?? {};
  if (await hasPasswordIdentity(req.user!.authId)) {
    if (!password) return res.status(400).json({ error: 'password is required' });
    const check = await supabaseAnon().auth.signInWithPassword({ email: req.user!.email, password });
    if (check.error) return res.status(403).json({ error: 'Password is incorrect' });
  }

  const result = await deleteUserAccount(req.user!.id);
  if (!result.ok) return res.status(409).json({ error: result.error });
  return res.json({ ok: true });
});

// POST /auth/wechat/link  { code }  — the calling user connects their WeChat
// account for future silent re-auth. `code` is a wx.login() code (single-use,
// valid a few minutes); exchanged here for a stable openid and stored on the
// caller's own row. Never creates or switches accounts — only ever attaches
// to whoever is already authenticated.
router.post('/wechat/link', requireAuth, async (req, res) => {
  const { code } = req.body ?? {};
  if (typeof code !== 'string' || !code) return res.status(400).json({ error: 'code is required' });

  let openid: string;
  try {
    ({ openid } = await wechatCode2Session(code));
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const existing = await prisma.user.findUnique({ where: { wechatOpenId: openid } });
  if (existing && existing.id !== req.user!.id) {
    return res.status(409).json({ error: 'This WeChat account is already connected to a different login' });
  }

  await prisma.user.update({ where: { id: req.user!.id }, data: { wechatOpenId: openid } });
  return res.json({ ok: true });
});

// POST /auth/wechat/unlink — disconnect WeChat from the calling account
router.post('/wechat/unlink', requireAuth, async (req, res) => {
  await prisma.user.update({ where: { id: req.user!.id }, data: { wechatOpenId: null } });
  return res.json({ ok: true });
});

// POST /auth/wechat  { code }  — public: re-authenticate a login that's
// already connected its WeChat account (see /wechat/link above). Meant to be
// called silently on every Mini Program launch — a 404 here just means
// "nothing linked yet," which the client treats as "show the normal login
// screen," not an error to surface.
router.post('/wechat', async (req, res) => {
  const { code } = req.body ?? {};
  if (typeof code !== 'string' || !code) return res.status(400).json({ error: 'code is required' });

  let openid: string;
  try {
    ({ openid } = await wechatCode2Session(code));
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const user = await prisma.user.findUnique({ where: { wechatOpenId: openid } });
  if (!user) return res.status(404).json({ error: 'No account is connected to this WeChat login yet' });

  try {
    const session = await mintSessionForUser(user.email);
    return res.json({ user: publicUser(user), session });
  } catch (err) {
    alertError('auth.wechat', err, { userId: user.id });
    return res.status(500).json({ error: 'Could not sign in with WeChat' });
  }
});

export default router;
