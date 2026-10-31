import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { AmbPage, Pill, SectionTitle, Stat } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { money, STATE_TONE, useAmbLabels } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import type { AmbassadorEarning, AmbassadorMe, AmbassadorPayout, AmbassadorTotals } from '../../types'

/** Every reward — waiting, owed, paid — and every payout. Real money and
 * estimates are kept apart. */
export function AmbMoney() {
  const t = useT()
  const label = useAmbLabels()
  const [data, setData] = useState<{ totals: AmbassadorTotals; items: AmbassadorEarning[]; payouts: AmbassadorPayout[] } | null>(null)
  const [me, setMe] = useState<AmbassadorMe | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    Promise.all([api.getAmbassadorEarnings(), api.getAmbassadorMe()])
      .then(([e, m]) => {
        setData(e)
        setMe(m)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // a yearly payment counts fewer than 12 months once the store is near its limit
  const yearly = (i: AmbassadorEarning) =>
    i.periods > 1 || (!!i.periodStart && !!i.periodEnd && Date.parse(i.periodEnd) - Date.parse(i.periodStart) > 60 * 86_400_000)
  const what = (i: AmbassadorEarning) =>
    i.kind === 'BOUNTY'
      ? t('ambPortal.money.kindBounty')
      : i.kind === 'ADJUSTMENT'
        ? t('ambPortal.money.kindAdjustment')
        : yearly(i)
          ? t('ambPortal.money.kindYear')
          : t('ambPortal.money.kindMonth')
  return (
    <AmbPage title={t('ambPortal.money.title')} sub={t('ambPortal.money.sub')}>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {!data ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label={t('ambPortal.money.lifetime')} value={money(data.totals.lifetime)} />
            <Stat label={t('ambPortal.money.paid')} value={money(data.totals.paid)} tone="text-green-dark" />
            <Stat label={t('ambPortal.money.owed')} value={money(data.totals.approvedUnpaid)} hint={t('ambPortal.money.owedHint')} />
            <Stat label={t('ambPortal.money.pendingBounties')} value={money(data.totals.pendingBounties)} hint={t('ambPortal.money.pendingBountiesHint')} />
            <Stat label={t('ambPortal.money.pendingCommissions')} value={money(data.totals.pendingCommissions)} hint={t('ambPortal.money.pendingCommissionsHint')} />
          </div>
          {me && (
            <Card className="mt-3 border-dashed">
              <span className="font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">{t('ambPortal.money.estimateTitle')}</span>
              <p className="mt-1 font-body text-xs text-ink">
                {t('ambPortal.money.estimateBody', { month: money(me.estimate.monthlyCents), total: money(me.estimate.upcomingCents) })}
              </p>
              <p className="mt-1 font-body text-[11px] text-muted-ink">{t('ambPortal.money.estimateNote')}</p>
            </Card>
          )}
          {me && !(me.ambassador.isAdult && me.ambassador.w9Received) && (
            <p className="mt-3 rounded-xl border-2 border-yellow bg-yellow/10 px-3 py-2 font-body text-xs text-ink">{t('ambPortal.money.needsW9')}</p>
          )}

          <SectionTitle title={t('ambPortal.money.rewards')} />
          {data.items.length === 0 ? (
            <p className="font-body text-xs text-muted-ink">{t('ambPortal.money.noRewards')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.items.map((i) => (
                <li key={i.id} className="flex items-start gap-2 rounded-xl border-2 border-ink/15 bg-paper px-3 py-2">
                  <div className="min-w-0 flex-1 font-body text-xs">
                    <span className="block font-bold text-ink">{what(i)}</span>
                    <span className="block truncate text-muted-ink">
                      {[...new Set([i.business, i.store].filter(Boolean))].join(' · ')} · {shortDate(i.createdAt)}
                    </span>
                    {i.state === 'held' && <span className="block text-sky-dark">{t('ambPortal.money.heldUntil', { date: shortDate(i.availableAt) })}</span>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`font-heading text-sm font-extrabold ${i.amountCents < 0 ? 'text-coral-dark' : 'text-ink'}`}>{money(i.amountCents)}</span>
                    <Pill tone={STATE_TONE[i.state]}>{label.state(i.state)}</Pill>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <SectionTitle title={t('ambPortal.money.payouts')} hint={t('ambPortal.money.payoutsHint')} />
          {data.payouts.length === 0 ? (
            <p className="font-body text-xs text-muted-ink">{t('ambPortal.money.noPayouts')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.payouts.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-xl border-2 border-ink/15 bg-paper px-3 py-2 font-body text-xs">
                  <span className="min-w-0 flex-1 text-ink">
                    {p.status === 'PAID'
                      ? t('ambPortal.money.payoutPaid', { date: shortDate(p.paidAt ?? p.approvedAt), method: p.method ?? '—' })
                      : t('ambPortal.money.payoutSending', { date: shortDate(p.approvedAt) })}
                  </span>
                  <span className="font-heading text-sm font-extrabold text-ink">{money(p.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AmbPage>
  )
}
