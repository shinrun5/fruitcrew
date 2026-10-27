// Hourly pay: who may see it, and what a stretch of hours costs. Rates live on
// Employee.payRateCents, which lib/prisma.ts leaves out of every read unless
// asked for — this is where it's asked for.

import prisma from './prisma.js';
import type { AuthUser } from './auth.js';
import { OVERTIME_WEEK_MINUTES } from './payPeriod.js';

/** past 40 hours in a week, time and a half */
export const OVERTIME_RATE = 1.5;

/** Owners always; managers only when the owner has said so (Settings › Company). */
export async function canSeePay(user: AuthUser | undefined): Promise<boolean> {
  if (!user || user.orgId == null) return false;
  if (user.role === 'OWNER') return true;
  if (user.role !== 'MANAGER') return false;
  const org = await prisma.org.findUnique({ where: { id: user.orgId }, select: { managersSeePay: true } });
  return !!org?.managersSeePay;
}

/** employeeId → hourly rate in cents, for those who have one set */
export async function payRates(employeeIds: number[]): Promise<Map<number, number>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, payRateCents: { not: null } },
    select: { id: true, payRateCents: true },
  });
  return new Map(rows.map((r) => [r.id, r.payRateCents!]));
}

/** One week's pay for `minutes` worked at `rateCents` an hour — overtime past 40h. */
export function weekPayCents(minutes: number, rateCents: number): number {
  const over = Math.max(0, minutes - OVERTIME_WEEK_MINUTES);
  return Math.round((((minutes - over) + over * OVERTIME_RATE) / 60) * rateCents);
}

/** Dollars from the client ("16.5", 16.5) → cents; null clears it; undefined = bad input. */
export function centsFrom(v: unknown): number | null | undefined {
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1000) return undefined;
  return Math.round(n * 100);
}
