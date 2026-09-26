import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'

/** Shown instead of the normal app to a self-registered EMPLOYEE whose account
 * a manager/owner hasn't approved yet (see the backend's requireAuth gate,
 * lib/auth.ts). The API refuses almost everything else while pending, so there's
 * nothing useful to render underneath — just an explanation and a way out. */
export function PendingApproval() {
  const t = useT()
  const { logout } = useAuth()

  return (
    <div className="flex h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border-[2.5px] border-ink bg-paper p-4 text-center shadow-[3px_3px_0_var(--color-ink)]">
        <h1 className="font-heading text-lg font-bold text-ink">{t('pendingApproval.title')}</h1>
        <p className="mt-2 font-body text-sm text-muted-ink">{t('pendingApproval.body')}</p>
        <button
          onClick={() => void logout()}
          className="mt-4 rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold text-ink"
        >
          {t('pendingApproval.logout')}
        </button>
      </div>
    </div>
  )
}
