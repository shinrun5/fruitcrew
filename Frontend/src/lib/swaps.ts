import type { DayOfWeek, EmployeeStore, RecurringAvailability } from '../types'
import { DAYS, toMinutes, windowsOverlap } from './time'

/** One person-shift as it sits on the board (merged rows -> one span). */
export interface ShiftSpan {
  employeeId: number
  name: string
  avatarFruit: string | null
  storeId: number
  storeName: string
  day: DayOfWeek
  start: string // ISO datetime (1970 wall-clock)
  end: string
  shiftIds: number[]
}

export interface SwapOption {
  employeeId: number
  name: string
  avatarFruit: string | null
  /** the shift they currently hold — the one A would take on a direct swap */
  theirShift: ShiftSpan
}

/**
 * Direct-swap partners for `a`'s shift: someone who holds another shift this week
 * where BOTH people fully cover BOTH shifts and neither ends up double-booked.
 */
export function computeSwapOptions(args: {
  a: ShiftSpan
  spans: ShiftSpan[]
  employeeStores: EmployeeStore[]
  availability: RecurringAvailability[]
}): SwapOption[] {
  const { a, spans, employeeStores, availability } = args
  const aLo = toMinutes(a.start)
  const aHi = toMinutes(a.end)

  const linked = (empId: number, storeId: number) =>
    employeeStores.some((es) => es.employeeId === empId && es.storeId === storeId)

  const coversFull = (empId: number, day: DayOfWeek, lo: number, hi: number) =>
    availability.some(
      (w) =>
        w.employeeId === empId &&
        w.day === day &&
        toMinutes(w.start) <= lo &&
        toMinutes(w.end) >= hi,
    )

  // does empId hold another span (not in `exceptIds`) overlapping [lo,hi] on `day`?
  const busyElsewhere = (empId: number, day: DayOfWeek, lo: number, hi: number, exceptIds: number[]) =>
    spans.some(
      (s) =>
        s.employeeId === empId &&
        s.day === day &&
        !s.shiftIds.every((id) => exceptIds.includes(id)) &&
        windowsOverlap(toMinutes(s.start), toMinutes(s.end), lo, hi),
    )

  // already working A's store that day -> it's not a "swap for the day off", skip them
  const worksSameDayHere = (empId: number) =>
    spans.some((s) => s.employeeId === empId && s.storeId === a.storeId && s.day === a.day)

  const out: SwapOption[] = []
  for (const b of spans) {
    if (b.employeeId === a.employeeId) continue
    if (b.shiftIds.length === a.shiftIds.length && b.shiftIds.every((id) => a.shiftIds.includes(id))) continue
    if (worksSameDayHere(b.employeeId)) continue
    const bLo = toMinutes(b.start)
    const bHi = toMinutes(b.end)

    // B takes A's shift
    if (!linked(b.employeeId, a.storeId)) continue
    if (!coversFull(b.employeeId, a.day, aLo, aHi)) continue
    if (busyElsewhere(b.employeeId, a.day, aLo, aHi, b.shiftIds)) continue

    // A takes B's shift
    if (!linked(a.employeeId, b.storeId)) continue
    if (!coversFull(a.employeeId, b.day, bLo, bHi)) continue
    if (busyElsewhere(a.employeeId, b.day, bLo, bHi, a.shiftIds)) continue

    out.push({ employeeId: b.employeeId, name: b.name, avatarFruit: b.avatarFruit, theirShift: b })
  }

  return out.sort(
    (x, y) =>
      Number(y.theirShift.storeId === a.storeId) - Number(x.theirShift.storeId === a.storeId) ||
      DAYS.indexOf(x.theirShift.day) - DAYS.indexOf(y.theirShift.day) ||
      toMinutes(x.theirShift.start) - toMinutes(y.theirShift.start),
  )
}
