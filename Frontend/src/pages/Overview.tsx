import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store-context'
import { relativeTime, weekRangeLabel } from '../lib/time'
import type { OverviewStore } from '../types'

export function Overview() {
  const t = useT()
  const [stores, setStores] = useState<OverviewStore[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { setStoreId } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    api
      .getOverview()
      .then((d) => setStores(d.stores))
      .catch((e) => setError(e instanceof Error ? e.message : t('overview.err.load')))
  }, [])

  if (error) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!stores) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  const totalPending = stores.reduce((n, s) => n + s.pendingRequests, 0)
  const totalGaps = stores.reduce((n, s) => n + s.gapCount, 0)

  function open(storeId: number) {
    setStoreId(storeId)
    navigate('/schedule')
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('overview.title')}</h1>
      <p className="mt-1 font-body text-sm text-muted-ink">
        {stores.length === 1
          ? t('overview.storeCount.one', { n: stores.length })
          : t('overview.storeCount', { n: stores.length })}
        {totalPending > 0 &&
          (totalPending === 1
            ? t('overview.pendingSuffix.one', { n: totalPending })
            : t('overview.pendingSuffix', { n: totalPending }))}
        {totalGaps > 0 &&
          (totalGaps === 1
            ? t('overview.gapsSuffix.one', { n: totalGaps })
            : t('overview.gapsSuffix', { n: totalGaps }))}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {stores.map((s) => (
          <Card key={s.storeId} clickable onClick={() => open(s.storeId)} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-heading text-base font-extrabold text-ink">{s.name}</span>
              {s.publishedAt ? (
                <span className="flex items-center gap-1.5 rounded-full border-2 border-green bg-paper px-2 py-0.5 font-body text-[10px] font-bold text-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-green" />
                  {t('overview.posted', { ago: relativeTime(s.publishedAt) })}
                </span>
              ) : (
                <span className="rounded-full border-2 border-ink/25 px-2 py-0.5 font-body text-[10px] font-bold text-muted-ink">
                  {t('overview.notPosted')}
                </span>
              )}
            </div>

            {s.weekStart && (
              <span className="font-body text-[11px] text-muted-ink">
                {t('overview.weekOf', { range: weekRangeLabel(s.weekStart) })}
              </span>
            )}

            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-body text-xs">
              <Stat
                label={t('overview.stat.scheduled')}
                value={
                  s.shiftCount === 1
                    ? t('overview.shiftCount.one', { n: s.shiftCount })
                    : t('overview.shiftCount', { n: s.shiftCount })
                }
              />
              <Stat label={t('overview.stat.staffHours')} value={t('overview.hoursValue', { n: s.staffHours })} />
              {s.requirementCount === 0 ? (
                <Stat label={t('overview.stat.setup')} value={t('overview.noShiftNeeds')} tone="warn" />
              ) : s.gapCount > 0 ? (
                <Stat
                  label={t('overview.stat.coverage')}
                  value={t('overview.short', { n: s.gapCount })}
                  tone="warn"
                />
              ) : s.shiftCount > 0 ? (
                <Stat label={t('overview.stat.coverage')} value={t('overview.full')} tone="ok" />
              ) : null}
              {s.openShifts > 0 && (
                <Stat label={t('overview.stat.open')} value={`${s.openShifts}`} tone="warn" />
              )}
              {s.pendingRequests > 0 && (
                <Stat
                  label={t('overview.stat.marketplace')}
                  value={t('overview.pendingValue', { n: s.pendingRequests })}
                  tone="warn"
                />
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'ok' | 'warn'
}) {
  const color = tone === 'warn' ? 'text-coral-dark' : tone === 'ok' ? 'text-green' : 'text-ink'
  return (
    <span>
      <b className={`font-bold ${color}`}>{value}</b>{' '}
      <span className="text-muted-ink">{label}</span>
    </span>
  )
}
