import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/** Phone apps only: a fruitcrew.app link the OS hands to the app (an invite
 * link, a link in an email — see Backend/src/lib/appLinks.ts for which ones)
 * opens that same screen here. Renders nothing. */
export function AppLinkBridge() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const sub = App.addListener('appUrlOpen', ({ url }) => {
      try {
        const u = new URL(url)
        if (u.hostname === 'fruitcrew.app' || u.hostname === 'www.fruitcrew.app') navigate(u.pathname + u.search + u.hash)
        // fruitcrew://my-shifts — the home-screen widget
        else if (u.protocol === 'fruitcrew:') navigate(`/${u.hostname}${u.pathname}${u.search}`)
      } catch {
        /* not a URL we understand — stay put */
      }
    })
    return () => void sub.then((h) => h.remove())
  }, [navigate])

  return null
}
