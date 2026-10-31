import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { CopyButton } from '../../components/CopyButton'
import { Toggle, ToggleGroup } from '../../components/Toggle'
import { MonthsBar, Pill, SectionTitle, Stat } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { AMB_STATUS_TONE as STATUS_TONE, money, STAGE_TONE, STATE_TONE, useAmbLabels } from '../../lib/ambassadorText'
import { useConfirm } from '../../lib/confirm'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import { useCopy } from '../../lib/use-copy'
import type { AmbassadorDetail, AmbassadorStatus } from '../../types'
import { AuditList } from './AdmSettings'

export function AdmPerson() {
  const t = useT()
  const label = useAmbLabels()
  const confirm = useConfirm()
  const { copiedKey, copy } = useCopy()
  const { id } = useParams()
  const aid = Number(id)
  const [d, setD] = useState<AmbassadorDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')

  const load = useCallback(() => {
    api
      .getAmbassador(aid)
      .then((x) => {
        setD(x)
        setNotes(x.ambassador.notes ?? '')
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [aid])
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
  if (!d) return error ? <p className="font-body text-sm font-bold text-coral-dark">{error}</p> : <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>
  const a = d.ambassador
  const setStatus = async (status: AmbassadorStatus) => {
    if (status !== 'ACTIVE' && !(await confirm(t(`ambAdm.person.confirm.${status}`), { tone: 'danger', confirmLabel: t(`ambAdm.person.do.${status}`) }))) return
    void act(() => api.updateAmbassador(a.id, { status }))
  }
  return (
    <>
      <Link to="/admin/ambassadors/people" className="font-body text-xs font-bold text-sky-dark">
        ‹ {t('ambAdm.tab.people')}
      </Link>
      <Card className="mt-2 flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-base font-bold text-ink">{a.name}</h2>
            <span className="block break-all font-body text-xs text-muted-ink">
              {a.email}
              {a.phone ? ` · ${a.phone}` : ''}
            </span>
            <span className="block font-body text-xs text-muted-ink">
              {[a.school, a.area].filter(Boolean).join(' · ')} · {t('ambAdm.person.code', { code: a.code })}
            </span>
          </div>
          <Pill tone={STATUS_TONE[a.status]}>{t(`ambAdm.status.${a.status}`)}</Pill>
        </div>
        <p className="font-body text-[11px] text-muted-ink">
          {a.hasLogin ? (a.termsCurrent ? t('ambAdm.person.termsOk', { v: a.termsAcceptances[0]?.version ?? '' }) : t('ambAdm.person.termsOld')) : t('ambAdm.person.noLogin')}
        </p>
        {a.inviteUrl && (
          <div className="flex flex-wrap gap-2">
            <CopyButton copied={copiedKey === 'inv'} onClick={() => copy('inv', a.inviteUrl!)} label={t('ambAdm.copyInvite')} copiedLabel={t('ambPortal.home.copied')} tone="sky" />
          </div>
        )}
        {!a.hasLogin && (
          <Button size="sm" variant="secondary" className="self-start" disabled={busy} onClick={() => void act(() => api.newAmbassadorInvite(a.id))}>
            {t('ambAdm.person.newInvite')}
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          {(['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const)
            .filter((s) => s !== a.status)
            .map((s) => (
              <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus(s)}>
                {t(`ambAdm.person.do.${s}`)}
              </Button>
            ))}
        </div>
      </Card>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <SectionTitle title={t('ambAdm.person.payTitle')} hint={t('ambAdm.person.payHint')} />
      <ToggleGroup>
        <Toggle plain on={a.isAdult} label={t('ambAdm.person.adult')} busy={busy} onClick={() => void act(() => api.updateAmbassador(a.id, { isAdult: !a.isAdult }))} />
        <Toggle plain on={a.w9Received} label={t('ambAdm.person.w9')} busy={busy} onClick={() => void act(() => api.updateAmbassador(a.id, { w9Received: !a.w9Received }))} />
      </ToggleGroup>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('ambPortal.money.lifetime')} value={money(d.totals.lifetime)} />
        <Stat label={t('ambPortal.money.paid')} value={money(d.totals.paid)} />
        <Stat label={t('ambAdm.person.payable')} value={money(d.payableCents)} tone="text-green-dark" />
        <Stat label={t('ambPortal.money.waiting')} value={money(d.totals.pendingBounties + d.totals.pendingCommissions)} />
        <Stat
          label={t('ambAdm.person.paidYear')}
          value={money(d.paidThisYearCents)}
          hint={d.paidThisYearCents >= d.form1099Cents ? t('ambAdm.person.needs1099') : t('ambAdm.person.paidYearHint', { amount: money(d.form1099Cents) })}
          tone={d.paidThisYearCents >= d.form1099Cents ? 'text-coral-dark' : 'text-ink'}
        />
      </div>
      {d.payableCents > 0 && (
        <Button
          size="sm"
          className="mt-2 self-start"
          disabled={busy || !a.isAdult || !a.w9Received}
          onClick={async () => {
            if (await confirm(t('ambAdm.payouts.confirm', { amount: money(d.payableCents), name: a.name }), { confirmLabel: t('ambAdm.payouts.approve') })) void act(() => api.approvePayout(a.id))
          }}
        >
          {t('ambAdm.payouts.approveAmount', { amount: money(d.payableCents) })}
        </Button>
      )}

      <SectionTitle title={t('ambAdm.person.businesses')} />
      {d.businesses.length === 0 ? (
        <p className="font-body text-xs text-muted-ink">{t('ambPortal.stores.none')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {d.businesses.map((b) => (
            <Card key={b.id} padded={false} className="flex flex-col gap-1.5 p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-heading text-sm font-bold text-ink">{b.name}</span>
                <Pill tone={STAGE_TONE[b.stage]}>{label.stage(b.stage)}</Pill>
                {b.verified && <Pill tone="border-green bg-green/10 text-green-dark">{t('ambAdm.ref.verified')}</Pill>}
              </div>
              {b.stores.map((s) => (
                <div key={s.storeId} className="flex items-center gap-2 font-body text-[11px] text-ink">
                  <span className="w-28 shrink-0 truncate">{s.name}</span>
                  <MonthsBar used={s.paidMonths} max={s.paidMonths + s.monthsLeft} />
                  <span className="shrink-0">{s.paidMonths}/{s.paidMonths + s.monthsLeft}</span>
                  {s.bounty && <Pill tone={STATE_TONE[s.bounty]}>{label.state(s.bounty)}</Pill>}
                </div>
              ))}
            </Card>
          ))}
          <Link to="/admin/ambassadors/referrals" className="font-body text-xs font-bold text-sky-dark">
            {t('ambAdm.person.reviewReferrals')} ›
          </Link>
        </div>
      )}

      <SectionTitle title={t('ambAdm.person.rewards')} />
      <ul className="flex flex-col gap-1">
        {d.commissions.slice(0, 40).map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-lg border border-ink/10 bg-paper px-2.5 py-1.5 font-body text-[11px]">
            <span className="min-w-0 flex-1 truncate text-ink">
              {c.memo} · {[...new Set([c.business, c.store].filter(Boolean))].join(' · ')} · {shortDate(c.createdAt)}
              {c.flags && <span className="text-coral-dark"> · ⚠ {c.flags}</span>}
            </span>
            <span className="font-bold text-ink">{money(c.amountCents)}</span>
            <Pill tone={STATE_TONE[c.state]}>{label.state(c.state)}</Pill>
          </li>
        ))}
        {d.commissions.length === 0 && <li className="font-body text-xs text-muted-ink">{t('ambPortal.money.noRewards')}</li>}
      </ul>

      <SectionTitle title={t('ambAdm.person.payouts')} />
      <ul className="flex flex-col gap-1">
        {d.payouts.map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-lg border border-ink/10 bg-paper px-2.5 py-1.5 font-body text-[11px] text-ink">
            <span className="min-w-0 flex-1">
              #{p.id} · {t(`ambAdm.payouts.status.${p.status}`)} · {shortDate(p.paidAt ?? p.approvedAt)}
              {p.method ? ` · ${p.method}` : ''}
            </span>
            <span className="font-bold">{money(p.amountCents)}</span>
          </li>
        ))}
        {d.payouts.length === 0 && <li className="font-body text-xs text-muted-ink">{t('ambPortal.money.noPayouts')}</li>}
      </ul>

      <SectionTitle title={t('ambAdm.person.leads')} />
      <ul className="flex flex-col gap-1">
        {d.claims.slice(0, 20).map((c) => (
          <li key={c.id} className="font-body text-[11px] text-ink">
            <Link to={`/admin/ambassadors/leads/${c.lead.id}`} className="font-bold text-sky-dark">
              {c.lead.name}
            </Link>{' '}
            · {shortDate(c.claimedAt)} → {c.open ? t('ambAdm.person.claimOpen', { date: shortDate(c.expiresAt) }) : `${t(`ambAdm.endReason.${c.endReason ?? 'expired'}` as Parameters<typeof t>[0])}`}
          </li>
        ))}
        {d.claims.length === 0 && <li className="font-body text-xs text-muted-ink">{t('ambAdm.person.noClaims')}</li>}
      </ul>
      {d.contacts.length > 0 && (
        <>
          <SectionTitle title={t('ambAdm.person.outreach')} />
          <ul className="flex flex-col gap-1">
            {d.contacts.slice(0, 20).map((c) => (
              <li key={c.id} className="font-body text-[11px] text-ink">
                {shortDate(c.contactedAt)} · {c.lead.name} · {label.method(c.method)} · {label.outcome(c.outcome)}
                {c.notes && <span className="italic text-muted-ink"> — “{c.notes}”</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle title={t('ambAdm.person.notes')} />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} className="rounded-lg border-2 border-ink bg-cream px-2 py-1.5 font-body text-sm text-ink outline-none" />
      {notes !== (a.notes ?? '') && (
        <Button size="sm" className="mt-2 self-start" disabled={busy} onClick={() => void act(() => api.updateAmbassador(a.id, { notes }))}>
          {t('common.save')}
        </Button>
      )}

      <SectionTitle title={t('ambAdm.audit.title')} />
      <AuditList rows={d.audit} />
    </>
  )
}
