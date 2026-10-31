import { Capacitor } from '@capacitor/core'

/** A link someone opens from a text or an email: the website, even when it's
 * made inside the phone app (whose own origin is capacitor://localhost or
 * https://localhost — useless to anyone else). The app opens fruitcrew.app
 * links itself (see AppLinkBridge). */
export const webUrl = (path: string): string =>
  `${Capacitor.isNativePlatform() ? 'https://fruitcrew.app' : window.location.origin}${path}`

/** Where people write to FruitCrew — support, and ambassadors with a question they can't answer. */
export const SUPPORT_EMAIL = 'contact@fruitcrew.app'

/** A worker's personal sign-up link. */
export const workerInviteUrl = (code: string): string => webUrl(`/register?code=${encodeURIComponent(code)}`)
/** A manager's sign-up link. */
export const managerInviteUrl = (code: string): string => webUrl(`/register-manager?code=${encodeURIComponent(code)}`)
/** A student ambassador's referral link — it opens the business sign-up with their code. */
export const ambassadorReferralUrl = (code: string): string => webUrl(`/r/${encodeURIComponent(code)}`)
/** The public page where students learn about the program and apply. */
export const ambassadorsPageUrl = (): string => webUrl('/ambassadors')
