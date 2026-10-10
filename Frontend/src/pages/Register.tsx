import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { SignupFields } from '../components/SignupFields'
import { EMPTY_ACCOUNT, EMPTY_NAME } from '../lib/names'
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
  const [name, setName] = useState(EMPTY_NAME)
  const [account, setAccount] = useState(EMPTY_ACCOUNT)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to={homePathForRole(user)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (account.password.length < 8) {
      setError(t('auth.passwordTooShort'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const u = await register({
        email: account.email.trim(),
        password: account.password,
        inviteCode: inviteCode.trim(),
        ...name,
        phone: account.phone.trim(),
      })
      navigate(homePathForRole({ role: u.role, isSuperAdmin: false }), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.register.failed'))
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
        <SignupFields
          name={name}
          onNameChange={setName}
          account={account}
          onAccountChange={setAccount}
          error={error}
          busy={busy}
        />
      </form>
    </AuthLayout>
  )
}
