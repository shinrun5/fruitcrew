import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { DeleteAccount } from '../../components/DeleteAccount'
import { AmbPage, SectionTitle } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { money, percent } from '../../lib/ambassadorText'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import type { AmbassadorMe } from '../../types'

/** The program's rules in plain words, how to approach businesses, the terms
 * they agreed to, and their account. */
export function AmbRules() {
  const t = useT()
  const { user, logout } = useAuth()
  const [me, setMe] = useState<AmbassadorMe | null>(null)
  const [terms, setTerms] = useState<{ version: number; text: string; acceptedVersion: number | null; acceptedAt: string | null } | null>(null)
  const [showTerms, setShowTerms] = useState(false)
  useEffect(() => {
    api.getAmbassadorMe().then(setMe).catch(() => {})
    api.getAmbassadorTerms().then(setTerms).catch(() => {})
  }, [])
  const p = me?.program
  return (
    <AmbPage title={t('ambPortal.rules.title')}>
      {p && (
        <>
          <SectionTitle title={t('ambPortal.rules.earnTitle')} />
          <Card className="flex flex-col gap-1.5 font-body text-xs text-ink">
            <p>{t('ambPortal.rules.earn1', { bounty: money(p.bountyCents) })}</p>
            <p>{t('ambPortal.rules.earn2', { rate: percent(p.rateBps), months: p.maxPaidPeriods, perMonth: money(p.perMonthCents) })}</p>
            <p>{t('ambPortal.rules.earn3', { extra: percent(p.extraStoreRateBps) })}</p>
            <p>{t('ambPortal.rules.earn4', { days: p.holdDays })}</p>
            <p>{t('ambPortal.rules.earn5')}</p>
            <p className="font-bold">{t('ambPortal.rules.noGuarantee')}</p>
          </Card>
          <SectionTitle title={t('ambPortal.rules.claimTitle')} />
          <Card className="flex flex-col gap-1.5 font-body text-xs text-ink">
            <p className="font-bold">{t('ambPortal.rules.yourCall')}</p>
            <p>{t('ambPortal.rules.claim1')}</p>
            <p>{t('ambPortal.rules.claim2', { n: p.maxActiveClaims, days: p.claimDays })}</p>
            <p>{t('ambPortal.rules.claim3')}</p>
            <p>{t('ambPortal.rules.claim4')}</p>
          </Card>
        </>
      )}
      <SectionTitle title={t('ambPortal.rules.guideTitle')} />
      <Card className="flex flex-col gap-1.5 font-body text-xs text-ink">
        {(['guide1', 'guide2', 'guide3', 'guide4', 'guide5', 'guide6', 'guide7'] as const).map((k) => (
          <p key={k}>• {t(`ambPortal.rules.${k}`)}</p>
        ))}
      </Card>

      <SectionTitle title={t('ambPortal.rules.termsTitle')} />
      <Card className="flex flex-col gap-2">
        {terms && (
          <p className="font-body text-xs text-muted-ink">
            {terms.acceptedVersion && terms.acceptedAt
              ? t('ambPortal.rules.accepted', { v: terms.acceptedVersion, date: shortDate(terms.acceptedAt) })
              : t('ambPortal.rules.notAccepted')}
          </p>
        )}
        <Button size="sm" variant="secondary" className="self-start" onClick={() => setShowTerms((v) => !v)}>
          {showTerms ? t('ambPortal.rules.hideTerms') : t('ambPortal.rules.readTerms', { v: terms?.version ?? '' })}
        </Button>
        {showTerms && terms && <div className="whitespace-pre-wrap rounded-lg border-2 border-ink/15 bg-cream/60 p-2.5 font-body text-xs text-ink">{terms.text}</div>}
      </Card>

      <SectionTitle title={t('ambPortal.rules.accountTitle')} />
      <Card className="flex flex-col gap-2">
        <p className="font-body text-xs text-ink">{t('ambPortal.rules.signedInAs', { email: user?.email ?? '' })}</p>
        <Button size="sm" variant="secondary" className="self-start" onClick={() => void logout()}>
          {t('orgBlocked.logout')}
        </Button>
      </Card>
      <DeleteAccount />
    </AmbPage>
  )
}
