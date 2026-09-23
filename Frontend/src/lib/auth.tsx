import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import { getSession, isSessionIdle, setSession } from './session'
import type { AuthUser } from '../types'

interface AuthState {
  user: AuthUser | null
  /** true until the initial /auth/me hydration settles */
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  register: (input: {
    email: string
    password: string
    inviteCode: string
    name: string
    phone: string
  }) => Promise<AuthUser>
  registerOwner: (input: {
    email: string
    password: string
    companyName: string
    name: string
    phone: string
  }) => Promise<AuthUser>
  registerManager: (input: { email: string; password: string; code: string; name: string }) => Promise<AuthUser>
  registerStore: (input: {
    email: string
    password: string
    code: string
    name: string
    phone?: string
  }) => Promise<AuthUser>
  oauthSignIn: (input: {
    provider: 'google' | 'apple'
    idToken: string
    inviteCode?: string
    name?: string
  }) => Promise<{ status: 'linked'; user: AuthUser } | { status: 'needsInvite' }>
  /** Re-fetch /auth/me — use after something changes the account (e.g. becoming a worker). */
  refreshUser: () => Promise<void>
  logout: () => Promise<void>
  deleteAccount: (password?: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // hydrate from a stored token on first load
  useEffect(() => {
    if (!getSession()) {
      setLoading(false)
      return
    }
    if (isSessionIdle()) {
      setSession(null)
      setLoading(false)
      return
    }
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  // api.ts fires this when a request 401s and the refresh also failed
  useEffect(() => {
    const drop = () => setUser(null)
    window.addEventListener('auth:expired', drop)
    return () => window.removeEventListener('auth:expired', drop)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const u = await api.login(email, password)
        setUser(u)
        return u
      },
      register: async (input) => {
        const u = await api.register(input)
        setUser(u)
        return u
      },
      registerOwner: async (input) => {
        const u = await api.registerOwner(input)
        setUser(u)
        return u
      },
      registerManager: async (input) => {
        const u = await api.registerManager(input)
        setUser(u)
        return u
      },
      registerStore: async (input) => {
        const u = await api.registerStore(input)
        setUser(u)
        return u
      },
      oauthSignIn: async (input) => {
        const result = await api.oauthSignIn(input)
        if (result.status === 'linked') setUser(result.user)
        return result
      },
      refreshUser: async () => {
        try {
          setUser(await api.me())
        } catch {
          /* leave the current user in place if the refresh fails */
        }
      },
      logout: async () => {
        await api.logout()
        setUser(null)
      },
      deleteAccount: async (password) => {
        await api.deleteAccount(password)
        setUser(null)
      },
    }),
    [user, loading],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
