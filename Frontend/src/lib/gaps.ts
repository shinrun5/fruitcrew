import type { EmployeeStore, Shift, ShiftRequirement, Store } from '../types'
import { effectiveCanOpen } from './openers'
import { toMinutes } from './time'

export interface GapCardData {
  requirementId: number
  start: string // ISO — the actually-uncovered sub-window (head) or the full window (senior/opener)
  end: string
  label: 'COVERAGE GAP'
  detail: string
  shortBy: number
}

const phrase = (n: number, noun: string) => {
  const plural = noun === 'person' ? 'people' : `${noun}s`
  return `${n} more ${n === 1 ? noun : plural} needed`
}

/**
 * Work out what a requirement is *actually* still missing, given the current shifts
 * (which may include manual fills or splits the solver never saw). Derived from real
 * coverage, not from the solver's original gap report.
 */
export function remainingGaps(
  req: ShiftRequirement,
  shifts: Shift[],
  employeeStores: EmployeeStore[],
  stores: Store[],
): GapCardData[] {
  const R0 = toMinutes(req.start)
  const R1 = toMinutes(req.end)
  const head = req.managerRequired + req.seniorRequired + req.regularRequired + req.newRequired
  const seniorMin = req.managerRequired + req.seniorRequired

  const seniorTierAt = (eid: number) => {
    const link = employeeStores.find((es) => es.employeeId === eid && es.storeId === req.storeId)
    return link?.proficiency === 'SENIOR' || link?.proficiency === 'MANAGER'
  }

  const slotShifts = shifts.filter(
    (s) =>
      s.storeId === req.storeId &&
      s.day === req.day &&
      s.employeeId !== null &&
      toMinutes(s.start) < R1 &&
      toMinutes(s.end) > R0,
  )

  // --- head: sweep the window for stretches where too few people are present ---
  // A shift that starts within the requirement's own grace period ("late ok")
  // counts as present from the window's start — that's the whole point of grace,
  // e.g. someone coming in at 5:40 for a 5:00 night shift with 60m grace. Treat
  // it that way here too, or the sliver before their real start reads as a gap
  // that was never actually a shortfall.
  const graceEnd = R0 + req.graceMinutes
  const effStart = (s: Shift) => {
    const start = toMinutes(s.start)
    return start > R0 && start <= graceEnd ? R0 : start
  }
  const ticks = new Set<number>([R0, R1])
  for (const s of slotShifts) {
    const a = Math.max(R0, effStart(s))
    const b = Math.min(R1, toMinutes(s.end))
    if (a > R0) ticks.add(a)
    if (b < R1) ticks.add(b)
  }
  const sorted = [...ticks].sort((x, y) => x - y)
  const uncovered: { from: number; to: number; shortBy: number }[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i]!
    const t1 = sorted[i + 1]!
    const present = slotShifts.filter((s) => effStart(s) <= t0 && toMinutes(s.end) >= t1).length
    if (present >= head) continue
    const short = head - present
    const last = uncovered[uncovered.length - 1]
    if (last && last.to === t0) {
      last.to = t1
      last.shortBy = Math.max(last.shortBy, short)
    } else {
      uncovered.push({ from: t0, to: t1, shortBy: short })
    }
  }

  // --- senior / opener: whole-window "is there at least one such person" checks ---
  const distinct = [...new Set(slotShifts.map((s) => s.employeeId as number))]
  const seniorShort = seniorMin > 0 ? Math.max(0, seniorMin - distinct.filter(seniorTierAt).length) : 0
  const openerShort =
    req.needOpen && !distinct.some((eid) => effectiveCanOpen(employeeStores, stores, eid, req.storeId)) ? 1 : 0

  const minToIso = (m: number) => {
    const d = new Date(req.start)
    d.setUTCHours(Math.floor(m / 60), m % 60, 0, 0)
    return d.toISOString()
  }

  const fullWindowUncovered = uncovered.length === 1 && uncovered[0]!.from === R0 && uncovered[0]!.to === R1
  const cards: GapCardData[] = []

  if (fullWindowUncovered) {
    const u = uncovered[0]!
    const parts = [phrase(u.shortBy, 'person')]
    if (seniorShort) parts.push(phrase(seniorShort, 'senior'))
    if (openerShort) parts.push(phrase(openerShort, 'opener'))
    cards.push({
      requirementId: req.id,
      start: req.start,
      end: req.end,
      label: 'COVERAGE GAP',
      detail: parts.join('; '),
      shortBy: u.shortBy + seniorShort + openerShort,
    })
    return cards
  }

  for (const u of uncovered) {
    cards.push({
      requirementId: req.id,
      start: minToIso(u.from),
      end: minToIso(u.to),
      label: 'COVERAGE GAP',
      detail: phrase(u.shortBy, 'person'),
      shortBy: u.shortBy,
    })
  }
  if (seniorShort || openerShort) {
    const parts: string[] = []
    if (seniorShort) parts.push(phrase(seniorShort, 'senior'))
    if (openerShort) parts.push(phrase(openerShort, 'opener'))
    cards.push({
      requirementId: req.id,
      start: req.start,
      end: req.end,
      label: 'COVERAGE GAP',
      detail: parts.join('; '),
      shortBy: seniorShort + openerShort,
    })
  }
  return cards
}

/** All still-open gaps across every requirement, grouped by `${storeId}:${day}`. */
export function computeGapCards(
  requirements: ShiftRequirement[],
  shifts: Shift[],
  employeeStores: EmployeeStore[],
  stores: Store[],
): Map<string, GapCardData[]> {
  const byStoreDay = new Map<string, GapCardData[]>()
  for (const req of requirements) {
    const cards = remainingGaps(req, shifts, employeeStores, stores)
    if (cards.length === 0) continue
    const key = `${req.storeId}:${req.day}`
    byStoreDay.set(key, [...(byStoreDay.get(key) ?? []), ...cards])
  }
  return byStoreDay
}
