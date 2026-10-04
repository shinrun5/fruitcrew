import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { enablePush, pushAvailable, PUSH_RECEIVED_EVENT } from '../lib/push'

/** Phone apps only: registers for push once someone's signed in, and opens the
 * notification's screen when one is tapped. Renders nothing. */
export function PushBridge() {
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!pushAvailable()) return
    const subs = [
      PushNotifications.addListener('registration', ({ value }) => {
        void api.registerDevice(value, Capacitor.getPlatform() as 'ios' | 'android').catch(() => {})
      }),
      PushNotifications.addListener('registrationError', (e) => console.warn('[push] registration failed', e.error)),
      PushNotifications.addListener('pushNotificationReceived', () => window.dispatchEvent(new Event(PUSH_RECEIVED_EVENT))),
      // also delivered after a cold start from a tapped notification
      PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const link = (notification.data as { link?: unknown } | undefined)?.link
        if (typeof link === 'string' && link.startsWith('/')) navigate(link)
      }),
    ]
    return () => {
      for (const s of subs) void s.then((h) => h.remove())
    }
  }, [navigate])

  useEffect(() => {
    if (!pushAvailable() || !user) return
    enablePush().catch((e) => console.warn('[push] enable failed', e))
  }, [user?.id])

  return null
}
