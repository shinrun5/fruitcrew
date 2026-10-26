import { api } from './api'
import { computeGapCards, type GapCardData } from './gaps'
import { effectiveCanOpen } from './openers'
import { DAYS, minToClock, to12Hour, toHHMM24, toMinutes } from './time'
import type { useT } from './i18n'
import type { DayPerson } from '../components/ScheduleCards'
import type { DayOfWeek, Employee, EmployeeStore, RecurringAvailability, Shift, ShiftRequirement, Store } from '../types'

// The manager's schedule board (pages/Dashboard.tsx): loading it, and turning
// shift rows into the per-store, per-day cards it draws.

export interface BoardData {
  /** the week these shifts are for: null = each store's draft (the board's own
   * week), else a running week ("YYYY-MM-DD") being edited live */
  week: string | null
  stores: Store[]
  employees: Employee[]
  employeeStores: EmployeeStore[]
  shifts: Shift[]
  requirements: ShiftRequirement[]
  availability: RecurringAvailability[]
}

export async function loadBoard(week: string | null = null): Promise<BoardData> {
  const [stores, employees, employeeStores, shifts, requirements, availability] = await Promise.all([
    api.getStores(),
    api.getEmployees(),
    api.getEmployeeStores(),
    api.getShifts(week ?? undefined),
    api.getShiftRequirements(),
    api.getAvailability(),
  ])
  return { week, stores, employees, employeeStores, shifts, requirements, availability }
}

/** One worker's answer to the week's availability check (GET /availability/confirmations). */
export type AvailabilityConfirmation = Awaited<ReturnType<typeof api.getAvailabilityConfirmations>>['workers'][number]

/** A worker's week on the board: days at the selected store against their
 * day cap, and minutes across every store against their hours cap. */
export interface WorkerLoad {
  id: number
  name: string
  count: number
  max: number
  minutes: number
  hourLimit: number
}

interface ViewStore {
  id: number
  name: string
  days: {
    day: DayOfWeek
    people: DayPerson[]
    gaps: GapCardData[]
    requirements: ShiftRequirement[]
  }[]
}

/** One store/day's shift rows (already resolved to a display name each) merged
 * into contiguous per-person spans — the same transformation the live board and
 * the read-only past-week board both need. Shared so a frozen snapshot renders
 * with the exact same visual logic (full-day detection, opener star, etc.) as
 * the live week, just fed from a different row source. */
export function buildDayPeople(
  rows: { id: number; employeeId: number; name: string; start: string; end: string; sectionId: number | null; section: string | null }[],
  opStart: number,
  opEnd: number,
  needsOpen: boolean,
  employeeFruit: Map<number, string | null>,
  employeeStores: EmployeeStore[],
  stores: Store[],
  storeId: number,
): DayPerson[] {
  const byEmployee = new Map<number, typeof rows>()
  for (const r of rows) {
    const list = byEmployee.get(r.employeeId) ?? []
    list.push(r)
    byEmployee.set(r.employeeId, list)
  }

  const people: DayPerson[] = []
  for (const [employeeId, empRows] of byEmployee) {
    empRows.sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    // merge back-to-back / overlapping rows into spans — unless they're on
    // different sections (Front till 1, Produce after), which stay apart
    const spans: { start: string; end: string; shiftIds: number[]; sectionId: number | null; section: string | null }[] = []
    for (const s of empRows) {
      const last = spans[spans.length - 1]
      if (last && toMinutes(s.start) <= toMinutes(last.end) && last.sectionId === s.sectionId) {
        if (toMinutes(s.end) > toMinutes(last.end)) last.end = s.end
        last.shiftIds.push(s.id)
      } else {
        spans.push({ start: s.start, end: s.end, shiftIds: [s.id], sectionId: s.sectionId, section: s.section })
      }
    }
    for (const span of spans) {
      const ss = toMinutes(span.start)
      const se = toMinutes(span.end)
      const fullDay = ss <= opStart && se >= opEnd
      const isOpener = needsOpen && ss <= opStart && effectiveCanOpen(employeeStores, stores, employeeId, storeId)
      const comesIn = ss > opStart ? to12Hour(toHHMM24(span.start)) : undefined
      const leaves = se < opEnd ? to12Hour(toHHMM24(span.end)) : undefined
      people.push({
        employeeId,
        name: empRows[0]!.name,
        avatarFruit: employeeFruit.get(employeeId) ?? null,
        shiftIds: span.shiftIds,
        start: span.start,
        end: span.end,
        sectionId: span.sectionId,
        section: span.section,
        fullDay,
        isOpener,
        note: comesIn || leaves ? { comesIn, leaves } : undefined,
      })
    }
  }
  people.sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || a.name.localeCompare(b.name))
  return people
}

/** The store's operating window (earliest start / latest end across that day's
 * requirements) and whether an opener is needed at all — used both to build the
 * live board and, best-effort, to decorate a frozen past week with the same
 * "Full Day"/opener-star cosmetics using *current* requirements (a past week's
 * actual hours aren't retained; today's are a reasonable stand-in). */
export function dayOperatingWindow(requirements: ShiftRequirement[], storeId: number, day: DayOfWeek) {
  const dayReqs = requirements
    .filter((r) => r.storeId === storeId && r.day === day)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  const opStart = dayReqs.length ? Math.min(...dayReqs.map((r) => toMinutes(r.start))) : 0
  const opEnd = dayReqs.length ? Math.max(...dayReqs.map((r) => toMinutes(r.end))) : 0
  const needsOpen = dayReqs.some((r) => r.needOpen)
  return { dayReqs, opStart, opEnd, needsOpen }
}

/** `sectionNames` = the live sections (id → name) of the stores on screen —
 * a shift on a since-deleted section shows as having none. */
export function buildView(
  { stores, employees, employeeStores, shifts, requirements }: BoardData,
  sectionNames: Map<number, string> = new Map(),
): { stores: ViewStore[]; totalShort: number } {
  const employeeName = new Map(employees.map((e) => [e.id, e.name]))
  const employeeFruit = new Map(employees.map((e) => [e.id, e.avatarFruit]))

  // gaps reflect ACTUAL current coverage, not the solver's original report
  const gapsByStoreDay =
    shifts.length > 0 ? computeGapCards(requirements, shifts, employeeStores, stores) : new Map<string, GapCardData[]>()
  let totalShort = 0
  for (const list of gapsByStoreDay.values()) for (const g of list) totalShort += g.shortBy

  const viewStores: ViewStore[] = stores.map((store) => {
    const byDay = new Map<DayOfWeek, Shift[]>()
    for (const shift of shifts) {
      if (shift.storeId !== store.id || shift.employeeId === null) continue
      const list = byDay.get(shift.day) ?? []
      list.push(shift)
      byDay.set(shift.day, list)
    }

    const days = DAYS.filter((d) => byDay.has(d) || gapsByStoreDay.has(`${store.id}:${d}`)).map((day) => {
      const { dayReqs, opStart, opEnd, needsOpen } = dayOperatingWindow(requirements, store.id, day)
      const rows = (byDay.get(day) ?? []).map((s) => ({
        id: s.id,
        employeeId: s.employeeId as number,
        name: employeeName.get(s.employeeId as number) ?? `#${s.employeeId}`,
        start: s.start,
        end: s.end,
        ...(s.sectionId != null && sectionNames.has(s.sectionId)
          ? { sectionId: s.sectionId, section: sectionNames.get(s.sectionId)! }
          : { sectionId: null, section: null }),
      }))
      const people = buildDayPeople(rows, opStart, opEnd, needsOpen, employeeFruit, employeeStores, stores, store.id)

      return { day, people, gaps: gapsByStoreDay.get(`${store.id}:${day}`) ?? [], requirements: dayReqs }
    })

    return { id: store.id, name: store.name, days }
  })

  return { stores: viewStores, totalShort }
}

/** Why someone is scheduled off their availability (see availabilityIssue). */
export interface AvailabilityIssue {
  /** approved time off that day */
  onLeave: boolean
  /** the windows they did give for that day, "HH:MM" — empty if none */
  free: { start: string; end: string }[]
}

/** Null when a scheduled stretch is on the worker's availability; otherwise why
 * not — approved time off that day, or part of it outside every window they gave
 * (`windows`: that day's, wall-clock ISO). Their standing (fixed) shifts that day
 * count as covered too: the scheduler places those regardless of availability. A
 * late start within the requirement's grace still counts as covered, same as the
 * solver. On-call workers carry no availability by design, so only time off flags
 * them. */
export function availabilityIssue(args: {
  start: string
  end: string
  graceMinutes: number
  windows: { start: string; end: string }[]
  fixed: { start: string; end: string }[]
  onLeave: boolean
  standby: boolean
}): AvailabilityIssue | null {
  const toMin = (ws: { start: string; end: string }[]) =>
    ws.map((w) => [toMinutes(w.start), toMinutes(w.end)] as const).sort((a, b) => a[0] - b[0])
  const windows = toMin(args.windows)
  const free = windows.map(([a, b]) => ({ start: minToClock(a), end: minToClock(b) }))
  if (args.onLeave) return { onLeave: true, free }
  if (args.standby) return null
  const lo = toMinutes(args.start)
  const hi = toMinutes(args.end)
  if (hi <= lo) return null // runs past midnight — availability doesn't model that
  let covered = Math.min(lo + args.graceMinutes, hi)
  for (const [a, b] of toMin([...args.windows, ...args.fixed])) if (a <= covered && b > covered) covered = b
  return covered >= hi ? null : { onLeave: false, free }
}

/** The issue as one line — the card's tooltip and the picker's subtitle. */
export function availabilityNote(issue: AvailabilityIssue, t: ReturnType<typeof useT>): string {
  if (issue.onLeave) return t('schedule.card.onLeave')
  if (issue.free.length === 0) return t('schedule.card.notFreeDay')
  const hours = issue.free.map((w) => `${to12Hour(w.start)}–${to12Hour(w.end)}`).join(', ')
  return t('schedule.card.notFreeThen', { hours })
}
