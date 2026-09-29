import { useCallback, useEffect, useState } from 'react'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { addDaysYMD } from '../lib/time'
import type { HoursSummary } from '../types'

export function Payroll() {
  const t = useT()
  const [data, setData] = useState<HoursSummary | null>(null)
  const [anchor, setAnchor] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .getHoursSummary(anchor)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : t('payroll.errLoad')))
  }, [anchor, t])
  useEffect(() => {
    void load()
  }, [load])

  if (error) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!data) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  const totalHours = Math.round(data.rows.reduce((n, r) => n + r.hours, 0) * 10) / 10

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('nav.mgr.payroll')}</h1>
      <p className="mt-1 font-body text-xs text-muted-ink">{t('payroll.subtitle')}</p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          onClick={() => setAnchor(addDaysYMD(data.periodStart, -1))}
          className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink"
        >
          {t('payroll.prev')}
        </button>
        <span className="font-heading text-sm font-bold text-ink">
          {data.periodStart} – {addDaysYMD(data.periodEnd, -1)}
        </span>
        <button
          onClick={() => setAnchor(data.periodEnd)}
          className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink"
        >
          {t('payroll.next')}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 text-center shadow-[3px_3px_0_var(--color-ink)]">
          <div className="font-heading text-xl font-extrabold text-ink">{data.rows.length}</div>
          <div className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
            {t('payroll.stat.workers')}
          </div>
        </div>
        <div className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 text-center shadow-[3px_3px_0_var(--color-ink)]">
          <div className="font-heading text-xl font-extrabold text-ink">{totalHours}</div>
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
                  <td className="p-2.5 text-right text-ink">{r.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
