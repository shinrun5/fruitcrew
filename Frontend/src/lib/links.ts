import { Capacitor } from '@capacitor/core'

/** A link someone opens from a text or an email: the website, even when it's
 * made inside the phone app (whose own origin is capacitor://localhost or
 * https://localhost — useless to anyone else). The app opens fruitcrew.app
 * links itself (see AppLinkBridge). */
export const webUrl = (path: string): string =>
  `${Capacitor.isNativePlatform() ? 'https://fruitcrew.app' : window.location.origin}${path}`

/** A worker's personal sign-up link. */
export const workerInviteUrl = (code: string): string => webUrl(`/register?code=${encodeURIComponent(code)}`)

/** Opens their messages app with the text filled in — iPhone and Android
 * disagree on how the body is attached. */
export function smsHref(phone: string, body: string): string {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return `sms:${phone}${ios ? '&' : '?'}body=${encodeURIComponent(body)}`
}
