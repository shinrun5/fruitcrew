import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card, EmptyState } from '../../components/Card'
import { AmbPage, MonthsBar, Pill } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { money, STAGE_TONE, STATE_TONE, useAmbLabels } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import type { AmbassadorBusiness } from '../../types'

/** The businesses a student brought in, store by store: set up yet, paying,
 * how many paid months are left, and what each has earned. */
export function AmbStores() {
  const t = useT()
  const label = useAmbLabels()
  const [list, setList] = useState<AmbassadorBusiness[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.getAmbassadorStores().then(setList).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const step = (done: boolean, text: string) => (
    <span className={`font-body text-[11px] font-bold ${done ? 'text-green-dark' : 'text-muted-ink'}`}>
      {done ? '✓' : '○'} {text}
    </span>
  )
  return (
    <AmbPage title={t('ambPortal.stores.title')} sub={t('ambPortal.stores.sub')}>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {!list ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <div className="mt-3 flex flex-col items-center gap-2">
          <EmptyState title={t('ambPortal.stores.none')} body={t('ambPortal.stores.noneHint')} />
          <Link to="/ambassador">
            <Button size="sm" variant="secondary">
              {t('ambPortal.stores.shareLink')}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {list.map((b) => (
            <Card key={b.id} className="flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-heading text-sm font-bold text-ink">{b.name}</span>
                  <span className="font-body text-[11px] text-muted-ink">{t('ambPortal.stores.since', { date: shortDate(b.since) })}</span>
                </div>
                <Pill tone={STAGE_TONE[b.stage]}>{label.stage(b.stage)}</Pill>
              </div>
              <p className="font-body text-[11px] text-muted-ink">{t(`ambPortal.stageHint.${b.stage}`)}</p>
              {b.stores.map((s) => (
                <div key={s.storeId} className="flex flex-col gap-1.5 rounded-xl border-2 border-ink/10 bg-cream/50 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-body text-xs font-bold text-ink">{s.name}</span>
                    {s.position > 1 && <span className="font-body text-[10px] text-muted-ink">{t('ambPortal.stores.extra')}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {step(s.hasWorkers, t('ambPortal.stores.stepWorker'))}
                    {step(s.posted, t('ambPortal.stores.stepSchedule'))}
                    {s.bounty ? (
                      <span className="flex items-center gap-1 font-body text-[11px] font-bold text-ink">
                        {t('ambPortal.stores.bounty')} <Pill tone={STATE_TONE[s.bounty]}>{label.state(s.bounty)}</Pill>
                      </span>
                    ) : (
                      step(false, t('ambPortal.stores.bountyNotYet'))
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <MonthsBar used={s.paidMonths} max={s.maxMonths} />
                    <span className="shrink-0 font-body text-[11px] font-bold text-ink">{t('ambPortal.stores.months', { used: s.paidMonths, max: s.maxMonths })}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 font-body text-[11px] text-muted-ink">
                    <span>
                      {t('ambPortal.stores.earned')} <b className="text-ink">{money(s.earnedCents)}</b>
                    </span>
                    {s.estimateLeftCents > 0 && <span>{t('ambPortal.stores.estimate', { amount: money(s.estimateLeftCents), months: s.monthsLeft })}</span>}
                  </div>
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}
    </AmbPage>
  )
}
