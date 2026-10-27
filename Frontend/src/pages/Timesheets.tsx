import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { FruitAvatar } from '../components/FruitAvatar'
import { TimeImport } from '../components/TimeImport'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store-context'
import { addDaysYMD, clockToMin, DAY_LABEL, DAYS, dayDate, durationLabel, to12Hour, weekRangeLabel } from '../lib/time'
import { stampDay, stampMinutes, stampTime, workedMinutes } from '../lib/timeClock'
import { useRefreshOnReturn } from '../lib/use-refresh-on-return'
import type { TimeEntry, Timesheet } from '../types'

/** a few minutes either side of a shift is just clocking in */
const GRACE = 5

type Editing = { entry: TimeEntry } | { employeeId: number; day: string | null; start: string; end: string }

/** One store's week of hours worked, next to what was scheduled: who's on the
 * clock now, anything that needs a look (late, no clock-out, not on the
 * schedule), fixing a stretch, and signing the week off for Payroll. Where
 * the store's hours come from its POS, importing its export happens here. */
export function Timesheets() {
  const t = useT()
  const confirm = useConfirm()
  const { storeId, stores } = useStore()
  const [week, setWeek] = useState<string | undefined>(undefined)
  const [data, setData] = useState<Timesheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [addFor, setAddFor] = useState('')

  const load = useCallback(() => {
    if (storeId == null) return Promise.resolve()
    return api
      .getTimesheet(storeId, week)
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('timesheet.errLoad')))
  }, [storeId, week, t])
  useEffect(() => {
    void load()
  }, [load])
  useRefreshOnReturn(load, editing != null)

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('timesheet.errSave'))
    } finally {
      setBusy(false)
    }
  }

  const storeName = stores.find((s) => s.id === storeId)?.name ?? ''
  if (storeId == null) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>
  if (error && !data) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!data || data.storeId !== storeId) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  const today = stampDay(data.now)
  const nowMin = stampMinutes(data.now)
  const days = DAYS.map((d, i) => ({ day: d, ymd: addDaysYMD(data.weekStart, i), i }))
  const personOf = new Map(data.people.map((p) => [p.id, p]))
  const isPos = data.mode === 'POS'

  // per person: each day's scheduled shifts and stretches
  type DayRow = { ymd: string; i: number; label: string; scheduled: { start: string; end: string }[]; entries: TimeEntry[] }
  const rowsFor = (id: number): DayRow[] =>
    days
      .map(({ day, ymd, i }) => ({
        ymd,
        i,
        label: `${DAY_LABEL[day]} ${dayDate(data.weekStart, i)}`,
        scheduled: data.scheduled
          .filter((s) => s.employeeId === id && s.day === day)
          .sort((a, b) => a.start.localeCompare(b.start)),
        entries: data.entries.filter((e) => e.employeeId === id && stampDay(e.clockIn) === ymd),
      }))
      // days still ahead have nothing to check yet
      .filter((r) => r.entries.length > 0 || (r.scheduled.length > 0 && r.ymd <= today))
  const active = data.people.filter((p) => rowsFor(p.id).length > 0)
  const others = data.people.filter((p) => !active.includes(p))

  /** what about this day needs a look */
  function flags(r: DayRow): { text: string; tone: 'warn' | 'bad' }[] {
    const out: { text: string; tone: 'warn' | 'bad' }[] = []
    const first = r.scheduled[0]
    const last = r.scheduled[r.scheduled.length - 1]
    const started = first && (r.ymd < today || (r.ymd === today && nowMin - stampMinutes(`${today}T00:00`) > clockToMin(first.start) + 15))
    if (r.entries.length === 0) {
      // a POS store's hours come in later, so only call out days already over
      if (first && (isPos ? r.ymd < today : started)) {
        out.push({ text: r.ymd === today ? t('timesheet.flag.notIn') : t('timesheet.flag.noHours'), tone: 'bad' })
      }
      return out
    }
    if (!first) out.push({ text: t('timesheet.flag.unscheduled'), tone: 'warn' })
    for (const e of r.entries) {
      if (!e.clockOut && stampDay(e.clockIn) < today) out.push({ text: t('timesheet.flag.noOut'), tone: 'bad' })
    }
    if (first) {
      const late = stampMinutes(r.entries[0]!.clockIn) - stampMinutes(`${r.ymd}T${first.start}`)
      if (late > GRACE) out.push({ text: t('timesheet.flag.late', { time: durationLabel(late) }), tone: 'warn' })
      const lastOut = r.entries[r.entries.length - 1]!.clockOut
      // a shift running past midnight ends the next day
      const endDay = last!.end <= last!.start ? addDaysYMD(r.ymd, 1) : r.ymd
      const early = lastOut ? stampMinutes(`${endDay}T${last!.end}`) - stampMinutes(lastOut) : 0
      if (early > GRACE) out.push({ text: t('timesheet.flag.early', { time: durationLabel(early) }), tone: 'warn' })
    }
    return out
  }

  const finishedMinutes = (es: TimeEntry[]) => es.reduce((n, e) => n + workedMinutes(e), 0)
  const scheduledMinutes = (rows: { start: string; end: string }[]) =>
    rows.reduce((n, s) => n + ((clockToMin(s.end) - clockToMin(s.start) + 1440) % 1440 || 1440), 0)
  const weekWorked = finishedMinutes(data.entries)
  // scheduled so far — the rest of the week hasn't been worked yet
  const dayOf = new Map(days.map((d) => [d.day as string, d.ymd]))
  const soFar = (s: { day: string }) => (dayOf.get(s.day) ?? '') <= today
  const weekScheduled = scheduledMinutes(data.scheduled.filter(soFar))
  const toApprove = data.entries.filter((e) => e.clockOut && !e.approved).length
  const needsLook = active.reduce((n, p) => n + rowsFor(p.id).filter((r) => flags(r).length > 0).length, 0)
  // no going past the week that's on now
  const thisWeek = data.weekStart >= addDaysYMD(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))

  const save = (input: { clockIn: string; clockOut: string | null; breakMinutes: number }) => {
    if (!editing) return
    void act(() =>
      'entry' in editing
        ? api.updateTimeEntry(editing.entry.id, input)
        : api.addTimeEntry({ storeId, employeeId: editing.employeeId, ...input }),
    )
  }
  const remove = (entry: TimeEntry) =>
    void confirm(t('timesheet.deleteConfirm'), { tone: 'danger', confirmLabel: t('timesheet.delete') }).then((ok) => {
      if (ok) void act(() => api.deleteTimeEntry(entry.id))
    })

  const editor = (key: string) =>
    editing && (('entry' in editing ? `e${editing.entry.id}` : `a${editing.employeeId}-${editing.day ?? ''}`) === key) ? (
      <EntryEditor
        editing={editing}
        days={days.filter((d) => d.ymd <= today).map((d) => ({ ymd: d.ymd, label: `${DAY_LABEL[d.day]} ${dayDate(data.weekStart, d.i)}` }))}
        busy={busy}
        onSave={save}
        onDelete={'entry' in editing ? () => remove(editing.entry) : undefined}
        onCancel={() => setEditing(null)}
      />
    ) : null

  const stretch = (e: TimeEntry) => (
    <div key={e.id} className="flex flex-col">
      <button
        onClick={() => setEditing((cur) => (cur && 'entry' in cur && cur.entry.id === e.id ? null : { entry: e }))}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-1.5 py-1 text-left hover:bg-cream"
      >
        <span className="font-body text-xs font-bold text-ink">
          {stampTime(e.clockIn)} – {e.clockOut ? stampTime(e.clockOut) : t('timesheet.stillOn')}
          {e.clockOut && stampDay(e.clockOut) !== stampDay(e.clockIn) && (
            <span className="font-normal text-muted-ink"> {t('timesheet.nextDay')}</span>
          )}
        </span>
        {e.breakMinutes > 0 && (
          <span className="font-body text-[11px] text-muted-ink">{t('timesheet.break', { time: durationLabel(e.breakMinutes) })}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {e.edited && <span className="font-body text-[10px] font-bold text-muted-ink">{t('timesheet.edited')}</span>}
          <span className="font-body text-xs font-semibold text-ink">
            {durationLabel(workedMinutes(e, e.clockOut ? undefined : data.now))}
          </span>
          {e.approved && (
            <span title={t('timesheet.approved')} aria-label={t('timesheet.approved')} className="font-heading text-xs font-bold text-green">
              ✓
            </span>
          )}
        </span>
      </button>
      {editor(`e${e.id}`)}
    </div>
  )

  const nav = 'rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink'
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:p-6">
      <Link to="/payroll" className="font-body text-xs font-bold text-sky-dark">
        ‹ {t('nav.mgr.payroll')}
      </Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2">
        <h1 className="font-heading text-lg font-bold text-ink">{t('timesheet.title')}</h1>
        <span className="font-body text-xs font-semibold text-muted-ink">{storeName}</span>
      </div>

      {data.mode === 'OFF' ? (
        <Card className="mt-3 font-body text-xs text-ink">
          {t('timesheet.off')}{' '}
          <Link to="/settings" className="font-bold text-sky-dark">
            {t('timesheet.offLink')}
          </Link>
        </Card>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button onClick={() => setWeek(addDaysYMD(data.weekStart, -7))} className={nav} aria-label={t('timesheet.prevWeek')}>
              ‹
            </button>
            <span className="text-center font-heading text-sm font-bold text-ink">{weekRangeLabel(data.weekStart)}</span>
            <button
              onClick={() => setWeek(addDaysYMD(data.weekStart, 7))}
              disabled={thisWeek}
              className={`${nav} disabled:opacity-30`}
              aria-label={t('timesheet.nextWeek')}
            >
              ›
            </button>
          </div>

          <p className="mt-2 font-body text-xs text-muted-ink">
            {t('timesheet.summary', { worked: durationLabel(weekWorked), scheduled: durationLabel(weekScheduled) })}
            {needsLook > 0 && (
              <b className="text-coral-dark"> · {t(needsLook === 1 ? 'timesheet.needsLook.one' : 'timesheet.needsLook', { n: needsLook })}</b>
            )}
          </p>
          {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

          {isPos && (
            <Card className="mt-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading text-sm font-bold text-ink">{t('timesheet.pos.title')}</span>
                {!showImport && (
                  <button onClick={() => setShowImport(true)} className={nav}>
                    {t('timesheet.pos.import')}
                  </button>
                )}
              </div>
              <p className="font-body text-[11px] text-muted-ink">{t('timesheet.pos.how')}</p>
              {showImport && (
                <TimeImport
                  storeId={storeId}
                  storeName={storeName}
                  people={data.people}
                  onDone={(range) => {
                    // land on the week the export ends in
                    if (range) setWeek(range.to)
                    void load()
                  }}
                />
              )}
            </Card>
          )}

          {data.openNow.length > 0 && (
            <>
              <h2 className="mt-5 font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
                {t('timesheet.onNow', { n: data.openNow.length })}
              </h2>
              <Card padded={false} className="mt-2 divide-y-2 divide-ink/10 overflow-hidden">
                {data.openNow.map((e) => {
                  const p = personOf.get(e.employeeId)
                  return (
                    <div key={e.id} className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <FruitAvatar kind={fruitForPerson({ employeeId: e.employeeId, avatarFruit: p?.avatarFruit })} size={24} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-body text-sm font-semibold text-ink">{p?.name ?? '—'}</span>
                          <span className="font-body text-[11px] font-semibold text-muted-ink">
                            {e.onBreakSince
                              ? t('timesheet.onBreakSince', { time: stampTime(e.onBreakSince) })
                              : stampDay(e.clockIn) === today
                                ? t('timesheet.since', { time: stampTime(e.clockIn) })
                                : t('timesheet.sinceDay', { day: dayDate(stampDay(e.clockIn), 0), time: stampTime(e.clockIn) })}
                            {' · '}
                            {durationLabel(workedMinutes(e, data.now))}
                          </span>
                        </span>
                        <button
                          onClick={() => setEditing((cur) => (cur && 'entry' in cur && cur.entry.id === e.id ? null : { entry: e }))}
                          className="shrink-0 font-body text-[11px] font-bold text-sky-dark"
                        >
                          {t('timesheet.fix')}
                        </button>
                      </div>
                      {editor(`e${e.id}`)}
                    </div>
                  )
                })}
              </Card>
            </>
          )}

          {active.length === 0 ? (
            <Card className="mt-4 font-body text-xs text-muted-ink">{isPos ? t('timesheet.empty.pos') : t('timesheet.empty')}</Card>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {active.map((p) => {
                const rows = rowsFor(p.id)
                const worked = finishedMinutes(rows.flatMap((r) => r.entries))
                const sched = scheduledMinutes(rows.filter((r) => r.ymd <= today).flatMap((r) => r.scheduled))
                return (
                  <Card key={p.id} padded={false} className="overflow-hidden">
                    <div className="flex items-center gap-2.5 border-b-2 border-ink/10 bg-cream px-3 py-2">
                      <FruitAvatar kind={fruitForPerson({ employeeId: p.id, avatarFruit: p.avatarFruit })} size={24} />
                      <span className="min-w-0 flex-1 truncate font-heading text-sm font-bold text-ink">{p.name}</span>
                      <span className="shrink-0 font-body text-[11px] text-muted-ink">
                        <b className="text-ink">{durationLabel(worked)}</b> / {durationLabel(sched)}
                      </span>
                    </div>
                    <div className="flex flex-col divide-y divide-ink/10">
                      {rows.map((r) => {
                        const f = flags(r)
                        const addKey = `a${p.id}-${r.ymd}`
                        return (
                          <div key={r.ymd} className="flex flex-col gap-0.5 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-body text-[11px] font-bold text-ink">{r.label}</span>
                              <span className="font-body text-[11px] text-muted-ink">
                                {r.scheduled.length > 0
                                  ? r.scheduled.map((s) => `${to12Hour(s.start)}–${to12Hour(s.end)}`).join(', ')
                                  : t('timesheet.notScheduled')}
                              </span>
                              {f.map((x) => (
                                <span
                                  key={x.text}
                                  className={`rounded-full border px-1.5 py-px font-body text-[10px] font-bold ${
                                    x.tone === 'bad' ? 'border-coral bg-coral-bg text-coral-dark' : 'border-orange bg-orange/10 text-ink'
                                  }`}
                                >
                                  {x.text}
                                </span>
                              ))}
                            </div>
                            {r.entries.map(stretch)}
                            {r.entries.length === 0 && r.ymd <= today && (
                              <button
                                onClick={() =>
                                  setEditing({ employeeId: p.id, day: r.ymd, start: r.scheduled[0]!.start, end: r.scheduled[r.scheduled.length - 1]!.end })
                                }
                                className="self-start px-1.5 font-body text-[11px] font-bold text-sky-dark"
                              >
                                + {t('timesheet.addMissing')}
                              </button>
                            )}
                            {editor(addKey)}
                          </div>
                        )
                      })}
                      <div className="px-3 py-1.5">
                        <button
                          onClick={() => setEditing({ employeeId: p.id, day: null, start: '09:00', end: '17:00' })}
                          className="font-body text-[11px] font-bold text-sky-dark"
                        >
                          + {t('timesheet.addHours')}
                        </button>
                        {editor(`a${p.id}-`)}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          {others.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              <label className="flex flex-wrap items-center gap-1.5 font-body text-[11px] font-bold text-muted-ink">
                {t('timesheet.addFor')}
                <select
                  value={addFor}
                  onChange={(e) => {
                    setAddFor(e.target.value)
                    if (e.target.value) setEditing({ employeeId: Number(e.target.value), day: null, start: '09:00', end: '17:00' })
                  }}
                  className="rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none"
                >
                  <option value="">—</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {addFor && editor(`a${addFor}-`)}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              disabled={busy || toApprove === 0}
              onClick={() => void act(() => api.approveTimesheet(storeId, data.weekStart))}
              className="rounded-full border-2 border-ink bg-green px-4 py-1.5 font-heading text-xs font-bold text-white disabled:opacity-40"
            >
              {toApprove > 0 ? t('timesheet.approve', { n: toApprove }) : t('timesheet.allApproved')}
            </button>
            <span className="font-body text-[11px] text-muted-ink">{t('timesheet.approveHint')}</span>
          </div>
        </>
      )}
    </div>
  )
}

/** Fixing a stretch, or adding one that never got clocked. Times are on the
 * store's clock; a clock-out earlier than the clock-in ran past midnight. */
function EntryEditor({
  editing,
  days,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  editing: Editing
  /** days it can go on, when adding without one picked */
  days: { ymd: string; label: string }[]
  busy: boolean
  onSave: (input: { clockIn: string; clockOut: string | null; breakMinutes: number }) => void
  onDelete?: () => void
  onCancel: () => void
}) {
  const t = useT()
  const entry = 'entry' in editing ? editing.entry : null
  const [day, setDay] = useState(entry ? stampDay(entry.clockIn) : (editing as { day: string | null }).day ?? days[days.length - 1]?.ymd ?? '')
  const [start, setStart] = useState(entry ? entry.clockIn.slice(11) : (editing as { start: string }).start)
  const [end, setEnd] = useState(entry ? (entry.clockOut?.slice(11) ?? '') : (editing as { end: string }).end)
  const [brk, setBrk] = useState(String(entry?.breakMinutes ?? 0))
  const pickDay = !entry && (editing as { day: string | null }).day == null
  const overnight = end !== '' && start !== '' && end <= start
  const valid = day !== '' && start !== '' && (end !== '' || (entry != null && entry.clockOut == null))

  function submit() {
    const clockOut = end === '' ? null : `${overnight ? addDaysYMD(day, 1) : day}T${end}`
    onSave({ clockIn: `${day}T${start}`, clockOut, breakMinutes: Math.max(0, Math.round(Number(brk) || 0)) })
  }

  const input = 'rounded-lg border-2 border-ink bg-cream px-1.5 py-0.5 font-body text-xs font-bold text-ink'
  const label = 'flex items-center gap-1 font-body text-[11px] font-bold text-muted-ink'
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-xl border-2 border-ink/20 bg-cream/50 p-2.5">
      {pickDay && (
        <label className={label}>
          {t('timesheet.edit.day')}
          <select value={day} onChange={(e) => setDay(e.target.value)} className={input}>
            {days.map((d) => (
              <option key={d.ymd} value={d.ymd}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className={label}>
          {t('timesheet.edit.in')}
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </label>
        <label className={label}>
          {t('timesheet.edit.out')}
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
        </label>
        <label className={label}>
          {t('timesheet.edit.break')}
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={brk}
            onChange={(e) => setBrk(e.target.value)}
            className={`${input} w-14`}
          />
          {t('timesheet.edit.min')}
        </label>
      </div>
      {overnight && <span className="font-body text-[10px] text-muted-ink">{t('timesheet.edit.overnight')}</span>}
      {entry && !entry.clockOut && end === '' && (
        <span className="font-body text-[10px] text-muted-ink">{t('timesheet.edit.stillOn')}</span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={busy || !valid}
          onClick={submit}
          className="rounded-full border-2 border-ink bg-green px-3 py-0.5 font-heading text-[11px] font-bold text-white disabled:opacity-40"
        >
          {t('common.save')}
        </button>
        <button onClick={onCancel} className="rounded-full border-2 border-ink bg-paper px-3 py-0.5 font-heading text-[11px] font-bold text-ink">
          {t('common.cancel')}
        </button>
        {onDelete && (
          <button onClick={onDelete} className="ml-auto font-body text-[11px] font-bold text-coral-dark">
            {t('timesheet.delete')}
          </button>
        )}
      </div>
    </div>
  )
}
