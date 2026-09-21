import type { Session } from '../types'

// Where the token pair lives between page loads. localStorage is the pragmatic
// choice for now (a résumé-scope tradeoff); httpOnly cookies set by our own
// /auth endpoints are the planned hardening pass.

const KEY = 'fruitcrew.session'
const ACTIVITY_KEY = 'fruitcrew.session.lastActiveAt'

// The underlying Supabase refresh token has no fixed expiry, so without this,
// a browser that's logged in once stays logged in forever. Force a fresh
// login after this long with no authenticated app activity.
export const SESSION_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

let current: Session | null = read()

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function getSession(): Session | null {
  return current
}

export function setSession(session: Session | null) {
  current = session
  try {
    if (session) {
      localStorage.setItem(KEY, JSON.stringify(session))
      touchSessionActivity()
    } else {
      localStorage.removeItem(KEY)
      localStorage.removeItem(ACTIVITY_KEY)
    }
  } catch {
    // private mode / storage disabled -- in-memory `current` still works for the tab
  }
}

/** Reset the idle clock — call after every successful authenticated request. */
export function touchSessionActivity() {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

/** True once the session has gone unused for longer than SESSION_IDLE_TIMEOUT_MS. */
export function isSessionIdle(): boolean {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY)
    const last = raw ? Number(raw) : null
    return last != null && Date.now() - last > SESSION_IDLE_TIMEOUT_MS
  } catch {
    return false
  }
}
