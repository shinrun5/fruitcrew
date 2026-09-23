import { type FormEvent, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { Button } from '../components/Button'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { AppleSignInButton } from '../components/AppleSignInButton'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'

const PROVIDER_LABEL = { google: 'Google', apple: 'Apple' } as const

export function Login() {
  const t = useT()
  const { user, loading, login, oauthSignIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: { pathname?: string } } }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // set once Google/Apple hands back a token for an identity with no
  // FruitCrew account yet — held so the invite-code retry doesn't need
  // another provider popup, just a second call to the same endpoint
  const [pendingOAuth, setPendingOAuth] = useState<{
    provider: 'google' | 'apple'
    idToken: string
    name?: string
  } | null>(null)
  const [oauthInviteCode, setOauthInviteCode] = useState('')
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)

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

  async function handleOAuthToken(
    provider: 'google' | 'apple',
    idToken: string,
    name?: string,
    inviteCode?: string,
  ) {
    setOauthBusy(true)
    setOauthError(null)
    try {
      const result = await oauthSignIn({ provider, idToken, name, inviteCode })
      if (result.status === 'needsInvite') {
        setPendingOAuth({ provider, idToken, name })
        return
      }
      navigate(location.state?.from?.pathname ?? homePathForRole(result.user.role), { replace: true })
    } catch (err) {
      setOauthError(
        err instanceof Error ? err.message : t('auth.login.oauth.error', { provider: PROVIDER_LABEL[provider] }),
      )
    } finally {
      setOauthBusy(false)
    }
  }

  async function onOAuthInviteSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pendingOAuth) return
    await handleOAuthToken(pendingOAuth.provider, pendingOAuth.idToken, pendingOAuth.name, oauthInviteCode.trim())
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

      {pendingOAuth ? (
        <form onSubmit={onOAuthInviteSubmit} className="mt-4 border-t-2 border-dashed border-ink/15 pt-4">
          <p className="mb-3 font-body text-xs text-muted-ink">
            {t('auth.login.oauth.needsInvite', { provider: PROVIDER_LABEL[pendingOAuth.provider] })}
          </p>
          <Field
            label={t('auth.register.inviteCode')}
            required
            value={oauthInviteCode}
            onChange={(e) => setOauthInviteCode(e.target.value)}
          />
          {oauthError && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{oauthError}</p>}
          <Button type="submit" disabled={oauthBusy} className="w-full justify-center">
            {oauthBusy ? t('auth.login.oauth.linking') : t('auth.login.oauth.finish')}
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
          <div className="flex justify-center gap-3">
            <GoogleSignInButton onToken={(idToken) => void handleOAuthToken('google', idToken)} />
            <AppleSignInButton onToken={(idToken, name) => void handleOAuthToken('apple', idToken, name)} />
          </div>
          {oauthError && (
            <p className="mt-3 text-center font-body text-xs font-bold text-coral-dark">{oauthError}</p>
          )}
        </>
      )}
    </AuthLayout>
  )
}
