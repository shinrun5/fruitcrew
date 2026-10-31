import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Pill, SectionTitle } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { money } from '../../lib/ambassadorText'
import { useConfirm } from '../../lib/confirm'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import type { AdminPayout } from '../../types'

const TONE = { APPROVED: 'border-yellow bg-yellow/10 text-ink', PAID: 'border-green bg-green/10 text-green-dark', CANCELED: 'border-ink/25 bg-cream text-muted-ink' }

/** Money goes out by hand: approve what's owed, send it, then mark it paid. */
export function AdmPayouts() {
  const t = useT()
  const confirm = useConfirm()
  const [data, setData] = useState<{ payouts: AdminPayout[]; ready: { ambassadorId: number; name: string; amountCents: number; canPay: boolean }[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [paying, setPaying] = useState<number | null>(null)
  const [method, setMethod] = useState('')
  const [ref, setRef] = useState('')
  const load = useCallback(() => {
    api.getAdminPayouts().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setPaying(null)
      setMethod('')
      setRef('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function exportCsv() {
    try {
      const csv = await api.exportPayouts()
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'ambassador-payouts.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  if (!data) return error ? <p className="font-body text-sm font-bold text-coral-dark">{error}</p> : <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>
  return (
    <>
      {error && <p className="mb-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      <SectionTitle title={t('ambAdm.payouts.ready')} hint={t('ambAdm.payouts.readyHint')} />
      {data.ready.length === 0 ? (
        <p className="font-body text-xs text-muted-ink">{t('ambAdm.payouts.noneReady')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.ready.map((r) => (
            <Card key={r.ambassadorId} padded={false} className="flex flex-wrap items-center gap-2 p-3">
              <Link to={`/admin/ambassadors/people/${r.ambassadorId}`} className="min-w-0 flex-1 font-heading text-sm font-bold text-ink">
                {r.name}
              </Link>
              <span className="font-heading text-sm font-extrabold text-ink">{money(r.amountCents)}</span>
              {r.canPay ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    if (await confirm(t('ambAdm.payouts.confirm', { amount: money(r.amountCents), name: r.name }), { confirmLabel: t('ambAdm.payouts.approve') }))
                      void act(() => api.approvePayout(r.ambassadorId))
                  }}
                >
                  {t('ambAdm.payouts.approve')}
                </Button>
              ) : (
                <span className="font-body text-[11px] font-bold text-coral-dark">{t('ambAdm.payouts.needsW9')}</span>
              )}
            </Card>
          ))}
        </div>
      )}

      <SectionTitle
        title={t('ambAdm.payouts.history')}
        right={
          <button onClick={() => void exportCsv()} className="font-body text-xs font-bold text-sky-dark">
            {t('ambAdm.payouts.export')}
          </button>
        }
      />
      {data.payouts.length === 0 ? (
        <p className="font-body text-xs text-muted-ink">{t('ambPortal.money.noPayouts')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.payouts.map((p) => (
            <Card key={p.id} padded={false} className="flex flex-col gap-1.5 p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 font-body text-xs text-ink">
                  <b>#{p.id}</b> · {p.ambassador?.name} · {t('ambAdm.payouts.approvedOn', { date: shortDate(p.approvedAt) })}
                  {p.paidAt ? ` · ${t('ambAdm.payouts.paidOn', { date: shortDate(p.paidAt) })}` : ''}
                  {p.method ? ` · ${p.method}` : ''}
                  {p.reference ? ` (${p.reference})` : ''}
                </span>
                <span className="font-heading text-sm font-extrabold text-ink">{money(p.amountCents)}</span>
                <Pill tone={TONE[p.status]}>{t(`ambAdm.payouts.status.${p.status}`)}</Pill>
              </div>
              {p.status === 'APPROVED' &&
                (paying === p.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder={t('ambAdm.payouts.method')} className="w-32 rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none" />
                    <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('ambAdm.payouts.reference')} className="min-w-0 flex-1 rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none" />
                    <Button size="sm" disabled={busy} onClick={() => void act(() => api.completePayout(p.id, { ...(method.trim() ? { method: method.trim() } : {}), ...(ref.trim() ? { reference: ref.trim() } : {}) }))}>
                      {t('ambAdm.payouts.markPaid')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button onClick={() => setPaying(p.id)} className="font-body text-xs font-bold text-green-dark">
                      {t('ambAdm.payouts.sent')}
                    </button>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (await confirm(t('ambAdm.payouts.cancelConfirm'), { tone: 'danger', confirmLabel: t('ambAdm.payouts.cancel') })) void act(() => api.cancelPayout(p.id))
                      }}
                      className="font-body text-xs font-bold text-coral-dark"
                    >
                      {t('ambAdm.payouts.cancel')}
                    </button>
                  </div>
                ))}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
