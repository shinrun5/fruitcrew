import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, EmptyState } from '../../components/Card'
import { Pill, SectionTitle, Stat } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { AMB_STATUS_TONE, money, STAGE_TONE, useAmbLabels } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import type { AmbassadorBudget, AmbassadorOverview, AmbassadorRow } from '../../types'

/** The pilot budget: what's actually been spent, what's owed, and what's only
 * an estimate — kept visibly apart. */
export function BudgetCard({ b }: { b: AmbassadorBudget }) {
  const t = useT()
  const row = (label: string, cents: number, hint?: string, tone = 'text-ink') => (
    <div className="flex items-baseline justify-between gap-2 border-t border-ink/10 py-1.5 first:border-t-0">
      <span className="min-w-0 font-body text-xs text-ink">
        {label}
        {hint && <span className="block text-[10px] text-muted-ink">{hint}</span>}
      </span>
      <span className={`shrink-0 font-heading text-sm font-bold ${tone}`}>{money(cents)}</span>
    </div>
  )
  return (
    <Card className={b.overBudget ? 'border-coral' : b.nearLimit ? 'border-yellow' : ''}>
      <div className="flex items-baseline justify-between">
        <h3 className="font-heading text-sm font-bold text-ink">{t('ambAdm.budget.title')}</h3>
        <span className="font-heading text-sm font-extrabold text-ink">{money(b.budgetCents)}</span>
      </div>
      <div className="mt-2">
        {row(t('ambAdm.budget.paid'), b.paidCents, t('ambAdm.budget.paidHint'))}
        {row(t('ambAdm.budget.owed'), b.approvedUnpaidCents, t('ambAdm.budget.owedHint'))}
        {row(t('ambAdm.budget.pending'), b.pendingCents, t('ambAdm.budget.pendingHint'))}
        {row(t('ambAdm.budget.future'), b.estimatedFutureCents, t('ambAdm.budget.futureHint'))}
        {row(t('ambAdm.budget.remaining'), b.remainingCents, t('ambAdm.budget.remainingHint'), b.remainingCents < 0 ? 'text-coral-dark' : 'text-green-dark')}
      </div>
      <p className="mt-2 font-body text-[11px] text-muted-ink">{t('ambAdm.budget.trials', { amount: money(b.ifTrialsConvertCents) })}</p>
      {(b.overBudget || b.nearLimit) && (
        <p className={`mt-2 rounded-lg border-2 px-2.5 py-1.5 font-body text-xs font-bold ${b.overBudget ? 'border-coral bg-coral-bg text-coral-dark' : 'border-yellow bg-yellow/10 text-ink'}`}>
          {b.overBudget ? t('ambAdm.budget.over') : t('ambAdm.budget.near', { amount: money(b.perNewStoreCents) })}
        </p>
      )}
    </Card>
  )
}

/** Everyone at a glance: how far through training, how much outreach, the
 * stores they brought in and where each stands, and the money both ways —
 * what their stores have paid us, and what they've earned, are owed and got. */
function Team() {
  const t = useT()
  const L = useAmbLabels()
  const [list, setList] = useState<AmbassadorRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.getAmbassadors().then(setList).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  if (error) return <p className="font-body text-sm font-bold text-coral-dark">{error}</p>
  if (!list) return <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>
  // the ones bringing in stores first; someone let go stays only while they have stores
  const people = list
    .filter((a) => a.status !== 'DEACTIVATED' || a.stores > 0)
    .sort((a, b) => b.paying - a.paying || b.activated - a.activated || b.stores - a.stores || b.contacts30d - a.contacts30d)
  if (!people.length) return <EmptyState title={t('ambAdm.team.none', { tab: t('ambAdm.tab.people') })} />
  const cell = (label: string, cents: number, tone = 'text-ink') => (
    <div className="flex min-w-0 flex-col">
      <span className={`font-heading text-sm font-extrabold ${tone}`}>{money(cents)}</span>
      <span className="font-body text-[10px] font-bold text-muted-ink">{label}</span>
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      {people.map((a) => (
        <Card key={a.id} as={Link} to={`/admin/ambassadors/people/${a.id}`} clickable padded={false} className="flex flex-col gap-2 p-3 text-left">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <span className="block truncate font-heading text-sm font-bold text-ink">{a.name}</span>
              <span className="block truncate font-body text-xs text-muted-ink">{a.school ?? a.email}</span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Pill tone={AMB_STATUS_TONE[a.status]}>{t(`ambAdm.status.${a.status}`)}</Pill>
              {a.hasLogin ? (
                <Pill tone={a.trainingDone === a.trainingTotal ? STAGE_TONE.paying : 'border-ink/25 bg-cream text-muted-ink'}>
                  {t('ambAdm.team.training', { n: a.trainingDone, total: a.trainingTotal })}
                </Pill>
              ) : (
                <span className="font-body text-[10px] text-muted-ink">{t('ambAdm.people.noLogin')}</span>
              )}
            </div>
          </div>
          <p className="font-body text-[11px] text-muted-ink">
            {t('ambAdm.team.work', { claims: a.openClaims, contacts: a.contacts30d })} ·{' '}
            {a.lastContactAt ? t('ambAdm.team.lastContact', { date: shortDate(a.lastContactAt) }) : t('ambAdm.team.noContact')}
          </p>
          <div className="flex flex-col gap-1">
            <span className="font-body text-[11px] font-bold text-ink">
              {a.stores ? t('ambAdm.team.stores', { n: a.stores, activated: a.activated, paying: a.paying }) : t('ambAdm.team.noStores')}
            </span>
            {a.storeList.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {a.storeList.map((s) => (
                  <Pill key={s.storeId} tone={STAGE_TONE[s.stage]}>
                    {s.name === s.business ? s.name : `${s.business} · ${s.name}`} · {L.stage(s.stage)}
                  </Pill>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-ink/10 pt-2 sm:grid-cols-5">
            {cell(t('ambAdm.team.revenue'), a.revenueCents)}
            {cell(t('ambAdm.team.earned'), a.earnedCents)}
            {cell(t('ambAdm.team.pending'), a.pendingCents, 'text-muted-ink')}
            {cell(t('ambAdm.team.paid'), a.paidCents, 'text-green-dark')}
            {cell(t('ambAdm.team.owed'), a.payableCents, a.payableCents > 0 ? 'text-coral-dark' : 'text-ink')}
          </div>
        </Card>
      ))}
    </div>
  )
}

export function AdmOverview() {
  const t = useT()
  const [o, setO] = useState<AmbassadorOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.getAmbassadorOverview().then(setO).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  if (error) return <p className="font-body text-sm font-bold text-coral-dark">{error}</p>
  if (!o) return <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>
  const todo = [
    o.pendingApplications > 0 && { to: '/admin/ambassadors/applications', text: t('ambAdm.todo.applications', { n: o.pendingApplications }) },
    o.pendingCount > 0 && { to: '/admin/ambassadors/rewards', text: t('ambAdm.todo.rewards', { n: o.pendingCount, amount: money(o.pendingCents) }) },
    o.followUpRequests > 0 && { to: '/admin/ambassadors/leads?filter=followUp', text: t('ambAdm.todo.followUps', { n: o.followUpRequests }) },
    o.leadsToReview > 0 && { to: '/admin/ambassadors/leads?filter=review', text: t('ambAdm.todo.review', { n: o.leadsToReview }) },
  ].filter((x): x is { to: string; text: string } => !!x)
  return (
    <>
      {todo.length > 0 && (
        <Card className="flex flex-col gap-1.5 border-yellow">
          <h3 className="font-heading text-sm font-bold text-ink">{t('ambAdm.todo.title')}</h3>
          {todo.map((x) => (
            <Link key={x.to} to={x.to} className="font-body text-xs font-bold text-sky-dark">
              {x.text} ›
            </Link>
          ))}
        </Card>
      )}
      <SectionTitle title={t('ambAdm.overview.program')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={t('ambAdm.overview.ambassadors')} value={o.ambassadors} hint={t('ambAdm.overview.active', { n: o.activeAmbassadors })} />
        <Stat label={t('ambAdm.overview.referred')} value={o.storesReferred} hint={t('ambAdm.overview.businesses', { n: o.businessesReferred })} />
        <Stat label={t('ambAdm.overview.activated')} value={o.storesActivated} />
        <Stat label={t('ambAdm.overview.paying')} value={o.payingStores} />
        <Stat label={t('ambAdm.overview.revenue')} value={money(o.revenueCents)} hint={t('ambAdm.overview.revenueHint')} />
        <Stat label={t('ambAdm.overview.bountiesPaid')} value={money(o.bountiesPaidCents)} />
        <Stat label={t('ambAdm.overview.pending')} value={money(o.pendingCents)} />
        <Stat label={t('ambAdm.overview.cac')} value={o.acquisitionCostCents == null ? '—' : money(o.acquisitionCostCents)} hint={t('ambAdm.overview.cacHint')} />
      </div>
      <SectionTitle title={t('ambAdm.team.title')} hint={t('ambAdm.team.hint')} />
      <Team />
      <SectionTitle title={t('ambAdm.budget.section')} />
      <BudgetCard b={o.budget} />
    </>
  )
}
