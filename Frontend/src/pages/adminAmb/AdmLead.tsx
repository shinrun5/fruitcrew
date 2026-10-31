import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Field } from '../../components/Field'
import { SectionTitle } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { useAmbLabels } from '../../lib/ambassadorText'
import { useConfirm } from '../../lib/confirm'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import type { AdminLeadDetail, AmbassadorRow } from '../../types'
import { AuditList } from './AdmSettings'

/** One lead's whole story: who held it, every contact, and the admin's tools —
 * edit, do-not-contact, hand it to someone, answer a follow-up ask, merge a duplicate. */
export function AdmLead() {
  const t = useT()
  const label = useAmbLabels()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { id } = useParams()
  const leadId = Number(id)
  const [d, setD] = useState<AdminLeadDetail | null>(null)
  const [people, setPeople] = useState<AmbassadorRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<{ name: string; address: string; city: string; state: string; zip: string; phone: string; category: string } | null>(null)
  const [assignTo, setAssignTo] = useState('')

  const load = useCallback(() => {
    api.getAdminLead(leadId).then(setD).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [leadId])
  useEffect(load, [load])
  useEffect(() => {
    api.getAmbassadors().then((p) => setPeople(p.filter((x) => x.status === 'ACTIVE'))).catch(() => {})
  }, [])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setEdit(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  if (!d) return error ? <p className="font-body text-sm font-bold text-coral-dark">{error}</p> : <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>
  const l = d.lead
  const open = l.claims.find((c) => !c.endedAt && new Date(c.expiresAt) > new Date())
  const set = (k: keyof NonNullable<typeof edit>) => (e: { target: { value: string } }) => setEdit((x) => (x ? { ...x, [k]: e.target.value } : x))
  return (
    <>
      <Link to="/admin/ambassadors/leads" className="font-body text-xs font-bold text-sky-dark">
        ‹ {t('ambAdm.tab.leads')}
      </Link>
      <Card className="mt-2 flex flex-col gap-2">
        {edit ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Field label={t('ambPortal.add.name')} value={edit.name} onChange={set('name')} />
            </div>
            <div className="col-span-2">
              <Field label={t('ambPortal.add.address')} value={edit.address} onChange={set('address')} />
            </div>
            <Field label={t('ambPortal.add.city')} value={edit.city} onChange={set('city')} />
            <Field label={t('ambPortal.add.state')} value={edit.state} onChange={set('state')} />
            <Field label={t('ambPortal.add.zip')} value={edit.zip} onChange={set('zip')} />
            <Field label={t('ambPortal.add.phone')} value={edit.phone} onChange={set('phone')} />
            <div className="col-span-2">
              <Field label={t('ambPortal.add.category')} value={edit.category} onChange={set('category')} />
            </div>
            <div className="col-span-2 flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void act(() => api.updateAdminLead(l.id, edit))}>
                {t('common.save')}
              </Button>
              <button onClick={() => setEdit(null)} className="font-body text-xs text-muted-ink">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-base font-bold text-ink">{l.name}</h2>
              <span className="block font-body text-xs text-muted-ink">{[l.address, l.city, l.state, l.zip].filter(Boolean).join(', ') || '—'}</span>
              <span className="block font-body text-xs text-muted-ink">
                {[l.phone, l.category, t(`ambAdm.leads.source.${l.source}`)].filter(Boolean).join(' · ')}
              </span>
            </div>
            <button
              onClick={() => setEdit({ name: l.name, address: l.address ?? '', city: l.city ?? '', state: l.state ?? '', zip: l.zip ?? '', phone: l.phone ?? '', category: l.category ?? '' })}
              className="font-body text-xs font-bold text-sky-dark"
            >
              {t('common.edit')}
            </button>
          </div>
        )}
        <p className="font-body text-xs text-ink">
          {t('ambAdm.lead.outreach', { status: t(`ambAdm.lead.contact.${l.contactStatus}`) })}
          {l.lastContactAt ? ` · ${t('ambPortal.lead.lastContact', { date: shortDate(l.lastContactAt) })}` : ''}
        </p>
        {d.customer && <p className="font-body text-xs font-bold text-grape">{t('ambAdm.leads.customer', { name: d.customer })}</p>}
        {l.doNotContact && <p className="font-body text-xs font-bold text-coral-dark">{t('ambAdm.lead.dnc', { reason: l.dncReason ?? '—' })}</p>}
        {l.reviewNote && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-yellow bg-yellow/10 px-2.5 py-1.5">
            <span className="min-w-0 flex-1 font-body text-xs text-ink">⚠ {l.reviewNote}</span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => api.updateAdminLead(l.id, { clearReview: true }))}>
              {t('ambAdm.lead.dismiss')}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              if (l.doNotContact || (await confirm(t('ambAdm.lead.dncConfirm'), { tone: 'danger', confirmLabel: t('ambAdm.lead.dncOn') })))
                void act(() => api.updateAdminLead(l.id, { doNotContact: !l.doNotContact }))
            }}
          >
            {l.doNotContact ? t('ambAdm.lead.dncOff') : t('ambAdm.lead.dncOn')}
          </Button>
          {l.contactStatus !== 'NEW' && !l.doNotContact && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => api.updateAdminLead(l.id, { contactStatus: 'NEW' }))}>
              {t('ambAdm.lead.reset')}
            </Button>
          )}
        </div>
      </Card>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {l.followUpAskById && (
        <Card className="mt-3 flex flex-col gap-2 border-yellow">
          <h3 className="font-heading text-sm font-bold text-ink">{t('ambAdm.lead.askTitle')}</h3>
          <p className="font-body text-xs text-ink">“{l.followUpAskNote}”</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void act(() => api.answerLeadFollowUp(l.id, true))}>
              {t('ambAdm.lead.askYes')}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => api.answerLeadFollowUp(l.id, false))}>
              {t('ambAdm.lead.askNo')}
            </Button>
          </div>
        </Card>
      )}

      <SectionTitle title={t('ambAdm.lead.holder')} hint={open ? t('ambAdm.leads.heldBy', { name: open.ambassador.name, date: shortDate(open.expiresAt) }) : t('ambAdm.lead.free')} />
      <div className="flex flex-wrap items-center gap-2">
        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="rounded-lg border-2 border-ink bg-paper px-2 py-1 font-body text-xs text-ink">
          <option value="">{t('ambAdm.lead.pickAmbassador')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={busy || !assignTo} onClick={() => void act(() => api.assignLead(l.id, Number(assignTo)))}>
          {t('ambAdm.lead.assign')}
        </Button>
        {open && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => api.assignLead(l.id, null))}>
            {t('ambAdm.lead.free')}
          </Button>
        )}
      </div>

      {d.matches.length > 0 && (
        <>
          <SectionTitle title={t('ambAdm.lead.matches')} hint={t('ambAdm.lead.matchesHint')} />
          <div className="flex flex-col gap-1.5">
            {d.matches.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-ink/15 bg-paper px-2.5 py-1.5">
                <Link to={`/admin/ambassadors/leads/${m.id}`} className="min-w-0 flex-1 font-body text-xs text-sky-dark">
                  {m.name} · {[m.address, m.city].filter(Boolean).join(', ')} ({t(`ambAdm.lead.how.${m.how}`)})
                </Link>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    if (await confirm(t('ambAdm.lead.mergeConfirm', { into: m.name }), { confirmLabel: t('ambAdm.lead.merge') }))
                      void act(() => api.mergeLead(l.id, m.id)).then(() => navigate(`/admin/ambassadors/leads/${m.id}`))
                  }}
                >
                  {t('ambAdm.lead.merge')}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle title={t('ambPortal.lead.history')} />
      {l.contacts.length === 0 ? (
        <p className="font-body text-xs text-muted-ink">{t('ambPortal.lead.noHistory')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {l.contacts.map((c) => (
            <li key={c.id} className="rounded-lg border border-ink/10 bg-paper px-2.5 py-1.5 font-body text-[11px] text-ink">
              <b>{shortDate(c.contactedAt)}</b> · {c.ambassador?.name ?? t('ambPortal.who.fruitcrew')} · {label.method(c.method)} · {label.outcome(c.outcome)}
              {c.followUpAt && ` · ${t('ambPortal.lead.followUpOn', { date: shortDate(c.followUpAt) })}`}
              {c.notes && <span className="block italic text-muted-ink">“{c.notes}”</span>}
            </li>
          ))}
        </ul>
      )}
      <SectionTitle title={t('ambAdm.lead.claims')} />
      <ul className="flex flex-col gap-1">
        {l.claims.map((c) => (
          <li key={c.id} className="font-body text-[11px] text-ink">
            {c.ambassador.name} · {shortDate(c.claimedAt)} → {c.endedAt ? `${t(`ambAdm.endReason.${c.endReason ?? 'expired'}` as Parameters<typeof t>[0])} ${shortDate(c.endedAt)}` : t('ambAdm.person.claimOpen', { date: shortDate(c.expiresAt) })}
          </li>
        ))}
        {l.claims.length === 0 && <li className="font-body text-xs text-muted-ink">{t('ambAdm.person.noClaims')}</li>}
      </ul>
      <SectionTitle title={t('ambAdm.audit.title')} />
      <AuditList rows={d.audit} />
    </>
  )
}
