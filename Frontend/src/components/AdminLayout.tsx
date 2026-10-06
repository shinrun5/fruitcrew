import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { FruitAvatar } from './FruitAvatar'
import { NotificationBell } from './NotificationBell'
import { UserIcon } from './icons'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'

/** Chrome for the platform super-admin console — deliberately not
 * ManagerLayout: a super admin isn't necessarily running any store day to
 * day, so it skips the store switcher, "Work view" toggle, and the
 * Schedule/Workers/Marketplace/Chat/Notes/Stores nav row entirely. Just the
 * logo, an account link, and whatever the admin page itself renders. */
export function AdminLayout({ children }: { children?: ReactNode }) {
  const { user } = useAuth()
  const t = useT()
  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b-[3px] border-ink bg-paper px-4 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] sm:px-8 sm:py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <FruitAvatar kind="apple" size={34} />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-heading text-lg font-extrabold text-ink sm:text-xl">Fruit Crew</span>
            <span className="truncate font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
              {t('admin.title')}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* new businesses asking in, signing up, adding stores */}
          <NotificationBell />
          <NavLink
            to="/admin/account"
            className="flex shrink-0 items-center gap-1.5 rounded-full border-2 border-ink bg-paper px-2.5 py-1 font-body text-xs font-semibold text-ink"
          >
            <UserIcon size={14} />
            <span className="hidden max-w-[9rem] truncate sm:inline">{user?.name ?? user?.email}</span>
          </NavLink>
        </div>
      </div>

      <div className="flex flex-1 flex-col">{children ?? <Outlet />}</div>
    </div>
  )
}
