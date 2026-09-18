import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout, Field } from '../components/AuthLayout'
import { Button } from '../components/Button'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { homePathForRole } from '../lib/roles'

/** First-run screen: create the owner account + company. Disables itself once an
 * owner exists (the backend refuses too). */
export function Setup() {
  const { user, loading, registerOwner } = useAuth()
  const navigate = useNavigate()

  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .getSetupStatus()
      .then((s) => setNeedsSetup(s.needsSetup))
      .catch(() => setNeedsSetup(true)) // if the check fails, let them try; the API still guards
  }, [])

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
      const u = await registerOwner({
        email: email.trim(),
        password,
        companyName: company.trim(),
        name: name.trim(),
        phone: phone.trim(),
      })
      navigate(homePathForRole(u.role), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish setup')
    } finally {
      setBusy(false)
    }
  }

  if (needsSetup === false) {
    return (
      <AuthLayout
        title="Already set up"
        subtitle="This company has an owner account."
        footer={
          <Link to="/login" className="font-bold text-ink underline">
            Go to login
          </Link>
        }
      >
        <p className="font-body text-sm text-muted-ink">
          The owner can add managers and staff from inside the app. Running a different business and
          want to bring it to Fruit Crew?{' '}
          <Link to="/request-access" className="font-bold text-ink underline">
            Request access
          </Link>
          .
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Set up your company"
      subtitle="Create the owner account — do this once"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-ink underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Company name"
          required
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <Field label="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Phone number"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Field
          label="Your email"
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
        <Button type="submit" disabled={busy || needsSetup === null} className="w-full justify-center">
          {busy ? 'Setting up…' : 'Create owner account'}
        </Button>
      </form>
    </AuthLayout>
  )
}
