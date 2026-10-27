// The time clock: where each store's hours worked come from, and what a
// stretch on the clock counts for. Times are the stores' wall clock stored as
// if UTC (see TimeEntry in schema.prisma), so they line up with shifts.

import type { DayOfWeek, TimeClockMode, TimeEntry } from '@prisma/client';
import prisma from './prisma.js';
import { hhmmToMinutes, minuteOfDay, minutesToHHMM, storeClockNow } from './time.js';

/** Each store's time-clock mode — a section follows its parent's. */
export async function clockModes(storeIds: number[]): Promise<Map<number, TimeClockMode>> {
  if (storeIds.length === 0) return new Map();
  const rows = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, timeClock: true, parent: { select: { timeClock: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.parent?.timeClock ?? r.timeClock]));
}

/** The stores' clock right now, to the minute — what a clock-in records. */
export const clockNow = (): Date => new Date(storeClockNow());

/** What a finished stretch counts for: in to out, less unpaid breaks. */
export function workedMinutes(e: Pick<TimeEntry, 'clockIn' | 'clockOut' | 'breakMinutes'>): number {
  if (!e.clockOut) return 0;
  return Math.max(0, Math.round((e.clockOut.getTime() - e.clockIn.getTime()) / 60_000) - e.breakMinutes);
}

/** The store day a stretch belongs to (the one it started on), as UTC midnight. */
export const entryDay = (clockIn: Date): Date =>
  new Date(Date.UTC(clockIn.getUTCFullYear(), clockIn.getUTCMonth(), clockIn.getUTCDate()));

const STAMP = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

/** "YYYY-MM-DDTHH:MM" on the stores' clock ↔ the Date stored for it. */
export function parseStamp(v: unknown): Date | null {
  if (typeof v !== 'string' || !STAMP.test(v)) return null;
  const d = new Date(`${v}:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
export const toStamp = (d: Date): string => d.toISOString().slice(0, 16);

/** A stretch as the app sees it. */
export function shapeEntry(e: TimeEntry) {
  return {
    id: e.id,
    employeeId: e.employeeId,
    storeId: e.storeId,
    clockIn: toStamp(e.clockIn),
    clockOut: e.clockOut ? toStamp(e.clockOut) : null,
    breakMinutes: e.breakMinutes,
    onBreakSince: e.breakStartedAt ? toStamp(e.breakStartedAt) : null,
    source: e.source,
    approved: e.approvedAt != null,
    edited: e.editedById != null,
  };
}

/** The longest one stretch on the clock can be. */
export const MAX_STRETCH_MINUTES = 24 * 60;

/** Times a manager (or an import) gives for a stretch, checked — or what's wrong with them. */
export function readTimes(
  body: { clockIn?: unknown; clockOut?: unknown; breakMinutes?: unknown },
  now = clockNow(),
): { clockIn: Date; clockOut: Date | null; breakMinutes: number } | { error: string } {
  const clockIn = parseStamp(body.clockIn);
  if (!clockIn) return { error: 'Pick when they clocked in' };
  const noOut = body.clockOut == null || body.clockOut === '';
  const clockOut = noOut ? null : parseStamp(body.clockOut);
  if (!noOut && !clockOut) return { error: 'That clock-out time isn’t a time' };
  const breakMinutes = body.breakMinutes == null || body.breakMinutes === '' ? 0 : Number(body.breakMinutes);
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) return { error: 'Break has to be whole minutes' };
  if (clockIn > now) return { error: 'That clock-in hasn’t happened yet' };
  if (clockOut) {
    if (clockOut > now) return { error: 'That clock-out hasn’t happened yet' };
    const span = (clockOut.getTime() - clockIn.getTime()) / 60_000;
    if (span <= 0) return { error: 'Clock-out has to be after clock-in' };
    if (span > MAX_STRETCH_MINUTES) return { error: 'One stretch can’t be longer than 24 hours' };
    if (breakMinutes >= span) return { error: 'The break is longer than the time on the clock' };
  }
  return { clockIn, clockOut, breakMinutes };
}

/** Who was scheduled when at a store in a week — the live rows while the week
 * is still on the board, else its latest saved copy. */
export async function scheduledShifts(
  storeId: number,
  weekStart: Date,
): Promise<{ employeeId: number; day: DayOfWeek; start: string; end: string }[]> {
  const live = await prisma.shift.findMany({
    where: { storeId, weekStart, employeeId: { not: null } },
    select: { employeeId: true, day: true, start: true, end: true },
  });
  if (live.length > 0) {
    return live.map((s) => ({
      employeeId: s.employeeId!,
      day: s.day,
      start: minutesToHHMM(minuteOfDay(s.start)),
      end: minutesToHHMM(minuteOfDay(s.end)),
    }));
  }
  const snap = await prisma.scheduleSnapshot.findFirst({ where: { storeId, weekStart }, orderBy: { savedAt: 'desc' } });
  const rows = (snap?.shifts ?? []) as { employeeId: number | null; day: DayOfWeek; start: string; end: string }[];
  return rows
    .filter((r) => r.employeeId != null)
    .map((r) => ({
      employeeId: r.employeeId!,
      day: r.day,
      start: minutesToHHMM(hhmmToMinutes(r.start)),
      end: minutesToHHMM(hhmmToMinutes(r.end)),
    }));
}
