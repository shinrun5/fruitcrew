import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'

/** Where the emailed "choose a new password" link lands (?token=…). Saving
 * signs you straight in. */
export function ResetPassword() {
  const t = useT()
  const navigate = useNavigate()
  const { resetPassword } = useAuth()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError(t('auth.reset.tooShort'))
    if (password !== confirm) return setError(t('auth.reset.mismatch'))
    setBusy(true)
    setError(null)
    try {
      const u = await resetPassword(token, password)
      navigate(homePathForRole(u), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.reset.err'))
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <Link to="/forgot-password" className="font-bold text-ink underline">
      {t('auth.reset.newLink')}
    </Link>
  )

  if (!token) {
    return (
      <AuthLayout title={t('auth.reset.title')} subtitle={t('auth.reset.noToken')} footer={footer}>
        {null}
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')} footer={footer}>
      <form onSubmit={onSubmit} className="flex flex-col">
        <Field
          label={t('auth.reset.new')}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label={t('auth.reset.confirm')}
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? t('auth.reset.saving') : t('auth.reset.save')}
        </Button>
      </form>
    </AuthLayout>
  )
}
