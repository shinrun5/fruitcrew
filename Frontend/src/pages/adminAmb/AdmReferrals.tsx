import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card, EmptyState } from '../../components/Card'
import { MonthsBar, Pill } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { money, percent, STAGE_TONE, STATE_TONE, useAmbLabels, useWarningText } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import type { AdminOrgSummary, AdminReferral, AmbassadorRow } from '../../types'

const FILTERS = ['review', 'suspicious', 'all'] as const

function ReferralCard({ r, people, onChanged }: { r: AdminReferral; people: AmbassadorRow[]; onChanged: () => void }) {
  const t = useT()
  const label = useAmbLabels()
  const warn = useWarningText()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'reject' | 'move' | null>(null)
  const [note, setNote] = useState('')
  const [to, setTo] = useState('')
  async function act(input: Parameters<typeof api.updateReferral>[1]) {
    setBusy(true)
    setErr(null)
    try {
      await api.updateReferral(r.id, input)
      setMode(null)
      setNote('')
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const check = (k: keyof AdminReferral['checks'], text: string) => (
    <label className="flex items-center gap-1.5 font-body text-xs text-ink">
      <input type="checkbox" checked={r.checks[k]} disabled={busy} onChange={(e) => void act({ [k]: e.target.checked })} />
      {text}
    </label>
  )
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="block font-heading text-sm font-bold text-ink">{r.name}</span>
          <span className="block font-body text-xs text-muted-ink">
            <Link to={`/admin/ambassadors/people/${r.ambassador.id}`} className="font-bold text-sky-dark">
              {r.ambassador.name}
            </Link>{' '}
            · {t(`ambAdm.ref.source.${r.source}` as Parameters<typeof t>[0])} · {shortDate(r.since)}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Pill tone={STAGE_TONE[r.stage]}>{label.stage(r.stage)}</Pill>
          {r.verifiedAt && <Pill tone="border-green bg-green/10 text-green-dark">{t('ambAdm.ref.verified')}</Pill>}
        </div>
      </div>
      {r.signup && (
        <p className="font-body text-[11px] text-ink">
          {r.signup.contactName} · {r.signup.email}
          {r.signup.phone ? ` · ${r.signup.phone}` : ''}
          {r.signup.address ? ` · ${r.signup.address}` : ''}
          {r.signup.website ? ` · ${r.signup.website}` : ''}
        </p>
      )}
      {r.lead && (
        <p className="font-body text-[11px] text-muted-ink">
          {t('ambAdm.ref.lead')}{' '}
          <Link to={`/admin/ambassadors/leads/${r.lead.id}`} className="text-sky-dark">
            {r.lead.name}
          </Link>
        </p>
      )}
      <p className="font-body text-[11px] text-muted-ink">
        {t('ambAdm.ref.terms', { bounty: money(r.terms.bountyCents), rate: percent(r.terms.rateBps), extra: percent(r.terms.extraStoreRateBps), months: r.terms.maxPaidPeriods })}
      </p>
      {r.warnings.length > 0 && (
        <ul className="rounded-lg border-2 border-coral bg-coral-bg px-2.5 py-1.5 font-body text-xs font-bold text-coral-dark">
          {r.warnings.map((w, i) => (
            <li key={i}>⚠ {warn(w)}</li>
          ))}
        </ul>
      )}
      {r.stores.map((s) => (
        <div key={s.storeId} className="flex items-center gap-2 font-body text-[11px] text-ink">
          <span className="w-28 shrink-0 truncate">{s.name}</span>
          <span className="shrink-0 text-muted-ink">{t('ambAdm.ref.setup', { workers: s.workers, weeks: s.postedWeeks })}</span>
          <MonthsBar used={s.paidMonths} max={s.paidMonths + s.monthsLeft} />
          {s.bounty && <Pill tone={STATE_TONE[s.bounty]}>{label.state(s.bounty)}</Pill>}
        </div>
      ))}
      {r.rejectedAt ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-body text-xs font-bold text-coral-dark">{t('ambAdm.ref.notCredited', { note: r.rejectNote ?? '' })}</span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act({ reject: false })}>
            {t('ambAdm.ref.undoReject')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {check('foundOnline', t('ambAdm.ref.foundOnline'))}
            {check('phoneChecked', t('ambAdm.ref.phoneChecked'))}
            {check('ownerConfirmed', t('ambAdm.ref.ownerConfirmed'))}
          </div>
          <div className="flex flex-wrap gap-2">
            {!r.verifiedAt && r.orgId && (
              <Button size="sm" disabled={busy} onClick={() => void act({ verify: true })}>
                {t('ambAdm.ref.verify')}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode(mode === 'reject' ? null : 'reject')}>
              {t('ambAdm.ref.reject')}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode(mode === 'move' ? null : 'move')}>
              {t('ambAdm.ref.move')}
            </Button>
          </div>
          {mode && (
            <div className="flex flex-col gap-2 rounded-lg border-2 border-ink/15 bg-cream/60 p-2">
              {mode === 'move' && (
                <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border-2 border-ink bg-paper px-2 py-1 font-body text-xs text-ink">
                  <option value="">{t('ambAdm.lead.pickAmbassador')}</option>
                  {people
                    .filter((p) => p.id !== r.ambassador.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              )}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ambAdm.ref.why')} className="rounded-lg border-2 border-ink bg-paper px-2 py-1 font-body text-xs text-ink outline-none" />
              <Button
                size="sm"
                className="self-start"
                disabled={busy || !note.trim() || (mode === 'move' && !to)}
                onClick={() => void act(mode === 'reject' ? { reject: { note: note.trim() } } : { ambassadorId: Number(to), reason: note.trim() })}
              >
                {mode === 'reject' ? t('ambAdm.ref.rejectGo') : t('ambAdm.ref.moveGo')}
              </Button>
              <p className="font-body text-[11px] text-muted-ink">{mode === 'reject' ? t('ambAdm.ref.rejectHint') : t('ambAdm.ref.moveHint')}</p>
            </div>
          )}
        </>
      )}
      {err && <p className="font-body text-xs font-bold text-coral-dark">{err}</p>}
    </Card>
  )
}

/** Credit a business by hand — a code that was missed or disputed. */
function CreditByHand({ people, onDone }: { people: AmbassadorRow[]; onDone: () => void }) {
  const t = useT()
  const [orgs, setOrgs] = useState<AdminOrgSummary[]>([])
  const [orgId, setOrgId] = useState('')
  const [to, setTo] = useState('')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.getAdminOrgs().then((o) => setOrgs(o.filter((x) => !x.referredBy))).catch(() => {})
  }, [])
  async function go() {
    setBusy(true)
    setErr(null)
    try {
      await api.creditBusiness(Number(orgId), Number(to), why.trim())
      setOrgId('')
      setTo('')
      setWhy('')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const sel = 'rounded-lg border-2 border-ink bg-paper px-2 py-1 font-body text-xs text-ink'
  return (
    <Card className="flex flex-col gap-2">
      <h3 className="font-heading text-sm font-bold text-ink">{t('ambAdm.ref.handTitle')}</h3>
      <p className="font-body text-[11px] text-muted-ink">{t('ambAdm.ref.handHint')}</p>
      <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={sel}>
        <option value="">{t('ambAdm.ref.pickBusiness')}</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select value={to} onChange={(e) => setTo(e.target.value)} className={sel}>
        <option value="">{t('ambAdm.lead.pickAmbassador')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('ambAdm.ref.why')} className={`${sel} outline-none`} />
      {err && <p className="font-body text-xs font-bold text-coral-dark">{err}</p>}
      <Button size="sm" className="self-start" disabled={busy || !orgId || !to || !why.trim()} onClick={() => void go()}>
        {t('ambAdm.ref.handGo')}
      </Button>
    </Card>
  )
}

export function AdmReferrals() {
  const t = useT()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('review')
  const [list, setList] = useState<AdminReferral[] | null>(null)
  const [people, setPeople] = useState<AmbassadorRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hand, setHand] = useState(false)
  const load = useCallback(() => {
    api.getAdminReferrals(filter).then(setList).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [filter])
  useEffect(load, [load])
  useEffect(() => {
    api.getAmbassadors().then(setPeople).catch(() => {})
  }, [])
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold ${filter === f ? 'bg-ink text-white' : 'bg-paper text-ink'}`}>
            {t(`ambAdm.ref.filter.${f}`)}
          </button>
        ))}
        <button onClick={() => setHand((v) => !v)} className="ml-auto font-body text-xs font-bold text-sky-dark">
          {t('ambAdm.ref.handTitle')}
        </button>
      </div>
      {hand && (
        <div className="mt-2">
          <CreditByHand people={people} onDone={load} />
        </div>
      )}
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {!list ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <EmptyState className="mt-3" title={t('ambAdm.ref.none')} />
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {list.map((r) => (
            <ReferralCard key={r.id} r={r} people={people} onChanged={load} />
          ))}
        </div>
      )}
    </>
  )
}
