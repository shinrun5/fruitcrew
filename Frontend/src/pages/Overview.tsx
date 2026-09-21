import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../components/Card'
import { api } from '../lib/api'
import { useStore } from '../lib/store-context'
import { relativeTime, weekRangeLabel } from '../lib/time'
import type { OverviewStore } from '../types'

export function Overview() {
  const [stores, setStores] = useState<OverviewStore[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { setStoreId } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    api
      .getOverview()
      .then((d) => setStores(d.stores))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the overview'))
  }, [])

  if (error) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!stores) return <div className="p-6 font-body text-sm text-muted-ink">Loading…</div>

  const totalPending = stores.reduce((n, s) => n + s.pendingRequests, 0)
  const totalGaps = stores.reduce((n, s) => n + s.gapCount, 0)

  function open(storeId: number) {
    setStoreId(storeId)
    navigate('/schedule')
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">Overview</h1>
      <p className="mt-1 font-body text-sm text-muted-ink">
        {stores.length} store{stores.length === 1 ? '' : 's'}
        {totalPending > 0 && ` · ${totalPending} approval${totalPending === 1 ? '' : 's'} waiting`}
        {totalGaps > 0 && ` · ${totalGaps} coverage gap${totalGaps === 1 ? '' : 's'}`}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {stores.map((s) => (
          <Card key={s.storeId} clickable onClick={() => open(s.storeId)} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-heading text-base font-extrabold text-ink">{s.name}</span>
              {s.publishedAt ? (
                <span className="flex items-center gap-1.5 rounded-full border-2 border-green bg-paper px-2 py-0.5 font-body text-[10px] font-bold text-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-green" />
                  posted {relativeTime(s.publishedAt)}
                </span>
              ) : (
                <span className="rounded-full border-2 border-ink/25 px-2 py-0.5 font-body text-[10px] font-bold text-muted-ink">
                  not posted
                </span>
              )}
            </div>

            {s.weekStart && (
              <span className="font-body text-[11px] text-muted-ink">
                Week of {weekRangeLabel(s.weekStart)}
              </span>
            )}

            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-body text-xs">
              <Stat label="scheduled" value={`${s.shiftCount} shift${s.shiftCount === 1 ? '' : 's'}`} />
              <Stat label="staff hours" value={`${s.staffHours}h`} />
              {s.requirementCount === 0 ? (
                <Stat label="setup" value="no shift needs" tone="warn" />
              ) : s.gapCount > 0 ? (
                <Stat label="coverage" value={`${s.gapCount} short`} tone="warn" />
              ) : s.shiftCount > 0 ? (
                <Stat label="coverage" value="full" tone="ok" />
              ) : null}
              {s.openShifts > 0 && <Stat label="open" value={`${s.openShifts}`} tone="warn" />}
              {s.pendingRequests > 0 && (
                <Stat label="marketplace" value={`${s.pendingRequests} pending`} tone="warn" />
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
