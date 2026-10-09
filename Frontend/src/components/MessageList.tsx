import { FruitAvatar } from './FruitAvatar'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { segmentMentions } from '../lib/mentions'
import type { ChatMessage } from '../types'

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date()
  yest.setDate(yest.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

/** Chat/DM message stream: day dividers, grouped runs, own messages right-aligned.
 * `peerName` (DM mode) labels the other person's messages; otherwise the message's
 * own `authorName` is used. */
export function MessageList({
  messages,
  peerName,
  memberNames = [],
  onDelete,
  onReport,
  canModerate = false,
}: {
  messages: ChatMessage[]
  peerName?: string
  /** channel member names, for highlighting @-mentions in the transcript */
  memberNames?: string[]
  /** lets the viewer delete their own messages — omitted where that's not supported (DMs) */
  onDelete?: (id: number) => void
  /** lets the viewer flag someone else's message */
  onReport?: (id: number) => void
  /** a manager of this store — can also delete other people's messages (with onDelete) */
  canModerate?: boolean
}) {
  const t = useT()
  return (
    <>
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const showDay = !prev || !sameDay(prev.createdAt, m.createdAt)
        const grouped =
          !!prev &&
          !showDay &&
          prev.authorKey === m.authorKey &&
          prev.mine === m.mine &&
          new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000
        const who = m.mine ? 'You' : peerName ?? m.authorName
        return (
          <div key={m.id}>
            {showDay && (
              <div className="my-2 flex items-center gap-2">
                <div className="h-px flex-1 bg-ink/10" />
                <span className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
                  {dayLabel(m.createdAt)}
                </span>
                <div className="h-px flex-1 bg-ink/10" />
              </div>
            )}
            <div className={`flex gap-2 ${grouped ? 'mt-0.5' : 'mt-2.5'} ${m.mine ? 'flex-row-reverse' : ''}`}>
              <div className="w-7 shrink-0">
                {!grouped && (
                  <FruitAvatar
                    kind={fruitForPerson({ employeeId: m.authorKey, avatarFruit: m.authorFruit })}
                    size={26}
                  />
                )}
              </div>
              <div className={`flex min-w-0 max-w-[78%] flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
                {!grouped && (
                  <span className="mb-0.5 font-body text-[11px] font-bold text-muted-ink">
                    {who} · {clock(m.createdAt)}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  {m.mine && onDelete && (
                    <button
                      onClick={() => onDelete(m.id)}
                      aria-label={t('chat.deleteMessage')}
                      title={t('chat.deleteMessage')}
                      className="shrink-0 rounded-full px-1 font-body text-xs font-bold leading-none text-muted-ink hover:text-coral-dark"
                    >
                      ×
                    </button>
                  )}
                  <span
                    className={`whitespace-pre-wrap break-words rounded-2xl border-2 px-3 py-1.5 font-body text-sm ${
                      m.mentionsMe
                        ? 'border-sky-dark bg-sky/25 text-ink'
                        : m.mine
                          ? 'border-ink bg-sky text-ink'
                          : 'border-ink bg-cream text-ink'
                    }`}
                  >
                    {segmentMentions(m.body, memberNames).map((seg, si) =>
                      seg.mention ? (
                        <span
                          key={si}
                          className={`font-bold ${m.mine ? 'underline decoration-2' : 'text-sky-dark'}`}
                        >
                          {seg.text}
                        </span>
                      ) : (
                        <span key={si}>{seg.text}</span>
                      ),
                    )}
                  </span>
                  {!m.mine && onReport && (
                    <button
                      onClick={() => onReport(m.id)}
                      aria-label={t('chat.report')}
                      title={t('chat.report')}
                      className="shrink-0 rounded-full px-1 font-body text-[11px] leading-none text-muted-ink/60 hover:text-coral-dark"
                    >
                      ⚑
                    </button>
                  )}
                  {!m.mine && canModerate && onDelete && (
                    <button
                      onClick={() => onDelete(m.id)}
                      aria-label={t('chat.deleteMessage')}
                      title={t('chat.deleteMessage')}
                      className="shrink-0 rounded-full px-1 font-body text-xs font-bold leading-none text-muted-ink hover:text-coral-dark"
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
