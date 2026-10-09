import { DeleteAccount } from './DeleteAccount'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'

/** Shown instead of the normal app when this login's org has been paused or
 * deleted by a superadmin (see the backend's requireAuth gate, lib/auth.ts).
 * The API refuses almost everything else while blocked, so there's nothing
 * useful to render underneath — just an explanation and a way out. */
export function OrgBlocked() {
  const t = useT()
  const { logout } = useAuth()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border-[2.5px] border-ink bg-paper p-4 text-center shadow-[3px_3px_0_var(--color-ink)]">
        <h1 className="font-heading text-lg font-bold text-ink">{t('orgBlocked.title')}</h1>
        <p className="mt-2 font-body text-sm text-muted-ink">{t('orgBlocked.body')}</p>
        <button
          onClick={() => void logout()}
          className="mt-4 rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold text-ink"
        >
          {t('orgBlocked.logout')}
        </button>
      </div>
      <div className="w-full max-w-sm">
        <DeleteAccount />
      </div>
    </div>
  )
}
