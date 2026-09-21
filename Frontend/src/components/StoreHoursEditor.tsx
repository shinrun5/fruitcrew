import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS } from '../lib/time'
import type { DayOfWeek, StoreHoursConfig } from '../types'

type WeekdayRow = StoreHoursConfig['weekday'][number]
const blankRow = (day: DayOfWeek): WeekdayRow => ({
  day,
  closed: false,
  openTime: null,
  closeTime: null,
  nightStart: null,
})
const isNoop = (r: WeekdayRow) => !r.closed && !r.openTime && !r.closeTime && !r.nightStart

const timeInput =
  'w-[6.75rem] rounded-lg border-2 border-ink bg-cream px-1.5 py-1 font-body text-[12px] text-ink outline-none'

/** Manager editor for a store's per-weekday hours and holiday dates. */
export function StoreHoursEditor({ storeId }: { storeId: number }) {
  const t = useT()
  const [cfg, setCfg] = useState<StoreHoursConfig | null>(null)
  const [rows, setRows] = useState<Record<string, WeekdayRow>>({})
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
        setRows(byDay)
        setSavedSig(JSON.stringify(byDay))
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('stores.hours.errLoad')))
  }, [storeId, t])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = JSON.stringify(rows) !== savedSig

  function patch(day: DayOfWeek, p: Partial<WeekdayRow>) {
    setRows((r) => ({ ...r, [day]: { ...r[day], ...p } }))
  }

  async function saveWeekdays() {
    setBusy(true)
    setError(null)
    try {
      await api.putStoreWeekdayHours(
        storeId,
        DAYS.map((d) => rows[d]).filter((r) => !isNoop(r)),
      )
      await load()
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

  const dflt = cfg.default
  const dfltLabel =
    dflt.openTime && dflt.closeTime ? `${dflt.openTime}–${dflt.closeTime}` : t('stores.hours.defaultFallback')

  return (
    <div className="mt-2 rounded-xl border-2 border-ink/15 bg-cream/40 p-2.5">
      {error && <p className="mb-1 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <p className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
        {t('stores.hours.byDay')}{' '}
        <span className="font-normal normal-case">{t('stores.hours.blankHint', { default: dfltLabel })}</span>
      </p>
      <div className="mt-1 flex flex-col divide-y divide-ink/10">
        {DAYS.map((d) => {
          const r = rows[d]
          return (
            <div key={d} className="py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-9 shrink-0 font-body text-[12px] font-bold text-ink">
                  {DAY_LABEL[d]}
                </span>
                <label className="flex items-center gap-1 font-body text-[11px] font-bold text-muted-ink">
                  <input
                    type="checkbox"
                    checked={r.closed}
                    onChange={(e) => patch(d, { closed: e.target.checked })}
                  />
                  {t('stores.hours.closed')}
                </label>
              </div>
              {!r.closed && (
                <div className="mt-1 flex flex-col gap-1 pl-11">
                  <span className="flex items-center gap-1.5">
                    <input
                      type="time"
                      step={1800}
                      value={r.openTime ?? ''}
                      onChange={(e) => patch(d, { openTime: e.target.value || null })}
                      className={timeInput}
                    />
                    <span className="text-muted-ink">–</span>
                    <input
                      type="time"
                      step={1800}
                      value={r.closeTime ?? ''}
                      onChange={(e) => patch(d, { closeTime: e.target.value || null })}
                      className={timeInput}
                    />
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-10 font-body text-[10px] font-bold text-muted-ink">
                      {t('stores.hours.night')}
                    </span>
                    <input
                      type="time"
                      step={1800}
                      value={r.nightStart ?? ''}
                      onChange={(e) => patch(d, { nightStart: e.target.value || null })}
                      className={timeInput}
                    />
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {dirty && (
        <button
          onClick={() => void saveWeekdays()}
          disabled={busy}
          className="mt-2 rounded-full border-2 border-ink bg-green px-3 py-0.5 font-heading text-[11px] font-bold text-white disabled:opacity-50"
        >
          {t('stores.hours.saveDayHours')}
        </button>
      )}

      <p className="mt-3 font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
        {t('stores.hours.holidaysTitle')}
      </p>
      {cfg.holidays.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {cfg.holidays.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-body text-[11px]">
              <span className="font-bold text-ink">{h.date}</span>
              {h.label && <span className="text-muted-ink">{h.label}</span>}
              <span className={h.closed ? 'font-bold text-coral-dark' : 'text-ink'}>
                {h.closed ? t('stores.hours.holidayClosed') : `${h.openTime ?? '?'}–${h.closeTime ?? '?'}`}
              </span>
              <button
                onClick={() => void act(() => api.deleteStoreHoliday(storeId, h.id))}
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
