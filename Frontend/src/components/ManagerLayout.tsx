import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { FruitAvatar } from './FruitAvatar'
import { NotificationBell } from './NotificationBell'
import { CalendarIcon, ChatIcon, HomeIcon, MoreIcon, NoteIcon, PeopleIcon, SwapIcon, UserIcon } from './icons'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { useChatUnread } from '../lib/use-chat-unread'
import { useNotesCount } from '../lib/use-notes-count'
import { StoreProvider, hasSections, useStore } from '../lib/store-context'
import { setViewMode } from '../lib/viewMode'

const badge = (n: number) =>
  n > 0 ? (
    <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-coral px-1 font-body text-[10px] font-bold text-white">
      {n > 9 ? '9+' : n}
    </span>
  ) : null

// pages reached through More — its tab stays lit while you're on one of them
const MORE_ROUTES = ['/more', '/chat', '/notes', '/payroll', '/settings', '/account']
const MORE_ONLY_DESKTOP = ['/more', '/payroll', '/settings', '/account']

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

  // so a shared page (Chat/Notes) reached from Work view's own nav keeps that
  // chrome instead of snapping back here
  useEffect(() => {
    setViewMode('manage')
  }, [])

  // Five tabs on a phone, like the big scheduling apps: the daily-use screens
  // up front, everything else one tap away under More. Desktop has room, so
  // Chat and Notes keep their own pills there too. Admin lives on the Account
  // page (Profile.tsx) — a rare, single-operator console.
  const nav = [
    { to: '/home', label: t('nav.mgr.home'), Icon: HomeIcon, badge: 0, desktop: true, mobile: true },
    { to: '/schedule', label: t('nav.mgr.schedule'), Icon: CalendarIcon, badge: 0, desktop: true, mobile: true },
    { to: '/team', label: t('nav.mgr.workers'), Icon: PeopleIcon, badge: 0, desktop: true, mobile: true },
    { to: '/requests', label: t('nav.mgr.requests'), Icon: SwapIcon, badge: pending, desktop: true, mobile: true },
    { to: '/chat', label: t('nav.chat'), Icon: ChatIcon, badge: unread, desktop: true, mobile: false },
    { to: '/notes', label: t('nav.notes'), Icon: NoteIcon, badge: notes, desktop: true, mobile: false },
    // desktop's More only needs a dot for what it hides there (nothing with a count)
    { to: '/more', label: t('nav.more'), Icon: MoreIcon, badge: 0, desktop: true, mobile: false },
    { to: '/more', label: t('nav.more'), Icon: MoreIcon, badge: unread + notes, desktop: false, mobile: true },
  ]
  const inMore = MORE_ROUTES.some((p) => location.pathname.startsWith(p))

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <div className="sticky top-0 z-20 flex flex-col gap-2 border-b-[3px] border-ink bg-paper px-4 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] sm:px-8 sm:py-3">
        {/* identity row */}
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FruitAvatar kind="apple" size={34} />
            <span className="hidden truncate font-heading text-lg font-extrabold text-ink sm:inline sm:text-xl">
              Fruit Crew
            </span>
          </div>
          <div className="flex min-w-0 shrink items-center gap-1 sm:gap-2">
            {user?.isSuperAdmin && (
              <NavLink
                to="/admin"
                className="shrink-0 whitespace-nowrap rounded-full border-2 border-ink bg-paper px-2 py-1 font-heading text-xs font-bold text-ink sm:px-2.5"
              >
                {t('admin.backToAdmin')}
              </NavLink>
            )}
            {stores.length > 0 && (
              <select
                value={storeId ?? ''}
                onChange={(e) => setStoreId(Number(e.target.value))}
                className="min-w-[4rem] max-w-[7rem] shrink rounded-full border-2 border-ink bg-cream px-2 py-1 font-heading text-xs font-bold text-ink outline-none sm:max-w-[9rem] sm:px-3"
              >
                {stores
                  .filter((s) => s.parentStoreId === null)
                  .map((s) =>
                    hasSections(stores, s.id) ? (
                      // a store with sections is no longer itself schedulable —
                      // only its sections show up as selectable options
                      <optgroup key={s.id} label={s.name}>
                        {stores
                          .filter((sec) => sec.parentStoreId === s.id)
                          .map((sec) => (
                            <option key={sec.id} value={sec.id}>
                              {sec.name}
                            </option>
                          ))}
                      </optgroup>
                    ) : (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ),
                  )}
              </select>
            )}
            <NavLink
              to="/my-shifts"
              className="shrink-0 whitespace-nowrap rounded-full border-2 border-ink bg-green px-2 py-1 font-heading text-xs font-bold text-white sm:px-2.5"
            >
              {t('nav.mgr.workView')}
            </NavLink>
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
          {nav.filter((n) => n.desktop).map(({ to, label, Icon, badge: n }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                topTab({ isActive: isActive || (to === '/more' && MORE_ONLY_DESKTOP.some((p) => location.pathname.startsWith(p))) })
              }
            >
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
       * predate the bottom bar. Includes the safe-area inset (home indicator)
       * on top of the nav's own height — a flat pb-16 undershot that on any
       * notched device, letting the nav's fixed position cover the last bit
       * of scrolled content instead of just sitting below it. */}
      <div className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
        {children ?? <Outlet />}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t-[3px] border-ink bg-paper pb-[env(safe-area-inset-bottom)] sm:hidden">
        {nav.filter((n) => n.mobile).map(({ to, label, Icon, badge: n }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => bottomTab({ isActive: isActive || (to === '/more' && inMore) })}
          >
            {({ isActive: exact }) => {
              const isActive = exact || (to === '/more' && inMore)
              return (
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
                <span className="max-w-full truncate">{label}</span>
              </>
              )
            }}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
