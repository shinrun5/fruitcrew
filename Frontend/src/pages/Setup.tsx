import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { SignupFields } from '../components/SignupFields'
import { EMPTY_ACCOUNT, EMPTY_NAME } from '../lib/names'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'

/** First-run screen: create the owner account + company. Disables itself once an
 * owner exists (the backend refuses too). */
export function Setup() {
  const t = useT()
  const { user, loading, registerOwner } = useAuth()
  const navigate = useNavigate()

  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)
  const [company, setCompany] = useState('')
  const [name, setName] = useState(EMPTY_NAME)
  const [account, setAccount] = useState(EMPTY_ACCOUNT)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .getSetupStatus()
      .then((s) => setNeedsSetup(s.needsSetup))
      .catch(() => setNeedsSetup(true)) // if the check fails, let them try; the API still guards
  }, [])

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
      const u = await registerOwner({
        email: account.email.trim(),
        password: account.password,
        companyName: company.trim(),
        ...name,
        phone: account.phone.trim(),
      })
      navigate(homePathForRole({ role: u.role, isSuperAdmin: false }), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.setup.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (needsSetup === false) {
    return (
      <AuthLayout
        title={t('auth.setup.done.title')}
        subtitle={t('auth.setup.done.subtitle')}
        footer={
          <Link to="/login" className="font-bold text-ink underline">
            {t('auth.setup.done.login')}
          </Link>
        }
      >
        <p className="font-body text-sm text-muted-ink">
          {t('auth.setup.done.body')}{' '}
          <Link to="/request-access" className="font-bold text-ink underline">
            {t('auth.login.createOwner')}
          </Link>
          .
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t('auth.setup.title')}
      subtitle={t('auth.setup.subtitle')}
      footer={
        <>
          {t('auth.haveAccountQ')}{' '}
          <Link to="/login" className="font-bold text-ink underline">
            {t('auth.register.login')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <Field label={t('auth.setup.company')} required value={company} onChange={(e) => setCompany(e.target.value)} />
        <SignupFields
          name={name}
          onNameChange={setName}
          account={account}
          onAccountChange={setAccount}
          error={error}
          busy={busy}
          disabled={needsSetup === null}
          submitLabel={t('auth.setup.button')}
          busyLabel={t('auth.setup.busy')}
        />
      </form>
    </AuthLayout>
  )
}
