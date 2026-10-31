import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card, EmptyState } from '../../components/Card'
import { CopyButton } from '../../components/CopyButton'
import { Field } from '../../components/Field'
import { Pill } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { AMB_STATUS_TONE as STATUS_TONE, money } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { useCopy } from '../../lib/use-copy'
import type { AmbassadorRow } from '../../types'

function AddAmbassador({ onDone }: { onDone: () => void }) {
  const t = useT()
  const { copiedKey, copy } = useCopy()
  const [f, setF] = useState({ name: '', email: '', school: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const r = await api.createAmbassador({ name: f.name.trim(), email: f.email.trim(), ...(f.school.trim() ? { school: f.school.trim() } : {}), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}) })
      setInvite(r.inviteUrl)
      setF({ name: '', email: '', school: '', phone: '' })
      onDone()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <h3 className="font-heading text-sm font-bold text-ink">{t('ambAdm.people.add')}</h3>
      <p className="font-body text-[11px] text-muted-ink">{t('ambAdm.people.addHint')}</p>
      <form onSubmit={(e) => void submit(e)} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t('ambPublic.f.name')} value={f.name} onChange={set('name')} required />
        <Field label={t('ambPublic.f.email')} type="email" value={f.email} onChange={set('email')} required />
        <Field label={t('ambPublic.f.school')} value={f.school} onChange={set('school')} />
        <Field label={t('ambPortal.add.phone')} value={f.phone} onChange={set('phone')} type="tel" />
        {err && <p className="font-body text-xs font-bold text-coral-dark sm:col-span-2">{err}</p>}
        <Button type="submit" size="sm" disabled={busy} className="justify-self-start">
          {t('ambAdm.people.addSubmit')}
        </Button>
      </form>
      {invite && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border-2 border-green bg-green/10 px-2.5 py-1.5">
          <span className="min-w-0 flex-1 font-body text-[11px] text-ink">{t('ambAdm.apps.invited')}</span>
          <CopyButton copied={copiedKey === 'inv'} onClick={() => copy('inv', invite)} label={t('ambAdm.copyInvite')} copiedLabel={t('ambPortal.home.copied')} tone="sky" />
        </div>
      )}
    </Card>
  )
}

export function AdmPeople() {
  const t = useT()
  const [list, setList] = useState<AmbassadorRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const load = useCallback(() => {
    api.getAmbassadors().then(setList).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])
  return (
    <>
      {adding ? (
        <AddAmbassador onDone={load} />
      ) : (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => setAdding(true)}>
          + {t('ambAdm.people.add')}
        </Button>
      )}
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {!list ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <EmptyState className="mt-3" title={t('ambAdm.people.none')} />
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {list.map((a) => (
            <Card key={a.id} as={Link} to={`/admin/ambassadors/people/${a.id}`} clickable padded={false} className="flex flex-col gap-1 p-3 text-left">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-heading text-sm font-bold text-ink">{a.name}</span>
                  <span className="block truncate font-body text-xs text-muted-ink">
                    {a.code} · {a.school ?? a.email}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Pill tone={STATUS_TONE[a.status]}>{t(`ambAdm.status.${a.status}`)}</Pill>
                  {!a.hasLogin && <span className="font-body text-[10px] text-muted-ink">{t('ambAdm.people.noLogin')}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 font-body text-[11px] text-muted-ink">
                <span>{t('ambAdm.people.stores', { n: a.stores, activated: a.activated, paying: a.paying })}</span>
                <span>{t('ambAdm.people.activity', { claims: a.openClaims, contacts: a.contacts30d })}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 font-body text-[11px]">
                <span className="text-ink">{t('ambAdm.people.earned', { amount: money(a.earnedCents) })}</span>
                <span className="text-muted-ink">{t('ambAdm.people.pending', { amount: money(a.pendingCents) })}</span>
                <span className="text-muted-ink">{t('ambAdm.people.paid', { amount: money(a.paidCents) })}</span>
                {a.payableCents > 0 && <span className="font-bold text-green-dark">{t('ambAdm.people.payable', { amount: money(a.payableCents) })}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
