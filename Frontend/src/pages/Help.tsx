import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { Disclosure } from '../components/Disclosure'
import { SETUP_STEPS } from '../components/GettingStarted'
import { CalendarIcon, ChatIcon, ChecklistIcon, ClockIcon, PencilIcon, PeopleIcon, StoreIcon, SwapIcon } from '../components/icons'
import { useT } from '../lib/i18n'
import { useAddon } from '../lib/addons'
import { SUPPORT_EMAIL } from '../lib/links'

type TKey = Parameters<ReturnType<typeof useT>>[0]

// Each section: what it's about, a few plain lines, and a jump to where it happens.
const SECTIONS: { id: string; icon: ReactNode; title: TKey; summary: TKey; lines: TKey[]; to?: string; go?: TKey }[] = [
  {
    id: 'week',
    icon: <CalendarIcon size={20} />,
    title: 'help.week.title',
    summary: 'help.week.summary',
    lines: ['help.week.1', 'help.week.2', 'help.week.3', 'help.week.4'],
    to: '/schedule',
    go: 'nav.mgr.schedule',
  },
  {
    id: 'edit',
    icon: <PencilIcon size={20} />,
    title: 'help.edit.title',
    summary: 'help.edit.summary',
    lines: ['help.edit.1', 'help.edit.2', 'help.edit.3', 'help.edit.4', 'help.edit.5'],
    to: '/schedule',
    go: 'nav.mgr.schedule',
  },
  {
    id: 'requests',
    icon: <SwapIcon size={20} />,
    title: 'help.requests.title',
    summary: 'help.requests.summary',
    lines: ['help.requests.1', 'help.requests.2'],
    to: '/requests',
    go: 'nav.mgr.requests',
  },
  {
    id: 'team',
    icon: <PeopleIcon size={20} />,
    title: 'help.team.title',
    summary: 'help.team.summary',
    lines: ['help.team.1', 'help.team.2', 'help.team.3'],
    to: '/team',
    go: 'nav.mgr.workers',
  },
  {
    id: 'payroll',
    icon: <ClockIcon size={20} />,
    title: 'help.payroll.title',
    summary: 'help.payroll.summary',
    lines: ['help.payroll.1'],
    to: '/payroll',
    go: 'nav.mgr.payroll',
  },
  {
    id: 'clock',
    icon: <ClockIcon size={20} />,
    title: 'help.clock.title',
    summary: 'help.clock.summary',
    lines: ['help.clock.1', 'help.clock.2'],
    to: '/payroll/timesheets',
    go: 'timesheet.title',
  },
  {
    id: 'settings',
    icon: <StoreIcon size={20} />,
    title: 'help.settings.title',
    summary: 'help.settings.summary',
    lines: ['help.settings.1', 'help.settings.2', 'help.settings.3'],
    to: '/settings',
    go: 'nav.mgr.stores',
  },
  {
    id: 'chat',
    icon: <ChatIcon size={20} />,
    title: 'help.chat.title',
    summary: 'help.chat.summary',
    lines: ['help.chat.1'],
    to: '/chat',
    go: 'nav.chat',
  },
]

/** The owner/manager guide: getting set up, the weekly routine, and what each
 * page is for. Every topic is one row with a one-line summary, folded until
 * tapped, so the whole guide reads like a table of contents. */
export function Help() {
  const t = useT()
  // the Chat & Notes section only for a business that has either add-on
  const chatOn = useAddon('chat')
  const notesOn = useAddon('notes')
  const [open, setOpen] = useState<string | null>(null)
  const fold = (id: string) => ({ open: open === id, onToggle: () => setOpen(open === id ? null : id) })
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-10 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('help.title')}</h1>
      <p className="mt-1 font-body text-sm text-muted-ink">{t('help.subtitle')}</p>

      <Card padded={false} className="mt-4 overflow-hidden">
        <Disclosure
          icon={<ChecklistIcon size={20} />}
          title={t('setup.title')}
          summary={t('help.setup.summary')}
          {...fold('setup')}
        >
          <ol className="flex flex-col gap-3">
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
        </Disclosure>

        {SECTIONS.filter((s) => s.id !== 'chat' || chatOn || notesOn).map((s) => (
          <Disclosure key={s.id} icon={s.icon} title={t(s.title)} summary={t(s.summary)} {...fold(s.id)}>
            <ul className="flex flex-col gap-2.5">
              {s.lines.map((l) => (
                <li key={l} className="flex gap-2 font-body text-sm leading-relaxed text-ink">
                  <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-green" />
                  <span>{t(l)}</span>
                </li>
              ))}
            </ul>
            {s.to && s.go && (
              <Link
                to={s.to}
                className="mt-3 inline-block rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink"
              >
                {t('help.open', { page: t(s.go) })}
              </Link>
            )}
          </Disclosure>
        ))}
      </Card>

      <p className="mt-6 text-center font-body text-xs text-muted-ink">
        {t('help.contact')}{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold text-sky-dark">
          {SUPPORT_EMAIL}
        </a>
      </p>
    </div>
  )
}
