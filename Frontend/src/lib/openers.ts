import type { EmployeeStore, Store } from '../types'

/** Can this person open this store -- either personally flagged, or the store
 * doesn't gate opening at all (Store.requiresOpenerSkill = false). */
export function effectiveCanOpen(
  employeeStores: EmployeeStore[],
  stores: Store[],
  employeeId: number,
  storeId: number,
): boolean {
  const link = employeeStores.find((es) => es.employeeId === employeeId && es.storeId === storeId)
  if (link?.canOpen) return true
  const store = stores.find((s) => s.id === storeId)
  return store ? !store.requiresOpenerSkill : false
}
