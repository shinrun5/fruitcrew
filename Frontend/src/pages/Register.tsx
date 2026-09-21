import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { Button } from '../components/Button'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'

export function Register() {
  const t = useT()
  const { user, loading, register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const linkedCode = params.get('code')?.trim() ?? ''

  const [inviteCode, setInviteCode] = useState(linkedCode)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      const u = await register({
        email: email.trim(),
        password,
        inviteCode: inviteCode.trim(),
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

  return (
    <AuthLayout
      title={t('auth.register.title')}
      subtitle={
        linkedCode ? t('auth.register.subtitleLinked') : t('auth.register.subtitle')
      }
      footer={
        <>
          {t('auth.register.haveAccountQ')}{' '}
          <Link to="/login" className="font-bold text-ink underline">
            {t('auth.register.login')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label={t('auth.register.inviteCode')}
          required
          readOnly={!!linkedCode}
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
        />
        <Field label={t('auth.register.fullName')} required value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label={t('auth.register.phone')}
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
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
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? t('auth.register.busy') : t('auth.register.button')}
        </Button>
      </form>
    </AuthLayout>
  )
}
