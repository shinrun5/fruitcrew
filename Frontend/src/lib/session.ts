import type { Session } from '../types'

// Where the token pair lives between page loads. localStorage is the pragmatic
// choice for now (a résumé-scope tradeoff); httpOnly cookies set by our own
// /auth endpoints are the planned hardening pass.

const KEY = 'fruitcrew.session'
const ACTIVITY_KEY = 'fruitcrew.session.lastActiveAt'
// platform admins only: the business opened from Admin, sent as X-Admin-Org
// so the manager screens show that business alone (see requireAuth)
const ADMIN_ORG_KEY = 'fruitcrew.adminOrg'

// The underlying Supabase refresh token has no fixed expiry, so without this,
// a browser that's logged in once stays logged in forever. Force a fresh
// login after this long with no authenticated app activity.
export const SESSION_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

let current: Session | null = read()

/** Whose session this is — the user id inside the access token. */
function ownerOf(s: Session | null): string | null {
  try {
    const part = s?.access_token.split('.')[1]
    return part ? String(JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? '') || null : null
  } catch {
    return null
  }
}

// Other tabs share the stored session. Follow their changes, or the tabs fight:
// each refresh replaces the refresh token, so a tab still holding the old one
// fails its next refresh, signs out, and takes every other tab down with it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return
    const before = current
    current = read()
    if (before && !current) {
      // signed out in another tab
      window.dispatchEvent(new Event('auth:expired'))
    } else if (before && current && ownerOf(before) !== ownerOf(current)) {
      // someone else signed in there — don't keep showing the old account's screens
      window.location.reload()
    }
  })
}

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
      localStorage.removeItem(ADMIN_ORG_KEY)
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

/** The business a platform admin is acting as (null = none picked). */
export function getAdminOrg(): number | null {
  try {
    return Number(localStorage.getItem(ADMIN_ORG_KEY)) || null
  } catch {
    return null
  }
}

export function setAdminOrg(orgId: number | null) {
  try {
    if (orgId == null) localStorage.removeItem(ADMIN_ORG_KEY)
    else localStorage.setItem(ADMIN_ORG_KEY, String(orgId))
  } catch {
    // ignore
  }
}
