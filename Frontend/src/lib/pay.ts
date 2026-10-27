import { useEffect, useState } from 'react'
import { api } from './api'
import { timeLang, toMinutes } from './time'
import type { DayOfWeek } from '../types'

const DAY_ORDER: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
/** Twin of Backend lib/pay.ts: past 40 hours in a week, time and a half. */
const OVERTIME_AFTER = 40 * 60
const OVERTIME_RATE = 1.5

export interface PayInfo {
  /** owners; managers too when the owner allows it */
  canSee: boolean
  /** employeeId → cents an hour, for those with a rate */
  rates: Map<number, number>
  reload: () => void
}

/** Pay rates for the people at your stores — nothing at all for anyone who can't see pay. */
export function usePay(): PayInfo {
  const [state, setState] = useState<{ canSee: boolean; rates: Map<number, number> }>({ canSee: false, rates: new Map() })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    api
      .getPay()
      .then((p) => live && setState({ canSee: p.canSee, rates: new Map(Object.entries(p.rates).map(([k, v]) => [Number(k), v])) }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [tick])
  return { ...state, reload: () => setTick((n) => n + 1) }
}

/** What each shift costs: each person's week walked in order (any store), so
 * the hours past 40 — at 1.5× — land on the shifts where they actually fall.
 * Shifts of people with no rate are left out. */
export function shiftCosts(
  shifts: { id: number; employeeId: number | null; day: DayOfWeek; start: string; end: string }[],
  rates: Map<number, number>,
): Map<number, number> {
  const out = new Map<number, number>()
  const byPerson = new Map<number, typeof shifts>()
  for (const s of shifts) {
    if (s.employeeId === null || !rates.has(s.employeeId)) continue
    byPerson.set(s.employeeId, [...(byPerson.get(s.employeeId) ?? []), s])
  }
  for (const [id, list] of byPerson) {
    const rate = rates.get(id)!
    list.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || toMinutes(a.start) - toMinutes(b.start))
    let worked = 0
    for (const s of list) {
      const m = toMinutes(s.end) - toMinutes(s.start)
      const regular = Math.max(0, Math.min(m, OVERTIME_AFTER - worked))
      out.set(s.id, Math.round(((regular + (m - regular) * OVERTIME_RATE) / 60) * rate))
      worked += m
    }
  }
  return out
}

/** "$1,234" for a total, "$16.50" for a rate (`cents: true`). */
export function money(cents: number, opts: { cents?: boolean } = {}): string {
  const locale = { en: 'en-US', zh: 'zh-CN', es: 'es-US' }[timeLang()]
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(cents / 100)
}
