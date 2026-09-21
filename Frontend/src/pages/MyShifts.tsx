import { useCallback, useEffect, useState } from 'react'
import { CalendarIcon } from '../components/icons'
import { FruitAvatar } from '../components/FruitAvatar'
import { api } from '../lib/api'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { StoreProvider } from '../lib/store-context'
import { Closing } from './Closing'
import {
  DAY_LABEL,
  DAYS,
  dayDate,
  relativeTime,
  timeRange,
  to12Hour,
  toHHMM24,
  weekRangeLabel,
} from '../lib/time'
import type { ChangeRequest, MyShiftsResponse, Shift, ShiftCoworker, TeamShift, Store } from '../types'

const STATUS_STYLE: Record<ChangeRequest['status'], string> = {
  PENDING: 'border-orange bg-orange/10 text-ink',
  APPROVED: 'border-green bg-green/10 text-green',
  DENIED: 'border-coral bg-coral-bg text-coral-dark',
  CANCELLED: 'border-ink/25 text-muted-ink',
}

export function MyShifts() {
  const t = useT()
  const [data, setData] = useState<MyShiftsResponse | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [openShifts, setOpenShifts] = useState<Shift[]>([])
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [view, setView] = useState<'mine' | 'team'>('mine')
  // Closing lives inside this page (it only applies to some stores) rather
  // than as its own nav tab
  const [subView, setSubView] = useState<'shifts' | 'closing'>('shifts')

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

  const tracksClosing = stores.some((s) => s.tracksClosingDuties)
  const subTabs = tracksClosing && (
    <div className="flex gap-1.5 p-4 pb-0 sm:p-6 sm:pb-0">
      {(['shifts', 'closing'] as const).map((v) => (
        <button
          key={v}
          onClick={() => setSubView(v)}
          className={`rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold capitalize ${
            subView === v ? 'bg-ink text-white' : 'bg-paper text-ink'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  )

  if (tracksClosing && subView === 'closing') {
    return (
      <StoreProvider>
        {subTabs}
        <Closing />
      </StoreProvider>
    )
  }

  if (!data.published) {
    return (
      <>
        {subTabs}
        <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-24 sm:p-6 sm:pb-6">
          <h1 className="font-heading text-lg font-bold text-ink">{t('myshifts.title')}</h1>
          <EmptyState
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

  const totalHours = Math.round(
    data.shifts.reduce(
      (sum, s) => sum + (new Date(s.end).getTime() - new Date(s.start).getTime()) / 3_600_000,
      0,
    ),
  )
  const meta = [
    byDay.length > 0 &&
      t(data.shifts.length === 1 ? 'myshifts.shiftCount.one' : 'myshifts.shiftCount', {
        n: data.shifts.length,
        hours: totalHours,
      }),
    data.publishedAt && t('myshifts.postedAgo', { ago: relativeTime(data.publishedAt) }),
  ].filter(Boolean)

  return (
    <>
      {subTabs}
      <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-24 sm:p-6 sm:pb-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('myshifts.title')}</h1>
      <div className="mt-0.5 font-body text-xs text-muted-ink">
        {data.weekStart && (
          <span className="font-bold text-ink">
            {t('myshifts.weekOf', { range: weekRangeLabel(data.weekStart) })}
          </span>
        )}
        {data.weekStart && meta.length > 0 && ' · '}
        {meta.join(' · ')}
      </div>

      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {data.published && !data.live && (
        <div className="mt-3 rounded-xl border-2 border-orange bg-orange/10 px-3 py-2 font-body text-xs text-ink">
          {t('myshifts.draftBanner')}
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
          title={t('myshifts.offThisWeek.title')}
          body={t('myshifts.offThisWeek.body')}
        />
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {byDay.map(({ day, shifts }) => (
            <div
              key={day}
              className="overflow-hidden rounded-2xl border-[2.5px] border-ink bg-paper shadow-[3px_3px_0_var(--color-ink)]"
            >
              <div className="flex items-baseline gap-1.5 border-b-2 border-ink/10 bg-cream px-3 py-1.5">
                <span className="font-heading text-sm font-bold text-ink">{DAY_LABEL[day]}</span>
                {data.weekStart && (
                  <span className="font-body text-[11px] font-semibold text-muted-ink">
                    {dayDate(data.weekStart, DAYS.indexOf(day))}
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
            </div>
          ))}
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
  const byDay = DAYS.map((day) => ({
    day,
    shifts: team
      .filter((s) => s.day === day)
      .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name)),
  })).filter((d) => d.shifts.length > 0)

  if (byDay.length === 0) {
    return <EmptyState title={t('myshifts.teamEmpty.title')} body={t('myshifts.teamEmpty.body')} />
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {byDay.map(({ day, shifts }) => (
        <div
          key={day}
          className="overflow-hidden rounded-2xl border-[2.5px] border-ink bg-paper shadow-[3px_3px_0_var(--color-ink)]"
        >
          <div className="flex items-baseline gap-1.5 border-b-2 border-ink/10 bg-cream px-3 py-1.5">
            <span className="font-heading text-sm font-bold text-ink">{DAY_LABEL[day]}</span>
            {weekStart && (
              <span className="font-body text-[11px] font-semibold text-muted-ink">
                {dayDate(weekStart, DAYS.indexOf(day))}
              </span>
            )}
          </div>
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
                    {multiStore && <span className="text-muted-ink"> · {storeName(s.storeId)}</span>}
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-8 flex flex-col items-center gap-2 rounded-2xl border-[2.5px] border-dashed border-ink/25 bg-paper/60 px-6 py-10 text-center">
      <span className="text-muted-ink">
        <CalendarIcon size={30} />
      </span>
      <span className="font-heading text-sm font-bold text-ink">{title}</span>
      <span className="max-w-xs font-body text-xs text-muted-ink">{body}</span>
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
  const base = (targetEmployeeId?: number): ReqInput => ({
    type: 'SWAP',
    ...(targetEmployeeId ? { targetEmployeeId } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(handoff ? { handoffStart: pStart, handoffEnd: pEnd } : {}),
  })

  const pill = 'rounded-full border-2 px-3 py-1.5 font-heading text-[11px] font-bold'
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
      <button
        disabled={!partValid}
        onClick={() => onSubmit(base())}
        className={`${pill} w-full border-ink bg-green text-white disabled:opacity-40`}
      >
        {t('req.postToCrew')}
      </button>
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-body text-[11px] text-muted-ink">{t('req.orGiveTo')}</span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))}
          className="min-w-0 flex-1 rounded-lg border-2 border-ink bg-paper px-2 py-1.5 font-body text-xs text-ink outline-none"
        >
          <option value="">{t('req.choose')}</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          disabled={target === '' || !partValid}
          onClick={() => target !== '' && onSubmit(base(target))}
          className={`${pill} shrink-0 border-ink bg-paper text-ink disabled:opacity-40`}
        >
          {t('common.send')}
        </button>
      </div>
    </div>
  )
}
