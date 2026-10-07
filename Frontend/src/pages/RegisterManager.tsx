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
import type { ManagerInviteInfo } from '../types'

/** Where a manager/owner invite link (Stores → Team → Invite) lands — they pick
 * their own email and password instead of the owner inventing one for them. */
export function RegisterManager() {
  const { user, loading, registerManager } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // usually pre-filled from a link's ?code=, but someone handed just the bare
  // code (not a link) can paste it in directly below
  const [code, setCode] = useState(params.get('code')?.trim() ?? '')
  const [info, setInfo] = useState<ManagerInviteInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [name, setName] = useState(EMPTY_NAME)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setInfo(null)
    if (!code) {
      setInfoError(null)
      return
    }
    api
      .getManagerInviteInfo(code)
      .then((i) => {
        setInfo(i)
        setInfoError(null)
      })
      .catch((e) => setInfoError(e instanceof Error ? e.message : 'This invite code is invalid or already used.'))
  }, [code])

  if (!loading && user) return <Navigate to={homePathForRole(user)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const u = await registerManager({ email: email.trim(), password, code, ...name })
      navigate(homePathForRole({ role: u.role, isSuperAdmin: false }), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account')
    } finally {
      setBusy(false)
    }
  }

  const subtitle = infoError
    ? infoError
    : info
      ? `You're invited to join ${info.orgName} as ${info.role === 'OWNER' ? 'an owner' : 'a manager'}${
          info.storeNames.length ? ` of ${info.storeNames.join(', ')}` : ''
        }.`
      : code
        ? 'Loading your invite…'
        : 'Enter the invite code you were given.'

  return (
    <AuthLayout
      title="Accept your invite"
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
      {!info && (
        <Field
          label="Invite code"
          required
          autoFocus={!code}
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
        />
      )}
      {info && (
        <form onSubmit={onSubmit}>
          <NameFields value={name} onChange={setName} />
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
