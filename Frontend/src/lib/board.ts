import { api } from './api'
import { computeGapCards, type GapCardData } from './gaps'
import { effectiveCanOpen } from './openers'
import { DAYS, to12Hour, toHHMM24, toMinutes } from './time'
import type { DayPerson } from '../components/ScheduleCards'
import type { DayOfWeek, Employee, EmployeeStore, RecurringAvailability, Shift, ShiftRequirement, Store } from '../types'

// The manager's schedule board (pages/Dashboard.tsx): loading it, and turning
// shift rows into the per-store, per-day cards it draws.

export interface BoardData {
  stores: Store[]
  employees: Employee[]
  employeeStores: EmployeeStore[]
  shifts: Shift[]
  requirements: ShiftRequirement[]
  availability: RecurringAvailability[]
}

export async function loadBoard(): Promise<BoardData> {
  const [stores, employees, employeeStores, shifts, requirements, availability] = await Promise.all([
    api.getStores(),
    api.getEmployees(),
    api.getEmployeeStores(),
    api.getShifts(),
    api.getShiftRequirements(),
    api.getAvailability(),
  ])
  return { stores, employees, employeeStores, shifts, requirements, availability }
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
  accentClass: string
  days: {
    day: DayOfWeek
    people: DayPerson[]
    gaps: GapCardData[]
    requirements: ShiftRequirement[]
  }[]
}

const ACCENT_CLASSES = ['bg-green', 'bg-sky', 'bg-grape', 'bg-orange'] as const

/** One store/day's shift rows (already resolved to a display name each) merged
 * into contiguous per-person spans — the same transformation the live board and
 * the read-only past-week board both need. Shared so a frozen snapshot renders
 * with the exact same visual logic (full-day detection, opener star, etc.) as
 * the live week, just fed from a different row source. */
export function buildDayPeople(
  rows: { id: number; employeeId: number; name: string; start: string; end: string }[],
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
    // merge back-to-back / overlapping rows into spans
    const spans: { start: string; end: string; shiftIds: number[] }[] = []
    for (const s of empRows) {
      const last = spans[spans.length - 1]
      if (last && toMinutes(s.start) <= toMinutes(last.end)) {
        if (toMinutes(s.end) > toMinutes(last.end)) last.end = s.end
        last.shiftIds.push(s.id)
      } else {
        spans.push({ start: s.start, end: s.end, shiftIds: [s.id] })
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

export function buildView({
  stores,
  employees,
  employeeStores,
  shifts,
  requirements,
}: BoardData): { stores: ViewStore[]; totalShort: number } {
  const employeeName = new Map(employees.map((e) => [e.id, e.name]))
  const employeeFruit = new Map(employees.map((e) => [e.id, e.avatarFruit]))

  // gaps reflect ACTUAL current coverage, not the solver's original report
  const gapsByStoreDay =
    shifts.length > 0 ? computeGapCards(requirements, shifts, employeeStores, stores) : new Map<string, GapCardData[]>()
  let totalShort = 0
  for (const list of gapsByStoreDay.values()) for (const g of list) totalShort += g.shortBy

  const viewStores: ViewStore[] = stores.map((store, i) => {
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
      }))
      const people = buildDayPeople(rows, opStart, opEnd, needsOpen, employeeFruit, employeeStores, stores, store.id)

      return { day, people, gaps: gapsByStoreDay.get(`${store.id}:${day}`) ?? [], requirements: dayReqs }
    })

    return { id: store.id, name: store.name, accentClass: ACCENT_CLASSES[i % ACCENT_CLASSES.length], days }
  })

  return { stores: viewStores, totalShort }
}
