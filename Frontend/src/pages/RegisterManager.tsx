import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { SignupFields } from '../components/SignupFields'
import { EMPTY_ACCOUNT, EMPTY_NAME } from '../lib/names'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'
import type { ManagerInviteInfo } from '../types'

/** Where a manager/owner invite link (Stores → Team → Invite) lands — they pick
 * their own email and password instead of the owner inventing one for them. */
export function RegisterManager() {
  const t = useT()
  const { user, loading, registerManager } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // usually pre-filled from a link's ?code=, but someone handed just the bare
  // code (not a link) can paste it in directly below
  const [code, setCode] = useState(params.get('code')?.trim() ?? '')
  const [info, setInfo] = useState<ManagerInviteInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [name, setName] = useState(EMPTY_NAME)
  const [account, setAccount] = useState(EMPTY_ACCOUNT)
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
      .catch((e) => setInfoError(e instanceof Error ? e.message : t('auth.managerInvite.invalid')))
  }, [code, t])

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
      const u = await registerManager({ email: account.email.trim(), password: account.password, code, ...name })
      navigate(homePathForRole({ role: u.role, isSuperAdmin: false }), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.register.failed'))
    } finally {
      setBusy(false)
    }
  }

  const invited = (i: ManagerInviteInfo) => {
    const vars = { org: i.orgName, stores: i.storeNames.join(', ') }
    if (i.role === 'OWNER') {
      return t(i.storeNames.length ? 'auth.managerInvite.asOwnerOf' : 'auth.managerInvite.asOwner', vars)
    }
    return t(i.storeNames.length ? 'auth.managerInvite.asManagerOf' : 'auth.managerInvite.asManager', vars)
  }
  const subtitle = infoError
    ? infoError
    : info
      ? invited(info)
      : code
        ? t('auth.managerInvite.loading')
        : t('auth.managerInvite.enterCode')

  return (
    <AuthLayout
      title={t('auth.managerInvite.title')}
      subtitle={subtitle}
      footer={
        <>
          {t('auth.haveAccountQ')}{' '}
          <Link to="/login" className="font-bold text-ink underline">
            {t('auth.register.login')}
          </Link>
        </>
      }
    >
      {!info && (
        <Field
          label={t('auth.register.inviteCode')}
          required
          autoFocus={!code}
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
        />
      )}
      {info && (
        <form onSubmit={onSubmit}>
          <SignupFields
            name={name}
            onNameChange={setName}
            account={account}
            onAccountChange={setAccount}
            withPhone={false}
            error={error}
            busy={busy}
          />
        </form>
      )}
    </AuthLayout>
  )
}
