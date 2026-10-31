import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Field } from '../../components/Field'
import { Toggle, ToggleGroup } from '../../components/Toggle'
import { SectionTitle } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { useConfirm } from '../../lib/confirm'
import { useT } from '../../lib/i18n'
import { relativeTime } from '../../lib/time'
import type { AmbassadorSettings, AuditEntry } from '../../types'

/** Who changed what — admin actions on ambassadors, money and leads. */
export function AuditList({ rows }: { rows: (AuditEntry & { actor?: string | null })[] }) {
  const t = useT()
  if (rows.length === 0) return <p className="font-body text-xs text-muted-ink">{t('ambAdm.audit.none')}</p>
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => (
        <li key={r.id} className="rounded-lg border border-ink/10 bg-paper px-2.5 py-1.5 font-body text-[11px] text-ink">
          <b>{r.action}</b> · {relativeTime(r.at)}
          {r.actor ? ` · ${r.actor}` : ''}
          {r.detail != null && <span className="block break-all text-muted-ink">{JSON.stringify(r.detail).slice(0, 240)}</span>}
        </li>
      ))}
    </ul>
  )
}

type Form = { bounty: string; rate: string; extra: string; months: string; hold: string; claimDays: string; maxClaims: string; budget: string; terms: string }

const toForm = (s: AmbassadorSettings): Form => ({
  bounty: (s.bountyCents / 100).toString(),
  rate: (s.rateBps / 100).toString(),
  extra: (s.extraStoreRateBps / 100).toString(),
  months: String(s.maxPaidPeriods),
  hold: String(s.holdDays),
  claimDays: String(s.claimDays),
  maxClaims: String(s.maxActiveClaims),
  budget: (s.budgetCents / 100).toString(),
  terms: s.termsText,
})

export function AdmSettings() {
  const t = useT()
  const confirm = useConfirm()
  const [s, setS] = useState<AmbassadorSettings | null>(null)
  const [f, setF] = useState<Form | null>(null)
  const [audit, setAudit] = useState<(AuditEntry & { actor?: string | null })[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = () => {
    api
      .getAmbassadorSettings()
      .then((x) => {
        setS(x)
        setF(toForm(x))
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    api.getAmbassadorAudit(100).then(setAudit).catch(() => {})
  }
  useEffect(load, [])

  async function save(patch: Parameters<typeof api.updateAmbassadorSettings>[0]) {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const x = await api.updateAmbassadorSettings(patch)
      setS(x)
      setF(toForm(x))
      setSaved(true)
      api.getAmbassadorAudit(100).then(setAudit).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  if (!s || !f) return error ? <p className="font-body text-sm font-bold text-coral-dark">{error}</p> : <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>

  const cents = (v: string) => Math.round(Number(v) * 100)
  const bps = (v: string) => Math.round(Number(v) * 100)
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => (x ? { ...x, [k]: e.target.value } : x))
  async function saveNumbers() {
    if (!f) return
    await save({
      bountyCents: cents(f.bounty),
      rateBps: bps(f.rate),
      extraStoreRateBps: bps(f.extra),
      maxPaidPeriods: Number(f.months),
      holdDays: Number(f.hold),
      claimDays: Number(f.claimDays),
      maxActiveClaims: Number(f.maxClaims),
      budgetCents: cents(f.budget),
    })
  }
  async function saveTerms() {
    if (!f) return
    if (await confirm(t('ambAdm.settings.termsConfirm'), { confirmLabel: t('ambAdm.settings.termsSave') })) await save({ termsText: f.terms })
  }
  const num = (k: keyof Form, labelKey: string, step = '1') => (
    <Field label={t(labelKey as Parameters<typeof t>[0])} type="number" inputMode="decimal" step={step} min="0" value={f[k]} onChange={set(k)} />
  )
  return (
    <>
      <ToggleGroup>
        <Toggle plain on={s.enrollmentOpen} busy={busy} label={t('ambAdm.settings.enrollment')} hint={t('ambAdm.settings.enrollmentHint')} onClick={() => void save({ enrollmentOpen: !s.enrollmentOpen })} />
        <Toggle plain on={s.referralsOpen} busy={busy} label={t('ambAdm.settings.referrals')} hint={t('ambAdm.settings.referralsHint')} onClick={() => void save({ referralsOpen: !s.referralsOpen })} />
      </ToggleGroup>

      <SectionTitle title={t('ambAdm.settings.money')} hint={t('ambAdm.settings.moneyHint')} />
      <Card className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {num('bounty', 'ambAdm.settings.bounty', '0.01')}
        {num('rate', 'ambAdm.settings.rate', '0.1')}
        {num('extra', 'ambAdm.settings.extra', '0.1')}
        {num('months', 'ambAdm.settings.months')}
        {num('hold', 'ambAdm.settings.hold')}
        {num('budget', 'ambAdm.settings.budget', '1')}
        {num('claimDays', 'ambAdm.settings.claimDays')}
        {num('maxClaims', 'ambAdm.settings.maxClaims')}
        <Button size="sm" className="col-span-2 justify-self-start sm:col-span-4" disabled={busy} onClick={() => void saveNumbers()}>
          {t('common.save')}
        </Button>
      </Card>

      <SectionTitle title={t('ambAdm.settings.terms', { v: s.termsVersion })} hint={t('ambAdm.settings.termsHint')} />
      {s.starterTerms && <p className="mb-2 rounded-xl border-2 border-yellow bg-yellow/10 px-3 py-2 font-body text-xs font-bold text-ink">{t('ambAdm.settings.starter')}</p>}
      <textarea value={f.terms} onChange={set('terms')} rows={14} className="w-full rounded-lg border-2 border-ink bg-cream px-2 py-1.5 font-body text-xs text-ink outline-none" />
      {f.terms.trim() !== s.termsText && (
        <Button size="sm" className="mt-2 self-start" disabled={busy} onClick={() => void saveTerms()}>
          {t('ambAdm.settings.termsSave')}
        </Button>
      )}
      {saved && <p className="mt-2 font-body text-xs font-bold text-green-dark">{t('ambAdm.settings.saved')}</p>}
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <SectionTitle title={t('ambAdm.audit.title')} />
      <AuditList rows={audit} />
    </>
  )
}
