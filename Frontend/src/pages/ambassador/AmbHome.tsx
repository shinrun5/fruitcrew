import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { CopyButton } from '../../components/CopyButton'
import { AmbPage, SectionTitle, Stat } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { AMB_LESSONS, money, percent } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { ambassadorReferralUrl } from '../../lib/links'
import { useCopy } from '../../lib/use-copy'
import type { AmbassadorMe } from '../../types'

/** The program terms, with an "I agree" — shown until they accept the current version. */
export function TermsGate({ onAccepted }: { onAccepted: () => void }) {
  const t = useT()
  const [terms, setTerms] = useState<{ version: number; text: string; acceptedVersion: number | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.getAmbassadorTerms().then(setTerms).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])
  async function accept() {
    if (!terms) return
    setBusy(true)
    setErr(null)
    try {
      await api.acceptAmbassadorTerms(terms.version)
      onAccepted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="mt-3 border-yellow">
      <h2 className="font-heading text-sm font-bold text-ink">
        {terms?.acceptedVersion ? t('ambPortal.terms.updated') : t('ambPortal.terms.title')}
      </h2>
      <p className="mt-1 font-body text-xs text-muted-ink">{t('ambPortal.terms.hint')}</p>
      {terms && (
        <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border-2 border-ink/15 bg-cream/60 p-2.5 font-body text-xs text-ink">
          {terms.text}
        </div>
      )}
      {err && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{err}</p>}
      <Button className="mt-3 w-full justify-center" disabled={!terms || busy} onClick={() => void accept()}>
        {t('ambPortal.terms.accept', { v: terms?.version ?? '' })}
      </Button>
    </Card>
  )
}

export function AmbHome() {
  const t = useT()
  const [me, setMe] = useState<AmbassadorMe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const { copiedKey, copy } = useCopy()

  const load = useCallback(() => {
    api.getAmbassadorMe().then(setMe).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])

  const link = me ? ambassadorReferralUrl(me.ambassador.code) : ''
  useEffect(() => {
    if (!link) return
    let live = true
    QRCode.toDataURL(link, { margin: 1, width: 320, color: { dark: '#3A2B4D', light: '#FFFFFF' } })
      .then((url) => live && setQr(url))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [link])

  if (error) return <AmbPage title={t('ambPortal.home.title')}><p className="mt-3 font-body text-sm font-bold text-coral-dark">{error}</p></AmbPage>
  if (!me) return <AmbPage title={t('ambPortal.home.title')}><p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p></AmbPage>

  const p = me.program
  const first = me.ambassador.name.split(' ')[0] ?? me.ambassador.name
  const share = async () => {
    try {
      await navigator.share({ title: 'FruitCrew', text: t('ambPortal.home.shareText'), url: link })
    } catch {
      /* closed the share sheet */
    }
  }
  return (
    <AmbPage title={t('ambPortal.home.hi', { name: first })} sub={t('ambPortal.home.sub')}>
      {!me.termsAccepted && <TermsGate onAccepted={load} />}
      {me.ambassador.status === 'SUSPENDED' && (
        <p className="mt-3 rounded-xl border-2 border-coral bg-coral-bg px-3 py-2 font-body text-xs font-bold text-coral-dark">{t('ambPortal.home.suspended')}</p>
      )}
      {!p.referralsOpen && (
        <p className="mt-3 rounded-xl border-2 border-yellow bg-yellow/10 px-3 py-2 font-body text-xs font-bold text-ink">{t('ambPortal.home.paused')}</p>
      )}
      {me.trainingDone.length < AMB_LESSONS.length && (
        <Card as={Link} to="/ambassador/learn" clickable className="mt-3 flex items-center gap-3 border-grape">
          <span className="min-w-0 flex-1">
            <span className="block font-heading text-sm font-bold text-ink">{t('ambLearn.home.title')}</span>
            <span className="block font-body text-xs text-muted-ink">{t('ambLearn.home.progress', { n: me.trainingDone.length, total: AMB_LESSONS.length })}</span>
          </span>
          <span className="shrink-0 font-heading text-xs font-bold text-sky-dark">
            {me.trainingDone.length ? t('ambLearn.home.continue') : t('ambLearn.home.start')} ›
          </span>
        </Card>
      )}

      <SectionTitle title={t('ambPortal.home.linkTitle')} hint={t('ambPortal.home.linkHint')} />
      <Card className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        {qr ? (
          <img src={qr} alt={t('ambPortal.home.qrAlt')} className="h-40 w-40 shrink-0 rounded-lg border-2 border-ink/15" />
        ) : (
          <div className="h-40 w-40 shrink-0 rounded-lg border-2 border-dashed border-ink/20" />
        )}
        <div className="flex w-full min-w-0 flex-col gap-2">
          <span className="font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">{t('ambPortal.home.code')}</span>
          <span className="font-heading text-2xl font-extrabold tracking-wider text-ink">{me.ambassador.code}</span>
          <span className="break-all font-body text-xs text-muted-ink">{link}</span>
          <div className="flex flex-wrap gap-2">
            <CopyButton copied={copiedKey === 'link'} onClick={() => copy('link', link)} label={t('ambPortal.home.copyLink')} copiedLabel={t('ambPortal.home.copied')} tone="sky" />
            {typeof navigator.share === 'function' && (
              <Button size="sm" variant="secondary" onClick={() => void share()}>
                {t('ambPortal.home.share')}
              </Button>
            )}
            {qr && (
              <a href={qr} download={`fruitcrew-${me.ambassador.code}.png`} className="rounded-full border-2 border-ink bg-paper px-3 py-0.5 font-heading text-[11px] font-bold text-ink">
                {t('ambPortal.home.saveQr')}
              </a>
            )}
          </div>
        </div>
      </Card>

      <SectionTitle title={t('ambPortal.home.moneyTitle')} right={<Link to="/ambassador/money" className="font-body text-xs font-bold text-sky-dark">{t('ambPortal.home.seeAll')}</Link>} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t('ambPortal.money.lifetime')} value={money(me.totals.lifetime)} />
        <Stat label={t('ambPortal.money.paid')} value={money(me.totals.paid)} tone="text-green-dark" />
        <Stat label={t('ambPortal.money.owed')} value={money(me.totals.approvedUnpaid)} hint={t('ambPortal.money.owedHint')} />
        <Stat label={t('ambPortal.money.waiting')} value={money(me.totals.pendingBounties + me.totals.pendingCommissions)} hint={t('ambPortal.money.waitingHint')} />
      </div>
      {me.estimate.monthlyCents > 0 && (
        <p className="mt-2 font-body text-[11px] text-muted-ink">
          {t('ambPortal.home.estimate', { month: money(me.estimate.monthlyCents), total: money(me.estimate.upcomingCents) })}
        </p>
      )}

      <SectionTitle title={t('ambPortal.home.workTitle')} />
      <div className="grid grid-cols-2 gap-2">
        <Card as={Link} to="/ambassador/list" clickable padded={false} className="px-3 py-2">
          <span className="block font-heading text-lg font-extrabold text-ink">
            {me.counts.openClaims}/{p.maxActiveClaims}
          </span>
          <span className="font-body text-[11px] font-bold text-muted-ink">{t('ambPortal.home.holding')}</span>
        </Card>
        <Card as={Link} to="/ambassador/stores" clickable padded={false} className="px-3 py-2">
          <span className="block font-heading text-lg font-extrabold text-ink">{me.counts.stores}</span>
          <span className="font-body text-[11px] font-bold text-muted-ink">
            {t('ambPortal.home.storesLine', { activated: me.counts.activated, paying: me.counts.paying })}
          </span>
        </Card>
      </div>
      <Link to="/ambassador/find" className="mt-3">
        <Button className="w-full justify-center">{t('ambPortal.home.findCta')}</Button>
      </Link>

      <SectionTitle title={t('ambPortal.home.howTitle')} />
      <Card className="flex flex-col gap-1.5 font-body text-xs text-ink">
        <p>{t('ambPortal.home.how1', { bounty: money(p.bountyCents) })}</p>
        <p>{t('ambPortal.home.how2', { rate: percent(p.rateBps), months: p.maxPaidPeriods, perMonth: money(p.perMonthCents), extra: percent(p.extraStoreRateBps) })}</p>
        <p>{t('ambPortal.home.how3', { days: p.holdDays })}</p>
        <Link to="/ambassador/rules" className="font-bold text-sky-dark">
          {t('ambPortal.home.rulesLink')}
        </Link>
      </Card>
    </AmbPage>
  )
}
