import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useConfirm } from '../lib/confirm'
import { useT } from '../lib/i18n'
import { isNativeApp, priceOfStore } from '../lib/pricing'
import { shortDate } from '../lib/time'
import type { BillingSummary } from '../types'

type TKey = Parameters<ReturnType<typeof useT>>[0]

/** Send the browser to a Stripe page (Checkout or the billing portal). */
async function goToStripe(open: () => Promise<{ url: string }>, onError: (m: string) => void) {
  try {
    window.location.href = (await open()).url
  } catch (e) {
    onError(e instanceof Error ? e.message : '')
  }
}

const btn =
  'rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold shadow-[2px_2px_0_var(--color-ink)] disabled:opacity-50'

/** Settings › Plan: what the business is on and what it costs, with the way
 * to subscribe or manage billing. On the phone apps it only describes the
 * plan — buying happens on the website. */
export function PlanPanel({ billing }: { billing: BillingSummary }) {
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const native = isNativeApp()
  const b = billing

  const go = (open: () => Promise<{ url: string }>) => {
    setBusy(true)
    setError(null)
    void goToStripe(open, (m) => {
      setError(m || t('billing.err'))
      setBusy(false)
    })
  }

  let headline: string
  let detail: string | null = null
  if (b.state === 'active' || b.state === 'past_due') {
    headline = t(b.paidStores === 1 ? 'billing.active.one' : 'billing.active', { n: b.paidStores ?? 1, total: b.monthly })
  } else if (b.state === 'exempt') {
    headline = t('billing.exempt')
  } else {
    headline = b.daysLeft != null ? t(b.daysLeft === 1 ? 'billing.trial.daysLeft.one' : 'billing.trial.daysLeft', { n: b.daysLeft }) : t('billing.trial')
    detail = t('billing.trial.includes')
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)]">
      <div>
        <p className="font-heading text-sm font-extrabold text-ink">{headline}</p>
        {detail && <p className="font-body text-xs text-muted-ink">{detail}</p>}
      </div>

      {b.state === 'past_due' && (
        <p className="rounded-xl border-2 border-coral bg-coral-bg px-3 py-2 font-body text-xs font-bold text-coral-dark">
          {t('billing.pastDue')}
        </p>
      )}

      {/* the price ladder, until they're paying (then it's on their invoice) */}
      {b.state !== 'active' && b.state !== 'past_due' && b.state !== 'exempt' && <PriceLadder />}

      {native ? (
        b.enabled && b.state !== 'exempt' && <p className="font-body text-[11px] text-muted-ink">{t('billing.native')}</p>
      ) : b.state === 'trial' && b.enabled ? (
        <div>
          <button disabled={busy} onClick={() => go(api.startCheckout)} className={`${btn} bg-green text-white`}>
            {busy ? t('billing.opening') : t('billing.subscribe', { total: b.monthly })}
          </button>
          {b.trialEndsAt && (
            <p className="mt-1.5 font-body text-[11px] text-muted-ink">
              {t('billing.subscribeEarly', { date: shortDate(b.trialEndsAt) })}
            </p>
          )}
        </div>
      ) : (b.state === 'active' || b.state === 'past_due') && b.hasBillingAccount ? (
        <div>
          <button disabled={busy} onClick={() => go(api.openBillingPortal)} className={`${btn} bg-paper text-ink`}>
            {busy ? t('billing.opening') : t('billing.manage')}
          </button>
        </div>
      ) : null}
      {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
    </div>
  )
}

function PriceLadder() {
  const t = useT()
  return (
    <div className="rounded-xl bg-cream/70 px-3 py-2">
      <p className="font-body text-[11px] font-bold text-ink">{t('billing.pricing.title')}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-body text-[11px] text-muted-ink">
        {[1, 2, 3, 4].map((n) => (
          <span key={n}>
            {t(`billing.pricing.store${n}` as TKey, { price: priceOfStore(n) })}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Under Settings › Locations once the business has every store it pays for:
 * what another one costs, and (when subscribed, on the web) a button that adds
 * it to the plan. `onAdded` then reveals the Add store form. */
export function StoreLimitNote({
  billing,
  onAdded,
}: {
  billing: BillingSummary
  onAdded: (b: BillingSummary) => void
}) {
  const t = useT()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const b = billing
  const limit = b.storeLimit ?? 1
  const native = isNativeApp()

  async function addToPlan() {
    const paid = b.paidStores ?? 1
    const ok = await confirm(
      t('billing.addStore.confirm', { from: b.monthly, to: b.monthly + b.nextStorePrice }),
      { confirmLabel: t('billing.addStore.confirmBtn') },
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      onAdded(await api.setPaidStores(paid + 1))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('billing.err'))
    } finally {
      setBusy(false)
    }
  }

  let text: string
  if (b.state === 'active' && !native) text = t('billing.limit.active', { price: b.nextStorePrice })
  else if (b.state === 'active' || b.state === 'past_due') text = t('billing.limit.activeNative', { price: b.nextStorePrice })
  else if (b.state === 'exempt') text = t(limit === 1 ? 'billing.limit.exempt.one' : 'billing.limit.exempt', { n: limit })
  else if (b.enabled) text = t('billing.limit.trial', { price: b.nextStorePrice })
  else text = t('billing.limit.off', { price: b.nextStorePrice })

  return (
    <div className="mb-3 rounded-xl border-2 border-dashed border-ink/30 px-3 py-2">
      <p className="font-body text-xs text-muted-ink">{text}</p>
      {b.state === 'active' && !native && (
        <button disabled={busy} onClick={() => void addToPlan()} className={`${btn} mt-2 bg-green text-white`}>
          {busy ? t('billing.opening') : t('billing.addStore.btn', { price: b.nextStorePrice })}
        </button>
      )}
      {error && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{error}</p>}
    </div>
  )
}

/** Shown instead of the app once a business's free trial has ended without a
 * plan. The owner can subscribe right here (on the web); everyone else is told
 * to ask them. Nothing has been deleted either way. */
export function BillingLapsed() {
  const t = useT()
  const { user, logout, refreshUser } = useAuth()
  const location = useLocation()
  const isOwner = user?.role === 'OWNER'
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // back from Stripe Checkout — the plan lands a moment later via Stripe's webhook
  const justPaid = new URLSearchParams(location.search).get('billing') === 'done'

  useEffect(() => {
    if (isOwner) api.getBilling().then(setBilling).catch(() => {})
  }, [isOwner])

  useEffect(() => {
    if (!justPaid) return
    const id = window.setInterval(() => void refreshUser(), 3000)
    return () => window.clearInterval(id)
  }, [justPaid, refreshUser])

  return (
    <div className="flex h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border-[2.5px] border-ink bg-paper p-4 text-center shadow-[3px_3px_0_var(--color-ink)]">
        <h1 className="font-heading text-lg font-bold text-ink">
          {justPaid ? t('billing.lapsed.finishing') : t('billing.lapsed.title')}
        </h1>
        <p className="mt-2 font-body text-sm text-muted-ink">
          {justPaid ? t('billing.lapsed.finishingBody') : isOwner ? t('billing.lapsed.owner') : t('billing.lapsed.staff')}
        </p>
        {isOwner && !justPaid && billing && (
          <div className="mt-3">
            {isNativeApp() ? (
              <p className="font-body text-xs text-muted-ink">{t('billing.native')}</p>
            ) : (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void goToStripe(api.startCheckout, (m) => {
                    setError(m || t('billing.err'))
                    setBusy(false)
                  })
                }}
                className={`${btn} bg-green text-white`}
              >
                {busy ? t('billing.opening') : t('billing.subscribe', { total: billing.monthly })}
              </button>
            )}
            {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
          </div>
        )}
        <button
          onClick={() => void logout()}
          className="mt-4 rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold text-ink"
        >
          {t('orgBlocked.logout')}
        </button>
      </div>
    </div>
  )
}
