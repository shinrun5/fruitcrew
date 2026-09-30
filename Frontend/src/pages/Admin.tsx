import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { CopyButton } from '../components/CopyButton'
import { Field } from '../components/Field'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useCopy } from '../lib/use-copy'
import { useT } from '../lib/i18n'
import { STORE_ID_KEY } from '../lib/store-context'
import { relativeTime, shortDate, weekRangeLabel } from '../lib/time'
import type { AccountDeletionRequest, AdminOrgDetail, AdminOrgSummary, SignupRequest } from '../types'

/** The platform operator's console: what's waiting on you first (sign-up and
 * account-deletion requests), then every business, each opening onto its
 * stores (with a jump into managing any of them), people and owner code. */
export function Admin() {
  const t = useT()
  const confirm = useConfirm()
  const [orgs, setOrgs] = useState<AdminOrgSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signups, setSignups] = useState<SignupRequest[] | null>(null)
  const [deletions, setDeletions] = useState<AccountDeletionRequest[] | null>(null)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const [billing, setBilling] = useState<{ enabled: boolean; withoutTrial: number } | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)

  function loadOrgs() {
    return api
      .getAdminOrgs()
      .then(setOrgs)
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.err.loadOrgs')))
  }

  useEffect(() => {
    void loadOrgs()
    api.getAdminBilling().then(setBilling).catch(() => {})
    api
      .getSignupRequests('PENDING')
      .then(setSignups)
      .catch((e) => setQueueError(e instanceof Error ? e.message : t('admin.err.loadSignups')))
    api
      .getDeletionRequests('PENDING')
      .then(setDeletions)
      .catch((e) => setQueueError(e instanceof Error ? e.message : t('admin.err.loadDeletions')))
  }, [])

  async function decide(key: string, fn: () => Promise<unknown>, after: () => void) {
    setDeciding(key)
    setQueueError(null)
    try {
      await fn()
      after()
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : t('admin.err.updateRequest'))
    } finally {
      setDeciding(null)
    }
  }

  const active = useMemo(() => orgs?.filter((o) => !o.deletedAt) ?? [], [orgs])
  const deleted = useMemo(() => orgs?.filter((o) => o.deletedAt) ?? [], [orgs])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return active
    return active.filter((o) => o.name.toLowerCase().includes(q) || o.owners.some((e) => e.toLowerCase().includes(q)))
  }, [active, query])

  if (error) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!orgs) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  const waiting = (signups?.length ?? 0) + (deletions?.length ?? 0)

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-4 pb-10 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('admin.title')}</h1>
      <p className="mt-1 font-body text-sm text-muted-ink">{t('admin.subtitle')}</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatCard label={t('admin.stat.orgs')} value={active.length} />
        <StatCard label={t('admin.stat.stores')} value={active.reduce((n, o) => n + o.storeCount, 0)} />
        <StatCard label={t('admin.stat.workers')} value={active.reduce((n, o) => n + o.employeeCount, 0)} />
      </div>

      {/* --- what's waiting on you --- */}
      <SectionHeading>{t('admin.attention')}</SectionHeading>
      {queueError && <p className="mb-2 font-body text-xs font-bold text-coral-dark">{queueError}</p>}
      {signups && deletions && waiting === 0 && (
        <p className="font-body text-sm text-muted-ink">{t('admin.nothingWaiting')}</p>
      )}
      <div className="flex flex-col gap-3">
        {signups?.map((r) => (
          <Card key={`s${r.id}`}>
            <Tag>{t('admin.pendingSignups.title')}</Tag>
            <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-heading text-base font-extrabold text-ink">{r.businessName}</span>
                <span className="ml-2 font-body text-[11px] text-muted-ink">
                  {t('admin.requestedAgo', { ago: relativeTime(r.createdAt) })}
                </span>
                <div className="mt-0.5 break-words font-body text-xs text-muted-ink">
                  {r.contactName} · {r.email}
                  {r.phone ? ` · ${r.phone}` : ''}
                </div>
                {r.message && <p className="mt-1.5 font-body text-xs text-ink">“{r.message}”</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Pill
                  disabled={deciding === `s${r.id}`}
                  onClick={() =>
                    void decide(`s${r.id}`, () => api.declineSignupRequest(r.id), () =>
                      setSignups((p) => p?.filter((x) => x.id !== r.id) ?? p),
                    )
                  }
                >
                  {t('admin.decline')}
                </Pill>
                <Pill
                  tone="go"
                  disabled={deciding === `s${r.id}`}
                  onClick={() =>
                    void decide(`s${r.id}`, () => api.approveSignupRequest(r.id), () => {
                      setSignups((p) => p?.filter((x) => x.id !== r.id) ?? p)
                      void loadOrgs()
                    })
                  }
                >
                  {deciding === `s${r.id}` ? t('admin.working') : t('admin.approve')}
                </Pill>
              </div>
            </div>
            <p className="mt-2 font-body text-[11px] text-muted-ink">{t('admin.approveHint')}</p>
          </Card>
        ))}
        {deletions?.map((r) => (
          <Card key={`d${r.id}`}>
            <Tag tone="danger">{t('admin.pendingDeletions.title')}</Tag>
            <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="break-all font-heading text-base font-extrabold text-ink">{r.email}</span>
                <span className="ml-2 font-body text-[11px] text-muted-ink">
                  {t('admin.requestedAgo', { ago: relativeTime(r.createdAt) })}
                </span>
                {r.reason && <p className="mt-1.5 font-body text-xs text-ink">“{r.reason}”</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Pill
                  disabled={deciding === `d${r.id}`}
                  onClick={() =>
                    void decide(`d${r.id}`, () => api.declineDeletionRequest(r.id), () =>
                      setDeletions((p) => p?.filter((x) => x.id !== r.id) ?? p),
                    )
                  }
                >
                  {t('admin.decline')}
                </Pill>
                <Pill
                  tone="danger"
                  disabled={deciding === `d${r.id}`}
                  onClick={async () => {
                    // this one can't be taken back — the login and personal info are gone
                    if (
                      !(await confirm(t('admin.confirmFulfillDeletion', { email: r.email }), {
                        tone: 'danger',
                        confirmLabel: t('admin.deleteAccount'),
                      }))
                    )
                      return
                    void decide(`d${r.id}`, () => api.fulfillDeletionRequest(r.id), () =>
                      setDeletions((p) => p?.filter((x) => x.id !== r.id) ?? p),
                    )
                  }}
                >
                  {deciding === `d${r.id}` ? t('admin.working') : t('admin.deleteAccount')}
                </Pill>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* --- every business --- */}
      <div className="mt-8 mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">
          {t('admin.orgsHeading', { n: active.length })}
        </h2>
        <Button size="sm" variant={adding ? 'secondary' : 'primary'} onClick={() => setAdding((v) => !v)}>
          {adding ? t('common.close') : t('admin.addBusiness')}
        </Button>
      </div>
      {adding && <CreateOrgPanel onCreated={() => void loadOrgs()} />}
      {/* launch day: businesses that signed up while billing was off have no trial clock yet */}
      {billing?.enabled && billing.withoutTrial > 0 && (
        <Card className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 font-body text-xs text-ink">
            {t(billing.withoutTrial === 1 ? 'admin.billing.noTrial.one' : 'admin.billing.noTrial', { n: billing.withoutTrial })}
          </p>
          <Pill
            tone="go"
            onClick={async () => {
              if (!(await confirm(t('admin.billing.startTrialsConfirm', { n: billing.withoutTrial }), { confirmLabel: t('admin.billing.startTrials') })))
                return
              try {
                await api.startAdminTrials()
                setBilling({ ...billing, withoutTrial: 0 })
                void loadOrgs()
              } catch (e) {
                setError(e instanceof Error ? e.message : t('admin.err.orgAction'))
              }
            }}
          >
            {t('admin.billing.startTrials')}
          </Pill>
        </Card>
      )}
      {active.length > 3 && (
        <Field
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.search')}
          className="mb-3"
        />
      )}
      <div className="flex flex-col gap-3">
        {shown.map((o) => (
          <OrgCard
            key={o.id}
            org={o}
            open={openId === o.id}
            onToggle={() => setOpenId((id) => (id === o.id ? null : o.id))}
            onUpdated={() => void loadOrgs()}
            onChanged={() => {
              setOpenId(null)
              void loadOrgs()
            }}
          />
        ))}
        {shown.length === 0 && <p className="font-body text-sm text-muted-ink">{t('admin.noMatches')}</p>}
      </div>

      {/* --- deleted: out of the way, but one tap from restoring --- */}
      {deleted.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowDeleted((v) => !v)}
            className="font-body text-xs font-bold text-sky-dark"
          >
            {showDeleted ? t('admin.hideDeleted') : t('admin.showDeleted', { n: deleted.length })}
          </button>
          {showDeleted && (
            <div className="mt-2 flex flex-col gap-2">
              {deleted.map((o) => (
                <DeletedRow key={o.id} org={o} onRestored={() => void loadOrgs()} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** One business: a summary row that opens onto its stores, people, owner code
 * and the pause/delete levers. */
function OrgCard({
  org: o,
  open,
  onToggle,
  onChanged,
  onUpdated,
}: {
  org: AdminOrgSummary
  open: boolean
  onToggle: () => void
  /** after pause/delete — closes the card and reloads */
  onChanged: () => void
  /** after a small edit — reloads, card stays open */
  onUpdated: () => void
}) {
  const t = useT()
  const confirm = useConfirm()
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDetail(null)
    setError(null)
    api
      .getAdminOrg(o.id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.err.loadOrgDetail')))
  }, [open, o.id, t])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.err.orgAction'))
    } finally {
      setBusy(false)
    }
  }

  const noOwner = o.owners.length === 0

  return (
    <Card padded={false}>
      <button onClick={onToggle} className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-heading text-base font-extrabold text-ink">{o.name}</span>
            {o.pausedAt && <Tag tone="danger">{t('admin.pausedBadge')}</Tag>}
            {noOwner && <Tag tone="warn">{t('admin.noOwnerYet')}</Tag>}
            {o.billing.state === 'lapsed' && <Tag tone="danger">{t('admin.billing.tag.lapsed')}</Tag>}
            {o.billing.state === 'past_due' && <Tag tone="danger">{t('admin.billing.tag.pastDue')}</Tag>}
            {o.billing.state === 'active' && <Tag>{t('admin.billing.tag.paying', { total: o.billing.monthly ?? 0 })}</Tag>}
            {o.billing.exempt && <Tag>{t('admin.billing.tag.comped')}</Tag>}
            {/* the default is one store — flag the ones allowed more */}
            {o.storeLimit !== 1 && o.billing.state !== 'active' && o.billing.state !== 'past_due' && (
              <Tag>
                {o.storeLimit == null ? t('admin.storeLimit.noLimitTag') : t('admin.storeLimit.tag', { n: o.storeLimit })}
              </Tag>
            )}
          </div>
          <div className="mt-0.5 break-words font-body text-xs text-muted-ink">
            {noOwner ? t('admin.noOwner') : o.owners.join(', ')} · {t('admin.since', { ago: relativeTime(o.createdAt) })}
          </div>
        </div>
        <div className="flex items-center gap-4 font-body text-xs">
          <span>
            <b className="font-bold text-ink">{o.storeCount}</b>{' '}
            <span className="text-muted-ink">{o.storeCount === 1 ? t('admin.unit.stores.one') : t('admin.unit.stores')}</span>
          </span>
          <span>
            <b className="font-bold text-ink">{o.employeeCount}</b>{' '}
            <span className="text-muted-ink">
              {o.employeeCount === 1 ? t('admin.unit.workers.one') : t('admin.unit.workers')}
            </span>
          </span>
          <span aria-hidden className="font-heading text-lg text-muted-ink">
            {open ? '▾' : '›'}
          </span>
        </div>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t-2 border-ink/10 p-4">
          {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
          {!detail ? (
            !error && <p className="font-body text-xs text-muted-ink">{t('common.loading')}</p>
          ) : (
            <>
              {/* no owner yet means the sign-up code is the only way in — lead with it */}
              {noOwner && <OrgInviteGenerator orgId={o.id} initialInvite={detail.pendingOwnerInvite} highlight />}

              <PlanEditor org={o} onSaved={onUpdated} />
              <StoreLimitEditor org={o} onSaved={onUpdated} />

              <div>
                <SubHeading>{t('admin.detail.stores')}</SubHeading>
                <div className="flex flex-col gap-1.5">
                  {detail.stores
                    .filter((s) => s.parentStoreId == null)
                    .flatMap((s) => [s, ...detail.stores.filter((sec) => sec.parentStoreId === s.id)])
                    .map((s) => (
                      <StoreRow key={s.id} store={s} isSection={s.parentStoreId != null} />
                    ))}
                  {detail.stores.length === 0 && (
                    <p className="font-body text-xs text-muted-ink">{t('admin.detail.noStores')}</p>
                  )}
                </div>
              </div>

              <div>
                <SubHeading>{t('admin.detail.ownersHeading')}</SubHeading>
                <div className="flex flex-col gap-1">
                  {detail.people.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-body text-xs">
                      <span className="break-all font-bold text-ink">{p.email}</span>
                      <span className="rounded-full border border-ink/25 px-1.5 py-px text-[10px] font-bold text-muted-ink">
                        {p.role === 'OWNER' ? t('admin.role.owner') : t('admin.role.manager')}
                      </span>
                      {p.role === 'MANAGER' && p.storeIds.length > 0 && (
                        <span className="text-muted-ink">
                          {detail.stores
                            .filter((s) => p.storeIds.includes(s.id))
                            .map((s) => s.name)
                            .join(', ')}
                        </span>
                      )}
                      <span className="text-muted-ink">{t('admin.detail.joinedAgo', { ago: relativeTime(p.createdAt) })}</span>
                    </div>
                  ))}
                  {detail.people.length === 0 && <p className="font-body text-xs text-muted-ink">{t('admin.detail.nobody')}</p>}
                </div>
              </div>

              {!noOwner && <OrgInviteGenerator orgId={o.id} initialInvite={detail.pendingOwnerInvite} />}

              <div className="flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
                {o.pausedAt ? (
                  // resuming is never the risky direction — no confirm
                  <Pill disabled={busy} onClick={() => void act(() => api.unpauseAdminOrg(o.id))}>
                    {busy ? t('admin.working') : t('admin.resume')}
                  </Pill>
                ) : (
                  <Pill
                    tone="warn"
                    disabled={busy}
                    onClick={async () => {
                      if (await confirm(t('admin.confirmPause', { name: o.name }), { tone: 'danger', confirmLabel: t('admin.pause') }))
                        void act(() => api.pauseAdminOrg(o.id))
                    }}
                  >
                    {busy ? t('admin.working') : t('admin.pause')}
                  </Pill>
                )}
                <Pill
                  tone="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (await confirm(t('admin.confirmDelete', { name: o.name }), { tone: 'danger', confirmLabel: t('admin.deleteOrg') }))
                      void act(() => api.deleteAdminOrg(o.id))
                  }}
                >
                  {busy ? t('admin.working') : t('admin.deleteOrg')}
                </Pill>
                <span className="font-body text-[11px] text-muted-ink">{t('admin.leversHint')}</span>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

/** How many stores (sections don't count) the business may have. Trial plans
 * get one; pick more — or no limit — for a business that's paying for it. */
/** Where the business stands on paying, with the two levers a person needs:
 * more trial time, and comping them (free, never locked out). */
function PlanEditor({ org: o, onSaved }: { org: AdminOrgSummary; onSaved: () => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const b = o.billing

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.err.orgAction'))
    } finally {
      setBusy(false)
    }
  }

  const status =
    b.state === 'off'
      ? t('admin.billing.state.off')
      : b.state === 'exempt'
        ? t('admin.billing.state.exempt')
        : b.state === 'active'
          ? t('admin.billing.state.active', { total: b.monthly ?? 0 })
          : b.state === 'past_due'
            ? t('admin.billing.state.pastDue')
            : b.state === 'lapsed'
              ? t('admin.billing.state.lapsed', { date: b.trialEndsAt ? shortDate(b.trialEndsAt) : '' })
              : b.trialEndsAt
                ? t('admin.billing.state.trial', { date: shortDate(b.trialEndsAt) })
                : t('admin.billing.state.trialNotStarted')

  const canExtend = b.state === 'trial' || b.state === 'lapsed'
  return (
    <div>
      <SubHeading>{t('admin.billing.title')}</SubHeading>
      <p className={`font-body text-xs ${b.state === 'lapsed' || b.state === 'past_due' ? 'font-bold text-coral-dark' : 'text-ink'}`}>
        {status}
      </p>
      {b.state !== 'off' && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {canExtend && (
            <Pill disabled={busy} onClick={() => void run(() => api.extendAdminTrial(o.id, 14))}>
              {t('admin.billing.extend')}
            </Pill>
          )}
          {b.state !== 'active' && b.state !== 'past_due' && (
            <Pill disabled={busy} onClick={() => void run(() => api.setAdminExempt(o.id, !b.exempt))}>
              {b.exempt ? t('admin.billing.uncomp') : t('admin.billing.comp')}
            </Pill>
          )}
        </div>
      )}
      {error && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{error}</p>}
    </div>
  )
}

function StoreLimitEditor({ org: o, onSaved }: { org: AdminOrgSummary; onSaved: () => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = [1, 2, 3, 4, 5, 10, 20]
  if (o.storeLimit != null && !options.includes(o.storeLimit)) options.push(o.storeLimit)
  options.sort((a, b) => a - b)

  async function save(value: string) {
    setBusy(true)
    setError(null)
    try {
      await api.setAdminStoreLimit(o.id, value === 'none' ? null : Number(value))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.err.orgAction'))
    } finally {
      setBusy(false)
    }
  }

  const over = o.storeLimit != null && o.locationCount > o.storeLimit
  if (o.billing.state === 'active' || o.billing.state === 'past_due') {
    return (
      <div>
        <SubHeading>{t('admin.storeLimit.title')}</SubHeading>
        <p className="font-body text-xs text-muted-ink">
          {t('admin.storeLimit.fromStripe', { n: o.storeLimit ?? 1, used: o.locationCount })}
        </p>
      </div>
    )
  }
  return (
    <div>
      <SubHeading>{t('admin.storeLimit.title')}</SubHeading>
      <div className="flex flex-wrap items-center gap-2 font-body text-xs">
        <select
          value={o.storeLimit ?? 'none'}
          disabled={busy}
          onChange={(e) => void save(e.target.value)}
          className="rounded-full border-2 border-ink bg-cream px-2.5 py-1 font-heading text-xs font-bold text-ink outline-none disabled:opacity-50"
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {t(n === 1 ? 'admin.storeLimit.option.one' : 'admin.storeLimit.option', { n })}
            </option>
          ))}
          <option value="none">{t('admin.storeLimit.none')}</option>
        </select>
        <span className={over ? 'font-bold text-coral-dark' : 'text-muted-ink'}>
          {o.storeLimit == null
            ? t('admin.storeLimit.usingNoLimit', { n: o.locationCount })
            : t('admin.storeLimit.using', { n: o.locationCount, limit: o.storeLimit })}
          {over && ` · ${t('admin.storeLimit.over')}`}
        </span>
      </div>
      {error && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{error}</p>}
    </div>
  )
}

function DeletedRow({ org: o, onRestored }: { org: AdminOrgSummary; onRestored: () => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-[2.5px] border-ink/40 bg-paper/60 p-3">
      <div>
        <span className="font-heading text-sm font-bold text-muted-ink">{o.name}</span>
        <span className="ml-2 font-body text-[11px] text-muted-ink">{t('admin.deletedAgo', { ago: relativeTime(o.deletedAt!) })}</span>
        {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
      </div>
      <Pill
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await api.restoreAdminOrg(o.id)
            onRestored()
          } catch (e) {
            setError(e instanceof Error ? e.message : t('admin.err.orgAction'))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? t('admin.working') : t('admin.restore')}
      </Pill>
    </div>
  )
}

/** Onboard a business directly — same business + owner sign-up code that
 * approving a request creates, for a customer you're signing up by hand (a
 * call, a walk-in). Emails the link only if a contact email is given. */
function CreateOrgPanel({ onCreated }: { onCreated: () => void }) {
  const t = useT()
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
    <Card className="mb-3">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <p className="font-body text-xs text-muted-ink">{t('admin.create.hint')}</p>
        <Field label={t('admin.create.businessName')} value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
        <div className="flex flex-wrap gap-2 [&>label]:min-w-[10rem] [&>label]:flex-1">
          <Field label={t('admin.create.contactName')} value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <Field label={t('admin.create.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <p className="font-body text-[11px] text-muted-ink">{t('admin.create.emailHint')}</p>
        {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? t('common.saving') : t('admin.create.generate')}
          </Button>
        </div>
      </form>

      {result && (
        <div className="mt-3 flex flex-col gap-1.5 border-t-2 border-ink/10 pt-3">
          <p className="font-body text-xs font-bold text-ink">{t('admin.create.success', { name: result.orgName })}</p>
          {result.emailed && <p className="font-body text-[11px] font-bold text-green-dark">{t('admin.create.emailedNote')}</p>}
          <CodeAndCopy code={result.code} copyKey="new-org" copiedKey={copiedKey} copy={copy} />
          <p className="font-body text-[11px] text-muted-ink">{t('admin.create.codeHint')}</p>
        </div>
      )}
    </Card>
  )
}

/** The business's owner sign-up code: shows whichever one is still valid, and
 * makes a fresh one (replacing it) — for a code that got lost or expired. */
function OrgInviteGenerator({
  orgId,
  initialInvite,
  highlight = false,
}: {
  orgId: number
  initialInvite: { code: string; expiresAt: string | null } | null
  highlight?: boolean
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(initialInvite?.code ?? null)
  const { copiedKey, copy } = useCopy()

  async function generate() {
    setError(null)
    setBusy(true)
    try {
      setCode((await api.createAdminOrgInvite(orgId)).code)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.create.err'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={highlight ? 'rounded-xl border-2 border-orange bg-orange/10 p-3' : ''}>
      <SubHeading>{t('admin.ownerCode.title')}</SubHeading>
      <p className="mb-1.5 font-body text-[11px] text-muted-ink">
        {highlight ? t('admin.ownerCode.noOwnerHint') : code ? t('admin.detail.currentCode') : t('admin.ownerCode.none')}
      </p>
      {code && <CodeAndCopy code={code} copyKey={`org-${orgId}`} copiedKey={copiedKey} copy={copy} />}
      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy}
        className="mt-1.5 rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink disabled:opacity-50"
      >
        {busy ? t('common.saving') : t('admin.detail.newCode')}
      </button>
      {error && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{error}</p>}
    </div>
  )
}

function CodeAndCopy({
  code,
  copyKey,
  copiedKey,
  copy,
}: {
  code: string
  copyKey: string
  copiedKey: string | null
  copy: (key: string, text: string) => void
}) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded-lg border border-ink/20 bg-cream px-2 py-1 font-heading text-sm font-bold tracking-wide">{code}</code>
      <CopyButton
        copied={copiedKey === `${copyKey}-code`}
        onClick={() => copy(`${copyKey}-code`, code)}
        label={t('stores.managers.copyCode')}
        copiedLabel={t('stores.managers.copiedCode')}
        tone="sky"
      />
      <CopyButton
        copied={copiedKey === `${copyKey}-link`}
        onClick={() => copy(`${copyKey}-link`, `${window.location.origin}/register-manager?code=${code}`)}
        label={t('admin.create.copyLink')}
        copiedLabel={t('stores.managers.copiedLink')}
      />
    </div>
  )
}

/** A store inside a business, with a jump straight into managing it (the
 * normal Schedule page — isSuperAdmin passes every store's access checks). */
function StoreRow({ store, isSection }: { store: AdminOrgDetail['stores'][number]; isSection: boolean }) {
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
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream/60 px-3 py-2 ${isSection ? 'ml-4' : ''}`}>
      <div className="min-w-0 font-body text-xs">
        <span className="font-bold text-ink">{store.name}</span>
        {isSection && <span className="ml-1.5 text-[10px] font-bold uppercase text-muted-ink">{t('stores.section.badge')}</span>}
        <div className="flex flex-wrap gap-x-3 text-muted-ink">
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
        className="shrink-0 rounded-full border-2 border-ink bg-ink px-3 py-0.5 font-heading text-[11px] font-bold text-white"
      >
        {t('admin.manageStore')}
      </button>
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

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 mb-2 font-heading text-sm font-bold uppercase tracking-wide text-muted-ink">{children}</h2>
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">{children}</h3>
}

function Tag({ children, tone }: { children: ReactNode; tone?: 'danger' | 'warn' }) {
  const color =
    tone === 'danger'
      ? 'border-coral/60 text-coral-dark'
      : tone === 'warn'
        ? 'border-orange text-ink'
        : 'border-ink/25 text-muted-ink'
  return <span className={`rounded-full border px-1.5 py-px font-body text-[9px] font-bold uppercase tracking-wide ${color}`}>{children}</span>
}

function Pill({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'go' | 'warn' | 'danger'
}) {
  const cls =
    tone === 'go'
      ? 'border-ink bg-green text-white'
      : tone === 'danger'
        ? 'border-coral-dark bg-coral-dark text-white'
        : tone === 'warn'
          ? 'border-coral text-coral-dark bg-paper'
          : 'border-ink bg-paper text-ink'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border-2 px-3 py-1 font-heading text-xs font-bold disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  )
}
