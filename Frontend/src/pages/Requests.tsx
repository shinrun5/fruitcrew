import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { SelectField } from '../components/Field'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { DAY_LABEL, relativeTime, timeRange } from '../lib/time'
import type { ChangeRequest, Store, TimeOffRequest } from '../types'

const STATUS_STYLE: Record<ChangeRequest['status'], string> = {
  PENDING: 'border-orange bg-orange/10 text-ink',
  APPROVED: 'border-green bg-green/10 text-green',
  DENIED: 'border-coral bg-coral-bg text-coral-dark',
  CANCELLED: 'border-ink/25 text-muted-ink',
}

const prettyDate = (s: string) =>
  new Date(`${s}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

export function Requests() {
  const t = useT()
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffRequest[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [toBusy, setToBusy] = useState<number | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [notifyBusy, setNotifyBusy] = useState<number | null>(null)
  const [notified, setNotified] = useState<Set<number>>(new Set())

  function refresh() {
    return Promise.all([api.getChangeRequests(), api.getStores(), api.getTimeOff()])
      .then(([r, s, t]) => {
        setRequests(r)
        setStores(s)
        setTimeOff(t)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('requests.errLoad')))
  }

  async function ackTimeOff(id: number) {
    setToBusy(id)
    setError(null)
    try {
      await api.ackTimeOff(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('requests.errUpdate'))
    } finally {
      setToBusy(null)
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? t('requests.storeFallback', { id })

  async function resolve(id: number, approve: boolean) {
    setBusy(id)
    setError(null)
    try {
      await (approve ? api.approveChangeRequest(id) : api.denyChangeRequest(id))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('requests.errResolve'))
    } finally {
      setBusy(null)
    }
  }

  async function renotify(id: number) {
    setNotifyBusy(id)
    setError(null)
    try {
      await api.renotifyOffer(id)
      setNotified((s) => new Set(s).add(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('requests.errResend'))
    } finally {
      setNotifyBusy(null)
    }
  }

  const isOpenOffer = (r: ChangeRequest) =>
    r.openOffer && r.status === 'PENDING' && !r.targetEmployee

  // three buckets: posted-but-unclaimed, waiting on the manager, and already settled
  const openOffers = requests.filter(isOpenOffer)
  const changes = [...requests]
    .filter((r) => !isOpenOffer(r))
    .sort((a, b) => b.id - a.id)
  const pending = changes.filter((r) => r.status === 'PENDING')
  const past = changes.filter((r) => r.status !== 'PENDING')

  const shiftWhen = (r: ChangeRequest) => {
    const hrs =
      r.handoffStart && r.handoffEnd
        ? `${timeRange(r.handoffStart, r.handoffEnd)} · ${t('requests.partOfShift')}`
        : timeRange(r.shift.start, r.shift.end)
    return `${DAY_LABEL[r.shift.day]} · ${hrs} · ${storeName(r.shift.storeId)}`
  }

  const timeOffSorted = [...timeOff].sort(
    (a, b) =>
      Number(a.acknowledged) - Number(b.acknowledged) || a.startDate.localeCompare(b.startDate),
  )
  const timeOffOpen = timeOffSorted.filter((t) => !t.acknowledged).length

  function sentence(r: ChangeRequest) {
    const who = r.requestedBy.name
    if (r.type === 'DROP') return t('requests.wantsDrop', { name: who })
    if (r.type === 'PICKUP') return t('requests.wantsPickup', { name: who })
    if (r.openOffer)
      return t('requests.claimedShift', { claimer: r.targetEmployee?.name ?? '—', owner: who })
    return `${who} → ${r.targetEmployee?.name ?? '—'}`
  }

  function statusLabel(s: ChangeRequest['status']) {
    if (s === 'APPROVED') return t('requests.status.approved')
    if (s === 'DENIED') return t('requests.status.denied')
    if (s === 'CANCELLED') return t('requests.status.cancelled')
    return t('requests.status.pending')
  }

  const nothingAtAll =
    !loading &&
    openOffers.length === 0 &&
    pending.length === 0 &&
    past.length === 0 &&
    timeOffSorted.length === 0

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="font-heading text-lg font-bold text-ink">{t('nav.mgr.marketplace')}</h1>
        <span className="font-body text-xs text-muted-ink">{t('requests.subtitle')}</span>
      </div>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {loading && <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>}
      {nothingAtAll && (
        <p className="mt-4 font-body text-sm text-muted-ink">{t('requests.emptyAll')}</p>
      )}

      {/* --- posted, nobody's claimed it yet --- */}
      {openOffers.length > 0 && (
        <Section
          title={t('market.available')}
          hint={t('requests.waitingForClaim', { n: openOffers.length })}
        >
          {openOffers.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border-[2.5px] border-dashed border-ink/45 bg-cream p-3"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-body text-sm font-bold text-ink">{r.requestedBy.name}</span>
                <span className="font-body text-xs text-muted-ink">{t('requests.putUpForGrabs')}</span>
                <span className="ml-auto font-body text-[10px] text-muted-ink">
                  {relativeTime(r.createdAt)}
                </span>
              </div>
              <p className="mt-1 font-heading text-xs font-bold text-ink">{shiftWhen(r)}</p>
              {r.note && <p className="mt-1 font-body text-xs italic text-ink">“{r.note}”</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  disabled={busy === r.id}
                  onClick={() => void resolve(r.id, false)}
                  className="rounded-full border-2 border-coral px-3 py-0.5 font-heading text-[11px] font-bold text-coral-dark transition-colors duration-150 ease-out hover:bg-coral-bg disabled:opacity-50"
                >
                  {t('requests.takeDown')}
                </button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={notifyBusy === r.id || notified.has(r.id)}
                  onClick={() => void renotify(r.id)}
                >
                  {notified.has(r.id)
                    ? t('requests.alertSent')
                    : notifyBusy === r.id
                      ? t('profile.testEmail.sending')
                      : t('requests.resendAlert')}
                </Button>
              </div>
              <AssignRow
                id={r.id}
                excludeId={r.requestedBy.id}
                onDone={() => void refresh()}
              />
            </div>
          ))}
        </Section>
      )}

      {/* --- waiting on the manager --- */}
      {!loading && !nothingAtAll && (
        <Section
          title={t('requests.waitingOnYou')}
          hint={pending.length > 0 ? t('requests.toApproveOrDeny', { n: pending.length }) : undefined}
        >
          {pending.length === 0 ? (
            <p className="font-body text-xs text-muted-ink">{t('requests.nothingNeedsCall')}</p>
          ) : (
            pending.map((r) => (
              <Card key={r.id} padded={false} className="p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-body text-sm font-bold text-ink">{sentence(r)}</span>
                  <span className="ml-auto font-body text-[10px] text-muted-ink">
                    {relativeTime(r.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 font-body text-xs text-muted-ink">
                  {r.handoffStart && r.handoffEnd ? (
                    <>
                      {timeRange(r.handoffStart, r.handoffEnd)}{' '}
                      <span className="text-sky-dark">
                        {t('requests.partOfRange', { range: timeRange(r.shift.start, r.shift.end) })}
                      </span>{' '}
                      · {DAY_LABEL[r.shift.day]} · {storeName(r.shift.storeId)}
                    </>
                  ) : (
                    shiftWhen(r)
                  )}
                </p>
                {r.note && <p className="mt-1 font-body text-xs italic text-ink">“{r.note}”</p>}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={busy === r.id} onClick={() => void resolve(r.id, true)}>
                    {t('requests.approve')}
                  </Button>
                  <button
                    disabled={busy === r.id}
                    onClick={() => void resolve(r.id, false)}
                    className="rounded-full border-2 border-coral px-3 py-0.5 font-heading text-[11px] font-bold text-coral-dark transition-colors duration-150 ease-out hover:bg-coral-bg disabled:opacity-50"
                  >
                    {t('requests.deny')}
                  </button>
                </div>
              </Card>
            ))
          )}
        </Section>
      )}

      {/* --- time off (a heads-up, not an approval) --- */}
      {timeOffSorted.length > 0 && (
        <Section
          title={t('avail.tab.timeoff')}
          hint={timeOffOpen > 0 ? t('requests.toAcknowledge', { n: timeOffOpen }) : t('requests.allSeen')}
        >
          {timeOffSorted.map((off) => (
            <div
              key={off.id}
              className={`rounded-2xl border-[2.5px] bg-paper p-3 ${
                off.acknowledged
                  ? 'border-ink/25'
                  : 'border-ink shadow-[3px_3px_0_var(--color-ink)]'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-body text-sm font-bold text-ink">
                  {off.employeeName ?? `#${off.employeeId}`} —{' '}
                  {t('requests.dateRange', {
                    start: prettyDate(off.startDate),
                    end: prettyDate(off.endDate),
                  })}
                </span>
                <span
                  className={`rounded-full border px-1.5 py-px font-body text-[10px] font-bold ${
                    off.state === 'active'
                      ? 'border-green bg-green/10 text-green-dark'
                      : 'border-sky bg-sky/10 text-sky-dark'
                  }`}
                >
                  {off.state === 'active' ? t('timeoff.state.active') : t('timeoff.state.upcoming')}
                </span>
                <span className="ml-auto font-body text-[10px] text-muted-ink">
                  {relativeTime(off.createdAt)}
                </span>
              </div>
              {off.note && <p className="mt-1 font-body text-xs italic text-ink">“{off.note}”</p>}
              <div className="mt-2">
                {off.acknowledged ? (
                  <span className="font-body text-[11px] font-bold text-muted-ink">{t('requests.seen')}</span>
                ) : (
                  <Button size="sm" variant="secondary" disabled={toBusy === off.id} onClick={() => void ackTimeOff(off.id)}>
                    {t('requests.gotIt')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* --- settled: approved / denied / cancelled --- */}
      {past.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowPast((v) => !v)}
            className="font-body text-[11px] font-bold text-sky-dark"
          >
            {showPast ? t('requests.hidePast') : t('requests.showPast', { n: past.length })}
          </button>
          {showPast && (
            <div className="mt-2 flex flex-col gap-2">
              {past.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border-2 border-ink/20 bg-paper/60 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-body text-xs font-bold text-ink">{sentence(r)}</span>
                    <span
                      className={`rounded-full border px-1.5 py-px font-body text-[10px] font-bold ${STATUS_STYLE[r.status]}`}
                    >
                      {statusLabel(r.status)}
                    </span>
                    <span className="ml-auto font-body text-[10px] text-muted-ink">
                      {relativeTime(r.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 font-body text-[11px] text-muted-ink">{shiftWhen(r)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Manager override: hand an unclaimed marketplace post straight to someone (incl. themselves). */
function AssignRow({
  id,
  excludeId,
  onDone,
}: {
  id: number
  excludeId: number
  onDone: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<{ id: number; name: string }[]>([])
  const [pick, setPick] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || people.length) return
    api
      .getAssignable(id)
      .then((list) => setPeople(list.filter((p) => p.id !== excludeId)))
      .catch(() => setErr(t('requests.errLoadCrew')))
  }, [open, id, excludeId, people.length, t])

  async function go() {
    if (pick === '') return
    setBusy(true)
    setErr(null)
    try {
      await api.assignOffer(id, pick)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('requests.errAssign'))
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 font-body text-[11px] font-bold text-sky-dark"
      >
        {t('requests.assignToSomeone')}
      </button>
    )
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <SelectField
        size="sm"
        className="min-w-0 flex-1"
        value={pick}
        onChange={(e) => setPick(e.target.value === '' ? '' : Number(e.target.value))}
      >
        <option value="">{t('requests.choosePerson')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <Button size="sm" disabled={pick === '' || busy} onClick={() => void go()}>
        {busy ? '…' : t('requests.giveToThem')}
      </Button>
      <button
        onClick={() => setOpen(false)}
        className="font-body text-[11px] font-bold text-muted-ink underline"
      >
        {t('common.cancel')}
      </button>
      {err && (
        <span className="w-full font-body text-[11px] font-bold text-coral-dark">{err}</span>
      )}
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <>
      <h2 className="mt-5 flex flex-wrap items-baseline gap-x-2 font-heading text-sm font-bold text-ink">
        {title}
        {hint && <span className="font-body text-xs font-semibold text-muted-ink">— {hint}</span>}
      </h2>
      <div className="mt-2 flex flex-col gap-2.5">{children}</div>
    </>
  )
}
