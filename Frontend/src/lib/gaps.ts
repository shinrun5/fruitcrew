import type { EmployeeStore, Shift, ShiftRequirement, Store } from '../types'
import { effectiveCanOpen } from './openers'
import { timeLang, toMinutes } from './time'

export interface GapCardData {
  requirementId: number
  start: string // ISO — the actually-uncovered sub-window (head) or the full window (senior/opener)
  end: string
  label: 'COVERAGE GAP'
  detail: string
  shortBy: number
}

// Card text, in the app's current language. Built here rather than through
// useT() since the cards are computed outside React; the board rebuilds them
// on every render, so a language switch shows up straight away.
type Noun = 'person' | 'senior' | 'opener'
const SHORT: Record<'en' | 'zh' | 'es', (n: number, noun: Noun) => string> = {
  en: (n, noun) => `${n} more ${n === 1 ? noun : noun === 'person' ? 'people' : `${noun}s`} needed`,
  zh: (n, noun) => `还需 ${n} ${{ person: '人', senior: '名资深员工', opener: '名会开店的人' }[noun]}`,
  es: (n, noun) =>
    `${n === 1 ? 'Falta' : 'Faltan'} ${n} ${
      { person: n === 1 ? 'persona' : 'personas', senior: n === 1 ? 'Senior' : 'Seniors', opener: n === 1 ? 'persona que abra' : 'personas que abran' }[noun]
    }`,
}
const phrase = (n: number, noun: Noun) => SHORT[timeLang()](n, noun)

/** What whoever fills a headcount gap must also be — "… — must be a senior". */
function mustBe(seniorShort: number, openerShort: number): string {
  const lang = timeLang()
  const one = seniorShort === 1
  if (lang === 'zh') {
    if (seniorShort && openerShort) return one ? '需为会开店的资深员工' : `需有 ${seniorShort} 名资深员工，其中一人会开店`
    if (seniorShort) return one ? '需为资深员工' : `需有 ${seniorShort} 名资深员工`
    return '需会开店'
  }
  if (lang === 'es') {
    if (seniorShort && openerShort) return one ? 'debe ser Senior y poder abrir' : `deben ser ${seniorShort} Seniors, una que pueda abrir`
    if (seniorShort) return one ? 'debe ser Senior' : `deben ser ${seniorShort} Seniors`
    return 'debe poder abrir'
  }
  if (seniorShort && openerShort) return one ? 'must be a senior who can open' : `must be ${seniorShort} seniors, one who can open`
  if (seniorShort) return one ? 'must be a senior' : `must be ${seniorShort} seniors`
  return 'must be able to open'
}

/**
 * Head-count gaps for a whole store/day at once, not one requirement at a time.
 * Overlapping requirements are separate staffing needs that ADD UP — a 4pm
 * requirement for 1 and a 5pm requirement for 1 mean 2 distinct people from
 * 5 on, not "the bigger one covers the smaller." Checking requirements one at
 * a time let the same shift quietly double as "coverage" for two different
 * requirements it overlapped, hiding a real shortfall (see /loop bug report:
 * Mango Livingston Friday nights). Senior-minimum and opener checks stay
 * per-requirement below — those are "at least one such person" checks, not
 * headcounts, so they don't have the same double-counting problem.
 */
function headGapsForGroup(
  reqs: ShiftRequirement[],
  slotShifts: Shift[],
): { from: number; to: number; shortBy: number }[] {
  const bounds = reqs.map((r) => ({
    r0: toMinutes(r.start),
    r1: toMinutes(r.end),
    head: r.managerRequired + r.seniorRequired + r.regularRequired + r.newRequired,
    grace: r.graceMinutes,
  }))

  const ticks = new Set<number>()
  for (const b of bounds) {
    ticks.add(b.r0)
    ticks.add(b.r1)
  }
  for (const s of slotShifts) {
    ticks.add(toMinutes(s.start))
    ticks.add(toMinutes(s.end))
  }
  const sorted = [...ticks].sort((a, b) => a - b)

  const uncovered: { from: number; to: number; shortBy: number }[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i]!
    const t1 = sorted[i + 1]!

    const covering = bounds.filter((b) => b.r0 <= t0 && b.r1 >= t1)
    const required = covering.reduce((sum, b) => sum + b.head, 0)
    if (required === 0) continue

    // a shift counts as present for this slice if it spans it outright, or — for
    // whichever covering requirement grants it — starts late but within that
    // requirement's own grace period (the requirement's start substitutes for
    // the shift's real one, same as a single-requirement check would allow)
    const presentIds = new Set<number>()
    for (const s of slotShifts) {
      const sStart = toMinutes(s.start)
      const sEnd = toMinutes(s.end)
      if (sEnd < t1) continue
      const graced = covering.some((b) => sStart > b.r0 && sStart <= b.r0 + b.grace)
      const effStart = graced ? Math.min(sStart, t0) : sStart
      if (effStart <= t0) presentIds.add(s.employeeId as number)
    }

    const present = presentIds.size
    if (present >= required) continue
    const shortBy = required - present
    const last = uncovered[uncovered.length - 1]
    if (last && last.to === t0) {
      last.to = t1
      last.shortBy = Math.max(last.shortBy, shortBy)
    } else {
      uncovered.push({ from: t0, to: t1, shortBy })
    }
  }
  return uncovered
}

/** Senior-minimum / opener shortfall for one requirement — "at least one such
 * person during this specific window", checked independently per requirement. */
function qualitativeShort(
  req: ShiftRequirement,
  shifts: Shift[],
  employeeStores: EmployeeStore[],
  stores: Store[],
): { seniorShort: number; openerShort: number } | null {
  const R0 = toMinutes(req.start)
  const R1 = toMinutes(req.end)
  const seniorMin = req.managerRequired + req.seniorRequired
  if (seniorMin === 0 && !req.needOpen) return null

  const slotShifts = shifts.filter(
    (s) =>
      s.storeId === req.storeId &&
      s.day === req.day &&
      s.employeeId !== null &&
      toMinutes(s.start) < R1 &&
      toMinutes(s.end) > R0,
  )
  const distinct = [...new Set(slotShifts.map((s) => s.employeeId as number))]

  const seniorTierAt = (eid: number) => {
    const link = employeeStores.find((es) => es.employeeId === eid && es.storeId === req.storeId)
    return link?.proficiency === 'SENIOR' || link?.proficiency === 'MANAGER'
  }
  const seniorShort = seniorMin > 0 ? Math.max(0, seniorMin - distinct.filter(seniorTierAt).length) : 0
  const openerShort =
    req.needOpen && !distinct.some((eid) => effectiveCanOpen(employeeStores, stores, eid, req.storeId)) ? 1 : 0
  if (!seniorShort && !openerShort) return null
  return { seniorShort, openerShort }
}

/** All still-open gaps across every requirement, grouped by `${storeId}:${day}`.
 * A missing senior/opener isn't an extra person on top of a headcount gap in
 * the same window — whoever fills that gap can be the senior/opener — so it
 * only adds to shortBy beyond that gap, and when the gap absorbs it entirely
 * it's folded into the gap's own card ("… — must be a senior") instead.
 * Likewise one senior who can open covers both needs at once. */
export function computeGapCards(
  requirements: ShiftRequirement[],
  shifts: Shift[],
  employeeStores: EmployeeStore[],
  stores: Store[],
): Map<string, GapCardData[]> {
  const byStoreDay = new Map<string, GapCardData[]>()
  const groups = new Map<string, ShiftRequirement[]>()
  for (const req of requirements) {
    const key = `${req.storeId}:${req.day}`
    groups.set(key, [...(groups.get(key) ?? []), req])
  }

  const minToIso = (base: string, m: number) => {
    const d = new Date(base)
    d.setUTCHours(Math.floor(m / 60), m % 60, 0, 0)
    return d.toISOString()
  }

  for (const [key, reqs] of groups) {
    const slotShifts = shifts.filter(
      (s) => s.storeId === reqs[0]!.storeId && s.day === reqs[0]!.day && s.employeeId !== null,
    )

    const sortedReqs = [...reqs].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    const heads = headGapsForGroup(reqs, slotShifts).map((u) => {
      // whichever requirement this sub-window falls inside names the card (for
      // display/keying only — filling a gap doesn't act on a specific requirement)
      const owner = sortedReqs.find((r) => toMinutes(r.start) <= u.from && toMinutes(r.end) >= u.to) ?? sortedReqs[0]!
      return {
        ...u,
        musts: [] as string[],
        card: {
          requirementId: owner.id,
          start: minToIso(owner.start, u.from),
          end: minToIso(owner.start, u.to),
          label: 'COVERAGE GAP' as const,
          detail: phrase(u.shortBy, 'person'),
          shortBy: u.shortBy,
        },
      }
    })

    const qualCards: GapCardData[] = []
    for (const req of reqs) {
      const q = qualitativeShort(req, shifts, employeeStores, stores)
      if (!q) continue
      const R0 = toMinutes(req.start)
      const R1 = toMinutes(req.end)
      const overlapping = heads.filter((h) => h.from < R1 && h.to > R0)
      const headInWindow = Math.max(0, ...overlapping.map((h) => h.shortBy))
      const extra = Math.max(0, Math.max(q.seniorShort, q.openerShort) - headInWindow)

      if (extra === 0) {
        for (const h of overlapping) h.musts.push(mustBe(q.seniorShort, q.openerShort))
        continue
      }
      const parts: string[] = []
      if (q.seniorShort) parts.push(phrase(q.seniorShort, 'senior'))
      if (q.openerShort) parts.push(phrase(q.openerShort, 'opener'))
      qualCards.push({
        requirementId: req.id,
        start: req.start,
        end: req.end,
        label: 'COVERAGE GAP',
        detail: parts.join(timeLang() === 'zh' ? '；' : '; '),
        shortBy: extra,
      })
    }

    const cards = [
      ...heads.map((h) =>
        h.musts.length
          ? { ...h.card, detail: `${h.card.detail} — ${[...new Set(h.musts)].join(timeLang() === 'zh' ? '；' : '; ')}` }
          : h.card,
      ),
      ...qualCards,
    ]
    if (cards.length) byStoreDay.set(key, cards)
  }
  return byStoreDay
}
