import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { relativeTime, weekRangeLabel } from '../lib/time'
import type { AccountDeletionRequest, AdminOrgDetail, AdminOrgSummary, SignupRequest } from '../types'

/** Read-only cross-org oversight for whoever operates the hosting — not a way
 * to act inside a customer's org — plus the one exception: approving or
 * declining a business's request to join the platform. */
export function Admin() {
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [pending, setPending] = useState<SignupRequest[] | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<number | null>(null)

  const [pendingDeletions, setPendingDeletions] = useState<AccountDeletionRequest[] | null>(null)
  const [deletionError, setDeletionError] = useState<string | null>(null)
  const [decidingDeletionId, setDecidingDeletionId] = useState<number | null>(null)

  function loadPending() {
    api
      .getSignupRequests('PENDING')
      .then(setPending)
      .catch((e) => setPendingError(e instanceof Error ? e.message : 'Could not load signup requests'))
  }

  function loadPendingDeletions() {
    api
      .getDeletionRequests('PENDING')
      .then(setPendingDeletions)
      .catch((e) => setDeletionError(e instanceof Error ? e.message : 'Could not load deletion requests'))
  }

  useEffect(() => {
    api
      .getAdminOrgs()
      .then(setOrgs)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load orgs'))
    loadPending()
    loadPendingDeletions()
  }, [])

  async function decide(id: number, action: 'approve' | 'decline') {
    setDecidingId(id)
    setPendingError(null)
    try {
      if (action === 'approve') await api.approveSignupRequest(id)
      else await api.declineSignupRequest(id)
      setPending((p) => p?.filter((r) => r.id !== id) ?? p)
      if (action === 'approve') {
        api
          .getAdminOrgs()
          .then(setOrgs)
          .catch(() => {})
      }
    } catch (e) {
      setPendingError(e instanceof Error ? e.message : 'Could not update that request')
    } finally {
      setDecidingId(null)
    }
  }

  async function decideDeletion(id: number, action: 'fulfill' | 'decline') {
    setDecidingDeletionId(id)
    setDeletionError(null)
    try {
      if (action === 'fulfill') await api.fulfillDeletionRequest(id)
      else await api.declineDeletionRequest(id)
      setPendingDeletions((p) => p?.filter((r) => r.id !== id) ?? p)
    } catch (e) {
      setDeletionError(e instanceof Error ? e.message : 'Could not update that request')
    } finally {
      setDecidingDeletionId(null)
    }
  }

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

      <h2 className="mt-6 font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">
        Pending signups
      </h2>
      {pendingError && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{pendingError}</p>}
      {!pending ? (
        <p className="mt-2 font-body text-xs text-muted-ink">Loading…</p>
      ) : pending.length === 0 ? (
        <p className="mt-2 font-body text-xs text-muted-ink">Nothing waiting on you.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {pending.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border-[2.5px] border-ink bg-paper p-4 shadow-[3px_3px_0_var(--color-ink)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-heading text-base font-extrabold text-ink">{r.businessName}</span>
                  <span className="ml-2 font-body text-[11px] text-muted-ink">
                    requested {relativeTime(r.createdAt)}
                  </span>
                  <div className="mt-0.5 font-body text-xs text-muted-ink">
                    {r.contactName} · {r.email}
                    {r.phone ? ` · ${r.phone}` : ''}
                  </div>
                  {r.message && <p className="mt-1.5 font-body text-xs text-ink">{r.message}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void decide(r.id, 'decline')}
                    disabled={decidingId === r.id}
                    className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => void decide(r.id, 'approve')}
                    disabled={decidingId === r.id}
                    className="rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-xs font-bold text-white disabled:opacity-50"
                  >
                    {decidingId === r.id ? 'Working…' : 'Approve'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-6 font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">
        Pending deletions
      </h2>
      {deletionError && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{deletionError}</p>}
      {!pendingDeletions ? (
        <p className="mt-2 font-body text-xs text-muted-ink">Loading…</p>
      ) : pendingDeletions.length === 0 ? (
        <p className="mt-2 font-body text-xs text-muted-ink">Nothing waiting on you.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {pendingDeletions.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border-[2.5px] border-ink bg-paper p-4 shadow-[3px_3px_0_var(--color-ink)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-heading text-base font-extrabold text-ink">{r.email}</span>
                  <span className="ml-2 font-body text-[11px] text-muted-ink">
                    requested {relativeTime(r.createdAt)}
                  </span>
                  {r.reason && <p className="mt-1.5 font-body text-xs text-ink">{r.reason}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void decideDeletion(r.id, 'decline')}
                    disabled={decidingDeletionId === r.id}
                    className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => void decideDeletion(r.id, 'fulfill')}
                    disabled={decidingDeletionId === r.id}
                    className="rounded-full border-2 border-ink bg-coral-dark px-3 py-1 font-heading text-xs font-bold text-white disabled:opacity-50"
                  >
                    {decidingDeletionId === r.id ? 'Working…' : 'Delete account'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-6 font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">Orgs</h2>
      <div className="mt-2 flex flex-col gap-3">
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
