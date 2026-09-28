import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import type { Store } from '../types'

interface StoreCtx {
  stores: Store[]
  storeId: number | null
  setStoreId: (id: number) => void
  loading: boolean
}

const Ctx = createContext<StoreCtx | null>(null)
// exported so the admin console can preselect a store before routing into
// ManagerLayout (a fresh <StoreProvider> reads this on mount) — see Admin.tsx
export const STORE_ID_KEY = 'fruitcrew.storeId'
const KEY = STORE_ID_KEY

/** True once a store has sections (e.g. "Front of House") under it — it's no
 * longer directly schedulable itself at that point, only its sections are. */
export function hasSections(stores: Store[], storeId: number): boolean {
  return stores.some((s) => s.parentStoreId === storeId)
}

/** Loads the stores the signed-in manager/owner can see and tracks which one is
 * selected (persisted per browser). Wrap the manager area in this. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .getStores()
      .then((list) => {
        setStores(list)
        let saved: number | null = null
        try {
          saved = Number(localStorage.getItem(KEY)) || null
        } catch {
          saved = null
        }
        // a store with sections is inert (its sections carry the actual
        // schedules) — skip it when falling back to a default so a fresh
        // session doesn't land on a now-unschedulable parent
        const isLeaf = (id: number) => !hasSections(list, id)
        const savedStore = list.find((s) => s.id === saved)
        const pick = savedStore && isLeaf(savedStore.id) ? savedStore.id : (list.find((s) => isLeaf(s.id))?.id ?? null)
        setId(pick)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function setStoreId(id: number) {
    setId(id)
    try {
      localStorage.setItem(KEY, String(id))
    } catch {
      // ignore
    }
  }

  const value = useMemo<StoreCtx>(
    () => ({ stores, storeId, setStoreId, loading }),
    [stores, storeId, loading],
  )
  return <Ctx value={value}>{children}</Ctx>
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore must be used within <StoreProvider>')
  return ctx
}
