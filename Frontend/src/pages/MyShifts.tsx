import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card, EmptyState } from '../components/Card'
import { CalendarSync } from '../components/CalendarSync'
import { CalendarIcon } from '../components/icons'
import { FruitAvatar } from '../components/FruitAvatar'
import { api } from '../lib/api'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import {
  DAY_LABEL,
  DAYS,
  dayDate,
  relativeTime,
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

  const byDay = DAYS.map((day) => ({
    day,
    shifts: data.shifts
      .filter((s) => s.day === day)
      .sort((a, b) => a.start.localeCompare(b.start)),
  })).filter((d) => d.shifts.length > 0)

  // how many days into the posted week we are (0 = Monday). Shifts on an earlier
  // day are already worked — no change requests / pickups for those.
  const now = new Date()
  const todayIdx = data.weekStart
    ? Math.floor(
        (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
          new Date(data.weekStart).getTime()) /
          86_400_000,
      )
    : -1
  const dayPassed = (day: string) => DAYS.indexOf(day as (typeof DAYS)[number]) < todayIdx
  const pickable = openShifts.filter((s) => !dayPassed(s.day))

  // "today" and "next shift" go by the device's own clock — shift times are
  // store wall-clock, so a 9pm check in New York is still today's shift
  const localTodayIdx = data.weekStart
    ? Math.round(
        (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(data.weekStart).getTime()) /
          86_400_000,
      )
    : -1
  const nowMin = now.getHours() * 60 + now.getMinutes()
  // days from today (0 = today) for a shift in the week starting `ws`
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const daysAway = (ws: string, day: string) =>
    Math.round((new Date(ws).getTime() + DAYS.indexOf(day as (typeof DAYS)[number]) * 86_400_000 - todayMs) / 86_400_000)
  const upcoming = (ws: string, s: MyShift) => {
    const d = daysAway(ws, s.day)
    return d > 0 || (d === 0 && toMinutes(s.end) > nowMin)
  }
  // the rest of this calendar week, once next week is already what's posted
  const restOfWeek = data.thisWeek
    ? data.thisWeek.shifts
        .filter((s) => upcoming(data.thisWeek!.weekStart, s))
        .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || toMinutes(a.start) - toMinutes(b.start))
    : []
  // weeks between this one and the posted one (posted two weeks ahead)
  const between = (data.upcomingWeeks ?? []).filter((w) => w.shifts.length > 0)
  const byStart = (a: MyShift, b: MyShift) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || toMinutes(a.start) - toMinutes(b.start)
  const nextShift = [
    ...restOfWeek.map((s) => ({ s, ws: data.thisWeek!.weekStart })),
    ...between.flatMap((w) => w.shifts.map((s) => ({ s, ws: w.weekStart }))),
    ...(data.weekStart ? data.shifts.map((s) => ({ s, ws: data.weekStart! })) : []),
  ]
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
  const meta = [data.publishedAt && t('myshifts.postedAgo', { ago: relativeTime(data.publishedAt) })].filter(Boolean)
  const weekLine = (
    <div className="mt-0.5 font-body text-xs text-muted-ink">
      {data.weekStart && (
        <span className="font-bold text-ink">{t('myshifts.weekOf', { range: weekRangeLabel(data.weekStart) })}</span>
      )}
      {data.weekStart && meta.length > 0 && ' · '}
      {meta.join(' · ')}
    </div>
  )

  return (
    <>
      <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-lg font-bold text-ink">{t('myshifts.title')}</h1>
        <CalendarSync />
      </div>
      {restOfWeek.length === 0 && between.length === 0 && weekLine}

      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {data.published && !data.live && (
        <div className="mt-3 rounded-xl border-2 border-orange bg-orange/10 px-3 py-2 font-body text-xs text-ink">
          {t('myshifts.draftBanner')}
        </div>
      )}

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
          storeName={storeName(nextShift.s.storeId)}
        />
      )}

      {restOfWeek.length > 0 && (
        <ShiftListCard title={t('myshifts.restOfWeek')} weekStart={data.thisWeek!.weekStart} shifts={restOfWeek} storeName={storeName} />
      )}
      {between.map((w) => (
        <ShiftListCard
          key={w.weekStart}
          title={t('myshifts.weekOf', { range: weekRangeLabel(w.weekStart) })}
          weekStart={w.weekStart}
          shifts={[...w.shifts].sort(byStart)}
          storeName={storeName}
        />
      ))}

      {/* with this week's leftovers (and any in-between weeks) shown above,
          "Week of …" belongs to the posted week below them, not the top of the page */}
      {(restOfWeek.length > 0 || between.length > 0) && <div className="mt-4">{weekLine}</div>}

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
        <TeamWeek
          team={data.team}
          weekStart={data.weekStart}
          myEmployeeId={data.shifts.find((s) => s.employeeId != null)?.employeeId ?? null}
          multiStore={data.stores.length > 1}
          storeName={storeName}
        />
      ) : byDay.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={calendarIcon}
          title={onCall ? t('myshifts.onCall.title') : t('myshifts.offThisWeek.title')}
          body={onCall ? t('myshifts.onCall.body') : t('myshifts.offThisWeek.body')}
        />
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {byDay.map(({ day, shifts }) => {
            const isToday = DAYS.indexOf(day) === localTodayIdx
            return (
            <Card key={day} padded={false} className={`overflow-hidden ${isToday ? 'ring-2 ring-green' : ''}`}>
              <div
                className={`flex items-baseline gap-1.5 border-b-2 border-ink/10 px-3 py-1.5 ${
                  isToday ? 'bg-green/15' : 'bg-cream'
                }`}
              >
                <span className="font-heading text-sm font-bold text-ink">{DAY_LABEL[day]}</span>
                {data.weekStart && (
                  <span className="font-body text-[11px] font-semibold text-muted-ink">
                    {dayDate(data.weekStart, DAYS.indexOf(day))}
                  </span>
                )}
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
                          <div className="font-heading text-sm font-bold text-ink">
                            {timeRange(s.start, s.end)}
                          </div>
                          <div className="font-body text-[11px] font-semibold text-muted-ink">
                            {storeName(s.storeId)}
                          </div>
                        </div>
                        {!data.live ? null : pending ? (
                          <span className="flex shrink-0 flex-col items-end gap-0.5 text-right font-body text-[11px] font-bold text-orange">
                            {pending.openOffer
                              ? t('myshifts.onMarketplace')
                              : t('myshifts.changeRequested')}
                            <button
                              onClick={() => void act(() => api.cancelChangeRequest(pending.id))}
                              className="font-bold text-muted-ink underline"
                            >
                              {pending.openOffer ? t('myshifts.withdraw') : t('common.cancel')}
                            </button>
                          </span>
                        ) : dayPassed(day) ? (
                          <span className="shrink-0 font-body text-[11px] font-semibold text-muted-ink">
                            {t('myshifts.worked')}
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
                      {data.live && !dayPassed(day) && expanded === s.id && !pending && (
                        <RequestPanel
                          shift={{ id: s.id, start: s.start, end: s.end }}
                          onSubmit={(input) =>
                            act(() => api.createChangeRequest({ shiftId: s.id, ...input }))
                          }
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
            )
          })}
        </div>
      )}

      {data.live && pickable.length > 0 && (
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
                      {DAY_LABEL[s.day]} · {timeRange(s.start, s.end)}
                    </div>
                    <div className="font-body text-[11px] text-muted-ink">{storeName(s.storeId)}</div>
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
                  {r.type === 'DROP'
                    ? t('myshifts.req.drop')
                    : r.type === 'PICKUP'
                      ? t('myshifts.req.pickup')
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
      if (current.end === s.start) current = { ...current, end: s.end }
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
                        <span
                          className={`min-w-0 flex-1 truncate font-body text-xs ${
                            open ? 'italic text-muted-ink' : mine ? 'font-bold text-ink' : 'text-ink'
                          }`}
                        >
                          {mine ? t('myshifts.you') : s.name}
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
/** A read-only list of shifts in one week: "Rest of this week", or a week
 * between this one and the posted one. */
function ShiftListCard({
  title,
  weekStart,
  shifts,
  storeName,
}: {
  title: string
  weekStart: string
  shifts: MyShift[]
  storeName: (id: number) => string
}) {
  const t = useT()
  return (
    <Card padded={false} className="mt-3 overflow-hidden">
      <div className="border-b-2 border-ink/10 bg-cream px-3 py-1.5 font-heading text-sm font-bold text-ink">{title}</div>
      <ul className="flex flex-col divide-y divide-ink/10">
        {shifts.map((s) => (
          <li key={s.id} className="px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-heading text-sm font-bold text-ink">
                {DAY_LABEL[s.day]} {dayDate(weekStart, DAYS.indexOf(s.day))}
              </span>
              <span className="font-body text-xs font-bold text-ink">{timeRange(s.start, s.end)}</span>
              <span className="font-body text-[11px] text-muted-ink">{storeName(s.storeId)}</span>
            </div>
            {s.coworkers.length > 0 && <CoworkerRow people={s.coworkers} label={t('myshifts.workingWith')} />}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function NextShiftCard({ shift, when, storeName }: { shift: MyShift; when: string; storeName: string }) {
  const t = useT()
  return (
    <Card className="mt-3 border-green bg-green/10">
      <div className="font-body text-[10px] font-bold uppercase tracking-wide text-green-dark">
        {t('myshifts.next.title')}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-heading text-lg font-extrabold text-ink">{when}</span>
        <span className="font-heading text-base font-bold text-ink">{timeRange(shift.start, shift.end)}</span>
      </div>
      <div className="font-body text-xs font-semibold text-muted-ink">{storeName}</div>
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
        </span>
      ))}
    </div>
  )
}

type ReqInput = {
  type: 'SWAP' | 'DROP'
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
  const base = (type: 'SWAP' | 'DROP', targetEmployeeId?: number): ReqInput => ({
    type,
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
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 justify-center"
          disabled={!partValid}
          onClick={() => onSubmit(base('SWAP'))}
        >
          {t('req.postToCrew')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="flex-1 justify-center border-coral text-coral-dark"
          disabled={!partValid}
          onClick={() => onSubmit(base('DROP'))}
        >
          {t('myshifts.req.drop')}
        </Button>
      </div>
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
          onClick={() => target !== '' && onSubmit(base('SWAP', target))}
        >
          {t('common.send')}
        </Button>
      </div>
    </div>
  )
}
