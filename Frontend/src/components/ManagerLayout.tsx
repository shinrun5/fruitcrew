import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { FruitAvatar } from './FruitAvatar'
import { LangToggle } from './LangToggle'
import { NotificationBell } from './NotificationBell'
import { CalendarIcon, ChatIcon, DashboardIcon, NoteIcon, PeopleIcon, StoreIcon, SwapIcon, UserIcon } from './icons'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useChatUnread } from '../lib/use-chat-unread'
import { useNotesCount } from '../lib/use-notes-count'
import { StoreProvider, useStore } from '../lib/store-context'
import { setViewMode } from '../lib/viewMode'

const badge = (n: number) =>
  n > 0 ? (
    <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-coral px-1 font-body text-[10px] font-bold text-white">
      {n > 9 ? '9+' : n}
    </span>
  ) : null

const topTab = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold transition-colors duration-150 ease-out ${
    isActive ? 'bg-ink text-white' : 'bg-paper text-ink hover:bg-cream'
  }`

const bottomTab = ({ isActive }: { isActive: boolean }) =>
  `relative flex min-w-0 flex-1 flex-col items-center gap-1 overflow-hidden pt-2.5 pb-1.5 font-heading text-[10px] font-bold transition-colors duration-150 ease-out ${
    isActive ? 'text-ink' : 'text-muted-ink'
  }`

export function ManagerLayout({ children }: { children?: ReactNode }) {
  return (
    <StoreProvider>
      <Chrome>{children}</Chrome>
    </StoreProvider>
  )
}

/** Logo, store switcher, nav, logout — inside StoreProvider so the switcher works.
 * Nav pills in the top bar on desktop, a bottom tab bar on phones — same
 * pattern as the Work view (EmployeeLayout), for a cleaner mobile chrome than
 * a sideways-scrolling pill strip. Closing lives inside Schedule now (it only
 * applies to some stores), not as its own tab. */
function Chrome({ children }: { children?: ReactNode }) {
  const { user } = useAuth()
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

  // so a shared page (Chat/Notes) reached from Work view's own nav keeps that
  // chrome instead of snapping back here
  useEffect(() => {
    setViewMode('manage')
  }, [])

  // Admin lives on the Account page instead (Profile.tsx) — it's a rare,
  // single-operator debug console, not worth nav space every manager sees
  const nav = [
    ...(user?.role === 'OWNER' ? [{ to: '/overview', label: 'Overview', short: 'Home', Icon: DashboardIcon, badge: 0 }] : []),
    { to: '/schedule', label: 'Schedule', short: 'Schedule', Icon: CalendarIcon, badge: 0 },
    { to: '/workers', label: 'Workers', short: 'Workers', Icon: PeopleIcon, badge: 0 },
    { to: '/requests', label: 'Marketplace', short: 'Market', Icon: SwapIcon, badge: pending },
    { to: '/chat', label: 'Chat', short: 'Chat', Icon: ChatIcon, badge: unread },
    { to: '/notes', label: 'Notes', short: 'Notes', Icon: NoteIcon, badge: notes },
    { to: '/stores', label: 'Stores', short: 'Stores', Icon: StoreIcon, badge: 0 },
  ]

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <div className="sticky top-0 z-20 flex flex-col gap-2 border-b-[3px] border-ink bg-paper px-2.5 py-2.5 sm:px-8 sm:py-3">
        {/* identity row */}
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 shrink-0 items-center gap-2.5">
            <FruitAvatar kind="apple" size={28} />
            <span className="hidden font-heading text-lg font-extrabold text-ink sm:inline sm:text-xl">
              Fruit Crew
            </span>
          </div>
          <div className="flex min-w-0 shrink items-center gap-1 sm:gap-2">
            {stores.length > 0 && (
              <select
                value={storeId ?? ''}
                onChange={(e) => setStoreId(Number(e.target.value))}
                className="min-w-[4rem] max-w-[7rem] shrink rounded-full border-2 border-ink bg-cream px-2 py-1 font-heading text-xs font-bold text-ink outline-none sm:max-w-[9rem] sm:px-3"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <NavLink
              to="/my-shifts"
              className="shrink-0 whitespace-nowrap rounded-full border-2 border-ink bg-green px-2 py-1 font-heading text-xs font-bold text-white sm:px-2.5"
            >
              Work view
            </NavLink>
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
          </div>
        </div>

        {/* nav pills — desktop only; phones use the bottom tab bar instead */}
        <div className="no-scrollbar -mx-1 hidden items-center gap-2 overflow-x-auto px-1 pb-0.5 sm:flex">
          {nav.map(({ to, label, Icon, badge: n }) => (
            <NavLink key={to} to={to} className={topTab}>
              <span className="inline-flex items-center gap-1.5">
                <Icon size={14} />
                {label}
                {badge(n)}
              </span>
            </NavLink>
          ))}
        </div>
      </div>

      {/* pb reserves room for the fixed bottom bar on phones, unlike Work view
       * this is handled here rather than per-page since existing manager pages
       * predate the bottom bar */}
      <div className="flex flex-1 flex-col pb-16 sm:pb-0">{children ?? <Outlet />}</div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t-[3px] border-ink bg-paper pb-[env(safe-area-inset-bottom)] sm:hidden">
        {nav.map(({ to, short, Icon, badge: n }) => (
          <NavLink key={to} to={to} className={bottomTab}>
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-1/2 top-1 h-1 w-7 -translate-x-1/2 rounded-full bg-green transition-[transform,opacity] duration-150 ease-ink ${
                    isActive ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                  }`}
                />
                <span className="relative">
                  <Icon size={21} />
                  {n > 0 && <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-coral" />}
                </span>
                <span className="max-w-full truncate">{short}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
