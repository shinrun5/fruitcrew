import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from './api'
import { useAddon } from './addons'

const POLL_MS = 20000

/** Total unread chat messages across the caller's stores. Polls slowly, and
 * re-checks on tab focus and route changes (e.g. after leaving the chat page). */
export function useChatUnread(): number {
  const [total, setTotal] = useState(0)
  const { pathname } = useLocation()
  const on = useAddon('chat')

  useEffect(() => {
    // switched off for this business: nothing to count, and the API would refuse
    if (!on) return setTotal(0)
    let live = true
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await api.getChatUnread()
        if (live) setTotal(r.total)
      } catch {
        /* leave the last known value */
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
