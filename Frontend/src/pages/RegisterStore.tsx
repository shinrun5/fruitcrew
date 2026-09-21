import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { Button } from '../components/Button'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { homePathForRole } from '../lib/roles'
import type { StoreInviteInfo } from '../types'

/** Where a store's reusable sign-up link (Stores → a store → Sign-up link) lands
 * — any number of different workers can use the same link over time, each
 * picking their own email/password and landing on that store's roster as a
 * new worker (a manager sets their tier/permissions afterward from Workers). */
export function RegisterStore() {
  const { user, loading, registerStore } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const code = params.get('code')?.trim() ?? ''

  const [info, setInfo] = useState<StoreInviteInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) {
      setInfoError('This link is missing its sign-up code.')
      return
    }
    api
      .getStoreInviteInfo(code)
      .then(setInfo)
      .catch((e) => setInfoError(e instanceof Error ? e.message : 'This sign-up link is invalid.'))
  }, [code])

  if (!loading && user) return <Navigate to={homePathForRole(user.role)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const u = await registerStore({
        email: email.trim(),
        password,
        code,
        name: name.trim(),
        phone: phone.trim(),
      })
      navigate(homePathForRole(u.role), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account')
    } finally {
      setBusy(false)
    }
  }

  const subtitle = infoError
    ? infoError
    : info
      ? `You're joining ${info.storeName} at ${info.orgName} as a worker.`
      : 'Loading…'

  return (
    <AuthLayout
      title="Join the team"
      subtitle={subtitle}
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-ink underline">
            Log in
          </Link>
        </>
      }
    >
      {!infoError && info && (
        <form onSubmit={onSubmit}>
          <Field label="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Field
            label="Phone number"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
