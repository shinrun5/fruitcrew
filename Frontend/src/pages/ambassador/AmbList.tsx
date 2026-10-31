import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/Card'
import { AmbPage, SectionTitle } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { LeadCard } from '../../types'
import { LeadRow } from './AmbFind'

/** What the student holds right now, and businesses they've worked on before. */
export function AmbList() {
  const t = useT()
  const [data, setData] = useState<{ claimed: LeadCard[]; worked: LeadCard[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    api.getMyLeads().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(load, [load])

  return (
    <AmbPage title={t('ambPortal.list.title')} sub={t('ambPortal.list.sub')}>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {!data ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : (
        <>
          <SectionTitle title={t('ambPortal.list.holding', { n: data.claimed.length })} hint={t('ambPortal.list.holdingHint')} />
          {data.claimed.length === 0 ? (
            <div className="flex flex-col items-center gap-2">
              <EmptyState title={t('ambPortal.list.none')} />
              <Link to="/ambassador/find">
                <Button size="sm">{t('ambPortal.home.findCta')}</Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {data.claimed.map((l) => (
                <LeadRow key={l.id} lead={l} onClaimed={load} />
              ))}
            </div>
          )}
          {data.worked.length > 0 && (
            <>
              <SectionTitle title={t('ambPortal.list.worked')} hint={t('ambPortal.list.workedHint')} />
              <div className="flex flex-col gap-2">
                {data.worked.map((l) => (
                  <LeadRow key={l.id} lead={l} onClaimed={load} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </AmbPage>
  )
}
