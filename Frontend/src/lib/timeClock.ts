import { to12Hour } from './time'
import type { Store, TimeClockMode, TimeEntry } from '../types'

// Stretches on the clock carry "YYYY-MM-DDTHH:MM" on the stores' clock (see
// the backend's lib/timeClock.ts) — read as if UTC, like every shift time here.

/** Minutes since the epoch of a stamp, for differences between two of them. */
export const stampMinutes = (stamp: string): number => Date.parse(`${stamp}:00Z`) / 60_000

/** "9:58 AM" */
export const stampTime = (stamp: string): string => to12Hour(stamp.slice(11, 16))

/** "YYYY-MM-DD" — the day a stretch belongs to is the one it started on. */
export const stampDay = (stamp: string): string => stamp.slice(0, 10)

/** Time a stretch counts for: in to out (or to `now` while still on), less breaks. */
export function workedMinutes(e: TimeEntry, now?: string): number {
  const end = e.clockOut ?? now
  if (!end) return 0
  const onBreak = !e.clockOut && e.onBreakSince && now ? stampMinutes(now) - stampMinutes(e.onBreakSince) : 0
  return Math.max(0, stampMinutes(end) - stampMinutes(e.clockIn) - e.breakMinutes - onBreak)
}

/** A store's time-clock mode — a section follows its parent's. */
export function clockModeOf(store: Store | undefined, stores: Store[]): TimeClockMode {
  if (!store) return 'OFF'
  const parent = store.parentStoreId != null ? stores.find((s) => s.id === store.parentStoreId) : undefined
  return (parent ?? store).timeClock ?? 'OFF'
}
