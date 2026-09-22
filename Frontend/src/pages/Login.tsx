import { type FormEvent, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { Button } from '../components/Button'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'

export function Login() {
  const t = useT()
  const { user, loading, login, oauthSignIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: { pathname?: string } } }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // set once Google hands back a token for an identity with no FruitCrew
  // account yet — held so the invite-code retry doesn't need another
  // Google popup, just a second call to the same endpoint
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(null)
  const [googleInviteCode, setGoogleInviteCode] = useState('')
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)

  if (!loading && user) return <Navigate to={homePathForRole(user.role)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const u = await login(email.trim(), password)
      navigate(location.state?.from?.pathname ?? homePathForRole(u.role), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in')
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogleToken(idToken: string, inviteCode?: string) {
    setGoogleBusy(true)
    setGoogleError(null)
    try {
      const result = await oauthSignIn({ provider: 'google', idToken, inviteCode })
      if (result.status === 'needsInvite') {
        setPendingGoogleToken(idToken)
        return
      }
      navigate(location.state?.from?.pathname ?? homePathForRole(result.user.role), { replace: true })
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : t('auth.login.google.error'))
    } finally {
      setGoogleBusy(false)
    }
  }

  async function onGoogleInviteSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pendingGoogleToken) return
    await handleGoogleToken(pendingGoogleToken, googleInviteCode.trim())
  }

  return (
    <AuthLayout
      title="Fruit Crew"
      subtitle={t('auth.login.subtitle')}
      footer={
        <div className="flex flex-col gap-1">
          <span>
            {t('auth.login.inviteQ')}{' '}
            <Link to="/register" className="font-bold text-ink underline">
              {t('auth.login.setup')}
            </Link>
          </span>
          <span>
            {t('auth.login.newCompanyQ')}{' '}
            <Link to="/request-access" className="font-bold text-ink underline">
              {t('auth.login.createOwner')}
            </Link>
          </span>
        </div>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? t('auth.login.busy') : t('auth.login.button')}
        </Button>
      </form>

      {pendingGoogleToken ? (
        <form onSubmit={onGoogleInviteSubmit} className="mt-4 border-t-2 border-dashed border-ink/15 pt-4">
          <p className="mb-3 font-body text-xs text-muted-ink">{t('auth.login.google.needsInvite')}</p>
          <Field
            label={t('auth.register.inviteCode')}
            required
            value={googleInviteCode}
            onChange={(e) => setGoogleInviteCode(e.target.value)}
          />
          {googleError && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{googleError}</p>}
          <Button type="submit" disabled={googleBusy} className="w-full justify-center">
            {googleBusy ? t('auth.login.google.linking') : t('auth.login.google.finish')}
          </Button>
        </form>
      ) : (
        <>
          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-ink/10" />
            <span className="font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
              {t('auth.login.orDivider')}
            </span>
            <div className="h-px flex-1 bg-ink/10" />
          </div>
          <GoogleSignInButton onToken={(idToken) => void handleGoogleToken(idToken)} />
          {googleError && (
            <p className="mt-3 text-center font-body text-xs font-bold text-coral-dark">{googleError}</p>
          )}
        </>
      )}
    </AuthLayout>
  )
}
