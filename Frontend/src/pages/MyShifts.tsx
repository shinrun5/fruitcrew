import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card, EmptyState } from '../components/Card'
import { CalendarSync } from '../components/CalendarSync'
import { ClockCard } from '../components/ClockCard'
import { CalendarIcon } from '../components/icons'
import { FruitAvatar } from '../components/FruitAvatar'
import { api } from '../lib/api'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import {
  DAY_LABEL,
  DAYS,
  dayDate,
  localMondayYMD,
  relativeTime,
  shiftWeekYMD,
  timeRange,
  to12Hour,
  toHHMM24,
  toMinutes,
  weekRangeLabel,
  durationLabel,
} from '../lib/time'
import type {
  ChangeRequest,
  MyShift,
  MyShiftsResponse,
  MyShiftsWeek,
  Shift,
  ShiftCoworker,
  TeamShift,
  Store,
} from '../types'

const STATUS_STYLE: Record<ChangeRequest['status'], string> = {
  PENDING: 'border-orange bg-orange/10 text-ink',
  APPROVED: 'border-green bg-green/10 text-green',
  DENIED: 'border-coral bg-coral-bg text-coral-dark',
  CANCELLED: 'border-ink/25 text-muted-ink',
}

const calendarIcon = (
  <span className="text-muted-ink">
    <CalendarIcon size={30} />
  </span>
)

export function MyShifts() {
  const t = useT()
  const [data, setData] = useState<MyShiftsResponse | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [openShifts, setOpenShifts] = useState<Shift[]>([])
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [periodMinutes, setPeriodMinutes] = useState<number | null>(null)
  const [onCall, setOnCall] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [view, setView] = useState<'mine' | 'team'>('mine')

  const refresh = useCallback(
    () =>
      Promise.all([
        api.getMyShifts(),
        api.getStores(),
        api.getOpenShifts().catch(() => [] as Shift[]),
        api.getMyChangeRequests().catch(() => [] as ChangeRequest[]),
      ]).then(([d, s, o, r]) => {
        setData(d)
        setStores(s)
        setOpenShifts(o)
        setRequests(r)
      }),
    [],
  )

  // pay-period hours come from the profile endpoint, which does the heavier
  // multi-week aggregation — fetched once rather than on every 30s poll
  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        setPeriodMinutes(p.employee?.periodStart ? p.employee.minutesThisPeriod : null)
        setOnCall(!!p.employee?.standby)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : 'Could not load your shifts'))
    // the fetch above only happens once on mount — without this, a manager's
    // edit or repost after that never shows up until the employee happens to
    // navigate away and back, so poll slowly and re-check on tab focus too
    const check = () => {
      if (document.visibilityState === 'visible') refresh().catch(() => {})
    }
    const h = setInterval(check, 30_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(h)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [refresh])

  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? `Store ${id}`
  const pendingFor = (shiftId: number) =>
    requests.find((r) => r.shift.id === shiftId && r.status === 'PENDING')

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      setExpanded(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  if (error && !data) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!data) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  if (!data.published) {
    return (
      <>
        <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-heading text-lg font-bold text-ink">{t('myshifts.title')}</h1>
            <CalendarSync />
          </div>
          <ClockCard />
          <EmptyState
            className="mt-8"
            icon={calendarIcon}
            title={t('myshifts.nothingPosted.title')}
            body={t('myshifts.nothingPosted.body')}
          />
        </div>
      </>
    )
  }

  // every week that's on people's phones, in order: the rest of this one (once
  // next week is posted), any in between, then the posted week. A live one
  // takes swaps, drops and pickups — including this Sunday after next week
  // is up; an archived copy is read-only.
  const posted: MyShiftsWeek | null = data.weekStart
    ? { weekStart: data.weekStart, shifts: data.shifts, team: data.team, live: data.live }
    : null
  const weeks = [data.thisWeek, ...(data.upcomingWeeks ?? []), posted].filter((w): w is MyShiftsWeek => !!w)

  // "today" and "next shift" go by the device's own clock — shift times are
  // store wall-clock, so a 9pm check in New York is still today's shift
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  // days from today (0 = today) for `day` in the week starting `ws`
  const daysAway = (ws: string, day: string) =>
    Math.round((new Date(ws).getTime() + DAYS.indexOf(day as (typeof DAYS)[number]) * 86_400_000 - todayMs) / 86_400_000)
  const upcoming = (ws: string, s: MyShift) => {
    const d = daysAway(ws, s.day)
    return d > 0 || (d === 0 && toMinutes(s.end) > nowMin)
  }
  // already worked — no change requests / pickups (a day before today, the
  // same check the server makes by the store's date)
  const dayPassed = (ws: string, day: string) => daysAway(ws, day) < 0
  const byStart = (a: MyShift, b: MyShift) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || toMinutes(a.start) - toMinutes(b.start)

  // what "My shifts" lists per week: this week from now on, later weeks whole
  const thisMonday = localMondayYMD()
  const mineWeeks = weeks.map((w) => {
    const shifts = (w.weekStart.slice(0, 10) === thisMonday && w !== posted ? w.shifts.filter((s) => upcoming(w.weekStart, s)) : w.shifts)
      .slice()
      .sort(byStart)
    const days = DAYS.map((day) => ({ day, shifts: shifts.filter((s) => s.day === day) })).filter((d) => d.shifts.length > 0)
    return { ...w, days }
  })
    // this week's leftovers drop out once they've all been worked
    .filter((w) => w.days.length > 0 || w === posted)
  const teamWeeks = weeks
    .map((w) => ({ w, team: w === posted ? w.team : w.team.filter((s) => daysAway(w.weekStart, s.day) >= 0) }))
    .filter(({ w, team }) => team.length > 0 || w === posted)
  const pickable = openShifts.filter((s) => !dayPassed(s.weekStart, s.day))
  // one store: no need to name it on every shift
  const multiStore = data.stores.length > 1
  // inside the store's "no trades this close to a shift" window
  const tooClose = (ws: string, s: { storeId: number; day: string; start: string }) => {
    const cutoff = data.stores.find((st) => st.storeId === s.storeId)?.tradeCutoffHours ?? 0
    return cutoff > 0 && daysAway(ws, s.day) * 1440 + toMinutes(s.start) - nowMin < cutoff * 60
  }

  const nextShift = weeks
    .flatMap((w) => w.shifts.map((s) => ({ s, ws: w.weekStart })))
    .filter(({ s, ws }) => upcoming(ws, s))
    .map((x) => ({ ...x, away: daysAway(x.ws, x.s.day) }))
    .sort((a, b) => a.away - b.away || toMinutes(a.s.start) - toMinutes(b.s.start))[0]
  const postedAhead = data.weekStart ? Math.ceil((new Date(data.weekStart).getTime() - todayMs) / 86_400_000) : 0
  const postedIsNextWeek = postedAhead > 0 && postedAhead <= 7
  // posted two weeks ahead: "that week", not "next week"
  const postedIsLater = postedAhead > 7

  const weekMinutes = data.shifts.reduce(
    (sum, s) => sum + (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60_000,
    0,
  )
  const postedAgo = data.publishedAt ? t('myshifts.postedAgo', { ago: relativeTime(data.publishedAt) }) : null
  const weekTitle = (ws: string) => {
    const ymd = ws.slice(0, 10)
    const range = weekRangeLabel(ws)
    if (ymd === thisMonday) return t('myshifts.thisWeekOf', { range })
    if (ymd === shiftWeekYMD(thisMonday, 1)) return t('myshifts.nextWeekOf', { range })
    return t('myshifts.weekOf', { range })
  }
  // a week's heading — only once there's more than one week to tell apart
  const weekHeading = (w: MyShiftsWeek, of: unknown[]) =>
    of.length > 1 && (
      <div className="mt-5 flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-heading text-sm font-bold text-ink">{weekTitle(w.weekStart)}</h2>
        {w === posted && postedAgo && <span className="font-body text-[11px] text-muted-ink">{postedAgo}</span>}
      </div>
    )
  const myEmployeeId = weeks.flatMap((w) => w.shifts).find((s) => s.employeeId != null)?.employeeId ?? null

  const dayCard = (w: MyShiftsWeek, day: (typeof DAYS)[number], shifts: MyShift[]) => {
    const isToday = daysAway(w.weekStart, day) === 0
    return (
      <Card key={day} padded={false} className={`overflow-hidden ${isToday ? 'ring-2 ring-green' : ''}`}>
        <div
          className={`flex items-baseline gap-1.5 border-b-2 border-ink/10 px-3 py-1.5 ${isToday ? 'bg-green/15' : 'bg-cream'}`}
        >
          <span className="font-heading text-sm font-bold text-ink">{DAY_LABEL[day]}</span>
          <span className="font-body text-[11px] font-semibold text-muted-ink">{dayDate(w.weekStart, DAYS.indexOf(day))}</span>
          {isToday && (
            <span className="ml-auto rounded-full bg-green px-2 py-px font-heading text-[10px] font-bold text-white">
              {t('myshifts.today')}
            </span>
          )}
        </div>
        <div className="flex flex-col divide-y divide-ink/10">
          {shifts.map((s) => {
            const pending = pendingFor(s.id)
            return (
              <div key={s.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-heading text-sm font-bold text-ink">{timeRange(s.start, s.end)}</span>
                      <SectionTag name={s.section} />
                    </div>
                    {multiStore && <div className="font-body text-[11px] font-semibold text-muted-ink">{storeName(s.storeId)}</div>}
                  </div>
                  {!w.live ? null : pending ? (
                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-right font-body text-[11px] font-bold text-orange">
                      {pending.openOffer ? t('myshifts.onMarketplace') : t('myshifts.changeRequested')}
                      <button
                        onClick={() => void act(() => api.cancelChangeRequest(pending.id))}
                        className="font-bold text-muted-ink underline"
                      >
                        {pending.openOffer ? t('myshifts.withdraw') : t('common.cancel')}
                      </button>
                    </span>
                  ) : dayPassed(w.weekStart, day) ? (
                    <span className="shrink-0 font-body text-[11px] font-semibold text-muted-ink">{t('myshifts.worked')}</span>
                  ) : tooClose(w.weekStart, s) ? (
                    <span className="max-w-[9rem] shrink-0 text-right font-body text-[11px] font-semibold text-muted-ink">
                      {t('myshifts.tooClose')}
                    </span>
                  ) : (
                    <button
                      onClick={() => setExpanded((e) => (e === s.id ? null : s.id))}
                      className="shrink-0 rounded-full px-2.5 py-1 font-heading text-[11px] font-bold text-sky-dark active:bg-sky/10"
                    >
                      {expanded === s.id ? t('common.close') : t('myshifts.requestChange')}
                    </button>
                  )}
                </div>
                {s.coworkers.length > 0 && <CoworkerRow people={s.coworkers} label={t('myshifts.workingWith')} />}
                {w.live && !dayPassed(w.weekStart, day) && expanded === s.id && !pending && (
                  <RequestPanel
                    shift={{ id: s.id, start: s.start, end: s.end }}
                    onSubmit={(input) => act(() => api.createChangeRequest({ shiftId: s.id, ...input }))}
                  />
                )}
              </div>
            )
          })}
        </div>
      </Card>
    )
  }

  return (
    <>
      <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-lg font-bold text-ink">{t('myshifts.title')}</h1>
        <CalendarSync />
      </div>
      {mineWeeks.length <= 1 && data.weekStart && (
        <div className="mt-0.5 font-body text-xs text-muted-ink">
          <span className="font-bold text-ink">{t('myshifts.weekOf', { range: weekRangeLabel(data.weekStart) })}</span>
          {postedAgo && ` · ${postedAgo}`}
        </div>
      )}

      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {data.published && !data.live && (
        <div className="mt-3 rounded-xl border-2 border-orange bg-orange/10 px-3 py-2 font-body text-xs text-ink">
          {t('myshifts.draftBanner')}
        </div>
      )}

      <ClockCard preferStoreId={nextShift?.away === 0 ? nextShift.s.storeId : null} />

      {nextShift && (
        <NextShiftCard
          shift={nextShift.s}
          when={
            nextShift.away === 0
              ? toMinutes(nextShift.s.start) <= nowMin
                ? t('myshifts.next.now')
                : t('myshifts.next.today')
              : nextShift.away === 1
                ? t('myshifts.next.tomorrow')
                : `${DAY_LABEL[nextShift.s.day]} ${dayDate(nextShift.ws, DAYS.indexOf(nextShift.s.day))}`
          }
          storeName={multiStore ? storeName(nextShift.s.storeId) : null}
        />
      )}

      {data.shifts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <StatPill>
            {t(data.shifts.length === 1 ? 'myshifts.stat.shifts.one' : 'myshifts.stat.shifts', { n: data.shifts.length })}
          </StatPill>
          <StatPill>
            {t(postedIsLater ? 'myshifts.stat.thatWeek' : postedIsNextWeek ? 'myshifts.stat.nextWeek' : 'myshifts.stat.week', {
              n: durationLabel(weekMinutes),
            })}
          </StatPill>
          {periodMinutes != null && <StatPill>{t('myshifts.stat.period', { n: durationLabel(periodMinutes) })}</StatPill>}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {(['mine', 'team'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold ${
              view === v ? 'bg-ink text-white' : 'bg-paper text-ink'
            }`}
          >
            {v === 'mine' ? t('myshifts.tab.mine') : t('myshifts.tab.team')}
          </button>
        ))}
      </div>

      {view === 'team' ? (
        teamWeeks.map(({ w, team }) => (
          <section key={w.weekStart}>
            {weekHeading(w, teamWeeks)}
            <TeamWeek
              team={team}
              weekStart={w.weekStart}
              myEmployeeId={myEmployeeId}
              multiStore={multiStore}
              storeName={storeName}
            />
          </section>
        ))
      ) : mineWeeks.every((w) => w.days.length === 0) ? (
        <EmptyState
          className="mt-8"
          icon={calendarIcon}
          title={onCall ? t('myshifts.onCall.title') : t('myshifts.offThisWeek.title')}
          body={onCall ? t('myshifts.onCall.body') : t('myshifts.offThisWeek.body')}
        />
      ) : (
        mineWeeks.map((w) => (
          <section key={w.weekStart}>
            {weekHeading(w, mineWeeks)}
            {w.days.length === 0 ? (
              <p className="mt-2 font-body text-xs text-muted-ink">{t('myshifts.offThatWeek')}</p>
            ) : (
              <div className={`${mineWeeks.length > 1 ? 'mt-2' : 'mt-4'} flex flex-col gap-2.5`}>
                {w.days.map((d) => dayCard(w, d.day, d.shifts))}
              </div>
            )}
          </section>
        ))
      )}

      {pickable.length > 0 && (
        <>
          <h2 className="mt-6 font-heading text-sm font-bold text-ink">{t('myshifts.openShifts.title')}</h2>
          <div className="mt-2 flex flex-col gap-1.5">
            {pickable.map((s) => {
              const pending = pendingFor(s.id)
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-xl border-2 border-dashed border-ink/40 bg-paper px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-body text-xs font-bold text-ink">
                      {DAY_LABEL[s.day]} {dayDate(s.weekStart, DAYS.indexOf(s.day))} · {timeRange(s.start, s.end)}
                    </div>
                    {multiStore && <div className="font-body text-[11px] text-muted-ink">{storeName(s.storeId)}</div>}
                  </div>
                  {pending ? (
                    <span className="flex shrink-0 items-center gap-1.5 font-body text-[11px] font-bold text-orange">
                      {t('myshifts.requested')}
                      <button
                        onClick={() => void act(() => api.cancelChangeRequest(pending.id))}
                        className="font-bold text-muted-ink underline"
                      >
                        {t('common.cancel')}
                      </button>
                    </span>
                  ) : tooClose(s.weekStart, s) ? (
                    <span className="max-w-[9rem] shrink-0 text-right font-body text-[11px] font-semibold text-muted-ink">
                      {t('myshifts.tooClose')}
                    </span>
                  ) : (
                    <button
                      onClick={() => void act(() => api.createChangeRequest({ type: 'PICKUP', shiftId: s.id }))}
                      className="shrink-0 rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-[11px] font-bold text-white"
                    >
                      {t('myshifts.pickUp')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {requests.length > 0 && (
        <>
          <h2 className="mt-6 font-heading text-sm font-bold text-ink">{t('myshifts.myRequests')}</h2>
          <div className="mt-2 flex flex-col gap-1.5">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 font-body text-xs">
                <span className="font-bold text-ink">
                  {r.type === 'PICKUP'
                    ? t('myshifts.req.pickup')
                    : r.openOffer && !r.targetEmployee
                      ? t('myshifts.req.posted')
                      : t('myshifts.req.giveTo', { name: r.targetEmployee?.name ?? '—' })}
                </span>
                <span className="text-muted-ink">
                  {DAY_LABEL[r.shift.day]}{' '}
                  {r.handoffStart && r.handoffEnd
                    ? `${timeRange(r.handoffStart, r.handoffEnd)} ${t('myshifts.req.part')}`
                    : timeRange(r.shift.start, r.shift.end)}{' '}
                  · {storeName(r.shift.storeId)}
                </span>
                <span
                  className={`rounded-full border px-1.5 py-px text-[10px] font-bold ${STATUS_STYLE[r.status]}`}
                >
                  {r.status.toLowerCase()}
                </span>
                {r.status === 'PENDING' && (
                  <button
                    onClick={() => void act(() => api.cancelChangeRequest(r.id))}
                    className="font-bold text-muted-ink underline"
                  >
                    {t('common.cancel')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      </div>
    </>
  )
}

/** Two rows are really one shift if they're the same person, back-to-back
 * with no gap — a "whole day" shift is stored as separate morning/afternoon
 * Shift rows (for break tracking), which otherwise shows as two list rows
 * for one person instead of one. Open (unassigned) slots are left separate
 * since two adjacent open slots are usually two different positions, not
 * one shift. */
function mergeContiguous(shifts: TeamShift[]): TeamShift[] {
  // group by employee first — comparing only against the single most-recently
  // pushed row (regardless of whose it was) missed merges whenever another
  // coworker's shift started in between the two rows being merged
  const byEmployee = new Map<number, TeamShift[]>()
  const merged: TeamShift[] = []
  for (const s of shifts) {
    if (s.employeeId == null) {
      merged.push(s) // open slots never merge with anything
      continue
    }
    const group = byEmployee.get(s.employeeId)
    if (group) group.push(s)
    else byEmployee.set(s.employeeId, [s])
  }
  for (const group of byEmployee.values()) {
    const sorted = group.sort((a, b) => a.start.localeCompare(b.start))
    let current = sorted[0]!
    for (const s of sorted.slice(1)) {
      // Front till 1 then Produce stays two rows, so each shows its section
      if (current.end === s.start && current.section === s.section) current = { ...current, end: s.end }
      else {
        merged.push(current)
        current = s
      }
    }
    merged.push(current)
  }
  return merged
}

function TeamWeek({
  team,
  weekStart,
  myEmployeeId,
  multiStore,
  storeName,
}: {
  team: TeamShift[]
  weekStart: string | null
  myEmployeeId: number | null
  multiStore: boolean
  storeName: (id: number) => string
}) {
  const t = useT()
  const byDay = DAYS.map((day) => {
    const dayShifts = team.filter((s) => s.day === day)
    // group by store first so a multi-store worker's day doesn't mix
    // different stores' crews into one intertwined list, then merge each
    // store's back-to-back shifts per person
    const storeIds = [...new Set(dayShifts.map((s) => s.storeId))].sort(
      (a, b) => storeName(a).localeCompare(storeName(b)),
    )
    const stores = storeIds.map((storeId) => ({
      storeId,
      shifts: mergeContiguous(dayShifts.filter((s) => s.storeId === storeId)).sort(
        (a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name),
      ),
    }))
    return { day, stores }
  }).filter((d) => d.stores.length > 0)

  if (byDay.length === 0) {
    return (
      <EmptyState
        className="mt-8"
        icon={calendarIcon}
        title={t('myshifts.teamEmpty.title')}
        body={t('myshifts.teamEmpty.body')}
      />
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {byDay.map(({ day, stores }) => (
        <Card key={day} padded={false} className="overflow-hidden">
          <div className="flex items-baseline gap-1.5 border-b-2 border-ink/10 bg-cream px-3 py-1.5">
            <span className="font-heading text-sm font-bold text-ink">{DAY_LABEL[day]}</span>
            {weekStart && (
              <span className="font-body text-[11px] font-semibold text-muted-ink">
                {dayDate(weekStart, DAYS.indexOf(day))}
              </span>
            )}
          </div>
          <div className="flex flex-col">
            {stores.map(({ storeId, shifts }) => (
              <div key={storeId} className="border-b-2 border-ink/10 last:border-b-0">
                {multiStore && (
                  <div className="bg-paper px-3 pt-1.5 font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
                    {storeName(storeId)}
                  </div>
                )}
                <div className="flex flex-col divide-y divide-ink/10">
                  {shifts.map((s, i) => {
                    const mine = s.employeeId != null && s.employeeId === myEmployeeId
                    const open = s.employeeId == null
                    return (
                      <div
                        key={`${s.storeId}-${s.start}-${s.employeeId ?? 'open'}-${i}`}
                        className={`flex items-center gap-2 px-3 py-2 ${mine ? 'bg-sky/10' : ''}`}
                      >
                        {open ? (
                          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-ink/40 text-[10px] text-muted-ink">
                            ?
                          </span>
                        ) : (
                          <FruitAvatar
                            kind={fruitForPerson({ employeeId: s.avatarKey, avatarFruit: s.avatarFruit })}
                            size={18}
                          />
                        )}
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span
                            className={`min-w-0 truncate font-body text-xs ${
                              open ? 'italic text-muted-ink' : mine ? 'font-bold text-ink' : 'text-ink'
                            }`}
                          >
                            {mine ? t('myshifts.you') : s.name}
                          </span>
                          <SectionTag name={s.section} />
                        </span>
                        <span className="shrink-0 font-body text-[11px] font-semibold text-muted-ink">
                          {timeRange(s.start, s.end)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

/** The first thing a worker sees: when they're next on, and with whom. */
/** `storeName` only for someone working at more than one store */
function NextShiftCard({ shift, when, storeName }: { shift: MyShift; when: string; storeName: string | null }) {
  const t = useT()
  return (
    <Card className="mt-3 border-green bg-green/10">
      <div className="font-body text-[10px] font-bold uppercase tracking-wide text-green-dark">
        {t('myshifts.next.title')}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-heading text-lg font-extrabold text-ink">{when}</span>
        <span className="font-heading text-base font-bold text-ink">{timeRange(shift.start, shift.end)}</span>
        <SectionTag name={shift.section} />
      </div>
      {storeName && <div className="font-body text-xs font-semibold text-muted-ink">{storeName}</div>}
      {shift.coworkers.length > 0 && (
        <div className="mt-2">
          <CoworkerRow people={shift.coworkers} label={t('myshifts.workingWith')} />
        </div>
      )}
    </Card>
  )
}

function StatPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border-2 border-ink/15 bg-paper px-2.5 py-0.5 font-body text-[11px] font-bold text-ink">
      {children}
    </span>
  )
}

/** The part of the store someone's on for a shift, as a small tag. */
function SectionTag({ name }: { name: string | null | undefined }) {
  if (!name) return null
  return (
    <span className="min-w-0 truncate rounded-full border border-grape bg-grape/15 px-1.5 py-px font-body text-[9px] font-bold text-ink">
      {name}
    </span>
  )
}

function CoworkerRow({ people, label }: { people: ShiftCoworker[]; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-body text-[11px] font-bold text-muted-ink">{label}</span>
      {people.map((p, i) => (
        <span key={`${p.avatarKey}-${i}`} className="flex items-center gap-1">
          <FruitAvatar
            kind={fruitForPerson({ employeeId: p.avatarKey, avatarFruit: p.avatarFruit })}
            size={16}
          />
          <span className="font-body text-[11px] font-semibold text-ink">{p.name}</span>
          <SectionTag name={p.section} />
        </span>
      ))}
    </div>
  )
}

type ReqInput = {
  type: 'SWAP'
  targetEmployeeId?: number
  note?: string
  handoffStart?: string
  handoffEnd?: string
}

function RequestPanel({
  shift,
  onSubmit,
}: {
  shift: { id: number; start: string; end: string }
  onSubmit: (input: ReqInput) => void
}) {
  const t = useT()
  const shiftStart = toHHMM24(shift.start)
  const shiftEnd = toHHMM24(shift.end)
  const [targets, setTargets] = useState<{ id: number; name: string }[]>([])
  const [target, setTarget] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [part, setPart] = useState(false)
  const [pStart, setPStart] = useState(shiftStart)
  const [pEnd, setPEnd] = useState(shiftEnd)

  useEffect(() => {
    api.getSwapTargets(shift.id).then(setTargets).catch(() => setTargets([]))
  }, [shift.id])

  const inRange = pStart >= shiftStart && pEnd <= shiftEnd && pStart < pEnd
  const isWhole = pStart === shiftStart && pEnd === shiftEnd
  const partValid = !part || (inRange && !isWhole)
  const handoff = part && inRange && !isWhole
  // posting it (nobody named) or handing it to one coworker are both a SWAP
  const base = (targetEmployeeId?: number): ReqInput => ({
    type: 'SWAP',
    ...(targetEmployeeId ? { targetEmployeeId } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(handoff ? { handoffStart: pStart, handoffEnd: pEnd } : {}),
  })

  const timeInp =
    'w-[6.5rem] rounded-lg border-2 border-ink/40 bg-paper px-2 py-1 font-body text-xs text-ink outline-none'

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border-2 border-ink/15 bg-cream p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {(['whole', 'part'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPart(m === 'part')}
            className={`rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold ${
              (m === 'part') === part ? 'bg-ink text-white' : 'bg-paper text-ink'
            }`}
          >
            {m === 'whole' ? t('req.wholeShift') : t('req.partOfIt')}
          </button>
        ))}
        {part && (
          <span className="flex items-center gap-1">
            <input type="time" step={1800} value={pStart} min={shiftStart} max={shiftEnd} onChange={(e) => setPStart(e.target.value)} className={timeInp} />
            <span className="text-muted-ink">–</span>
            <input type="time" step={1800} value={pEnd} min={shiftStart} max={shiftEnd} onChange={(e) => setPEnd(e.target.value)} className={timeInp} />
          </span>
        )}
      </div>
      {part && !partValid && (
        <p className="font-body text-[11px] font-bold text-coral-dark">
          {isWhole
            ? t('req.wholeHint')
            : t('req.rangeHint', { range: `${to12Hour(shiftStart)}–${to12Hour(shiftEnd)}` })}
        </p>
      )}

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('req.notePlaceholder')}
        className="rounded-lg border-2 border-ink/30 bg-paper px-2.5 py-1.5 font-body text-xs text-ink outline-none"
      />
      <Button size="sm" className="justify-center" disabled={!partValid} onClick={() => onSubmit(base())}>
        {t('req.postToCrew')}
      </Button>
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-body text-[11px] text-muted-ink">{t('req.orGiveTo')}</span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))}
          className="min-w-0 flex-1 rounded-lg border-2 border-ink bg-paper px-2 py-1.5 font-body text-xs text-ink outline-none"
        >
          <option value="">{t('req.choose')}</option>
          {targets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          disabled={target === '' || !partValid}
          onClick={() => target !== '' && onSubmit(base(target))}
        >
          {t('common.send')}
        </Button>
      </div>
    </div>
  )
}
