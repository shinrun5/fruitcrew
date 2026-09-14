import type { DayOfWeek, Employee, EmployeeStore, RecurringAvailability, Shift, Tier } from '../types'
import { minToClock, toMinutes, windowsOverlap } from './time'

// Same idea as scheduler_real.py's escalation_candidates(): who could plausibly
// cover this window, ranked drop-ins (full coverage) before partial ones.
const TIER_RANK: Record<Tier, number> = { NEW: 0, REGULAR: 1, SENIOR: 2, MANAGER: 3 }

export interface Candidate {
  employeeId: number
  name: string
  avatarFruit: string | null
  tier: Tier
  canOpen: boolean
  coversFull: boolean
  standby: boolean
  /** false = no stated availability overlapping this window (only surfaced in override mode) */
  available: boolean
  /** their stated availability windows for this day, "HH:MM" 24h, sorted */
  availWindows: { start: string; end: string }[]
  /** when they DON'T cover the whole window: the slice of it they can actually work
   * (their best-overlapping availability window ∩ the shift window). null if they
   * cover it fully or not at all. Assigning them should clamp to this. */
  coveredWindow: { start: string; end: string } | null
  /** their total scheduled hours this week (every store), if given this whole window */
  projectedHours: number
  hourLimit: number
  /** their distinct scheduled days this week (every store), if given this one */
  projectedDays: number
  maxShifts: number
}

export function computeCandidates(args: {
  storeId: number
  day: DayOfWeek
  start: string
  end: string
  /** Already in this slot (or the person being replaced) — never offered as an alternate. */
  excludeEmployeeIds: Set<number>
  employees: Employee[]
  employeeStores: EmployeeStore[]
  availability: RecurringAvailability[]
  shifts: Shift[]
  /** This window's only opener is being removed and nobody else staying behind can
   * open -- restrict candidates to people who (effectively) can. */
  requireOpener?: boolean
  /** Needed to interpret requireOpener correctly: if the store doesn't gate opening
   * at all, everyone qualifies regardless of their personal canOpen flag. */
  storeRequiresOpenerSkill?: boolean
  /** Availability may begin this many minutes after `start` and still fully cover
   * (matches the requirement's grace; night shifts allow a late arrival). */
  graceMinutes?: number
  /** Last-minute override: include people whose stated availability doesn't cover this
   * window (still excludes double-booked). Their `available` flag is false. */
  ignoreAvailability?: boolean
}): Candidate[] {
  const { storeId, day, start, end, excludeEmployeeIds, employees, employeeStores, availability, shifts } = args
  const grace = args.graceMinutes ?? 0
  const lo = toMinutes(start)
  const hi = toMinutes(end)

  const linkByEmployee = new Map(
    employeeStores.filter((es) => es.storeId === storeId).map((es) => [es.employeeId, es]),
  )

  const out: Candidate[] = []
  for (const emp of employees) {
    if (excludeEmployeeIds.has(emp.id)) continue
    const link = linkByEmployee.get(emp.id)
    if (!link) continue // not eligible at this store at all
    if (args.requireOpener && !(link.canOpen || !args.storeRequiresOpenerSkill)) continue

    const windows = availability.filter((a) => a.employeeId === emp.id && a.day === day)
    let coversFull = false
    let coversAny = false
    let bestOverlap = 0
    let coveredWindow: { start: string; end: string } | null = null
    const availWindows: { start: string; end: string }[] = []
    for (const w of windows) {
      const a = toMinutes(w.start)
      const b = toMinutes(w.end)
      availWindows.push({ start: minToClock(a), end: minToClock(b) })
      if (a <= lo + grace && b >= hi) coversFull = true
      if (windowsOverlap(a, b, lo, hi)) {
        coversAny = true
        const ov = Math.min(b, hi) - Math.max(a, lo)
        if (ov > bestOverlap) {
          bestOverlap = ov
          coveredWindow = { start: minToClock(Math.max(a, lo)), end: minToClock(Math.min(b, hi)) }
        }
      }
    }
    availWindows.sort((x, y) => x.start.localeCompare(y.start))
    // the normal list only offers people who can cover the WHOLE window; someone who
    // merely overlaps it (e.g. a night-only person vs a morning shift) shows up only
    // under "add someone not free", tagged partial. On-call workers are the exception:
    // they carry no availability by design and exist to be dropped in by hand, so they
    // always show (ranked last).
    if (!coversFull && !args.ignoreAvailability && !emp.standby) continue

    // already committed to an overlapping shift elsewhere (or here) that day?
    const busy = shifts.some(
      (s) => s.employeeId === emp.id && s.day === day && windowsOverlap(toMinutes(s.start), toMinutes(s.end), lo, hi),
    )
    if (busy) continue

    // this week's load (every store) if they took the whole requested window —
    // lets the picker flag someone who'd cross their hour or day limit
    const empShifts = shifts.filter((s) => s.employeeId === emp.id)
    const currentHours = empShifts.reduce((sum, s) => sum + (toMinutes(s.end) - toMinutes(s.start)) / 60, 0)
    const daysWorked = new Set(empShifts.map((s) => s.day))
    daysWorked.add(day)

    out.push({
      employeeId: emp.id,
      name: emp.name,
      avatarFruit: emp.avatarFruit,
      tier: link.proficiency,
      canOpen: link.canOpen,
      coversFull,
      standby: emp.standby,
      available: coversAny,
      availWindows,
      coveredWindow: coversFull ? null : coveredWindow,
      projectedHours: currentHours + (hi - lo) / 60,
      hourLimit: emp.hourLimit,
      projectedDays: daysWorked.size,
      maxShifts: emp.maxShifts,
    })
  }

  // available first, then on-call last; full coverage before partial; senior first
  out.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      Number(a.standby) - Number(b.standby) ||
      Number(b.coversFull) - Number(a.coversFull) ||
      TIER_RANK[b.tier] - TIER_RANK[a.tier],
  )
  return out
}
