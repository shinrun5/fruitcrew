import { useEffect, useRef } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

const MIN_GAP_MS = 15_000

/** Re-run `refresh` whenever the person comes back to the page — the tab or
 * window regains focus, or the phone app returns from the background — so a
 * page left open never quietly shows stale data (e.g. a schedule someone else
 * has since changed). At most once per 15s, and never while `paused` (an
 * editor or picker is open, so the data under it shouldn't shift). */
export function useRefreshOnReturn(refresh: () => unknown, paused = false) {
  const latest = useRef(refresh)
  latest.current = refresh
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const lastRun = useRef(Date.now())

  useEffect(() => {
    const run = () => {
      if (pausedRef.current || document.visibilityState !== 'visible') return
      if (Date.now() - lastRun.current < MIN_GAP_MS) return
      lastRun.current = Date.now()
      void Promise.resolve(latest.current()).catch(() => {})
    }
    document.addEventListener('visibilitychange', run)
    window.addEventListener('focus', run)
    const resume = Capacitor.isNativePlatform() ? App.addListener('resume', run) : null
    return () => {
      document.removeEventListener('visibilitychange', run)
      window.removeEventListener('focus', run)
      void resume?.then((h) => h.remove())
    }
  }, [])
}
