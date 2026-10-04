import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

/** Fired when a push arrives while the app is open, so the bell can refresh
 * right away instead of on its next minute poll. */
export const PUSH_RECEIVED_EVENT = 'push:received'

/** Push only exists in the phone apps. Android additionally needs Firebase
 * configured (android/app/google-services.json) — without it the plugin's
 * register() crashes the app — so it stays off there until VITE_FIREBASE_ENABLED=1
 * is set in .env.capacitor alongside that file. iOS without the APNs setup just
 * reports a registration error, so it needs no such switch. */
export function pushAvailable(): boolean {
  if (!Capacitor.isNativePlatform()) return false
  if (Capacitor.getPlatform() === 'android' && import.meta.env.VITE_FIREBASE_ENABLED !== '1') return false
  return true
}

/** Ask once (the OS remembers the answer) and register this phone with APNs/FCM;
 * the 'registration' listener in PushBridge hands the token to the server. */
export async function enablePush(): Promise<void> {
  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') return
  if (Capacitor.getPlatform() === 'android') {
    // the channel lib/push.ts on the server sends to; Android 8+ needs one,
    // and it's what shows as "Fruit Crew" in the phone's notification settings
    await PushNotifications.createChannel({ id: 'default', name: 'Fruit Crew', importance: 4, sound: 'default' })
  }
  await PushNotifications.register()
}
