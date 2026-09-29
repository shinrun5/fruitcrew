import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { SETUP_STEPS } from '../components/GettingStarted'
import { CalendarIcon, ChatIcon, ChecklistIcon, ClockIcon, PencilIcon, PeopleIcon, StoreIcon, SwapIcon } from '../components/icons'
import { useT } from '../lib/i18n'

type TKey = Parameters<ReturnType<typeof useT>>[0]

const SUPPORT_EMAIL = 'contact@fruitcrew.app'

// Each section: what it's about, a few plain lines, and a jump to where it happens.
const SECTIONS: { id: string; icon: ReactNode; title: TKey; lines: TKey[]; to?: string; go?: TKey }[] = [
  {
    id: 'week',
    icon: <CalendarIcon size={18} />,
    title: 'help.week.title',
    lines: ['help.week.1', 'help.week.2', 'help.week.3', 'help.week.4'],
    to: '/schedule',
    go: 'nav.mgr.schedule',
  },
  {
    id: 'edit',
    icon: <PencilIcon size={18} />,
    title: 'help.edit.title',
    lines: ['help.edit.1', 'help.edit.2', 'help.edit.3'],
    to: '/schedule',
    go: 'nav.mgr.schedule',
  },
  {
    id: 'requests',
    icon: <SwapIcon size={18} />,
    title: 'help.requests.title',
    lines: ['help.requests.1', 'help.requests.2'],
    to: '/requests',
    go: 'nav.mgr.requests',
  },
  {
    id: 'team',
    icon: <PeopleIcon size={18} />,
    title: 'help.team.title',
    lines: ['help.team.1', 'help.team.2', 'help.team.3'],
    to: '/team',
    go: 'nav.mgr.workers',
  },
  {
    id: 'payroll',
    icon: <ClockIcon size={18} />,
    title: 'help.payroll.title',
    lines: ['help.payroll.1'],
    to: '/payroll',
    go: 'nav.mgr.payroll',
  },
  {
    id: 'settings',
    icon: <StoreIcon size={18} />,
    title: 'help.settings.title',
    lines: ['help.settings.1', 'help.settings.2', 'help.settings.3'],
    to: '/settings',
    go: 'nav.mgr.stores',
  },
  {
    id: 'chat',
    icon: <ChatIcon size={18} />,
    title: 'help.chat.title',
    lines: ['help.chat.1'],
    to: '/chat',
    go: 'nav.chat',
  },
]

/** The owner/manager guide: getting set up, the weekly routine, and what each
 * page is for — each section with a jump to the page it describes. */
export function Help() {
  const t = useT()
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-10 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('help.title')}</h1>
      <p className="mt-1 font-body text-sm text-muted-ink">{t('help.subtitle')}</p>

      <Card className="mt-4">
        <SectionTitle icon={<ChecklistIcon size={18} />}>{t('setup.title')}</SectionTitle>
        <ol className="mt-3 flex flex-col gap-3">
          {SETUP_STEPS.map((s, i) => (
            <li key={s.key} className="flex gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink font-heading text-[11px] font-bold text-ink">
                {i + 1}
              </span>
              <div className="min-w-0">
                <Link to={s.to} className="font-body text-sm font-bold text-ink hover:underline">
                  {t(s.title)}
                </Link>
                {s.optional && (
                  <span className="ml-1.5 rounded-full border border-ink/25 px-1.5 py-px align-middle font-body text-[9px] font-bold uppercase tracking-wide text-muted-ink">
                    {t('setup.optional')}
                  </span>
                )}
                <p className="font-body text-xs text-muted-ink">{t(s.body)}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {SECTIONS.map((s) => (
        <Card key={s.id} className="mt-3">
          <SectionTitle icon={s.icon}>{t(s.title)}</SectionTitle>
          <ul className="mt-2 flex flex-col gap-2">
            {s.lines.map((l) => (
              <li key={l} className="flex gap-2 font-body text-sm text-ink">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-green" />
                <span>{t(l)}</span>
              </li>
            ))}
          </ul>
          {s.to && s.go && (
            <Link to={s.to} className="mt-3 inline-block font-body text-xs font-bold text-sky-dark">
              {t('help.open', { page: t(s.go) })}
            </Link>
          )}
        </Card>
      ))}

      <p className="mt-6 text-center font-body text-xs text-muted-ink">
        {t('help.contact')}{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold text-sky-dark">
          {SUPPORT_EMAIL}
        </a>
      </p>
    </div>
  )
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 font-heading text-base font-extrabold text-ink">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink/20 bg-cream text-ink">
        {icon}
      </span>
      {children}
    </h2>
  )
}
