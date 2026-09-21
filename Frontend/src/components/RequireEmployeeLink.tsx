import { type ReactNode, useState } from 'react'
import { Button } from './Button'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'

/** Gate for pages that only make sense once this login is also a schedulable
 * worker (an Employee record) — every plain employee always has one, but a
 * manager/owner visiting these in Work view might not yet. */
export function RequireEmployeeLink({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth()
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (user?.employeeId != null) return <>{children}</>

  async function optIn() {
    setBusy(true)
    setError(null)
    try {
      await api.becomeWorker()
      await refreshUser()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('requireLink.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
      <div className="rounded-2xl border-[2.5px] border-ink bg-paper p-4 shadow-[3px_3px_0_var(--color-ink)]">
        <p className="font-body text-sm text-ink">{t('requireLink.body')}</p>
        {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
        <Button onClick={() => void optIn()} disabled={busy} className="mt-3">
          {busy ? t('requireLink.adding') : t('requireLink.button')}
        </Button>
      </div>
    </div>
  )
}
