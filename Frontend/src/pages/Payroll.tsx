import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { money } from '../lib/pay'
import { csvRow, saveFile } from '../lib/saveFile'
import { addDaysYMD, dateRangeLabel, durationLabel } from '../lib/time'
import type { HoursSummary } from '../types'

type Query = { anchor?: string } | { from: string; to: string }

export function Payroll() {
  const t = useT()
  const [data, setData] = useState<HoursSummary | null>(null)
  const [query, setQuery] = useState<Query>({})
  const [mode, setMode] = useState<'period' | 'custom'>('period')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    api
      .getHoursSummary(query)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : t('payroll.errLoad')))
  }, [query, t])
  useEffect(() => {
    void load()
  }, [load])

  if (error && !data) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!data) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  const totalMinutes = data.rows.reduce((n, r) => n + r.minutes, 0)
  const seePay = !!data.canSeePay
  const totalPay = data.rows.reduce((n, r) => n + (r.payCents ?? 0), 0)
  const unrated = data.rows.filter((r) => r.minutes > 0 && r.payCents == null).length
  const lastDay = addDaysYMD(data.periodEnd, -1)
  const range = dateRangeLabel(data.periodStart, lastDay)
  const clock = data.timeClock

  // decimal hours (what payroll services import), regular and overtime apart
  function exportCsv() {
    if (!data) return
    const h = (m: number) => (m / 60).toFixed(2)
    const $ = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2))
    const lines = [
      csvRow([
        t('payroll.col.worker'),
        t('payroll.csv.total'),
        t('payroll.csv.regular'),
        t('payroll.csv.overtime'),
        ...(seePay ? [t('payroll.csv.rate'), t('payroll.csv.pay')] : []),
      ]),
      ...data.rows.map((r) =>
        csvRow([
          r.name,
          h(r.minutes),
          h(r.minutes - r.overtimeMinutes),
          h(r.overtimeMinutes),
          ...(seePay ? [$(r.payRateCents), $(r.payCents)] : []),
        ]),
      ),
    ]
    void saveFile(
      `hours-${data.periodStart}-to-${lastDay}.csv`,
      new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }),
      t('payroll.csv.title', { range }),
    )
  }
  const pill = (on: boolean) =>
    `rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold ${on ? 'bg-ink text-white' : 'bg-paper text-ink'}`
  const dateInput = 'min-w-0 rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none'

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-lg font-bold text-ink">{t('nav.mgr.payroll')}</h1>
        <button
          onClick={exportCsv}
          disabled={data.rows.length === 0}
          className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink disabled:opacity-40"
        >
          {t('payroll.csv.btn')}
        </button>
      </div>
      {mode === 'period' && <p className="mt-1 font-body text-xs text-muted-ink">{t('payroll.subtitle')}</p>}

      {clock && (
        <Link
          to="/payroll/timesheets"
          className="mt-3 flex items-center gap-2 rounded-2xl border-[2.5px] border-ink bg-paper px-3 py-2.5 shadow-[3px_3px_0_var(--color-ink)]"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-heading text-sm font-bold text-ink">{t('timesheet.title')}</span>
            <span className="block font-body text-[11px] text-muted-ink">
              {clock.unapproved + clock.open === 0
                ? t('payroll.clock.allSet')
                : [
                    clock.unapproved > 0 && t('payroll.clock.toApprove', { n: clock.unapproved }),
                    clock.open > 0 && t('payroll.clock.open', { n: clock.open }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
          </span>
          <span aria-hidden className="font-heading text-base text-muted-ink">
            ›
          </span>
        </Link>
      )}

      <div className="mt-3 flex gap-2">
        <button
          className={pill(mode === 'period')}
          onClick={() => {
            setMode('period')
            setQuery({})
          }}
        >
          {t('payroll.mode.period')}
        </button>
        <button
          className={pill(mode === 'custom')}
          onClick={() => {
            // start from whatever's on screen, so a small tweak is a small edit
            setFrom(data.periodStart)
            setTo(addDaysYMD(data.periodEnd, -1))
            setMode('custom')
          }}
        >
          {t('payroll.mode.custom')}
        </button>
      </div>

      {mode === 'period' ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            onClick={() => setQuery({ anchor: addDaysYMD(data.periodStart, -1) })}
            className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink"
          >
            {t('payroll.prev')}
          </button>
          <span className="font-heading text-sm font-bold text-ink">
            {range}
          </span>
          <button
            onClick={() => setQuery({ anchor: data.periodEnd })}
            className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink"
          >
            {t('payroll.next')}
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (from && to) setQuery({ from, to })
          }}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col gap-1 font-body text-[10px] font-bold text-muted-ink">
            {t('payroll.from')}
            <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className={dateInput} />
          </label>
          <label className="flex flex-col gap-1 font-body text-[10px] font-bold text-muted-ink">
            {t('payroll.to')}
            <input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} className={dateInput} />
          </label>
          <button
            type="submit"
            className="rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-xs font-bold text-white"
          >
            {t('payroll.show')}
          </button>
          {'from' in query && (
            <span className="basis-full font-body text-xs text-muted-ink">
              {t('payroll.showing', { range })}
            </span>
          )}
        </form>
      )}
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <div className={`mt-3 grid gap-3 ${seePay ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 text-center shadow-[3px_3px_0_var(--color-ink)]">
          <div className="font-heading text-xl font-extrabold text-ink">{data.rows.length}</div>
          <div className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
            {t('payroll.stat.workers')}
          </div>
        </div>
        <div className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 text-center shadow-[3px_3px_0_var(--color-ink)]">
          <div className="font-heading text-xl font-extrabold text-ink">{durationLabel(totalMinutes)}</div>
          <div className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
            {t('payroll.stat.totalHours')}
          </div>
        </div>
        {seePay && (
          <div className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 text-center shadow-[3px_3px_0_var(--color-ink)]">
            <div className="font-heading text-xl font-extrabold text-ink">{money(totalPay)}</div>
            <div className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
              {t('payroll.stat.pay')}
            </div>
          </div>
        )}
      </div>

      <Card className="mt-4" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-body text-[13px]">
            <thead>
              <tr className="border-b-2 border-ink/10 text-muted-ink">
                <th className="p-2.5 text-left font-bold">{t('payroll.col.worker')}</th>
                <th className="p-2.5 text-right font-bold">{t('payroll.col.hours')}</th>
                <th className="p-2.5 text-right font-bold">{t('payroll.col.overtime')}</th>
                {seePay && <th className="p-2.5 text-right font-bold">{t('payroll.col.pay')}</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={seePay ? 4 : 3} className="p-3 text-center text-muted-ink">
                    {t('payroll.empty')}
                  </td>
                </tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.employeeId} className="border-t border-ink/10">
                  <td className="p-2.5 font-bold text-ink">{r.name}</td>
                  <td className="p-2.5 text-right text-ink">{durationLabel(r.minutes)}</td>
                  <td className={`p-2.5 text-right ${r.overtimeMinutes > 0 ? 'font-bold text-coral-dark' : 'text-muted-ink'}`}>
                    {r.overtimeMinutes > 0 ? durationLabel(r.overtimeMinutes) : '—'}
                  </td>
                  {seePay && (
                    <td className="p-2.5 text-right text-ink">
                      {r.payCents != null ? money(r.payCents) : <span className="text-muted-ink">{t('payroll.noRate')}</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-2 font-body text-[11px] text-muted-ink">
        {!clock
          ? t('payroll.note')
          : clock.allStores
            ? t('payroll.note.clock')
            : t('payroll.note.mixed', { stores: clock.stores.join(', ') })}
        {seePay && ` ${t('payroll.payNote')}`}
        {seePay && unrated > 0 && (
          <>
            {' '}
            <Link to="/team" className="font-bold text-coral-dark">
              {t(unrated === 1 ? 'payroll.unrated.one' : 'payroll.unrated', { n: unrated })}
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
