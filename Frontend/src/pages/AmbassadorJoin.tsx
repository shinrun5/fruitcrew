import { type FormEvent, useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'

/** /ambassador/join?code=… — an approved student makes their login and
 * accepts the program terms. */
export function AmbassadorJoin() {
  const t = useT()
  const { user, loading, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const code = params.get('code') ?? ''
  const [invite, setInvite] = useState<{ name: string; email: string; termsVersion: number; termsText: string } | null>(null)
  const [bad, setBad] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    api.getAmbassadorInvite(code).then(setInvite).catch((e) => setBad(e instanceof Error ? e.message : String(e)))
  }, [code])

  if (!loading && user) return <Navigate to={homePathForRole(user)} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!invite) return
    if (password.length < 8) return setErr(t('auth.passwordTooShort'))
    setBusy(true)
    setErr(null)
    try {
      await api.registerAmbassador({ code, password, termsVersion: invite.termsVersion })
      await refreshUser()
      navigate('/ambassador', { replace: true })
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('ambPublic.join.title')} subtitle={invite ? t('ambPublic.join.subtitle', { name: invite.name.split(' ')[0] ?? invite.name }) : undefined}>
      {!code || bad ? (
        <p className="font-body text-sm font-bold text-coral-dark">{bad ?? t('ambPublic.join.noCode')}</p>
      ) : !invite ? (
        <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <Field label={t('ambPublic.join.email')} value={invite.email} readOnly disabled />
          <Field label={t('ambPublic.join.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          <div>
            <span className="font-body text-[11px] font-bold text-muted-ink">{t('ambPublic.join.terms', { v: invite.termsVersion })}</span>
            <div className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border-2 border-ink/15 bg-cream/60 p-2.5 font-body text-xs text-ink">
              {invite.termsText}
            </div>
          </div>
          <label className="flex items-start gap-2 font-body text-xs font-bold text-ink">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
            {t('ambPublic.join.agree')}
          </label>
          {err && <p className="font-body text-xs font-bold text-coral-dark">{err}</p>}
          <Button type="submit" disabled={busy || !agree} className="justify-center">
            {t('ambPublic.join.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
