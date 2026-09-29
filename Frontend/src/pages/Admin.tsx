import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { CopyButton } from '../components/CopyButton'
import { Field } from '../components/Field'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useCopy } from '../lib/use-copy'
import { useT } from '../lib/i18n'
import { STORE_ID_KEY } from '../lib/store-context'
import { relativeTime, weekRangeLabel } from '../lib/time'
import type { AccountDeletionRequest, AdminOrgDetail, AdminOrgSummary, AdminStoreSummary, SignupRequest } from '../types'

/** Cross-org oversight for whoever operates the hosting: platform stats, every
 * store with a way to jump straight into managing one (see StatsAndStores),
 * every org with who runs it, and the signup/deletion approval queues. */
export function Admin() {
  const t = useT()
  const confirm = useConfirm()
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [orgActionBusy, setOrgActionBusy] = useState<number | null>(null)
  const [orgActionError, setOrgActionError] = useState<string | null>(null)

  const [stores, setStores] = useState<AdminStoreSummary[] | null>(null)
  const [storesError, setStoresError] = useState<string | null>(null)

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
      .catch((e) => setPendingError(e instanceof Error ? e.message : t('admin.err.loadSignups')))
  }

  function loadPendingDeletions() {
    api
      .getDeletionRequests('PENDING')
      .then(setPendingDeletions)
      .catch((e) => setDeletionError(e instanceof Error ? e.message : t('admin.err.loadDeletions')))
  }

  function loadOrgsAndStores() {
    api
      .getAdminOrgs()
      .then(setOrgs)
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.err.loadOrgs')))
    api
      .getAdminStores()
      .then(setStores)
      .catch((e) => setStoresError(e instanceof Error ? e.message : t('admin.err.loadStores')))
  }

  useEffect(() => {
    loadOrgsAndStores()
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
      setPendingError(e instanceof Error ? e.message : t('admin.err.updateRequest'))
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
      setDeletionError(e instanceof Error ? e.message : t('admin.err.updateRequest'))
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
      .catch((e) => setDetailError(e instanceof Error ? e.message : t('admin.err.loadOrgDetail')))
  }

  async function orgAction(id: number, fn: () => Promise<unknown>) {
    setOrgActionBusy(id)
    setOrgActionError(null)
    try {
      await fn()
      loadOrgsAndStores()
      if (openId === id) open(id) // close, since a paused/deleted org has nothing to manage
    } catch (e) {
      setOrgActionError(e instanceof Error ? e.message : t('admin.err.orgAction'))
    } finally {
      setOrgActionBusy(null)
    }
  }

  function pauseOrg(o: AdminOrgSummary) {
    void confirm(t('admin.confirmPause', { name: o.name }), { tone: 'danger', confirmLabel: t('admin.pause') }).then(
      (ok) => {
        if (ok) void orgAction(o.id, () => api.pauseAdminOrg(o.id))
      },
    )
  }
  function deleteOrg(o: AdminOrgSummary) {
    void confirm(t('admin.confirmDelete', { name: o.name }), { tone: 'danger', confirmLabel: t('admin.deleteOrg') }).then(
      (ok) => {
        if (ok) void orgAction(o.id, () => api.deleteAdminOrg(o.id))
      },
    )
  }
  // no confirm on the way back in — undoing a lockout is never the risky direction
  const unpauseOrg = (o: AdminOrgSummary) => void orgAction(o.id, () => api.unpauseAdminOrg(o.id))
  const restoreOrg = (o: AdminOrgSummary) => void orgAction(o.id, () => api.restoreAdminOrg(o.id))

  const activeOrgs = useMemo(() => orgs?.filter((o) => !o.deletedAt) ?? [], [orgs])
  const deletedOrgs = useMemo(() => orgs?.filter((o) => o.deletedAt) ?? [], [orgs])

  const stats = useMemo(
    () => ({
      orgs: activeOrgs.length,
      stores: activeOrgs.reduce((n, o) => n + o.storeCount, 0),
      workers: activeOrgs.reduce((n, o) => n + o.employeeCount, 0),
    }),
    [activeOrgs],
  )

  if (error) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!orgs) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('admin.title')}</h1>
      <p className="mt-1 font-body text-sm text-muted-ink">
        {orgs.length === 1
          ? t('admin.subtitle.one', { n: orgs.length })
          : t('admin.subtitle', { n: orgs.length })}
      </p>

      <CreateOrgPanel onCreated={loadOrgsAndStores} />

      {stats && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatCard label={t('admin.stat.orgs')} value={stats.orgs} />
          <StatCard label={t('admin.stat.stores')} value={stats.stores} />
          <StatCard label={t('admin.stat.workers')} value={stats.workers} />
        </div>
      )}

      <h2 className="mt-6 font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">
        {t('admin.allStores.title')}
      </h2>
      {storesError && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{storesError}</p>}
      {!stores ? (
        <p className="mt-2 font-body text-xs text-muted-ink">{t('common.loading')}</p>
      ) : stores.length === 0 ? (
        <p className="mt-2 font-body text-xs text-muted-ink">{t('admin.nothingWaiting')}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {stores
            .filter((s) => s.parentStoreId == null)
            .map((s) => (
              <div key={s.id} className="flex flex-col gap-2">
                <StoreRow store={s} />
                {stores
                  .filter((sec) => sec.parentStoreId === s.id)
                  .map((sec) => (
                    <div key={sec.id} className="ml-4 border-l-2 border-ink/15 pl-3 sm:ml-6">
                      <StoreRow store={sec} isSection />
                    </div>
                  ))}
              </div>
            ))}
        </div>
      )}

      <h2 className="mt-6 font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">
        {t('admin.pendingSignups.title')}
      </h2>
      {pendingError && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{pendingError}</p>}
      {!pending ? (
        <p className="mt-2 font-body text-xs text-muted-ink">{t('common.loading')}</p>
      ) : pending.length === 0 ? (
        <p className="mt-2 font-body text-xs text-muted-ink">{t('admin.nothingWaiting')}</p>
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
                    {t('admin.requestedAgo', { ago: relativeTime(r.createdAt) })}
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
                    {t('admin.decline')}
                  </button>
                  <button
                    onClick={() => void decide(r.id, 'approve')}
                    disabled={decidingId === r.id}
                    className="rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-xs font-bold text-white disabled:opacity-50"
                  >
                    {decidingId === r.id ? t('admin.working') : t('admin.approve')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-6 font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">
        {t('admin.pendingDeletions.title')}
      </h2>
      {deletionError && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{deletionError}</p>}
      {!pendingDeletions ? (
        <p className="mt-2 font-body text-xs text-muted-ink">{t('common.loading')}</p>
      ) : pendingDeletions.length === 0 ? (
        <p className="mt-2 font-body text-xs text-muted-ink">{t('admin.nothingWaiting')}</p>
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
                    {t('admin.requestedAgo', { ago: relativeTime(r.createdAt) })}
                  </span>
                  {r.reason && <p className="mt-1.5 font-body text-xs text-ink">{r.reason}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void decideDeletion(r.id, 'decline')}
                    disabled={decidingDeletionId === r.id}
                    className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink disabled:opacity-50"
                  >
                    {t('admin.decline')}
                  </button>
                  <button
                    onClick={() => void decideDeletion(r.id, 'fulfill')}
                    disabled={decidingDeletionId === r.id}
                    className="rounded-full border-2 border-ink bg-coral-dark px-3 py-1 font-heading text-xs font-bold text-white disabled:opacity-50"
                  >
                    {decidingDeletionId === r.id ? t('admin.working') : t('admin.deleteAccount')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-6 font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">
        {t('admin.orgsHeading')}
      </h2>
      <div className="mt-2 flex flex-col gap-3">
        {activeOrgs.map((o) => (
          <div key={o.id} className="rounded-2xl border-[2.5px] border-ink bg-paper shadow-[3px_3px_0_var(--color-ink)]">
            <button
              onClick={() => open(o.id)}
              className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left"
            >
              <div>
                <span className="font-heading text-base font-extrabold text-ink">{o.name}</span>
                {o.pausedAt && (
                  <span className="ml-2 rounded-full border border-coral/60 px-1.5 py-px font-body text-[9px] font-bold uppercase tracking-wide text-coral-dark">
                    {t('admin.pausedBadge')}
                  </span>
                )}
                <span className="ml-2 font-body text-[11px] text-muted-ink">
                  {t('admin.since', { ago: relativeTime(o.createdAt) })}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-body text-xs">
                <span>
                  <b className="font-bold text-ink">{o.storeCount}</b>{' '}
                  <span className="text-muted-ink">
                    {o.storeCount === 1 ? t('admin.unit.stores.one') : t('admin.unit.stores')}
                  </span>
                </span>
                <span>
                  <b className="font-bold text-ink">{o.employeeCount}</b>{' '}
                  <span className="text-muted-ink">
                    {o.employeeCount === 1 ? t('admin.unit.workers.one') : t('admin.unit.workers')}
                  </span>
                </span>
                <span className="text-muted-ink">{o.owners.join(', ') || t('admin.noOwner')}</span>
              </div>
            </button>

            {openId === o.id && (
              <div className="border-t-2 border-ink/10 p-4">
                {detailError ? (
                  <p className="font-body text-xs font-bold text-coral-dark">{detailError}</p>
                ) : !detail ? (
                  <p className="font-body text-xs text-muted-ink">{t('common.loading')}</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div>
                      <h2 className="font-heading text-xs font-bold uppercase tracking-wide text-muted-ink">
                        {t('admin.detail.stores')}
                      </h2>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        {detail.stores
                          .filter((s) => s.parentStoreId == null)
                          .map((s) => (
                            <div key={s.id} className="flex flex-col gap-1.5">
                              <OrgStoreRow store={s} />
                              {detail.stores
                                .filter((sec) => sec.parentStoreId === s.id)
                                .map((sec) => (
                                  <div key={sec.id} className="ml-3 border-l-2 border-ink/15 pl-2">
                                    <OrgStoreRow store={sec} isSection />
                                  </div>
                                ))}
                            </div>
                          ))}
                        {detail.stores.length === 0 && (
                          <p className="font-body text-xs text-muted-ink">{t('admin.detail.noStores')}</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <h2 className="font-heading text-xs font-bold uppercase tracking-wide text-muted-ink">
                        {t('admin.detail.ownersHeading')}
                      </h2>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        {detail.people.map((p) => (
                          <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-body text-xs">
                            <span className="font-bold text-ink">{p.email}</span>
                            <span className="rounded-full border border-ink/25 px-1.5 py-px text-[10px] font-bold text-muted-ink">
                              {p.role}
                            </span>
                            <span className="text-muted-ink">
                              {t('admin.detail.joinedAgo', { ago: relativeTime(p.createdAt) })}
                            </span>
                          </div>
                        ))}
                        {detail.people.length === 0 && (
                          <p className="font-body text-xs text-muted-ink">{t('admin.detail.nobody')}</p>
                        )}
                      </div>
                    </div>
                    <OrgInviteGenerator orgId={o.id} initialInvite={detail.pendingOwnerInvite} />
                    <div className="flex flex-wrap items-center gap-2 border-t border-ink/10 pt-2.5">
                      {o.pausedAt ? (
                        <button
                          onClick={() => unpauseOrg(o)}
                          disabled={orgActionBusy === o.id}
                          className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink disabled:opacity-50"
                        >
                          {orgActionBusy === o.id ? t('admin.working') : t('admin.resume')}
                        </button>
                      ) : (
                        <button
                          onClick={() => pauseOrg(o)}
                          disabled={orgActionBusy === o.id}
                          className="rounded-full border-2 border-coral px-2.5 py-0.5 font-heading text-[11px] font-bold text-coral-dark disabled:opacity-50"
                        >
                          {orgActionBusy === o.id ? t('admin.working') : t('admin.pause')}
                        </button>
                      )}
                      <button
                        onClick={() => deleteOrg(o)}
                        disabled={orgActionBusy === o.id}
                        className="rounded-full border-2 border-coral-dark bg-coral-dark px-2.5 py-0.5 font-heading text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        {orgActionBusy === o.id ? t('admin.working') : t('admin.deleteOrg')}
                      </button>
                      {orgActionError && (
                        <p className="w-full font-body text-xs font-bold text-coral-dark">{orgActionError}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="mt-6 font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">
        {t('admin.deletedOrgsHeading', { n: deletedOrgs.length })}
      </h2>
      {deletedOrgs.length === 0 ? (
        <p className="mt-2 font-body text-xs text-muted-ink">{t('admin.nothingWaiting')}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {deletedOrgs.map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-[2.5px] border-ink/40 bg-paper/60 p-3"
            >
              <div>
                <span className="font-heading text-sm font-bold text-muted-ink">{o.name}</span>
                <span className="ml-2 font-body text-[11px] text-muted-ink">
                  {t('admin.deletedAgo', { ago: relativeTime(o.deletedAt!) })}
                </span>
              </div>
              <button
                onClick={() => restoreOrg(o)}
                disabled={orgActionBusy === o.id}
                className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink disabled:opacity-50"
              >
                {orgActionBusy === o.id ? t('admin.working') : t('admin.restore')}
              </button>
            </div>
          ))}
          {orgActionError && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{orgActionError}</p>}
        </div>
      )}
    </div>
  )
}

/** Onboard a business directly — same Org + OWNER invite the signup-request
 * approval flow below creates, minus needing them to have filled out the
 * public request-access form first (for a customer you're signing up by
 * hand — a call, a walk-in). Emails the link only if a contact email is
 * given; otherwise the code/link is just handed back here to copy yourself. */
function CreateOrgPanel({ onCreated }: { onCreated: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ orgName: string; code: string; emailed: boolean } | null>(null)
  const { copiedKey, copy } = useCopy()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!businessName.trim()) return setError(t('admin.create.errName'))
    setBusy(true)
    try {
      const r = await api.createAdminOrg({
        businessName: businessName.trim(),
        contactName: contactName.trim() || undefined,
        email: email.trim() || undefined,
      })
      setResult({ orgName: r.orgName, code: r.code, emailed: r.emailed })
      setBusinessName('')
      setContactName('')
      setEmail('')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.create.err'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border-[2.5px] border-ink bg-paper p-4 shadow-[3px_3px_0_var(--color-ink)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="font-heading text-sm font-bold text-ink">{t('admin.create.title')}</span>
        <span className="shrink-0 rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink">
          {open ? t('common.close') : t('admin.create.open')}
        </span>
      </button>

      {open && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2 border-t-2 border-ink/10 pt-3">
          <p className="font-body text-xs text-muted-ink">{t('admin.create.hint')}</p>
          <Field
            label={t('admin.create.businessName')}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
          />
          <div className="flex flex-wrap gap-2 [&>label]:min-w-[10rem] [&>label]:flex-1">
            <Field label={t('admin.create.contactName')} value={contactName} onChange={(e) => setContactName(e.target.value)} />
            <Field
              label={t('admin.create.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <p className="font-body text-[11px] text-muted-ink">{t('admin.create.emailHint')}</p>
          {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('admin.create.generate')}
            </Button>
          </div>
        </form>
      )}

      {result && (
        <div className="mt-3 flex flex-col gap-1.5 border-t-2 border-ink/10 pt-3">
          <p className="font-body text-xs font-bold text-ink">{t('admin.create.success', { name: result.orgName })}</p>
          {result.emailed && (
            <p className="font-body text-[11px] font-bold text-green-dark">{t('admin.create.emailedNote')}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-ink/20 bg-cream px-2 py-1 font-heading text-sm font-bold tracking-wide">
              {result.code}
            </code>
            <CopyButton
              copied={copiedKey === 'new-org-code'}
              onClick={() => copy('new-org-code', result.code)}
              label={t('stores.managers.copyCode')}
              copiedLabel={t('stores.managers.copiedCode')}
              tone="sky"
            />
            <CopyButton
              copied={copiedKey === 'new-org-link'}
              onClick={() => copy('new-org-link', `${window.location.origin}/register-manager?code=${result.code}`)}
              label={t('admin.create.copyLink')}
              copiedLabel={t('stores.managers.copiedLink')}
            />
          </div>
          <p className="font-body text-[11px] text-muted-ink">{t('admin.create.codeHint')}</p>
        </div>
      )}
    </div>
  )
}

/** Recovery for exactly the "created it, lost the code, org just sits there
 * with nobody in it" case: generate a fresh OWNER code for an org that
 * already exists, right from its row in the org list below. Only one such
 * code is ever live per org (see POST /orgs/:id/invite), so this shows
 * whichever one is currently outstanding rather than only what was just
 * generated in this page load — otherwise re-opening an org with an
 * already-valid code just invites generating a redundant second one. */
function OrgInviteGenerator({ orgId, initialInvite }: { orgId: number; initialInvite: { code: string; expiresAt: string | null } | null }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(initialInvite?.code ?? null)
  const { copiedKey, copy } = useCopy()

  async function generate() {
    setError(null)
    setBusy(true)
    try {
      const r = await api.createAdminOrgInvite(orgId)
      setCode(r.code)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.create.err'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-ink/10 pt-2">
      {code && <p className="mb-1.5 font-body text-[11px] text-muted-ink">{t('admin.detail.currentCode')}</p>}
      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy}
        className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink disabled:opacity-50"
      >
        {busy ? t('common.saving') : t('admin.detail.newCode')}
      </button>
      {error && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {code && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <code className="rounded-lg border border-ink/20 bg-cream px-2 py-1 font-heading text-sm font-bold tracking-wide">
            {code}
          </code>
          <CopyButton
            copied={copiedKey === `org-${orgId}-code`}
            onClick={() => copy(`org-${orgId}-code`, code)}
            label={t('stores.managers.copyCode')}
            copiedLabel={t('stores.managers.copiedCode')}
            tone="sky"
          />
          <CopyButton
            copied={copiedKey === `org-${orgId}-link`}
            onClick={() => copy(`org-${orgId}-link`, `${window.location.origin}/register-manager?code=${code}`)}
            label={t('admin.create.copyLink')}
            copiedLabel={t('stores.managers.copiedLink')}
          />
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 text-center shadow-[3px_3px_0_var(--color-ink)]">
      <div className="font-heading text-xl font-extrabold text-ink">{value}</div>
      <div className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">{label}</div>
    </div>
  )
}

/** One row in an org's own store list (the detail panel below its summary
 * row) — a section gets the same badge treatment as StoreRow, just without
 * the repeated org name since it's already scoped to one org here. */
function OrgStoreRow({ store, isSection = false }: { store: AdminOrgDetail['stores'][number]; isSection?: boolean }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-body text-xs">
      <span className="font-bold text-ink">{store.name}</span>
      {isSection && (
        <span className="rounded-full border border-ink/25 px-1.5 py-px font-body text-[9px] font-bold uppercase tracking-wide text-muted-ink">
          {t('stores.section.badge')}
        </span>
      )}
      <span className="text-muted-ink">
        {store.employeeCount === 1
          ? t('admin.detail.workerCount.one', { n: store.employeeCount })
          : t('admin.detail.workerCount', { n: store.employeeCount })}
      </span>
      {store.weekStart && (
        <span className="text-muted-ink">{t('admin.detail.weekOf', { range: weekRangeLabel(store.weekStart) })}</span>
      )}
      <span className={store.publishedAt ? 'font-bold text-green' : 'text-muted-ink'}>
        {store.publishedAt ? t('admin.detail.posted', { ago: relativeTime(store.publishedAt) }) : t('admin.detail.notPosted')}
      </span>
    </div>
  )
}

/** Sets the store the manager UI should open on, then routes into it — the
 * same "go manage this store" jump for every row, reusing the normal
 * Schedule page rather than building a parallel editor (isSuperAdmin already
 * makes that page's store-scoping checks pass for any store, see
 * Backend/src/lib/auth.ts). */
function StoreRow({ store, isSection = false }: { store: AdminStoreSummary; isSection?: boolean }) {
  const t = useT()
  const navigate = useNavigate()

  function manage() {
    try {
      localStorage.setItem(STORE_ID_KEY, String(store.id))
    } catch {
      /* ignore */
    }
    navigate('/schedule')
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)]">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-heading text-sm font-extrabold text-ink">{store.name}</span>
          {isSection && (
            <span className="rounded-full border border-ink/25 px-1.5 py-px font-body text-[9px] font-bold uppercase tracking-wide text-muted-ink">
              {t('stores.section.badge')}
            </span>
          )}
          <span className="font-body text-[11px] text-muted-ink">{store.orgName}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 font-body text-xs text-muted-ink">
          <span>
            {store.employeeCount === 1
              ? t('admin.detail.workerCount.one', { n: store.employeeCount })
              : t('admin.detail.workerCount', { n: store.employeeCount })}
          </span>
          {store.weekStart && <span>{t('admin.detail.weekOf', { range: weekRangeLabel(store.weekStart) })}</span>}
          <span className={store.publishedAt ? 'font-bold text-green' : ''}>
            {store.publishedAt ? t('admin.detail.posted', { ago: relativeTime(store.publishedAt) }) : t('admin.detail.notPosted')}
          </span>
        </div>
      </div>
      <button
        onClick={manage}
        className="shrink-0 rounded-full border-2 border-ink bg-ink px-3 py-1 font-heading text-xs font-bold text-white"
      >
        {t('admin.manageStore')}
      </button>
    </div>
  )
}
