import { type ReactNode, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { CalendarIcon, ChatIcon, ClockIcon, MoreIcon, NoteIcon, SwapIcon } from './icons'
import { useChatUnread } from '../lib/use-chat-unread'
import { useNotesCount } from '../lib/use-notes-count'
import { FruitAvatar } from './FruitAvatar'
import { NotificationBell } from './NotificationBell'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'
import { setViewMode } from '../lib/viewMode'

// Five tabs on a phone: the everyday screens, then More for Notes, Closing
// and Profile. A desktop has room for every page as its own pill, so it
// gets no More — no page is ever listed in two places.
const NAV = [
  { to: '/my-shifts', label: 'nav.shifts', short: 'nav.shifts', Icon: CalendarIcon, desktop: true, mobile: true },
  { to: '/marketplace', label: 'nav.market', short: 'nav.market', Icon: SwapIcon, desktop: true, mobile: true },
  { to: '/availability', label: 'nav.availability', short: 'nav.hours', Icon: ClockIcon, desktop: true, mobile: true },
  { to: '/chat', label: 'nav.chat', short: 'nav.chat', Icon: ChatIcon, desktop: true, mobile: true },
  { to: '/notes', label: 'nav.notes', short: 'nav.notes', Icon: NoteIcon, desktop: true, mobile: false },
  { to: '/closing', label: 'more.closing', short: 'more.closing', Icon: NoteIcon, desktop: true, mobile: false },
  // (Profile on a desktop is the name link in the top bar, like Account for managers)
  { to: '/more', label: 'nav.more', short: 'nav.more', Icon: MoreIcon, desktop: false, mobile: true },
] as const

// pages reached through More — its tab stays lit while you're on one
const MORE_ROUTES = ['/more', '/notes', '/closing', '/profile']

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
  `relative flex min-w-0 flex-1 flex-col items-center gap-1 overflow-hidden pt-2.5 pb-1.5 font-heading text-[11px] font-bold transition-colors duration-150 ease-out ${
    isActive ? 'text-ink' : 'text-muted-ink'
  }`

/** Employee chrome: nav pills in the top bar on desktop, a bottom tab bar on phones. */
export function EmployeeLayout({ children }: { children?: ReactNode }): ReactNode {
  const { user } = useAuth()
  const t = useT()
  const unread = useChatUnread()
  const notes = useNotesCount()
  const location = useLocation()
  const inMore = MORE_ROUTES.some((p) => location.pathname.startsWith(p))
  const badgeFor = (to: string, mobile: boolean) =>
    to === '/chat' ? unread : to === '/notes' ? notes : to === '/more' && mobile ? notes : 0
  const isManager = user?.role === 'MANAGER' || user?.role === 'OWNER'

  // so a shared page (Chat/Notes) reached from here keeps this chrome for a
  // manager/owner instead of snapping back to Manage view's; irrelevant for a
  // plain employee, who always gets this layout regardless
  useEffect(() => {
    if (isManager) setViewMode('work')
  }, [isManager])

  // Closing only gets a pill where one of your stores actually uses it
  const [tracksClosing, setTracksClosing] = useState(false)
  useEffect(() => {
    api
      .getStores()
      .then((s) => setTracksClosing(s.some((x) => x.tracksClosingDuties)))
      .catch(() => {})
  }, [])

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <div className="sticky top-0 z-20 flex flex-col gap-2 border-b-[3px] border-ink bg-paper px-4 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] sm:px-8 sm:py-3">
        {/* identity row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FruitAvatar kind="apple" size={34} />
            <span className="truncate font-heading text-lg font-extrabold text-ink sm:text-xl">
              Fruit Crew
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            {isManager && (
              <NavLink
                to={homePathForRole(user!)}
                className="shrink-0 whitespace-nowrap rounded-full border-2 border-ink bg-ink px-2.5 py-1 font-heading text-xs font-bold text-white"
              >
                {t('nav.mgr.manageView')}
              </NavLink>
            )}
            <NavLink
              to="/profile"
              className="hidden font-body text-xs font-semibold text-muted-ink hover:text-ink sm:inline"
            >
              {user?.name ?? user?.email}
            </NavLink>
            <NotificationBell />
          </div>
        </div>

        {/* nav pills — desktop only; phones use the bottom tab bar instead */}
        <div className="no-scrollbar -mx-1 hidden items-center gap-2 overflow-x-auto px-1 pb-0.5 sm:flex">
          {NAV.filter((n) => n.desktop && (n.to !== '/closing' || tracksClosing)).map(({ to, label }) => (
            <NavLink key={to} to={to} className={topTab}>
              {t(label)}
              {badge(badgeFor(to, false))}
            </NavLink>
          ))}
        </div>
      </div>

      {/* most pages also add their own pb-24 sm:pb-6/8 on top of this for
       * extra breathing room, but this baseline is the actual guarantee —
       * Closing.tsx (reachable here via RoleScreen) had none of its own and
       * was getting its last bit of content covered by the fixed nav below */}
      <div className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
        {children ?? <Outlet />}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t-[3px] border-ink bg-paper pb-[env(safe-area-inset-bottom)] sm:hidden">
        {NAV.filter((n) => n.mobile).map(({ to, short, Icon }) => {
          const lit = (exact: boolean) => exact || (to === '/more' && inMore)
          return (
            <NavLink key={to} to={to} className={({ isActive }) => bottomTab({ isActive: lit(isActive) })}>
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute left-1/2 top-1 h-1 w-7 -translate-x-1/2 rounded-full bg-green transition-[transform,opacity] duration-150 ease-ink ${
                      lit(isActive) ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                    }`}
                  />
                  <span className="relative">
                    <Icon size={21} />
                    {badgeFor(to, true) > 0 && (
                      <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-coral" />
                    )}
                  </span>
                  <span className="max-w-full truncate">{t(short)}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
