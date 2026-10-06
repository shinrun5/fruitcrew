import { Capacitor, registerPlugin } from '@capacitor/core'

// Sign in with Apple. The iPhone app uses Apple's native sheet
// (ios/App/App/AppleSignInPlugin.swift); the website uses Apple's JS
// (components/AppleSignInButton.tsx). Android has neither — Apple doesn't
// offer it there — so it keeps email + password.

export interface AppleResult {
  idToken: string
  /** one-time code the server trades for the token it revokes on account deletion */
  authorizationCode?: string
  /** the raw nonce; Apple got its SHA-256, the server checks they match */
  nonce?: string
  /** only on someone's very first authorization — Apple never sends it again */
  name?: string
}

const Native = registerPlugin<{
  authorize(o: { nonce?: string }): Promise<{ identityToken: string; authorizationCode: string; givenName: string; familyName: string }>
}>('AppleSignIn')

export const appleNativeAvailable = () => Capacitor.getPlatform() === 'ios'

/** A one-time random value, and its SHA-256 hex for Apple. No nonce at all
 * where WebCrypto isn't available — Apple and the server both allow that. */
export async function newNonce(): Promise<{ raw: string; hashed: string } | null> {
  if (!globalThis.crypto?.subtle) return null
  const raw = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hashed = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { raw, hashed }
}

/** The native sheet. null = the person cancelled. */
export async function signInWithAppleNative(): Promise<AppleResult | null> {
  const nonce = await newNonce()
  try {
    const r = await Native.authorize(nonce ? { nonce: nonce.hashed } : {})
    const name = [r.givenName, r.familyName].map((s) => s?.trim()).filter(Boolean).join(' ') || undefined
    return { idToken: r.identityToken, authorizationCode: r.authorizationCode || undefined, nonce: nonce?.raw, name }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'CANCELED' || err.message === 'canceled') return null
    throw e
  }
}
