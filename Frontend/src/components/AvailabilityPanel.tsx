import { useCallback, useEffect, useState } from 'react'
import { AvailabilityEditor, type AvailWindow } from './AvailabilityEditor'
import { Button } from './Button'
import { SelectField } from './Field'
import type { DayHours, DayOfWeek } from '../types'
import { TimeOffPanel } from './TimeOffPanel'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { shiftWeekYMD, thisMondayYMD, toHHMM24, weekRangeLabel } from '../lib/time'

const norm = (ws: { day: AvailWindow['day']; start: string; end: string }[]): AvailWindow[] =>
  ws.map((w) => ({ day: w.day, start: toHHMM24(w.start), end: toHHMM24(w.end) }))

const WEEKS = [0, 1, 2, 3, 4].map((n) => ({
  n,
  ymd: shiftWeekYMD(`${thisMondayYMD()}T00:00:00.000Z`, n),
}))

interface PendingWeek {
  weekStart: string
  stores: string[]
  confirmed: boolean
}

/** The availability screen: your standing weekly hours, or a one-week override.
 * `barClass` is passed straight through to the editor's sticky save bar. */
export function AvailabilityPanel({ barClass }: { barClass: string }) {
  const t = useT()
  const weekLabel = (n: number, ymd: string) => {
    const head = n === 0 ? t('avail.thisWeek') : n === 1 ? t('avail.nextWeek') : t('avail.inNWeeks', { n })
    return `${head} — ${weekRangeLabel(`${ymd}T00:00:00.000Z`)}`
  }
  const [mode, setMode] = useState<'standing' | 'week' | 'timeoff'>('standing')
  const [week, setWeek] = useState(WEEKS[0].ymd)
  const [hasOverride, setHasOverride] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)

  // The week(s) currently "on the board" across the stores you work — usually
  // one, but a worker at two stores whose schedules aren't on the same week
  // (one advanced, one hasn't) gets a banner per week instead of one guess.
  const [pending, setPending] = useState<PendingWeek[] | null>(null)
  const refreshPending = useCallback(() => {
    api
      .getMyPendingWeeks()
      .then((r) => setPending(r.weeks))
      .catch(() => setPending([]))
  }, [])
  useEffect(() => {
    refreshPending()
  }, [refreshPending])

  async function confirmPendingWeek(weekStart: string) {
    setBusy(true)
    try {
      await api.confirmMyWeekAvailability(weekStart)
      setPending((cur) => cur?.map((w) => (w.weekStart === weekStart ? { ...w, confirmed: true } : w)) ?? cur)
      if (week === weekStart) setConfirmed(true)
    } finally {
      setBusy(false)
    }
  }

  // store hours per weekday — drives the editor's quick-add buttons
  const [hoursByDay, setHoursByDay] = useState<Record<DayOfWeek, DayHours>>()

  useEffect(() => {
    let live = true
    api
      .getMyStoreHours()
      .then((h) => live && setHoursByDay(h.byDay))
      .catch(() => {}) // fall back to the editor's built-in defaults
    return () => {
      live = false
    }
  }, [])

  const standingLoad = useCallback(() => api.getMyAvailability().then(norm), [])
  const standingSave = useCallback((w: AvailWindow[]) => api.saveMyAvailability(w).then(norm), [])

  const weekLoad = useCallback(
    () =>
      api.getMyWeekAvailability(week).then((r) => {
        setHasOverride(r.hasOverride)
        setConfirmed(r.confirmed)
        return r.windows
      }),
    [week],
  )
  const weekSave = useCallback(
    (w: AvailWindow[]) =>
      api.saveMyWeekAvailability(week, w).then((r) => {
        setHasOverride(true)
        setConfirmed(true)
        refreshPending()
        return r.windows
      }),
    [week, refreshPending],
  )

  async function confirmWeek() {
    setBusy(true)
    try {
      await api.confirmMyWeekAvailability(week)
      setConfirmed(true)
      refreshPending()
    } finally {
      setBusy(false)
    }
  }

  async function clearOverride() {
    setBusy(true)
    try {
      await api.clearMyWeekAvailability(week)
      setHasOverride(false)
      setReload((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const tab = (active: boolean) =>
    `rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold ${
      active ? 'bg-ink text-white' : 'bg-paper text-ink'
    }`

  return (
    <div className="flex flex-col gap-3">
      {pending && pending.length > 0 && (
        <div className="flex flex-col gap-2">
          {pending.map((w) => {
            const range = weekRangeLabel(`${w.weekStart}T00:00:00.000Z`)
            return (
              <div
                key={w.weekStart}
                className={`rounded-xl border-2 px-3 py-2.5 ${
                  w.confirmed ? 'border-green bg-green/10' : 'border-ink bg-paper'
                }`}
              >
                {w.confirmed ? (
                  <p className="font-body text-xs font-bold text-green-dark">
                    {t('avail.next.confirmed', { range })}
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-body text-xs text-ink">{t('avail.next.prompt', { range })}</span>
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => void confirmPendingWeek(w.weekStart)}
                    >
                      {t('avail.next.confirmBtn')}
                    </Button>
                  </div>
                )}
                {pending.length > 1 && (
                  <p className="mt-0.5 font-body text-[10px] text-muted-ink">{w.stores.join(', ')}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        <button className={`shrink-0 ${tab(mode === 'standing')}`} onClick={() => setMode('standing')}>
          {t('avail.tab.every')}
        </button>
        <button className={`shrink-0 ${tab(mode === 'week')}`} onClick={() => setMode('week')}>
          {t('avail.tab.week')}
        </button>
        <button className={`shrink-0 ${tab(mode === 'timeoff')}`} onClick={() => setMode('timeoff')}>
          {t('avail.tab.timeoff')}
        </button>
      </div>

      {mode === 'week' && (
        <div className="flex flex-col gap-1.5">
          <SelectField
            value={week}
            onChange={(e) => setWeek(e.target.value)}
            className="font-bold"
          >
            {WEEKS.map((w) => (
              <option key={w.ymd} value={w.ymd}>
                {weekLabel(w.n, w.ymd)}
              </option>
            ))}
          </SelectField>
          <p className="font-body text-xs text-muted-ink">
            {hasOverride ? t('avail.week.hasOverride') : t('avail.week.fromStanding')}
          </p>
          {hasOverride && (
            <button
              onClick={() => void clearOverride()}
              disabled={busy}
              className="self-start font-body text-xs font-bold text-coral-dark underline"
            >
              {t('avail.week.removeOverride')}
            </button>
          )}
          {!hasOverride &&
            (confirmed ? (
              <p className="font-body text-xs font-bold text-green-dark">
                {t('avail.week.confirmed')}
              </p>
            ) : (
              <Button size="sm" className="self-start" disabled={busy} onClick={() => void confirmWeek()}>
                {t('avail.week.confirmBtn')}
              </Button>
            ))}
        </div>
      )}

      {mode === 'timeoff' ? (
        <TimeOffPanel />
      ) : mode === 'standing' ? (
        <AvailabilityEditor
          key="standing"
          barClass={barClass}
          load={standingLoad}
          save={standingSave}
          idleText={t('avail.idle.every')}
          hoursByDay={hoursByDay}
        />
      ) : (
        <AvailabilityEditor
          key={`week-${week}-${reload}`}
          barClass={barClass}
          load={weekLoad}
          save={weekSave}
          idleText={hasOverride ? t('avail.idle.weekSaved') : t('avail.idle.weekCopy')}
          hoursByDay={hoursByDay}
        />
      )}
    </div>
  )
}
