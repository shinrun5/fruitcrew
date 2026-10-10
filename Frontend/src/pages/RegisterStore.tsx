import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { SignupFields } from '../components/SignupFields'
import { EMPTY_ACCOUNT, EMPTY_NAME } from '../lib/names'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'
import type { StoreInviteInfo } from '../types'

/** Where a store's reusable sign-up link (Stores → a store → Sign-up link) lands
 * — any number of different workers can use the same link over time, each
 * picking their own email/password and landing on that store's roster as a
 * new worker (a manager sets their tier/permissions afterward from Workers). */
export function RegisterStore() {
  const t = useT()
  const { user, loading, registerStore } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const code = params.get('code')?.trim() ?? ''

  const [info, setInfo] = useState<StoreInviteInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [name, setName] = useState(EMPTY_NAME)
  const [account, setAccount] = useState(EMPTY_ACCOUNT)
  const [sectionIds, setSectionIds] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) {
      setInfoError(t('auth.joinStore.missingCode'))
      return
    }
    api
      .getStoreInviteInfo(code)
      .then(setInfo)
      .catch((e) => setInfoError(e instanceof Error ? e.message : t('auth.joinStore.invalid')))
  }, [code, t])

  if (!loading && user) return <Navigate to={homePathForRole(user)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (account.password.length < 8) {
      setError(t('auth.passwordTooShort'))
      return
    }
    if (info && info.sections.length > 0 && sectionIds.length === 0) {
      setError(t('auth.joinStore.pickTeam'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const u = await registerStore({
        email: account.email.trim(),
        password: account.password,
        code,
        ...name,
        phone: account.phone.trim(),
        ...(info && info.sections.length > 0 ? { storeIds: sectionIds } : {}),
      })
      navigate(homePathForRole({ role: u.role, isSuperAdmin: false }), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.register.failed'))
    } finally {
      setBusy(false)
    }
  }

  function toggleSection(id: number) {
    setSectionIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  const subtitle = infoError
    ? infoError
    : info
      ? t('auth.joinStore.subtitle', { store: info.storeName, org: info.orgName })
      : t('common.loading')

  return (
    <AuthLayout
      title={t('auth.joinStore.title')}
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
      {!infoError && info && (
        <form onSubmit={onSubmit}>
          {info.sections.length > 0 && (
            <div className="mb-3">
              <span className="mb-1 block font-body text-xs font-bold text-muted-ink">
                {info.sections.length > 1 ? t('auth.joinStore.whichTeams') : t('auth.joinStore.whichTeam')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {info.sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSection(s.id)}
                    aria-pressed={sectionIds.includes(s.id)}
                    className={`rounded-full border-2 px-3 py-1 font-heading text-xs font-bold ${
                      sectionIds.includes(s.id) ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <SignupFields
            name={name}
            onNameChange={setName}
            account={account}
            onAccountChange={setAccount}
            error={error}
            busy={busy}
          />
        </form>
      )}
    </AuthLayout>
  )
}
