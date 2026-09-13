import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { FruitAvatar } from './FruitAvatar'
import { LangToggle } from './LangToggle'
import { NotificationBell } from './NotificationBell'
import { UserIcon } from './icons'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { useChatUnread } from '../lib/use-chat-unread'
import { useNotesCount } from '../lib/use-notes-count'
import { StoreProvider, useStore } from '../lib/store-context'

const tab = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold ${
    isActive ? 'bg-ink text-white' : 'bg-paper text-ink'
  }`

export function ManagerLayout({ children }: { children?: ReactNode }) {
  return (
    <StoreProvider>
      <Chrome>{children}</Chrome>
    </StoreProvider>
  )
}

/** Logo, store switcher, nav tabs, logout — inside StoreProvider so the switcher works.
 * On mobile the identity row and the nav strip stack; the nav scrolls sideways. */
function Chrome({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth()
  const t = useT()
  const location = useLocation()
  const { stores, storeId, setStoreId } = useStore()
  const [pending, setPending] = useState(0)
  const unread = useChatUnread()
  const notes = useNotesCount()

  useEffect(() => {
    Promise.all([api.getChangeRequests('PENDING'), api.getTimeOff(true)])
      .then(([r, t]) =>
        setPending(r.filter((x) => !(x.openOffer && !x.targetEmployee)).length + t.length),
      )
      .catch(() => {})
  }, [location.pathname])

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <div className="flex flex-col gap-2 border-b-[3px] border-ink bg-paper px-4 py-2.5 sm:px-8 sm:py-3">
        {/* identity row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FruitAvatar kind="apple" size={28} />
            <span className="truncate font-heading text-lg font-extrabold text-ink sm:text-xl">
              Fruit Crew
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stores.length > 0 && (
              <select
                value={storeId ?? ''}
                onChange={(e) => setStoreId(Number(e.target.value))}
                className="max-w-[7.5rem] shrink-0 rounded-full border-2 border-ink bg-cream px-3 py-1 font-heading text-xs font-bold text-ink outline-none sm:max-w-[9rem]"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <LangToggle />
            <NotificationBell />
            <NavLink
              to="/account"
              className="flex shrink-0 items-center gap-1.5 rounded-full border-2 border-ink bg-paper px-2.5 py-1 font-body text-xs font-semibold text-ink"
            >
              <UserIcon size={14} />
              <span className="hidden max-w-[9rem] truncate sm:inline">
                {user?.name ?? user?.email}
              </span>
            </NavLink>
            <button
              onClick={() => void logout()}
              className="shrink-0 whitespace-nowrap rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink"
            >
              {t('nav.logout')}
            </button>
          </div>
        </div>

        {/* nav strip — scrolls sideways when it doesn't fit */}
        <div className="no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5">
          {user?.role === 'OWNER' && (
            <NavLink to="/overview" className={tab}>
              Overview
            </NavLink>
          )}
          <NavLink to="/schedule" className={tab}>
            Schedule
          </NavLink>
          <NavLink to="/closing" className={tab}>
            Closing
          </NavLink>
          <NavLink to="/workers" className={tab}>
            Workers
          </NavLink>
          <NavLink to="/requests" className={tab}>
            Marketplace{pending > 0 ? ` (${pending})` : ''}
          </NavLink>
          <NavLink to="/chat" className={tab}>
            Chat{unread > 0 ? ` (${unread > 9 ? '9+' : unread})` : ''}
          </NavLink>
          <NavLink to="/notes" className={tab}>
            Notes{notes > 0 ? ` (${notes > 9 ? '9+' : notes})` : ''}
          </NavLink>
          <NavLink to="/stores" className={tab}>
            Stores
          </NavLink>
          <NavLink to="/my-availability" className={tab}>
            My hours
          </NavLink>
        </div>
      </div>
      {children ?? <Outlet />}
    </div>
  )
}
