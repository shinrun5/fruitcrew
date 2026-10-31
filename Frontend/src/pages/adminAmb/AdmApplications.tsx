import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card, EmptyState } from '../../components/Card'
import { CopyButton } from '../../components/CopyButton'
import { Pill } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { ambassadorsPageUrl } from '../../lib/links'
import { shortDate } from '../../lib/time'
import { useCopy } from '../../lib/use-copy'
import type { AmbassadorApplication } from '../../types'

const TONE = { PENDING: 'border-yellow bg-yellow/10 text-ink', APPROVED: 'border-green bg-green/10 text-green-dark', REJECTED: 'border-ink/25 bg-cream text-muted-ink' }

export function AdmApplications() {
  const t = useT()
  const { copiedKey, copy } = useCopy()
  const [show, setShow] = useState<'PENDING' | 'all'>('PENDING')
  const [list, setList] = useState<AmbassadorApplication[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  // the one just approved: its card leaves the waiting list, so its link shows up top
  const [justApproved, setJustApproved] = useState<{ name: string; url: string } | null>(null)
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(() => {
    api.getAmbassadorApplications(show).then(setList).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [show])
  useEffect(load, [load])

  async function act(id: number, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <Card className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-body text-xs text-ink">{t('ambAdm.apps.pageLink')}</span>
        <CopyButton copied={copiedKey === 'page'} onClick={() => copy('page', ambassadorsPageUrl())} label={t('ambAdm.apps.copyPage')} copiedLabel={t('ambPortal.home.copied')} tone="sky" />
      </Card>
      <div className="mt-3 flex gap-1.5">
        {(['PENDING', 'all'] as const).map((s) => (
          <button key={s} onClick={() => setShow(s)} className={`rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold ${show === s ? 'bg-ink text-white' : 'bg-paper text-ink'}`}>
            {s === 'PENDING' ? t('ambAdm.apps.pending') : t('ambAdm.apps.all')}
          </button>
        ))}
      </div>
      {justApproved && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border-2 border-green bg-green/10 px-3 py-2">
          <span className="min-w-0 flex-1 font-body text-xs text-ink">
            <b>{justApproved.name}</b> — {t('ambAdm.apps.invited')}
          </span>
          <CopyButton copied={copiedKey === 'inv'} onClick={() => copy('inv', justApproved.url)} label={t('ambAdm.copyInvite')} copiedLabel={t('ambPortal.home.copied')} tone="sky" />
        </div>
      )}
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {!list ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <EmptyState className="mt-3" title={t('ambAdm.apps.none')} />
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {list.map((a) => (
            <Card key={a.id} className="flex flex-col gap-1.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block font-heading text-sm font-bold text-ink">{a.name}</span>
                  <span className="block break-all font-body text-xs text-muted-ink">
                    {a.email}
                    {a.school ? ` · ${a.school}` : ''} · {a.area}
                  </span>
                </div>
                <Pill tone={TONE[a.status]}>{t(`ambAdm.apps.status.${a.status}`)}</Pill>
              </div>
              <p className="font-body text-xs text-ink">
                <b>{t('ambAdm.apps.why')}</b> {a.why}
              </p>
              {a.experience && (
                <p className="font-body text-xs text-ink">
                  <b>{t('ambAdm.apps.experience')}</b> {a.experience}
                </p>
              )}
              <span className="font-body text-[11px] text-muted-ink">{t('ambAdm.apps.applied', { date: shortDate(a.createdAt) })}</span>
              {a.decisionNote && <span className="font-body text-[11px] italic text-muted-ink">“{a.decisionNote}”</span>}
              {a.ambassadorId && (
                <Link to={`/admin/ambassadors/people/${a.ambassadorId}`} className="font-body text-xs font-bold text-sky-dark">
                  {t('ambAdm.apps.open')} ›
                </Link>
              )}
              {a.status === 'PENDING' &&
                (rejecting === a.id ? (
                  <div className="flex flex-col gap-2">
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ambAdm.apps.notePh')} className="rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => void act(a.id, () => api.rejectAmbassadorApplication(a.id, note.trim())).then(() => setRejecting(null))}>
                        {t('ambAdm.apps.reject')}
                      </Button>
                      <button onClick={() => setRejecting(null)} className="font-body text-xs text-muted-ink">
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy === a.id}
                      onClick={() =>
                        void act(a.id, async () => {
                          const r = await api.approveAmbassadorApplication(a.id)
                          setJustApproved({ name: a.name, url: r.inviteUrl })
                        })
                      }
                    >
                      {t('ambAdm.apps.approve')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setRejecting(a.id)}>
                      {t('ambAdm.apps.reject')}
                    </Button>
                  </div>
                ))}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
