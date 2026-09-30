import { type ReactNode, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useConfirm } from '../lib/confirm'
import { useT } from '../lib/i18n'
import { isNativeApp, priceOfStore } from '../lib/pricing'
import { shortDate } from '../lib/time'
import type { BillingSummary } from '../types'
import type { AddonKey } from '../lib/addons'
import { Modal } from './Modal'
import { ChatIcon, ChecklistIcon, NoteIcon } from './icons'

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
export function PlanPanel({ billing, onChange }: { billing: BillingSummary; onChange: (b: BillingSummary) => void }) {
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
    // the phone apps say what the plan is, never what it costs (app store rules)
    headline = native
      ? t(b.paidStores === 1 ? 'billing.active.native.one' : 'billing.active.native', { n: b.paidStores ?? 1 })
      : t(b.paidStores === 1 ? 'billing.active.one' : 'billing.active', { n: b.paidStores ?? 1, total: b.monthly })
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
      {!native && b.state !== 'active' && b.state !== 'past_due' && b.state !== 'exempt' && <PriceLadder />}

      {native ? (
        b.enabled && b.state !== 'exempt' && <p className="font-body text-[11px] text-muted-ink">{t('billing.native')}</p>
      ) : b.state === 'trial' && b.enabled ? (
        <div>
          <SubscribeButton billing={b} />
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

      <AddonsList billing={b} onChange={onChange} />
    </div>
  )
}

const ADDON_ICON: Record<AddonKey, ReactNode> = {
  chat: <ChatIcon size={16} />,
  notes: <NoteIcon size={16} />,
  closing: <ChecklistIcon size={16} />,
}

/** Settings › Plan › Add-ons: the extras a business turns on separately. Free
 * while billing is off, all on during the trial and for a comped business,
 * and a switch each once paying (web only — the phone apps never sell). */
function AddonsList({ billing: b, onChange }: { billing: BillingSummary; onChange: (b: BillingSummary) => void }) {
  const t = useT()
  const confirm = useConfirm()
  const native = isNativeApp()
  const [busy, setBusy] = useState<AddonKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const paying = b.state === 'active' || b.state === 'past_due'
  const canSwitch = paying && b.state === 'active' && !native

  async function flip(key: AddonKey, on: boolean) {
    const name = t(`addons.${key}.name` as TKey)
    const ok = await confirm(
      on
        ? t('addons.confirmOn', { name, from: b.monthly, to: b.monthly + b.addonPrice })
        : t('addons.confirmOff', { name, from: b.monthly, to: b.monthly - b.addonPrice }),
      { confirmLabel: on ? t('addons.turnOn') : t('addons.turnOff'), tone: on ? 'default' : 'danger' },
    )
    if (!ok) return
    setBusy(key)
    setError(null)
    try {
      onChange(await api.setAddon(key, on))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('billing.err'))
    } finally {
      setBusy(null)
    }
  }

  const note =
    b.state === 'off'
      ? t('addons.note.off')
      : b.state === 'trial'
        ? t('addons.note.trial')
        : b.state === 'exempt'
          ? t('addons.note.exempt')
          : native
            ? null
            : t('addons.note.paying', { price: b.addonPrice })

  return (
    <div className="mt-1 border-t-2 border-ink/10 pt-3">
      <p className="font-heading text-sm font-extrabold text-ink">{t('addons.title')}</p>
      {note && <p className="font-body text-[11px] text-muted-ink">{note}</p>}
      <ul className="mt-2 flex flex-col gap-2">
        {b.addons.map((a) => (
          <li key={a.key} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink/20 bg-cream text-ink">
              {ADDON_ICON[a.key]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-body text-sm font-bold text-ink">{t(`addons.${a.key}.name` as TKey)}</p>
              <p className="font-body text-[11px] text-muted-ink">{t(`addons.${a.key}.description` as TKey)}</p>
            </div>
            {canSwitch ? (
              <button
                role="switch"
                aria-checked={a.paid}
                aria-label={t(`addons.${a.key}.name` as TKey)}
                disabled={busy !== null}
                onClick={() => void flip(a.key, !a.paid)}
                className={`relative mt-1 h-6 w-11 shrink-0 rounded-full border-2 border-ink transition-colors disabled:opacity-50 ${a.paid ? 'bg-green' : 'bg-cream'}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full border-2 border-ink bg-paper transition-[left] ${a.paid ? 'left-[22px]' : 'left-0.5'}`}
                />
              </button>
            ) : (
              <span
                className={`mt-1 shrink-0 rounded-full border px-2 py-0.5 font-body text-[10px] font-bold ${a.on ? 'border-green text-green-dark' : 'border-ink/25 text-muted-ink'}`}
              >
                {a.on ? t(b.state === 'trial' ? 'addons.status.trial' : 'addons.status.on') : t('addons.status.off')}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{error}</p>}
    </div>
  )
}

/** Subscribe (web only): first a short "choose your add-ons" step — the ones
 * the business used during its trial come pre-ticked — then Stripe Checkout. */
function SubscribeButton({ billing: b }: { billing: BillingSummary }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<AddonKey[]>(() => b.addons.filter((a) => a.usedInTrial).map((a) => a.key))
  const total = b.storesMonthly + b.addonPrice * picked.length

  return (
    <>
      <button onClick={() => setOpen(true)} className={`${btn} bg-green text-white`}>
        {t('billing.subscribeStart')}
      </button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} className="max-w-sm">
        <h2 className="font-heading text-base font-extrabold text-ink">{t('addons.choose.title')}</h2>
        <p className="mt-1 font-body text-xs text-muted-ink">
          {t(b.storesInUse <= 1 ? 'addons.choose.base.one' : 'addons.choose.base', { n: Math.max(1, b.storesInUse), total: b.storesMonthly })}
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {b.addons.map((a) => (
            <li key={a.key}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border-2 border-ink/15 p-2 has-[:checked]:border-ink has-[:checked]:bg-cream">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--color-green)]"
                  checked={picked.includes(a.key)}
                  onChange={(e) =>
                    setPicked((p) => (e.target.checked ? [...p, a.key] : p.filter((k) => k !== a.key)))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-body text-sm font-bold text-ink">
                    {t(`addons.${a.key}.name` as TKey)}{' '}
                    <span className="font-normal text-muted-ink">{t('addons.choose.price', { price: b.addonPrice })}</span>
                  </span>
                  <span className="block font-body text-[11px] text-muted-ink">
                    {t(`addons.${a.key}.description` as TKey)}
                    {a.usedInTrial && ` · ${t('addons.choose.used')}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-heading text-sm font-extrabold text-ink">{t('addons.choose.total', { total })}</p>
        {error && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button disabled={busy} onClick={() => setOpen(false)} className={`${btn} bg-paper text-ink`}>
            {t('common.cancel')}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              void goToStripe(
                () => api.startCheckout(picked),
                (m) => {
                  setError(m || t('billing.err'))
                  setBusy(false)
                },
              )
            }}
            className={`${btn} bg-green text-white`}
          >
            {busy ? t('billing.opening') : t('addons.choose.continue')}
          </button>
        </div>
      </Modal>
    </>
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
  if (native) text = t('billing.limit.native')
  else if (b.state === 'active') text = t('billing.limit.active', { price: b.nextStorePrice })
  else if (b.state === 'past_due') text = t('billing.limit.activeNative', { price: b.nextStorePrice })
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
          {justPaid
            ? t('billing.lapsed.finishingBody')
            : !isOwner
              ? t('billing.lapsed.staff')
              : isNativeApp()
                ? t('billing.lapsed.ownerNative')
                : t('billing.lapsed.owner')}
        </p>
        {isOwner && !justPaid && billing && (
          <div className="mt-3">
            {isNativeApp() ? (
              <p className="font-body text-xs text-muted-ink">{t('billing.native')}</p>
            ) : (
              <SubscribeButton billing={billing} />
            )}
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
