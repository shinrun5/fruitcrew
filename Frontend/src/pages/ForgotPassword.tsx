import { type FormEvent, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

/** "Forgot password?" — emails a one-time link to /reset-password. Also how
 * someone who only signs in with Google/Apple sets a first password. */
export function ForgotPassword() {
  const t = useT()
  const location = useLocation()
  const [email, setEmail] = useState<string>((location.state as { email?: string } | null)?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.forgot.err'))
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <Link to="/login" className="font-bold text-ink underline">
      {t('auth.forgot.back')}
    </Link>
  )

  if (sent) {
    return (
      <AuthLayout title={t('auth.forgot.sentTitle')} subtitle={t('auth.forgot.sentSubtitle', { email: email.trim() })} footer={back}>
        <p className="font-body text-sm text-muted-ink">{t('auth.forgot.sentBody')}</p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')} footer={back}>
      <form onSubmit={onSubmit} className="flex flex-col">
        <Field
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? t('auth.forgot.sending') : t('auth.forgot.send')}
        </Button>
      </form>
    </AuthLayout>
  )
}
