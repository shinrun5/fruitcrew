import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { AmbPage, Pill, SectionTitle } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { LEAD_TONE, useAmbLabels } from '../../lib/ambassadorText'
import { useConfirm } from '../../lib/confirm'
import { useT } from '../../lib/i18n'
import { telHref } from '../../lib/phone'
import { localYMD, shortDate } from '../../lib/time'
import type { ContactMethod, ContactOutcome, LeadDetail } from '../../types'

const METHODS: ContactMethod[] = ['IN_PERSON', 'PHONE', 'EMAIL', 'SOCIAL', 'OTHER']
const OUTCOMES: ContactOutcome[] = ['NO_ANSWER', 'LEFT_INFO', 'SPOKE', 'INTERESTED', 'FOLLOW_UP', 'DECLINED', 'DO_NOT_CONTACT']

const chip = (on: boolean) =>
  `rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold ${on ? 'bg-ink text-white' : 'bg-paper text-ink'}`

/** Record one visit, call or message. */
function LogOutreach({ leadId, onSaved }: { leadId: number; onSaved: () => void }) {
  const t = useT()
  const label = useAmbLabels()
  const [date, setDate] = useState(() => localYMD())
  const [method, setMethod] = useState<ContactMethod>('IN_PERSON')
  const [outcome, setOutcome] = useState<ContactOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [followUp, setFollowUp] = useState(false)
  const [followUpDate, setFollowUpDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const needsDate = outcome === 'FOLLOW_UP' || followUp

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!outcome) return setErr(t('ambPortal.log.pickOutcome'))
    if (needsDate && !followUpDate) return setErr(t('ambPortal.log.pickFollowUp'))
    setBusy(true)
    setErr(null)
    try {
      await api.logLeadContact(leadId, {
        date,
        method,
        outcome,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(needsDate ? { followUp: true, followUpDate } : {}),
      })
      setOutcome(null)
      setNotes('')
      setFollowUp(false)
      setFollowUpDate('')
      onSaved()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }
  const inp = 'rounded-lg border-2 border-ink bg-cream px-2 py-1.5 font-body text-sm text-ink outline-none'
  return (
    <Card className="mt-3">
      <h2 className="font-heading text-sm font-bold text-ink">{t('ambPortal.log.title')}</h2>
      <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] font-bold text-muted-ink">{t('ambPortal.log.date')}</span>
          <input type="date" value={date} max={localYMD()} onChange={(e) => setDate(e.target.value)} className={`${inp} w-44`} required />
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-body text-[11px] font-bold text-muted-ink">{t('ambPortal.log.how')}</span>
          <div className="flex flex-wrap gap-1.5">
            {METHODS.map((m) => (
              <button type="button" key={m} onClick={() => setMethod(m)} className={chip(method === m)}>
                {label.method(m)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-body text-[11px] font-bold text-muted-ink">{t('ambPortal.log.outcome')}</span>
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map((o) => (
              <button type="button" key={o} onClick={() => setOutcome(o)} className={chip(outcome === o)}>
                {label.outcome(o)}
              </button>
            ))}
          </div>
          {outcome === 'DO_NOT_CONTACT' && <p className="font-body text-[11px] font-bold text-coral-dark">{t('ambPortal.log.dncHint')}</p>}
          {outcome === 'DECLINED' && <p className="font-body text-[11px] text-muted-ink">{t('ambPortal.log.declinedHint')}</p>}
        </div>
        {outcome !== 'FOLLOW_UP' && outcome !== 'DECLINED' && outcome !== 'DO_NOT_CONTACT' && (
          <label className="flex items-center gap-2 font-body text-xs font-bold text-ink">
            <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
            {t('ambPortal.log.followUpAsked')}
          </label>
        )}
        {needsDate && (
          <label className="flex flex-col gap-1">
            <span className="font-body text-[11px] font-bold text-muted-ink">{t('ambPortal.log.followUpDate')}</span>
            <input type="date" value={followUpDate} min={date} onChange={(e) => setFollowUpDate(e.target.value)} className={`${inp} w-44`} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] font-bold text-muted-ink">{t('ambPortal.log.notes')}</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} placeholder={t('ambPortal.log.notesPh')} className={inp} />
        </label>
        {err && <p className="font-body text-xs font-bold text-coral-dark">{err}</p>}
        <Button type="submit" disabled={busy} className="justify-center">
          {t('ambPortal.log.save')}
        </Button>
      </form>
    </Card>
  )
}

export function AmbLead() {
  const t = useT()
  const label = useAmbLabels()
  const confirm = useConfirm()
  const { id } = useParams()
  const leadId = Number(id)
  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [askNote, setAskNote] = useState('')
  const [asking, setAsking] = useState(false)

  const load = useCallback(() => {
    api.getLead(leadId).then(setLead).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [leadId])
  useEffect(load, [load])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!lead) {
    return (
      <AmbPage title={t('ambPortal.lead.title')}>
        {error ? <p className="mt-3 font-body text-sm font-bold text-coral-dark">{error}</p> : <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>}
      </AmbPage>
    )
  }
  const mine = lead.status === 'claimedByYou'
  const where = [lead.address, [lead.city, lead.state].filter(Boolean).join(', '), lead.zip].filter(Boolean).join(' · ')
  const canAsk = !lead.canClaim && !lead.followUpAsked && ['contacted', 'interested', 'followUp', 'declined'].includes(lead.status)
  return (
    <AmbPage title={lead.name} sub={where || undefined}>
      <Link to="/ambassador/find" className="mt-1 font-body text-xs font-bold text-sky-dark">
        ‹ {t('ambPortal.lead.back')}
      </Link>
      <Card className="mt-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={LEAD_TONE[lead.status]}>{label.lead(lead.status)}</Pill>
          {lead.category && <span className="font-body text-xs text-muted-ink">{lead.category}</span>}
          {lead.lastContactAt && <span className="font-body text-xs text-muted-ink">{t('ambPortal.lead.lastContact', { date: shortDate(lead.lastContactAt) })}</span>}
        </div>
        <p className="font-body text-xs text-ink">{t(`ambPortal.leadHint.${lead.status}`)}</p>
        {mine && lead.claimExpiresAt && <p className="font-body text-xs font-bold text-sky-dark">{t('ambPortal.lead.yoursUntil', { date: shortDate(lead.claimExpiresAt) })}</p>}
        {mine && lead.followUpAt && <p className="font-body text-xs text-ink">{t('ambPortal.lead.followUpOn', { date: shortDate(lead.followUpAt) })}</p>}
        <div className="flex flex-wrap gap-2">
          {lead.canClaim && (
            <Button size="sm" disabled={busy} onClick={() => void act(() => api.claimLead(lead.id))}>
              {t('ambPortal.find.claim')}
            </Button>
          )}
          {mine && lead.phone && (
            <a href={telHref(lead.phone)} className="rounded-full border-2 border-ink bg-paper px-3 py-0.5 font-heading text-[11px] font-bold text-ink">
              {t('ambPortal.lead.call')}
            </a>
          )}
          {mine && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                if (await confirm(t('ambPortal.lead.releaseConfirm'), { confirmLabel: t('ambPortal.lead.release') })) void act(() => api.releaseLead(lead.id))
              }}
            >
              {t('ambPortal.lead.release')}
            </Button>
          )}
        </div>
        {lead.followUpAsked && <p className="font-body text-xs text-muted-ink">{t('ambPortal.find.asked')}</p>}
        {canAsk &&
          (asking ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void act(() => api.askLeadFollowUp(lead.id, askNote.trim())).then(() => setAsking(false))
              }}
              className="flex flex-col gap-2"
            >
              <textarea
                value={askNote}
                onChange={(e) => setAskNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder={t('ambPortal.lead.askPh')}
                className="rounded-lg border-2 border-ink bg-cream px-2 py-1.5 font-body text-sm text-ink outline-none"
              />
              <Button type="submit" size="sm" disabled={busy || !askNote.trim()} className="self-start">
                {t('ambPortal.lead.askSend')}
              </Button>
            </form>
          ) : (
            <button onClick={() => setAsking(true)} className="self-start font-body text-xs font-bold text-sky-dark">
              {t('ambPortal.lead.ask')}
            </button>
          ))}
        {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
      </Card>

      {mine && <LogOutreach leadId={lead.id} onSaved={load} />}

      <SectionTitle title={t('ambPortal.lead.history')} hint={t('ambPortal.lead.historyHint')} />
      {lead.history.length === 0 ? (
        <p className="font-body text-xs text-muted-ink">{t('ambPortal.lead.noHistory')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lead.history.map((h) => (
            <li key={h.id} className="rounded-xl border-2 border-ink/15 bg-paper px-3 py-2 font-body text-xs text-ink">
              <span className="font-bold">{shortDate(h.contactedAt)}</span> · {label.method(h.method)} · {label.outcome(h.outcome)}
              <span className="text-muted-ink"> — {t(`ambPortal.who.${h.who}`)}</span>
              {h.followUpAt && <span className="block text-muted-ink">{t('ambPortal.lead.followUpOn', { date: shortDate(h.followUpAt) })}</span>}
              {h.notes && <span className="block italic text-ink">“{h.notes}”</span>}
            </li>
          ))}
        </ul>
      )}
    </AmbPage>
  )
}
