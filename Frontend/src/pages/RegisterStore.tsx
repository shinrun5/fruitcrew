import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { NameFields } from '../components/NameFields'
import { EMPTY_NAME } from '../lib/names'
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
  const [name, setName] = useState(EMPTY_NAME)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sectionIds, setSectionIds] = useState<number[]>([])
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

  if (!loading && user) return <Navigate to={homePathForRole(user)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (info && info.sections.length > 0 && sectionIds.length === 0) {
      setError('Pick at least one team to join')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const u = await registerStore({
        email: email.trim(),
        password,
        code,
        ...name,
        phone: phone.trim(),
        ...(info && info.sections.length > 0 ? { storeIds: sectionIds } : {}),
      })
      navigate(homePathForRole({ role: u.role, isSuperAdmin: false }), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account')
    } finally {
      setBusy(false)
    }
  }

  function toggleSection(id: number) {
    setSectionIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
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
          {info.sections.length > 0 && (
            <div className="mb-3">
              <span className="mb-1 block font-body text-xs font-bold text-muted-ink">
                Which team{info.sections.length > 1 ? '(s)' : ''} are you joining?
              </span>
              <div className="flex flex-wrap gap-1.5">
                {info.sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSection(s.id)}
                    aria-pressed={sectionIds.includes(s.id)}
                    className={`rounded-full border-2 px-3 py-1 font-heading text-xs font-bold ${
                      sectionIds.includes(s.id) ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <NameFields value={name} onChange={setName} />
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
