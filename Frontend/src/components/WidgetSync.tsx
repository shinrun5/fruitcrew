import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { syncWidget, widgetAvailable } from '../lib/widget'

/** iPhone app only: keeps the home-screen widget's shifts current — on sign-in,
 * whenever the app comes back to the foreground, and cleared on sign-out.
 * Renders nothing. */
export function WidgetSync() {
  const { user } = useAuth()

  useEffect(() => {
    if (!widgetAvailable()) return
    if (!user) {
      void syncWidget(null, false)
      return
    }
    const sync = () =>
      // owners/managers who don't work shifts have no My Shifts — the widget just says so
      api
        .getMyShifts()
        .then((d) => syncWidget(d, true))
        .catch(() => syncWidget(null, true))
    void sync()
    const sub = App.addListener('resume', () => void sync())
    return () => void sub.then((h) => h.remove())
  }, [user?.id])

  return null
}
