import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Role } from '@prisma/client';
import prisma from './prisma.js';
import { ORG_BILLING_SELECT, billingState } from './billing.js';

// Supabase signs access tokens with per-project asymmetric keys (ES256). We verify
// against the project's published JWKS, then look up OUR user row by the token's
// `sub` (the Supabase user UUID) and hang everything downstream off `req.user`.
//
// createRemoteJWKSet caches the key set and only refetches when it sees an unknown
// `kid` (with a cooldown), so this is one network call on the first request.

export interface AuthUser {
  id: number;
  authId: string;
  email: string;
  name: string | null;
  role: Role;
  employeeId: number | null;
  orgId: number | null;
  /** stores this user may act on: every store on the platform for a super
   * admin, an OWNER's whole org, a MANAGER's assigned stores, or an
   * EMPLOYEE's linked stores. */
  storeIds: number[];
  /** stores this login is actually staffed at (their own Employee record's
   * links), regardless of role — an OWNER/MANAGER who also works shifts still
   * has these; a pure owner/manager with no Employee link has none. Used to
   * gate the store group chat: "employee only" means "actual staff only",
   * which is a person's Employee link, not their login's role. */
  employeeStoreIds: number[];
  /** platform-level, independent of role/org — full cross-org oversight,
   * including editing any store's schedule (see storeIds below). */
  isSuperAdmin: boolean;
  /** false only for an EMPLOYEE who self-registered via an invite code and hasn't
   * been reviewed by a manager/owner yet — see SELF_SERVICE_ALLOWED below. */
  approved: boolean;
  /** true when this login's org is paused or deleted — same SELF_SERVICE_ALLOWED
   * allowlist blocks everything else, see below. */
  orgBlocked: boolean;
  /** true when billing is on and the business's free trial has ended without
   * a plan (see lib/billing.ts) — blocked like orgBlocked, except the owner
   * can still reach /api/billing to subscribe their way back in. */
  billingLapsed: boolean;
}

/** Routes still reachable while blocked — either a not-yet-approved EMPLOYEE,
 * or anyone in a paused/deleted org. Enough to see their own status, log out,
 * or back out of the account entirely, nothing store/schedule related.
 * Matched against `req.originalUrl` (stable regardless of how deep a router
 * this runs from), ignoring any query string. */
const SELF_SERVICE_ALLOWED: { method: string; path: string }[] = [
  { method: 'GET', path: '/api/auth/me' },
  { method: 'POST', path: '/api/auth/logout' },
  { method: 'POST', path: '/api/auth/change-password' },
  { method: 'DELETE', path: '/api/auth/account' },
];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error('Missing SUPABASE_URL — set it in Backend/.env');
    jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

export function bearerToken(req: Request): string | null {
  const header = req.header('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  let authId: string;
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      // Supabase access tokens: iss = <project>/auth/v1, aud = "authenticated".
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });
    if (!payload.sub) throw new Error('no sub claim');
    authId = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = await prisma.user.findUnique({
    where: { authId },
    include: {
      managerStores: { select: { storeId: true } },
      employee: {
        select: {
          name: true,
          employeeStores: { select: { storeId: true, store: { select: { org: { select: { pausedAt: true, deletedAt: true, ...ORG_BILLING_SELECT } } } } } },
        },
      },
      org: { select: { pausedAt: true, deletedAt: true, ...ORG_BILLING_SELECT } },
    },
  });
  if (!user) return res.status(401).json({ error: 'No account is linked to this token' });

  let storeIds: number[];
  if (user.isSuperAdmin) {
    storeIds = (await prisma.store.findMany({ select: { id: true } })).map((s) => s.id);
  } else if (user.role === 'OWNER' && user.orgId != null) {
    storeIds = (await prisma.store.findMany({ where: { orgId: user.orgId }, select: { id: true } })).map(
      (s) => s.id,
    );
  } else if (user.role === 'MANAGER') {
    storeIds = user.managerStores.map((m) => m.storeId);
  } else {
    storeIds = user.employee?.employeeStores.map((e) => e.storeId) ?? [];
  }
  const employeeStoreIds = user.employee?.employeeStores.map((e) => e.storeId) ?? [];

  // OWNER/MANAGER have user.org directly; an EMPLOYEE has no orgId column at
  // all (see User.orgId's comment), so fall back to whatever org their own
  // Employee links resolve to — every store an employee can be linked to
  // belongs to exactly one org, so the first link's org is authoritative.
  const orgStatus = user.org ?? user.employee?.employeeStores[0]?.store.org ?? null;
  const orgBlocked = !user.isSuperAdmin && !!(orgStatus?.pausedAt || orgStatus?.deletedAt);

  const path = req.originalUrl.split('?')[0] ?? '';
  const selfServiceOnly = SELF_SERVICE_ALLOWED.some((p) => p.method === req.method && p.path === path);
  if (orgBlocked && !selfServiceOnly) {
    return res.status(403).json({
      error: 'This account is not available right now. Contact us for help.',
      orgBlocked: true,
    });
  }
  const billingLapsed = !user.isSuperAdmin && !!orgStatus && billingState(orgStatus) === 'lapsed';
  const ownerPaying = user.role === 'OWNER' && (path === '/api/billing' || path.startsWith('/api/billing/'));
  if (billingLapsed && !selfServiceOnly && !ownerPaying) {
    return res.status(403).json({
      error: 'This business’s free trial has ended.',
      billingLapsed: true,
    });
  }
  if (user.role === 'EMPLOYEE' && !user.approved && !selfServiceOnly) {
    return res.status(403).json({
      error: 'Your account is pending approval from a manager.',
      pendingApproval: true,
    });
  }

  req.user = {
    id: user.id,
    authId: user.authId,
    email: user.email,
    name: user.name ?? user.employee?.name ?? null,
    role: user.role,
    employeeId: user.employeeId,
    orgId: user.orgId,
    storeIds,
    employeeStoreIds,
    isSuperAdmin: user.isSuperAdmin,
    approved: user.approved,
    orgBlocked,
    billingLapsed,
  };
  next();
}

/** Gate a route to one or more roles. Use after `requireAuth`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

export const requireOwner = [requireAuth, requireRole('OWNER')] as const;

/** Gate a route to the platform-level superadmin flag (independent of role/org). */
function checkSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Forbidden' });
  next();
}
export const requireSuperAdmin = [requireAuth, checkSuperAdmin] as const;

/** True when the user may act on this store (OWNER of its org, or an assigned MANAGER). */
export function canManageStore(user: AuthUser | undefined, storeId: number): boolean {
  return (
    !!user &&
    (user.isSuperAdmin || user.role === 'OWNER' || user.role === 'MANAGER') &&
    user.storeIds.includes(storeId)
  );
}

/** Middleware: reject unless the user can manage the store named by `pick(req)`. */
export function requireManagerFor(pick: (req: Request) => number | undefined) {
  return [
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
      const storeId = pick(req);
      if (storeId === undefined || Number.isNaN(storeId)) {
        return res.status(400).json({ error: 'storeId is required' });
      }
      if (!canManageStore(req.user, storeId)) {
        return res.status(403).json({ error: 'You do not manage that store' });
      }
      next();
    },
  ] as const;
}
