import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from './api'
import { useAddon } from './addons'

const POLL_MS = 25000

/** Total open shift notes across the caller's stores. Polls slowly and re-checks
 * on tab focus / route change (so it drops after you clear notes). */
export function useNotesCount(): number {
  const [total, setTotal] = useState(0)
  const { pathname } = useLocation()
  const on = useAddon('notes')

  useEffect(() => {
    // switched off for this business: nothing to count, and the API would refuse
    if (!on) return setTotal(0)
    let live = true
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await api.getNoteCounts()
        if (live) setTotal(r.total)
      } catch {
        /* keep last known */
      }
    }
    void check()
    const h = setInterval(check, POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      live = false
      clearInterval(h)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [pathname, on])

  return total
}
