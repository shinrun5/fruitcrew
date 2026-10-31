import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS, to12Hour } from '../lib/time'
import type { DayOfWeek, StoreHoursConfig } from '../types'

type WeekdayRow = StoreHoursConfig['weekday'][number]
type Usual = StoreHoursConfig['default']
const blankRow = (day: DayOfWeek): WeekdayRow => ({
  day,
  closed: false,
  openTime: null,
  closeTime: null,
  nightStart: null,
})
/** Whether a day really differs from the usual hours — a day set to exactly
 * the usual times (or left blank) isn't an exception and isn't saved as one. */
const differs = (r: WeekdayRow, u: Usual) =>
  r.closed ||
  (!!(r.openTime || r.closeTime || r.nightStart) &&
    !(r.openTime === u.openTime && r.closeTime === u.closeTime && r.nightStart === u.nightStart))
const exceptions = (rows: Record<string, WeekdayRow | undefined>, u: Usual) =>
  DAYS.map((d) => rows[d]).filter((r): r is WeekdayRow => !!r && differs(r, u))
const signature = (u: Usual, rows: Record<string, WeekdayRow>) => JSON.stringify({ u, days: exceptions(rows, u) })

const timeInput =
  'w-[6.75rem] rounded-lg border-2 border-ink bg-cream px-1.5 py-1 font-body text-[12px] text-ink outline-none'
const heading = 'font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink'

/** A store's hours, all in one place: the usual hours, the weekdays that
 * differ from them, and holidays / one-off dates. */
export function SpecialHoursEditor({ storeId, onSaved }: { storeId: number; onSaved?: () => void }) {
  const t = useT()
  const confirm = useConfirm()
  const [cfg, setCfg] = useState<StoreHoursConfig | null>(null)
  const [usual, setUsual] = useState<Usual>({ openTime: null, closeTime: null, nightStart: null })
  const [rows, setRows] = useState<Record<string, WeekdayRow>>({})
  // days opened with "Change" — shown with their own times even before they differ
  const [opened, setOpened] = useState<Set<DayOfWeek>>(new Set())
  const [savedSig, setSavedSig] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    return api
      .getStoreHours(storeId)
      .then((c) => {
        setCfg(c)
        const byDay: Record<string, WeekdayRow> = {}
        for (const d of DAYS) byDay[d] = c.weekday.find((w) => w.day === d) ?? blankRow(d)
        setUsual(c.default)
        setRows(byDay)
        setOpened(new Set())
        setSavedSig(signature(c.default, byDay))
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('stores.hours.errLoad')))
  }, [storeId, t])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = signature(usual, rows) !== savedSig

  function patch(day: DayOfWeek, p: Partial<WeekdayRow>) {
    setRows((r) => ({ ...r, [day]: { ...r[day], ...p } }))
  }
  function change(day: DayOfWeek) {
    // start from the usual times, so only what's different needs typing
    patch(day, { closed: false, openTime: usual.openTime, closeTime: usual.closeTime, nightStart: usual.nightStart })
    setOpened((s) => new Set(s).add(day))
  }
  function backToUsual(day: DayOfWeek) {
    setRows((r) => ({ ...r, [day]: blankRow(day) }))
    setOpened((s) => {
      const next = new Set(s)
      next.delete(day)
      return next
    })
  }

  async function save() {
    if (!usual.openTime !== !usual.closeTime) return setError(t('stores.hours.errPair'))
    setBusy(true)
    setError(null)
    try {
      await api.putStoreHours(storeId, { default: usual, weekday: exceptions(rows, usual) })
      await load()
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('stores.hours.errSave'))
    } finally {
      setBusy(false)
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('stores.errGeneric'))
    } finally {
      setBusy(false)
    }
  }

  if (!cfg) return <p className="mt-2 font-body text-xs text-muted-ink">{t('stores.hours.loading')}</p>

  const range = (open: string | null, close: string | null) => (open && close ? `${to12Hour(open)}–${to12Hour(close)}` : null)
  const usualRange = range(usual.openTime, usual.closeTime)
  const time = (value: string | null, set: (v: string | null) => void, label: string) => (
    <input
      type="time"
      step={1800}
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => set(e.target.value || null)}
      className={timeInput}
    />
  )

  return (
    <div className="mt-2 rounded-xl border-2 border-ink/15 bg-cream/40 p-2.5">
      {error && <p className="mb-1 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <p className={heading}>{t('stores.hours.usual')}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        <span className="flex items-center gap-1.5">
          {time(usual.openTime, (v) => setUsual((u) => ({ ...u, openTime: v })), t('stores.hours.opens'))}
          <span className="text-muted-ink">–</span>
          {time(usual.closeTime, (v) => setUsual((u) => ({ ...u, closeTime: v })), t('stores.hours.closes'))}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-body text-[10px] font-bold text-muted-ink">{t('stores.hours.night')}</span>
          {time(usual.nightStart, (v) => setUsual((u) => ({ ...u, nightStart: v })), t('stores.hours.night'))}
        </span>
      </div>
      <p className="mt-1 font-body text-[11px] text-muted-ink">
        {usualRange ? t('stores.hours.usualHint') : t('stores.hours.defaultFallback')}
      </p>

      <p className={`${heading} mt-3`}>{t('stores.hours.byDay')}</p>
      <div className="mt-1 flex flex-col divide-y divide-ink/10">
        {DAYS.map((d) => {
          const r = rows[d]
          const own = opened.has(d) || differs(r, usual)
          return (
            <div key={d} className="py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-9 shrink-0 font-body text-[12px] font-bold text-ink">{DAY_LABEL[d]}</span>
                {own ? (
                  <label className="flex items-center gap-1 font-body text-[11px] font-bold text-muted-ink">
                    <input type="checkbox" checked={r.closed} onChange={(e) => patch(d, { closed: e.target.checked })} />
                    {t('stores.hours.closed')}
                  </label>
                ) : (
                  <span className="min-w-0 truncate font-body text-[12px] text-muted-ink">
                    {usualRange ? `${t('stores.hours.usual')} · ${usualRange}` : t('stores.hours.usual')}
                  </span>
                )}
                <button
                  onClick={() => (own ? backToUsual(d) : change(d))}
                  className="ml-auto shrink-0 font-body text-[11px] font-bold text-sky-dark"
                >
                  {own ? t('stores.hours.useUsual') : t('stores.hours.change')}
                </button>
              </div>
              {own && !r.closed && (
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 pl-11">
                  <span className="flex items-center gap-1.5">
                    {time(r.openTime, (v) => patch(d, { openTime: v }), t('stores.hours.opens'))}
                    <span className="text-muted-ink">–</span>
                    {time(r.closeTime, (v) => patch(d, { closeTime: v }), t('stores.hours.closes'))}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-body text-[10px] font-bold text-muted-ink">{t('stores.hours.night')}</span>
                    {time(r.nightStart, (v) => patch(d, { nightStart: v }), t('stores.hours.night'))}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {dirty && (
        <button
          onClick={() => void save()}
          disabled={busy}
          className="mt-2 rounded-full border-2 border-ink bg-green px-3 py-0.5 font-heading text-[11px] font-bold text-white disabled:opacity-50"
        >
          {t('stores.hours.saveDayHours')}
        </button>
      )}

      <p className={`${heading} mt-3`}>{t('stores.hours.holidaysTitle')}</p>
      {cfg.holidays.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {cfg.holidays.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-body text-[11px]">
              <span className="font-bold text-ink">{h.date}</span>
              {h.label && <span className="text-muted-ink">{h.label}</span>}
              <span className={h.closed ? 'font-bold text-coral-dark' : 'text-ink'}>
                {h.closed ? t('stores.hours.holidayClosed') : (range(h.openTime, h.closeTime) ?? '?')}
              </span>
              <button
                onClick={async () => {
                  if (
                    await confirm(t('stores.hours.confirmRemoveHoliday', { date: h.label ? `${h.date} (${h.label})` : h.date }), {
                      tone: 'danger',
                      confirmLabel: t('stores.hours.removeBtn'),
                    })
                  )
                    void act(() => api.deleteStoreHoliday(storeId, h.id))
                }}
                disabled={busy}
                className="font-bold text-muted-ink underline disabled:opacity-50"
              >
                {t('stores.hours.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <AddHoliday storeId={storeId} onAdded={() => void load()} onError={setError} />
    </div>
  )
}

function AddHoliday({
  storeId,
  onAdded,
  onError,
}: {
  storeId: number
  onAdded: () => void
  onError: (m: string | null) => void
}) {
  const t = useT()
  const [date, setDate] = useState('')
  const [label, setLabel] = useState('')
  const [closed, setClosed] = useState(true)
  const [openTime, setOpenTime] = useState('')
  const [closeTime, setCloseTime] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!date) return
    onError(null)
    setBusy(true)
    try {
      await api.addStoreHoliday(storeId, {
        date,
        label: label.trim() || undefined,
        closed,
        openTime: closed ? null : openTime || null,
        closeTime: closed ? null : closeTime || null,
      })
      setDate('')
      setLabel('')
      setClosed(true)
      setOpenTime('')
      setCloseTime('')
      onAdded()
    } catch (err) {
      onError(err instanceof Error ? err.message : t('stores.hours.errAddHoliday'))
    } finally {
      setBusy(false)
    }
  }

  const inp = 'rounded-lg border-2 border-ink bg-cream px-1.5 py-1 font-body text-[11px] text-ink outline-none'
  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} required />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('stores.hours.labelPlaceholder')}
          className={`${inp} min-w-[7rem] flex-1`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="flex items-center gap-1 font-body text-[11px] font-bold text-muted-ink">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
          {t('stores.hours.closed')}
        </label>
        {!closed && (
          <>
            <input type="time" step={1800} value={openTime} onChange={(e) => setOpenTime(e.target.value)} className={inp} />
            <span className="text-muted-ink">–</span>
            <input type="time" step={1800} value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className={inp} />
          </>
        )}
        <button
          type="submit"
          disabled={busy || !date}
          className="ml-auto rounded-full border-2 border-ink bg-green px-3 py-0.5 font-heading text-[11px] font-bold text-white disabled:opacity-50"
        >
          {t('stores.hours.addHoliday')}
        </button>
      </div>
    </form>
  )
}
