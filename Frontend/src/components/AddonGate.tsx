import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { type AddonKey, useAddon } from '../lib/addons'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { isNativeApp } from '../lib/pricing'
import { FruitAvatar } from './FruitAvatar'

type TKey = Parameters<ReturnType<typeof useT>>[0]

/** Wraps an add-on's page (Chat, Notes, Closing). When the business hasn't
 * turned it on, shows why instead — with the way to turn it on for an owner on
 * the web, and a plain "not turned on" for everyone else and in the phone apps
 * (which never sell anything). Nothing is deleted while it's off. */
export function AddonGate({ addon, children }: { addon: AddonKey; children: ReactNode }) {
  const t = useT()
  const { user } = useAuth()
  const on = useAddon(addon)
  if (on) return <>{children}</>

  const name = t(`addons.${addon}.name` as TKey)
  const canTurnOn = user?.role === 'OWNER' && !isNativeApp()
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 items-center p-4 sm:p-6">
      <div className="w-full rounded-2xl border-[2.5px] border-ink bg-paper p-5 text-center shadow-[3px_3px_0_var(--color-ink)]">
        <div className="mx-auto w-fit">
          <FruitAvatar kind="kiwi" size={44} />
        </div>
        <h1 className="mt-2 font-heading text-lg font-bold text-ink">{t('addons.gate.title', { name })}</h1>
        <p className="mt-1 font-body text-sm text-muted-ink">{t(`addons.${addon}.description` as TKey)}</p>
        {canTurnOn ? (
          <>
            <p className="mt-3 font-body text-xs text-muted-ink">{t('addons.gate.owner', { name })}</p>
            <Link
              to="/settings"
              className="mt-3 inline-block rounded-full border-2 border-ink bg-green px-4 py-1.5 font-heading text-sm font-bold text-white shadow-[2px_2px_0_var(--color-ink)]"
            >
              {t('addons.gate.go')}
            </Link>
          </>
        ) : (
          <p className="mt-3 font-body text-xs text-muted-ink">{t('addons.gate.staff')}</p>
        )}
      </div>
    </div>
  )
}
