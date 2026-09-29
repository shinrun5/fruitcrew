import { type ReactNode, useEffect, useState } from 'react'
import { Button } from './Button'
import { StorePicker } from './StorePicker'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import type { Store } from '../types'

/** Gate for pages that only make sense once this login is also a schedulable
 * worker (an Employee record) — every plain employee always has one, but a
 * manager/owner visiting these in Work view might not yet. Lets them pick
 * which store(s)/section(s) they'll actually work, rather than becoming a
 * worker everywhere they merely manage (e.g. one section, not both). */
export function RequireEmployeeLink({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth()
  const t = useT()
  const [stores, setStores] = useState<Store[] | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user?.employeeId != null) return
    api
      .getStores()
      .then(setStores)
      .catch(() => setStores([]))
  }, [user?.employeeId])

  if (user?.employeeId != null) return <>{children}</>

  // options a worker link would actually do something at — a store's
  // parent, once it has sections, is never itself scheduled
  const pickable = (stores ?? []).filter((s) => s.parentStoreId != null || !stores!.some((x) => x.parentStoreId === s.id))
  const needsPicker = pickable.length > 1

  async function optIn() {
    const storeIds = needsPicker ? picked : pickable.map((s) => s.id)
    if (storeIds.length === 0) {
      setError(t('requireLink.pickAtLeastOne'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.becomeWorker(storeIds)
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
        {needsPicker && (
          <div className="mt-3">
            <p className="mb-1.5 font-body text-xs font-bold text-muted-ink">{t('requireLink.pickHint')}</p>
            <StorePicker
              stores={stores!}
              picked={picked}
              disabled={busy}
              includeParentOfSections={false}
              onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
            />
          </div>
        )}
        {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
        <Button onClick={() => void optIn()} disabled={busy || stores == null} className="mt-3">
          {busy ? t('requireLink.adding') : t('requireLink.button')}
        </Button>
      </div>
    </div>
  )
}
