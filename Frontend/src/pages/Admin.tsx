import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { relativeTime, weekRangeLabel } from '../lib/time'
import type { AdminOrgDetail, AdminOrgSummary } from '../types'

/** Read-only cross-org oversight for whoever operates the hosting — not a way
 * to act inside a customer's org, just to see who's on the platform. */
export function Admin() {
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getAdminOrgs()
      .then(setOrgs)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load orgs'))
  }, [])

  function open(id: number) {
    if (openId === id) {
      setOpenId(null)
      setDetail(null)
      return
    }
    setOpenId(id)
    setDetail(null)
    setDetailError(null)
    api
      .getAdminOrg(id)
      .then(setDetail)
      .catch((e) => setDetailError(e instanceof Error ? e.message : 'Could not load that org'))
  }

  if (error) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!orgs) return <div className="p-6 font-body text-sm text-muted-ink">Loading…</div>

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">Admin</h1>
      <p className="mt-1 font-body text-sm text-muted-ink">
        {orgs.length} org{orgs.length === 1 ? '' : 's'} on the platform — read-only, for support and
        debugging.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {orgs.map((o) => (
          <div key={o.id} className="rounded-2xl border-[2.5px] border-ink bg-paper shadow-[3px_3px_0_var(--color-ink)]">
            <button
              onClick={() => open(o.id)}
              className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left"
            >
              <div>
                <span className="font-heading text-base font-extrabold text-ink">{o.name}</span>
                <span className="ml-2 font-body text-[11px] text-muted-ink">
                  since {relativeTime(o.createdAt)}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-body text-xs">
                <span>
                  <b className="font-bold text-ink">{o.storeCount}</b>{' '}
                  <span className="text-muted-ink">store{o.storeCount === 1 ? '' : 's'}</span>
                </span>
                <span>
                  <b className="font-bold text-ink">{o.employeeCount}</b>{' '}
                  <span className="text-muted-ink">worker{o.employeeCount === 1 ? '' : 's'}</span>
                </span>
                <span className="text-muted-ink">{o.owners.join(', ') || 'no owner'}</span>
              </div>
            </button>

            {openId === o.id && (
              <div className="border-t-2 border-ink/10 p-4">
                {detailError ? (
                  <p className="font-body text-xs font-bold text-coral-dark">{detailError}</p>
                ) : !detail ? (
                  <p className="font-body text-xs text-muted-ink">Loading…</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div>
                      <h2 className="font-heading text-xs font-bold uppercase tracking-wide text-muted-ink">
                        Stores
                      </h2>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        {detail.stores.map((s) => (
                          <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-body text-xs">
                            <span className="font-bold text-ink">{s.name}</span>
                            <span className="text-muted-ink">{s.employeeCount} workers</span>
                            {s.weekStart && (
                              <span className="text-muted-ink">week of {weekRangeLabel(s.weekStart)}</span>
                            )}
                            <span className={s.publishedAt ? 'font-bold text-green' : 'text-muted-ink'}>
                              {s.publishedAt ? `posted ${relativeTime(s.publishedAt)}` : 'not posted'}
                            </span>
                          </div>
                        ))}
                        {detail.stores.length === 0 && (
                          <p className="font-body text-xs text-muted-ink">No stores yet.</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <h2 className="font-heading text-xs font-bold uppercase tracking-wide text-muted-ink">
                        Owners &amp; managers
                      </h2>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        {detail.people.map((p) => (
                          <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-body text-xs">
                            <span className="font-bold text-ink">{p.email}</span>
                            <span className="rounded-full border border-ink/25 px-1.5 py-px text-[10px] font-bold text-muted-ink">
                              {p.role}
                            </span>
                            <span className="text-muted-ink">joined {relativeTime(p.createdAt)}</span>
                          </div>
                        ))}
                        {detail.people.length === 0 && (
                          <p className="font-body text-xs text-muted-ink">Nobody yet.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
