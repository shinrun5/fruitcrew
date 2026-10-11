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
  /** their own shifts that day (any store) overlapping this window — only ever
   * non-empty with `partlyBusy`; coveredWindow then stops where these start */
  alreadyWorking: { start: string; end: string }[]
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
  /** Also offer people already working part of this window (e.g. on tonight's shift
   * when this is the morning before it), for the part they're free — so someone free
   * all day can be stretched into a full day. Off where the whole window gets
   * assigned as-is (splitting a shift), since that would double-book them. */
  partlyBusy?: boolean
  /** The store's "no back-to-back" rule is on for this day: someone already working
   * here that day only shows up as a last-minute override, like the solver's rule. */
  noBackToBack?: boolean
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

    const dayShifts = shifts.filter((s) => s.employeeId === emp.id && s.day === day)
    if (args.noBackToBack && !args.ignoreAvailability && dayShifts.some((s) => s.storeId === storeId)) continue

    // the parts of the window they aren't already working, at any store
    const busy = dayShifts
      .map((s) => [toMinutes(s.start), toMinutes(s.end)] as const)
      .filter(([a, b]) => windowsOverlap(a, b, lo, hi))
    if (busy.length > 0 && !args.partlyBusy) continue
    let free: [number, number][] = [[lo, hi]]
    for (const [a, b] of busy) {
      free = free.flatMap(([f0, f1]): [number, number][] =>
        [[f0, Math.min(f1, a)] as [number, number], [Math.max(f0, b), f1] as [number, number]].filter(([x, y]) => y > x),
      )
    }
    if (free.length === 0) continue // working the whole window already
    // the stretch they'd take: the whole window, or the biggest free part of it
    const [p0, p1] = free.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x))

    const windows = availability.filter((a) => a.employeeId === emp.id && a.day === day)
    let coversPiece = false
    let coversAny = false
    let best: [number, number] | null = null
    const availWindows: { start: string; end: string }[] = []
    for (const w of windows) {
      const a = toMinutes(w.start)
      const b = toMinutes(w.end)
      availWindows.push({ start: minToClock(a), end: minToClock(b) })
      if (a <= p0 + (p0 === lo ? grace : 0) && b >= p1) coversPiece = true
      if (windowsOverlap(a, b, lo, hi)) coversAny = true
      for (const [f0, f1] of free) {
        const [o0, o1] = [Math.max(a, f0), Math.min(b, f1)]
        if (o1 > o0 && (!best || o1 - o0 > best[1] - best[0])) best = [o0, o1]
      }
    }
    availWindows.sort((x, y) => x.start.localeCompare(y.start))
    const coversFull = coversPiece && busy.length === 0
    // the normal list only offers people who can cover the WHOLE window (or, with
    // partlyBusy, all of the part they're free); someone who merely overlaps it
    // (e.g. a night-only person vs a morning shift) shows up only under "add
    // someone not free", tagged partial. On-call workers are the exception: they
    // carry no availability by design and exist to be dropped in by hand, so they
    // always show (ranked last).
    if (!coversPiece && !args.ignoreAvailability && !emp.standby) continue

    // what assigning them should clamp to: nothing if they take the whole window;
    // otherwise inside their free time, so it never runs into their own shift
    const covered: [number, number] | null = coversFull
      ? null
      : coversPiece
        ? [p0, p1]
        : (best ?? (busy.length > 0 ? [p0, p1] : null))

    // this week's load (every store) if they took this on — lets the picker flag
    // someone who'd cross their hour or day limit
    const empShifts = shifts.filter((s) => s.employeeId === emp.id)
    const currentHours = empShifts.reduce((sum, s) => sum + (toMinutes(s.end) - toMinutes(s.start)) / 60, 0)
    const addedHours = covered ? (covered[1] - covered[0]) / 60 : (hi - lo) / 60
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
      coveredWindow: covered && { start: minToClock(covered[0]), end: minToClock(covered[1]) },
      alreadyWorking: busy.map(([a, b]) => ({ start: minToClock(a), end: minToClock(b) })),
      projectedHours: currentHours + addedHours,
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
