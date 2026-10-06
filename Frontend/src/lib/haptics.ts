import { Capacitor } from '@capacitor/core'
import { Haptics, NotificationType } from '@capacitor/haptics'

/** A small "done" tap from the phone when something that matters goes through
 * (schedule posted, shift claimed, request approved) — the way native apps
 * confirm things. Phone apps only; never throws. */
export function hapticSuccess(): void {
  if (!Capacitor.isNativePlatform()) return
  void Haptics.notification({ type: NotificationType.Success }).catch(() => {})
}
