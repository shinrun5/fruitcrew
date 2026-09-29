import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { ChatIcon, ChecklistIcon, ClockIcon, HelpIcon, NoteIcon, StoreIcon, UserIcon } from '../components/icons'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { useChatUnread } from '../lib/use-chat-unread'
import { useNotesCount } from '../lib/use-notes-count'
import { getViewMode } from '../lib/viewMode'

interface Item {
  to: string
  icon: ReactNode
  label: string
  hint?: string
  count?: number
}

/** Everything that didn't earn a bottom-bar tab. Same page for both views,
 * with each view's own set of links. */
export function More() {
  const t = useT()
  const { user } = useAuth()
  const unread = useChatUnread()
  const notes = useNotesCount()
  const workView = user?.role === 'EMPLOYEE' || getViewMode() === 'work'
  const [tracksClosing, setTracksClosing] = useState(false)

  useEffect(() => {
    if (!workView) return
    api
      .getStores()
      .then((s) => setTracksClosing(s.some((x) => x.tracksClosingDuties)))
      .catch(() => {})
  }, [workView])

  const items: Item[] = workView
    ? [
        { to: '/notes', icon: <NoteIcon size={20} />, label: t('nav.notes'), hint: t('more.notesHint'), count: notes },
        ...(tracksClosing
          ? [{ to: '/closing', icon: <ChecklistIcon size={20} />, label: t('more.closing'), hint: t('more.closingHint') }]
          : []),
        { to: '/profile', icon: <UserIcon size={20} />, label: t('nav.profile'), hint: t('more.profileHint') },
      ]
    : [
        { to: '/chat', icon: <ChatIcon size={20} />, label: t('nav.chat'), hint: t('more.chatHint'), count: unread },
        { to: '/notes', icon: <NoteIcon size={20} />, label: t('nav.notes'), hint: t('more.notesHint'), count: notes },
        { to: '/payroll', icon: <ClockIcon size={20} />, label: t('nav.mgr.payroll'), hint: t('more.payrollHint') },
        { to: '/settings', icon: <StoreIcon size={20} />, label: t('nav.mgr.stores'), hint: t('more.storesHint') },
        { to: '/account', icon: <UserIcon size={20} />, label: t('more.account'), hint: t('more.accountHint') },
        { to: '/help', icon: <HelpIcon size={20} />, label: t('help.title'), hint: t('more.helpHint') },
      ]

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('nav.more')}</h1>
      <Card padded={false} className="mt-3 overflow-hidden">
        <ul className="divide-y-2 divide-ink/10">
          {items.map((it) => (
            <li key={it.to}>
              <Link
                to={it.to}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 ease-out hover:bg-cream active:bg-cream"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink/20 bg-cream text-ink">
                  {it.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-heading text-sm font-bold text-ink">{it.label}</span>
                  {it.hint && <span className="block font-body text-xs text-muted-ink">{it.hint}</span>}
                </span>
                {!!it.count && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-coral px-1.5 font-body text-[11px] font-bold text-white">
                    {it.count > 9 ? '9+' : it.count}
                  </span>
                )}
                <span aria-hidden className="font-heading text-lg text-muted-ink">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
