import type { DayOfWeek, MyShift, MyShiftsResponse } from '../types'
import { DAYS } from './time'

// The JSON the iOS widget reads (see lib/widget.ts): upcoming shifts as real
// moments in this phone's timezone. Kept free of Capacitor so it's testable.

/** weekStart (UTC Monday) + day + a wall-clock time (stored in the ISO's UTC fields) → that moment here */
function at(weekStart: string, day: DayOfWeek, clockIso: string): Date {
  const monday = new Date(weekStart)
  const clock = new Date(clockIso)
  return new Date(
    monday.getUTCFullYear(),
    monday.getUTCMonth(),
    monday.getUTCDate() + DAYS.indexOf(day),
    clock.getUTCHours(),
    clock.getUTCMinutes(),
  )
}

export function widgetPayload(data: MyShiftsResponse | null, signedIn: boolean, now = Date.now()): string {
  const storeName = new Map((data?.stores ?? []).map((s) => [s.storeId, s.storeName]))
  const weeks: { weekStart: string | null; shifts: MyShift[] }[] = data
    ? [{ weekStart: data.weekStart, shifts: data.shifts }, ...(data.thisWeek ? [data.thisWeek] : []), ...(data.upcomingWeeks ?? [])]
    : []
  const shifts = weeks
    .flatMap((w) =>
      w.weekStart
        ? w.shifts.map((s) => {
            const start = at(w.weekStart!, s.day, s.start)
            let end = at(w.weekStart!, s.day, s.end)
            if (end <= start) end = new Date(end.getTime() + 86_400_000) // runs past midnight
            return { start, end, store: storeName.get(s.storeId) ?? 'Work', coworkers: s.coworkers.map((c) => c.name.split(' ')[0] ?? c.name) }
          })
        : [],
    )
    .filter((s) => s.end.getTime() > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, 20)
  return JSON.stringify({
    signedIn,
    shifts: shifts.map((s) => ({ ...s, start: s.start.toISOString(), end: s.end.toISOString() })),
  })
}
