import { useState } from 'react'
import { AvailabilityExtras } from '../components/AvailabilityExtras'
import { AvailabilityPanel } from '../components/AvailabilityPanel'
import { useT } from '../lib/i18n'

/** Reached via RequireEmployeeLink, so the caller is always linked by the
 * time this renders — no need to handle the unlinked case here too. */
export function Availability() {
  const t = useT()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-24">
      <h1 className="font-heading text-lg font-bold text-ink">{t('avail.title')}</h1>
      <p className="mt-0.5 mb-4 font-body text-xs text-muted-ink sm:text-sm">{t('avail.subtitle')}</p>
      {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <AvailabilityPanel barClass="bottom-[calc(3.5rem+0.5rem+env(safe-area-inset-bottom))] sm:bottom-4" />
      <AvailabilityExtras onError={setError} />
    </div>
  )
}
