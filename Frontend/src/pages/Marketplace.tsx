import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card, EmptyState } from '../components/Card'
import { SwapIcon } from '../components/icons'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS, dayDate, shiftHasEnded, timeRange, to12Hour, toHHMM24 } from '../lib/time'
import type { ChangeRequest, Store } from '../types'

export function Marketplace() {
  const t = useT()
  const [data, setData] = useState<{
    available: ChangeRequest[]
    claimed: ChangeRequest[]
    posted: ChangeRequest[]
  } | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const refresh = useCallback(
    () =>
      Promise.all([api.getMarketplace(), api.getStores(), api.getMyShifts().catch(() => null)]).then(
        ([m, s, mine]) => {
          setData(m)
          setStores(s)
          setWeekStart(mine?.weekStart ?? null)
        },
      ),
    [],
  )

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : 'Could not load the marketplace'))
  }, [refresh])

  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? `Store ${id}`
  const isExpired = (r: ChangeRequest) => (weekStart ? shiftHasEnded(weekStart, r.shift.day, r.shift.end) : false)
  const when = (r: ChangeRequest) => {
    const d = weekStart ? `${dayDate(weekStart, DAYS.indexOf(r.shift.day))} · ` : ''
    const hrs =
      r.handoffStart && r.handoffEnd
        ? `${timeRange(r.handoffStart, r.handoffEnd)} ${t('market.partOfShift')}`
        : timeRange(r.shift.start, r.shift.end)
    return `${DAY_LABEL[r.shift.day]} ${d}${hrs} · ${storeName(r.shift.storeId)}`
  }

  async function act(id: number, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  if (error && !data) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!data) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  const nothing =
    data.available.length === 0 && data.claimed.length === 0 && data.posted.length === 0

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('market.title')}</h1>
      <p className="mt-0.5 font-body text-sm text-muted-ink">{t('market.subtitle')}</p>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {nothing ? (
        <EmptyState
          className="mt-8"
          icon={
            <span className="text-muted-ink">
              <SwapIcon size={30} />
            </span>
          }
          title={t('market.boardClear')}
          body={t('market.boardClearBody')}
        />
      ) : (
        <Section title={t('market.available')}>
          {data.available.length === 0 ? (
            <Empty>{t('market.nothingUp')}</Empty>
          ) : (
            data.available.map((r) => (
              <AvailableCard
                key={r.id}
                r={r}
                when={when(r)}
                expired={isExpired(r)}
                busy={busy === r.id}
                onClaim={() => void act(r.id, () => api.claimOffer(r.id))}
                onCounterOffer={(input) =>
                  act(r.id, () => api.proposeCounterOffer(r.id, input))
                }
              />
            ))
          )}
        </Section>
      )}

      {data.claimed.length > 0 && (
        <Section title={t('market.claimedWaiting')}>
          {data.claimed.map((r) => (
            <Card key={r.id} padded={false} className="flex flex-col p-3">
              <div className="flex items-center gap-2">
                <Line>{when(r)}</Line>
                {isExpired(r) && <ExpiredBadge />}
              </div>
              <Sub>{t('market.fromName', { name: r.requestedBy.name })}</Sub>
              <button
                disabled={busy === r.id}
                onClick={() => void act(r.id, () => api.unclaimOffer(r.id))}
                className="mt-2 self-start font-body text-[11px] font-bold text-muted-ink underline"
              >
                {t('market.backOut')}
              </button>
            </Card>
          ))}
        </Section>
      )}

      {data.posted.length > 0 && (
        <Section title={t('market.youPosted')}>
          {data.posted.map((r) => (
            <Card key={r.id} padded={false} className="flex flex-col p-3">
              <div className="flex items-center gap-2">
                <Line>{when(r)}</Line>
                <TypeBadge type={r.type} />
                {isExpired(r) && <ExpiredBadge />}
              </div>
              <Sub>
                {r.targetEmployee
                  ? t('market.someoneClaimed', { name: r.targetEmployee.name })
                  : t('market.noClaims')}
              </Sub>
              {!r.targetEmployee && r.counterOffers && r.counterOffers.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5 border-t border-ink/10 pt-2">
                  <Sub>{t('market.counterOffers')}</Sub>
                  {r.counterOffers.map((co) => (
                    <div
                      key={co.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/15 bg-cream/60 px-2 py-1.5"
                    >
                      <Line>
                        {t('market.counterOfferLine', { name: co.employeeName, range: timeRange(co.start, co.end) })}
                      </Line>
                      {co.note && <Note>“{co.note}”</Note>}
                      <span className="ml-auto flex gap-2">
                        <button
                          disabled={busy === r.id}
                          onClick={() => void act(r.id, () => api.acceptCounterOffer(co.id))}
                          className="font-body text-[11px] font-bold text-green-dark underline"
                        >
                          {t('market.accept')}
                        </button>
                        <button
                          disabled={busy === r.id}
                          onClick={() => void act(r.id, () => api.declineCounterOffer(co.id))}
                          className="font-body text-[11px] font-bold text-muted-ink underline"
                        >
                          {t('market.decline')}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                disabled={busy === r.id}
                onClick={() => void act(r.id, () => api.cancelChangeRequest(r.id))}
                className="mt-2 self-start font-body text-[11px] font-bold text-coral-dark underline"
              >
                {t('market.withdraw')}
              </button>
            </Card>
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h2 className="mt-6 font-heading text-sm font-bold text-ink">{title}</h2>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </>
  )
}
const Line = ({ children }: { children: ReactNode }) => (
  <span className="font-body text-xs font-bold text-ink">{children}</span>
)
const Sub = ({ children }: { children: ReactNode }) => (
  <span className="font-body text-[11px] text-muted-ink">{children}</span>
)
const Note = ({ children }: { children: ReactNode }) => (
  <span className="mt-0.5 font-body text-[11px] italic text-ink">{children}</span>
)
const Empty = ({ children }: { children: ReactNode }) => (
  <span className="font-body text-sm text-muted-ink">{children}</span>
)
function ExpiredBadge() {
  const t = useT()
  return (
    <span className="rounded-full border border-ink/25 px-1.5 py-px font-body text-[10px] font-bold text-muted-ink">
      {t('market.expired')}
    </span>
  )
}
function TypeBadge({ type }: { type: ChangeRequest['type'] }) {
  const t = useT()
  return (
    <span
      className={`rounded-full border px-1.5 py-px font-body text-[10px] font-bold ${
        type === 'DROP' ? 'border-coral text-coral-dark' : 'border-sky text-sky-dark'
      }`}
    >
      {type === 'DROP' ? t('market.badgeDropped') : t('market.badgeSwap')}
    </span>
  )
}

function AvailableCard({
  r,
  when,
  expired,
  busy,
  onClaim,
  onCounterOffer,
}: {
  r: ChangeRequest
  when: string
  expired: boolean
  busy: boolean
  onClaim: () => void
  onCounterOffer: (input: { start: string; end: string; note?: string }) => Promise<unknown>
}) {
  const t = useT()
  const [showCounter, setShowCounter] = useState(false)

  return (
    <Card padded={false} className="flex flex-col p-3">
      <div className="flex items-center gap-2">
        <Line>{when}</Line>
        <TypeBadge type={r.type} />
        {expired && <ExpiredBadge />}
      </div>
      <Sub>{t('market.offeredBy', { name: r.requestedBy.name })}</Sub>
      {r.note && <Note>“{r.note}”</Note>}
      {!expired && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={busy} onClick={onClaim}>
            {t('market.claim')}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setShowCounter((v) => !v)}>
            {t('market.counterOffer')}
          </Button>
        </div>
      )}
      {showCounter && (
        <CounterOfferForm
          offeredStart={r.handoffStart ?? r.shift.start}
          offeredEnd={r.handoffEnd ?? r.shift.end}
          busy={busy}
          onSubmit={(input) => {
            void onCounterOffer(input).then(() => setShowCounter(false))
          }}
          onCancel={() => setShowCounter(false)}
        />
      )}
    </Card>
  )
}

function CounterOfferForm({
  offeredStart,
  offeredEnd,
  busy,
  onSubmit,
  onCancel,
}: {
  offeredStart: string
  offeredEnd: string
  busy: boolean
  onSubmit: (input: { start: string; end: string; note?: string }) => void
  onCancel: () => void
}) {
  const t = useT()
  const winStart = toHHMM24(offeredStart)
  const winEnd = toHHMM24(offeredEnd)
  const [cStart, setCStart] = useState(winStart)
  const [cEnd, setCEnd] = useState(winEnd)
  const [note, setNote] = useState('')

  const inRange = cStart >= winStart && cEnd <= winEnd && cStart < cEnd
  const timeInp =
    'w-[6.5rem] rounded-lg border-2 border-ink/40 bg-paper px-2 py-1 font-body text-xs text-ink outline-none'

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border-2 border-ink/15 bg-cream p-2.5">
      <span className="font-body text-[11px] text-muted-ink">
        {t('market.counterOfferHint', { range: `${to12Hour(winStart)}–${to12Hour(winEnd)}` })}
      </span>
      <span className="flex items-center gap-1">
        <input type="time" step={1800} value={cStart} min={winStart} max={winEnd} onChange={(e) => setCStart(e.target.value)} className={timeInp} />
        <span className="text-muted-ink">–</span>
        <input type="time" step={1800} value={cEnd} min={winStart} max={winEnd} onChange={(e) => setCEnd(e.target.value)} className={timeInp} />
      </span>
      {!inRange && (
        <p className="font-body text-[11px] font-bold text-coral-dark">
          {t('req.rangeHint', { range: `${to12Hour(winStart)}–${to12Hour(winEnd)}` })}
        </p>
      )}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('req.notePlaceholder')}
        className="rounded-lg border-2 border-ink/30 bg-paper px-2.5 py-1.5 font-body text-xs text-ink outline-none"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!inRange || busy}
          onClick={() => onSubmit({ start: cStart, end: cEnd, ...(note.trim() ? { note: note.trim() } : {}) })}
        >
          {t('market.sendCounterOffer')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
