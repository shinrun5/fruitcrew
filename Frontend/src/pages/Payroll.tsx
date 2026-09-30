import { useCallback, useEffect, useState } from 'react'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { addDaysYMD, durationLabel } from '../lib/time'
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
  const pill = (on: boolean) =>
    `rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold ${on ? 'bg-ink text-white' : 'bg-paper text-ink'}`
  const dateInput = 'min-w-0 rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none'

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('nav.mgr.payroll')}</h1>
      {mode === 'period' && <p className="mt-1 font-body text-xs text-muted-ink">{t('payroll.subtitle')}</p>}

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
            {data.periodStart} – {addDaysYMD(data.periodEnd, -1)}
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
              {t('payroll.showing', { from: data.periodStart, to: addDaysYMD(data.periodEnd, -1) })}
            </span>
          )}
        </form>
      )}
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-3">
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
      </div>

      <Card className="mt-4" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-body text-[13px]">
            <thead>
              <tr className="border-b-2 border-ink/10 text-muted-ink">
                <th className="p-2.5 text-left font-bold">{t('payroll.col.worker')}</th>
                <th className="p-2.5 text-right font-bold">{t('payroll.col.hours')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-3 text-center text-muted-ink">
                    {t('payroll.empty')}
                  </td>
                </tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.employeeId} className="border-t border-ink/10">
                  <td className="p-2.5 font-bold text-ink">{r.name}</td>
                  <td className="p-2.5 text-right text-ink">{durationLabel(r.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
