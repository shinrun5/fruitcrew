import { NavLink, Outlet } from 'react-router-dom'
import { FruitAvatar } from './FruitAvatar'
import { BookIcon, ChecklistIcon, CoinIcon, HomeIcon, SearchIcon, ShieldIcon, StoreIcon } from './icons'
import { useT } from '../lib/i18n'

// Chrome for the student ambassador portal — the worker app's look (nav pills
// up top on a computer, a bottom tab bar on a phone, since students use it
// while out visiting businesses), with only the ambassador's own pages.
const NAV = [
  { to: '/ambassador', end: true, label: 'ambPortal.nav.home', Icon: HomeIcon },
  { to: '/ambassador/find', end: false, label: 'ambPortal.nav.find', Icon: SearchIcon },
  { to: '/ambassador/list', end: false, label: 'ambPortal.nav.list', Icon: ChecklistIcon },
  { to: '/ambassador/stores', end: false, label: 'ambPortal.nav.stores', Icon: StoreIcon },
  { to: '/ambassador/money', end: false, label: 'ambPortal.nav.money', Icon: CoinIcon },
  // product answers, close at hand while talking to an owner
  { to: '/ambassador/learn', end: false, label: 'ambPortal.nav.learn', Icon: BookIcon },
] as const

const topTab = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold transition-colors duration-150 ease-out ${
    isActive ? 'bg-ink text-white' : 'bg-paper text-ink hover:bg-cream'
  }`

const bottomTab = ({ isActive }: { isActive: boolean }) =>
  `relative flex min-w-0 flex-1 flex-col items-center gap-1 overflow-hidden pt-2.5 pb-1.5 font-heading text-[11px] font-bold transition-colors duration-150 ease-out ${
    isActive ? 'text-ink' : 'text-muted-ink'
  }`

export function AmbassadorLayout() {
  const t = useT()
  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <div className="sticky top-0 z-20 flex flex-col gap-2 border-b-[3px] border-ink bg-paper px-4 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] sm:px-8 sm:py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FruitAvatar kind="apple" size={34} />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-heading text-lg font-extrabold text-ink sm:text-xl">Fruit Crew</span>
              <span className="truncate font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">{t('ambPortal.title')}</span>
            </div>
          </div>
          <NavLink
            to="/ambassador/rules"
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 rounded-full border-2 border-ink px-2.5 py-1 font-heading text-xs font-bold ${isActive ? 'bg-ink text-white' : 'bg-paper text-ink'}`
            }
          >
            <ShieldIcon size={14} />
            {t('ambPortal.nav.rules')}
          </NavLink>
        </div>
        <div className="no-scrollbar -mx-1 hidden items-center gap-2 overflow-x-auto px-1 pb-0.5 sm:flex">
          {NAV.map(({ to, end, label }) => (
            <NavLink key={to} to={to} end={end} className={topTab}>
              {t(label)}
            </NavLink>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
        <Outlet />
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t-[3px] border-ink bg-paper pb-[env(safe-area-inset-bottom)] sm:hidden">
        {NAV.map(({ to, end, label, Icon }) => (
          <NavLink key={to} to={to} end={end} className={bottomTab}>
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-1/2 top-1 h-1 w-7 -translate-x-1/2 rounded-full bg-green transition-[transform,opacity] duration-150 ease-ink ${
                    isActive ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                  }`}
                />
                <Icon size={21} />
                <span className="max-w-full truncate">{t(label)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
