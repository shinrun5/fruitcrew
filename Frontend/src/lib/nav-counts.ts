import { createContext, useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from './api'
import { useAddon, type AddonKey } from './addons'

/** A nav badge total. Polls slowly, and re-checks on tab focus and route
 * changes (e.g. dropping after you leave the chat page or clear notes). */
function usePolledCount(addon: AddonKey, fetchTotal: () => Promise<{ total: number }>, pollMs: number): number {
  const [total, setTotal] = useState(0)
  const { pathname } = useLocation()
  const on = useAddon(addon)

  useEffect(() => {
    // switched off for this business: nothing to count, and the API would refuse
    if (!on) return setTotal(0)
    let live = true
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await fetchTotal()
        if (live) setTotal(r.total)
      } catch {
        /* leave the last known value */
      }
    }
    void check()
    const h = setInterval(check, pollMs)
    const onVis = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      live = false
      clearInterval(h)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [pathname, on, fetchTotal, pollMs])

  return total
}

/** Total unread chat messages across the caller's stores. */
export const useChatUnread = () => usePolledCount('chat', api.getChatUnread, 20000)

/** Total open shift notes across the caller's stores. */
export const useNotesCount = () => usePolledCount('notes', api.getNoteCounts, 25000)

interface NavCounts {
  unread: number
  notes: number
}

/** The layouts poll the counts once for their badges and hand them down
 * through this, so a page inside them (More) doesn't poll a second time. */
export const NavCountsContext = createContext<NavCounts>({ unread: 0, notes: 0 })

export const useNavCounts = () => useContext(NavCountsContext)
