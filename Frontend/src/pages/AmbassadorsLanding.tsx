import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field, TextareaField } from '../components/Field'
import { FruitAvatar } from '../components/FruitAvatar'
import { api } from '../lib/api'
import { money, percent } from '../lib/ambassadorText'
import { useT } from '../lib/i18n'
import type { AmbassadorProgramPublic } from '../types'

/** /ambassadors — the public page where students learn about the program and
 * apply. Applying gives no access; FruitCrew reviews every application. */
export function AmbassadorsLanding() {
  const t = useT()
  const [p, setP] = useState<AmbassadorProgramPublic | null>(null)
  const [f, setF] = useState({ name: '', email: '', school: '', area: '', experience: '', why: '', website: '' })
  const [adult, setAdult] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  useEffect(() => {
    api.getAmbassadorProgram().then(setP).catch(() => {})
  }, [])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await api.applyAmbassador({
        name: f.name.trim(),
        email: f.email.trim(),
        area: f.area.trim(),
        why: f.why.trim(),
        adult,
        ...(f.school.trim() ? { school: f.school.trim() } : {}),
        ...(f.experience.trim() ? { experience: f.experience.trim() } : {}),
        ...(f.website ? { website: f.website } : {}),
      })
      setSent(true)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-cream">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-12 sm:p-8">
        <div className="flex items-center gap-2.5">
          <FruitAvatar kind="apple" size={36} />
          <span className="font-heading text-lg font-extrabold text-ink">Fruit Crew</span>
          <Link to="/login" className="ml-auto font-body text-xs font-bold text-sky-dark">
            {t('ambPublic.signIn')}
          </Link>
        </div>

        <div>
          <span className="font-body text-[11px] font-bold uppercase tracking-wide text-green-dark">{t('ambPublic.kicker')}</span>
          <h1 className="mt-1 text-balance font-heading text-2xl font-extrabold text-ink sm:text-3xl">{t('ambPublic.title')}</h1>
          <p className="mt-2 font-body text-sm text-ink">{t('ambPublic.lead')}</p>
        </div>

        <Card className="flex flex-col gap-2">
          <h2 className="font-heading text-sm font-bold text-ink">{t('ambPublic.whatTitle')}</h2>
          <p className="font-body text-xs text-ink">{t('ambPublic.what')}</p>
        </Card>

        <Card className="flex flex-col gap-2">
          <h2 className="font-heading text-sm font-bold text-ink">{t('ambPublic.howTitle')}</h2>
          <ol className="flex flex-col gap-1.5 font-body text-xs text-ink">
            {(['how1', 'how2', 'how3', 'how4'] as const).map((k, i) => (
              <li key={k} className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-ink font-heading text-[10px] font-bold">{i + 1}</span>
                <span>{t(`ambPublic.${k}`)}</span>
              </li>
            ))}
          </ol>
        </Card>

        {p && (
          <Card className="flex flex-col gap-2 border-green">
            <h2 className="font-heading text-sm font-bold text-ink">{t('ambPublic.earnTitle')}</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border-2 border-ink/15 bg-paper px-3 py-2">
                <span className="block font-heading text-xl font-extrabold text-ink">{money(p.bountyCents)}</span>
                <span className="font-body text-[11px] font-bold text-muted-ink">{t('ambPublic.bounty')}</span>
              </div>
              <div className="rounded-xl border-2 border-ink/15 bg-paper px-3 py-2">
                <span className="block font-heading text-xl font-extrabold text-ink">{percent(p.rateBps)}</span>
                <span className="font-body text-[11px] font-bold text-muted-ink">{t('ambPublic.recurring', { months: p.maxPaidPeriods })}</span>
              </div>
            </div>
            <p className="font-body text-xs text-ink">
              {t('ambPublic.example', { price: money(p.storePriceCents), perMonth: money(p.perMonthCents), months: p.maxPaidPeriods, max: money(p.maxPerStoreCents) })}
            </p>
            <p className="font-body text-[11px] text-muted-ink">{t('ambPublic.fine', { extra: percent(p.extraStoreRateBps) })}</p>
            <p className="font-body text-[11px] font-bold text-muted-ink">{t('ambPublic.noGuarantee')}</p>
          </Card>
        )}

        <Card className="flex flex-col gap-1.5">
          <h2 className="font-heading text-sm font-bold text-ink">{t('ambPublic.whyTitle')}</h2>
          {(['why1', 'why2', 'why3'] as const).map((k) => (
            <p key={k} className="font-body text-xs text-ink">
              • {t(`ambPublic.${k}`)}
            </p>
          ))}
        </Card>

        <Card id="apply" className="flex flex-col gap-2">
          <h2 className="font-heading text-base font-bold text-ink">{t('ambPublic.applyTitle')}</h2>
          {sent ? (
            <p className="rounded-xl border-2 border-green bg-green/10 px-3 py-2 font-body text-sm font-bold text-green-dark">{t('ambPublic.sent')}</p>
          ) : p && !p.enrollmentOpen ? (
            <p className="font-body text-sm text-muted-ink">{t('ambPublic.closed')}</p>
          ) : (
            <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
              <p className="font-body text-[11px] text-muted-ink">{t('ambPublic.applyHint')}</p>
              <Field label={t('ambPublic.f.name')} value={f.name} onChange={set('name')} required maxLength={100} autoComplete="name" />
              <Field label={t('ambPublic.f.email')} value={f.email} onChange={set('email')} required type="email" maxLength={200} autoComplete="email" />
              <Field label={t('ambPublic.f.school')} value={f.school} onChange={set('school')} maxLength={120} />
              <Field label={t('ambPublic.f.area')} value={f.area} onChange={set('area')} required maxLength={120} placeholder={t('ambPublic.f.areaPh')} />
              <TextareaField label={t('ambPublic.f.experience')} value={f.experience} onChange={set('experience')} maxLength={1000} rows={2} />
              <TextareaField label={t('ambPublic.f.why')} value={f.why} onChange={set('why')} required maxLength={1500} rows={3} />
              <label className="flex items-center gap-2 font-body text-xs font-bold text-ink">
                <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} required />
                {t('ambPublic.f.adult')}
              </label>
              {/* never shown — only bots fill it in */}
              <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} className="hidden" />
              {err && <p className="font-body text-xs font-bold text-coral-dark">{err}</p>}
              <Button type="submit" disabled={busy || !adult} className="justify-center">
                {busy ? t('ambPublic.sending') : t('ambPublic.submit')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
