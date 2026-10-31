import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/Card'
import { Pill } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { money, STATE_TONE, useAmbLabels } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import type { AdminCommission, CommissionKind, CommissionStatus } from '../../types'

const STATUSES: (CommissionStatus | '')[] = ['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'REVERSED', '']
const KINDS: (CommissionKind | '')[] = ['', 'BOUNTY', 'RECURRING', 'ADJUSTMENT']

/** Every bounty and commission: approve what's waiting, reject what shouldn't be paid. */
export function AdmRewards() {
  const t = useT()
  const label = useAmbLabels()
  const [status, setStatus] = useState<CommissionStatus | ''>('PENDING')
  const [kind, setKind] = useState<CommissionKind | ''>('')
  const [rows, setRows] = useState<AdminCommission[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(() => {
    api
      .getAdminCommissions(status, kind)
      .then((r) => {
        setRows(r)
        setPicked(new Set())
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [status, kind])
  useEffect(load, [load])

  async function approve(ids: number[]) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const r = await api.approveCommissions(ids)
      setInfo(t('ambAdm.rewards.approved', { n: r.approved.length }) + (r.skipped.length ? ` ${t('ambAdm.rewards.skipped', { n: r.skipped.length })}` : ''))
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function reject(id: number) {
    setBusy(true)
    setError(null)
    try {
      await api.rejectCommission(id, note.trim())
      setRejecting(null)
      setNote('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const chip = (on: boolean) => `shrink-0 rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold ${on ? 'bg-ink text-white' : 'bg-paper text-ink'}`
  const pending = rows?.filter((r) => r.status === 'PENDING') ?? []
  return (
    <>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {STATUSES.map((s) => (
          <button key={s || 'all'} onClick={() => setStatus(s)} className={chip(status === s)}>
            {s ? t(`ambAdm.rewards.status.${s}`) : t('ambPortal.find.all')}
          </button>
        ))}
      </div>
      <div className="no-scrollbar -mx-1 mt-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {KINDS.map((k) => (
          <button key={k || 'all'} onClick={() => setKind(k)} className={chip(kind === k)}>
            {k ? t(`ambAdm.rewards.kind.${k}`) : t('ambAdm.rewards.allKinds')}
          </button>
        ))}
      </div>
      {pending.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || picked.size === 0} onClick={() => void approve([...picked])}>
            {t('ambAdm.rewards.approvePicked', { n: picked.size })}
          </Button>
          <button onClick={() => setPicked(new Set(pending.map((r) => r.id)))} className="font-body text-xs font-bold text-sky-dark">
            {t('ambAdm.rewards.pickAll')}
          </button>
        </div>
      )}
      {info && <p className="mt-2 font-body text-xs font-bold text-green-dark">{info}</p>}
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {!rows ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <EmptyState className="mt-3" title={t('ambAdm.rewards.none')} />
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 rounded-xl border-2 border-ink/15 bg-paper px-3 py-2">
              <div className="flex items-start gap-2">
                {c.status === 'PENDING' && (
                  <input
                    type="checkbox"
                    aria-label={t('ambAdm.rewards.pick')}
                    checked={picked.has(c.id)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s)
                        if (e.target.checked) n.add(c.id)
                        else n.delete(c.id)
                        return n
                      })
                    }
                    className="mt-1"
                  />
                )}
                <div className="min-w-0 flex-1 font-body text-xs">
                  <span className="block font-bold text-ink">
                    {t(`ambAdm.rewards.kind.${c.kind}`)} · {money(c.amountCents)}
                    {c.periods > 1 ? ` · ${t('ambAdm.rewards.months', { n: c.periods })}` : ''}
                  </span>
                  <span className="block truncate text-muted-ink">
                    {c.ambassador && (
                      <Link to={`/admin/ambassadors/people/${c.ambassador.id}`} className="text-sky-dark">
                        {c.ambassador.name}
                      </Link>
                    )}{' '}
                    · {[...new Set([c.business, c.store].filter(Boolean))].join(' · ')} · {shortDate(c.createdAt)}
                  </span>
                  {c.flags && <span className="block font-bold text-coral-dark">⚠ {c.flags}</span>}
                  {c.status === 'PENDING' && c.verified === false && <span className="block text-muted-ink">{t('ambAdm.rewards.verifyFirst')}</span>}
                  {c.decisionNote && <span className="block italic text-muted-ink">“{c.decisionNote}”</span>}
                </div>
                <Pill tone={STATE_TONE[c.state]}>{label.state(c.state)}</Pill>
              </div>
              {(c.status === 'PENDING' || (c.status === 'APPROVED' && c.state !== 'paid')) &&
                (rejecting === c.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ambAdm.ref.why')} className="min-w-0 flex-1 rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none" />
                    <Button size="sm" variant="secondary" disabled={busy || !note.trim()} onClick={() => void reject(c.id)}>
                      {t('ambAdm.rewards.reject')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    {c.status === 'PENDING' && (
                      <button disabled={busy} onClick={() => void approve([c.id])} className="font-body text-xs font-bold text-green-dark">
                        {t('ambAdm.rewards.approve')}
                      </button>
                    )}
                    <button onClick={() => setRejecting(c.id)} className="font-body text-xs font-bold text-coral-dark">
                      {t('ambAdm.rewards.reject')}
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
