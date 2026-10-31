import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card, EmptyState } from '../../components/Card'
import { Field } from '../../components/Field'
import { AmbPage, Pill } from '../../components/AmbassadorBits'
import { api, ApiError } from '../../lib/api'
import { LEAD_TONE, useAmbLabels } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import type { LeadCard, LeadInput, LeadStatus } from '../../types'

const FILTERS: (LeadStatus | '')[] = ['', 'available', 'claimedByYou', 'interested', 'followUp', 'contacted']

/** One business in a list: where it is, its status, and Claim when that's possible. */
export function LeadRow({ lead, onClaimed }: { lead: LeadCard; onClaimed?: () => void }) {
  const t = useT()
  const label = useAmbLabels()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function claim() {
    setBusy(true)
    setErr(null)
    try {
      await api.claimLead(lead.id)
      onClaimed?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const where = [lead.address, lead.city, lead.zip].filter(Boolean).join(', ')
  return (
    <Card padded={false} className="flex flex-col gap-1.5 p-3">
      <div className="flex items-start gap-2">
        <Link to={`/ambassador/lead/${lead.id}`} className="min-w-0 flex-1">
          <span className="block truncate font-heading text-sm font-bold text-ink">{lead.name}</span>
          <span className="block truncate font-body text-xs text-muted-ink">
            {where || '—'}
            {lead.category ? ` · ${lead.category}` : ''}
          </span>
        </Link>
        <Pill tone={LEAD_TONE[lead.status]}>{label.lead(lead.status)}</Pill>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {lead.claimExpiresAt && (
          <span className="font-body text-[11px] font-bold text-sky-dark">{t('ambPortal.find.yoursUntil', { date: shortDate(lead.claimExpiresAt) })}</span>
        )}
        {lead.reopenedForYou && lead.canClaim && <span className="font-body text-[11px] font-bold text-green-dark">{t('ambPortal.find.reopened')}</span>}
        {lead.followUpAsked && <span className="font-body text-[11px] text-muted-ink">{t('ambPortal.find.asked')}</span>}
        <span className="ml-auto flex gap-2">
          {lead.status === 'claimedByYou' ? (
            <Link to={`/ambassador/lead/${lead.id}`}>
              <Button size="sm">{t('ambPortal.find.logOutreach')}</Button>
            </Link>
          ) : lead.canClaim ? (
            <Button size="sm" disabled={busy} onClick={() => void claim()}>
              {t('ambPortal.find.claim')}
            </Button>
          ) : (
            <Link to={`/ambassador/lead/${lead.id}`} className="font-body text-[11px] font-bold text-sky-dark">
              {t('ambPortal.find.details')}
            </Link>
          )}
        </span>
      </div>
      {err && <p className="font-body text-[11px] font-bold text-coral-dark">{err}</p>}
    </Card>
  )
}

type AddProblem =
  | { code: 'duplicate'; lead: LeadCard }
  | { code: 'possible'; matches: { id: number; label: string }[]; customer: string | null }
  | { code: 'customer' }

function AddBusiness({ onDone }: { onDone: (leadId: number) => void }) {
  const t = useT()
  const [f, setF] = useState<LeadInput>({ name: '', address: '', city: '', state: '', zip: '', phone: '', category: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [problem, setProblem] = useState<AddProblem | null>(null)
  const set = (k: keyof LeadInput) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function submit(differentLocation = false) {
    setBusy(true)
    setErr(null)
    try {
      const r = await api.addLead({ ...f, ...(differentLocation ? { differentLocation: true } : {}) })
      if (r.claimError) setErr(r.claimError)
      onDone(r.lead.id)
    } catch (e) {
      const data = e instanceof ApiError ? (e.data as Record<string, unknown> | null) : null
      if (data?.code === 'duplicate') setProblem({ code: 'duplicate', lead: data.lead as LeadCard })
      else if (data?.code === 'possible') setProblem({ code: 'possible', matches: data.matches as { id: number; label: string }[], customer: (data.customer as string) ?? null })
      else if (data?.code === 'customer') setProblem({ code: 'customer' })
      else setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setProblem(null)
    void submit()
  }
  return (
    <Card className="mt-3">
      <h2 className="font-heading text-sm font-bold text-ink">{t('ambPortal.add.title')}</h2>
      <p className="font-body text-[11px] text-muted-ink">{t('ambPortal.add.hint')}</p>
      <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2">
        <Field label={t('ambPortal.add.name')} value={f.name} onChange={set('name')} required maxLength={120} />
        <Field label={t('ambPortal.add.address')} value={f.address} onChange={set('address')} maxLength={200} />
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_6rem] gap-2">
          <Field label={t('ambPortal.add.city')} value={f.city} onChange={set('city')} maxLength={80} />
          <Field label={t('ambPortal.add.state')} value={f.state} onChange={set('state')} maxLength={40} />
          <Field label={t('ambPortal.add.zip')} value={f.zip} onChange={set('zip')} inputMode="numeric" maxLength={10} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('ambPortal.add.phone')} value={f.phone} onChange={set('phone')} type="tel" maxLength={40} />
          <Field label={t('ambPortal.add.category')} value={f.category} onChange={set('category')} maxLength={60} placeholder={t('ambPortal.add.categoryPh')} />
        </div>
        {problem?.code === 'duplicate' && (
          <p className="rounded-lg border-2 border-yellow bg-yellow/10 px-2.5 py-2 font-body text-xs text-ink">
            {t('ambPortal.add.duplicate')}{' '}
            <Link to={`/ambassador/lead/${problem.lead.id}`} className="font-bold text-sky-dark underline">
              {problem.lead.name}
            </Link>
          </p>
        )}
        {problem?.code === 'customer' && <p className="rounded-lg border-2 border-grape bg-grape/10 px-2.5 py-2 font-body text-xs text-ink">{t('ambPortal.add.customer')}</p>}
        {problem?.code === 'possible' && (
          <div className="rounded-lg border-2 border-yellow bg-yellow/10 px-2.5 py-2 font-body text-xs text-ink">
            <p className="font-bold">{t('ambPortal.add.possible')}</p>
            <ul className="mt-1 list-disc pl-4">
              {problem.matches.map((m) => (
                <li key={m.id}>
                  <Link to={`/ambassador/lead/${m.id}`} className="text-sky-dark underline">
                    {m.label}
                  </Link>
                </li>
              ))}
              {problem.customer && <li>{t('ambPortal.add.possibleCustomer', { name: problem.customer })}</li>}
            </ul>
            <Button size="sm" variant="secondary" className="mt-2" disabled={busy} onClick={() => void submit(true)}>
              {t('ambPortal.add.differentPlace')}
            </Button>
          </div>
        )}
        {err && <p className="font-body text-xs font-bold text-coral-dark">{err}</p>}
        <Button type="submit" disabled={busy || !f.name.trim()} className="justify-center">
          {t('ambPortal.add.submit')}
        </Button>
      </form>
    </Card>
  )
}

export function AmbFind() {
  const t = useT()
  const label = useAmbLabels()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<LeadStatus | ''>('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ total: number; leads: LeadCard[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // wait for a pause in typing before searching
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(q.trim()), 300)
    return () => window.clearTimeout(id)
  }, [q])

  const search = useCallback(
    (next: number) => {
      api
        .searchLeads(query, status, next)
        .then((r) => {
          setPage(next)
          setData((d) => ({ total: r.total, leads: next > 0 && d ? [...d.leads, ...r.leads] : r.leads }))
          setError(null)
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    },
    [query, status],
  )
  // a new search starts from the top
  useEffect(() => search(0), [search])
  const load = (more: boolean) => search(more ? page + 1 : 0)

  return (
    <AmbPage title={t('ambPortal.find.title')} sub={t('ambPortal.find.sub')}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('ambPortal.find.placeholder')}
        aria-label={t('ambPortal.find.placeholder')}
        className="mt-3 w-full rounded-xl border-[2.5px] border-ink bg-paper px-3 py-2 font-body text-sm text-ink outline-none"
      />
      <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FILTERS.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`shrink-0 rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold ${status === s ? 'bg-ink text-white' : 'bg-paper text-ink'}`}
          >
            {s ? label.lead(s) : t('ambPortal.find.all')}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {!data ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : data.leads.length === 0 ? (
        <EmptyState className="mt-3" title={query ? t('ambPortal.find.none', { q: query }) : t('ambPortal.find.empty')} />
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <p className="font-body text-[11px] text-muted-ink">{t('ambPortal.find.count', { n: data.total })}</p>
          {data.leads.map((l) => (
            <LeadRow key={l.id} lead={l} onClaimed={() => load(false)} />
          ))}
          {data.leads.length < data.total && (
            <Button variant="secondary" size="sm" className="self-center" onClick={() => load(true)}>
              {t('ambPortal.find.more')}
            </Button>
          )}
        </div>
      )}
      {adding ? (
        <AddBusiness onDone={(id) => navigate(`/ambassador/lead/${id}`)} />
      ) : (
        <button onClick={() => setAdding(true)} className="mt-4 self-center font-body text-xs font-bold text-sky-dark">
          {t('ambPortal.find.addCta')}
        </button>
      )}
    </AmbPage>
  )
}
