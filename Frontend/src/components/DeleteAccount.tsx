import { type FormEvent, useState } from 'react'
import { Button } from './Button'
import { Card } from './Card'
import { Field } from './Field'
import { useAuth } from '../lib/auth'
import { useConfirm } from '../lib/confirm'
import { useT } from '../lib/i18n'

/** Profile › Delete my account — also on the screens shown instead of the app
 * (waiting for approval, business paused), since App Store 5.1.1(v) needs
 * every account to be deletable from inside the app. */
export function DeleteAccount({ className = 'mt-4' }: { className?: string }) {
  const t = useT()
  const { user, deleteAccount } = useAuth()
  const confirm = useConfirm()
  // undefined (not yet hydrated from /auth/me) defaults to "assume yes" —
  // the safer fallback, see AuthUser.hasPassword
  const needsPassword = user?.hasPassword !== false
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setError(null)
    // the last word before it's gone for good
    const ok = await confirm(t('profile.delete.finalConfirm'), {
      tone: 'danger',
      confirmLabel: t('profile.delete.confirmButton'),
      ...(user?.role === 'OWNER' ? { body: t('profile.delete.ownerWarning') } : {}),
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteAccount(needsPassword ? password : undefined)
      // deleteAccount clears the session; ProtectedRoute bounces to /login on its own
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account')
      setBusy(false)
    }
  }

  return (
    <Card className={`${className} border-coral-dark/40 text-left`}>
      <h2 className="font-heading text-sm font-bold text-coral-dark">{t('profile.delete.title')}</h2>
      {!open ? (
        <>
          <p className="mt-1 font-body text-xs text-muted-ink">{t('profile.delete.warning')}</p>
          {user?.role === 'OWNER' && (
            <p className="mt-1 font-body text-xs font-bold text-coral-dark">{t('profile.delete.ownerWarning')}</p>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 rounded-full border-2 border-coral-dark px-3 py-0.5 font-heading text-[11px] font-bold text-coral-dark transition-colors duration-150 ease-out hover:bg-coral-bg"
          >
            {t('profile.delete.button')}
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-2">
          <p className="mb-2 font-body text-xs text-muted-ink">
            {t(needsPassword ? 'profile.delete.confirmText' : 'profile.delete.confirmTextNoPassword')}
          </p>
          {needsPassword ? (
            <Field
              type="password"
              autoComplete="current-password"
              placeholder={t('profile.delete.passwordPlaceholder')}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          ) : (
            <Field
              type="text"
              autoCapitalize="characters"
              placeholder={t('profile.delete.typeDeletePlaceholder')}
              required
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
            />
          )}
          {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              variant="alert"
              disabled={busy || (!needsPassword && confirmWord.trim().toUpperCase() !== 'DELETE')}
            >
              {busy ? t('profile.delete.deleting') : t('profile.delete.confirmButton')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setOpen(false)
                setPassword('')
                setConfirmWord('')
                setError(null)
              }}
            >
              {t('profile.delete.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
