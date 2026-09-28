import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { FruitAvatar } from './FruitAvatar'
import { MessageList } from './MessageList'
import { useConfirm } from '../lib/confirm'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { deriveMentions } from '../lib/mentions'
import type { ChatMember, ChatMessage } from '../types'

const POLL_MS = 3000

export interface ThreadIO {
  fetchPage: (opts?: { after?: number; before?: number }) => Promise<{ messages: ChatMessage[]; hasMore: boolean }>
  send: (body: string, mentions: number[], mentionAll?: boolean) => Promise<{ message: ChatMessage }>
  markRead: () => Promise<unknown>
  /** only store channels support this — omit for DMs */
  deleteMessage?: (id: number) => Promise<unknown>
}

/** matches "@all" as a whole word — same boundary rule as lib/mentions. */
const ALL_RE = /(?:^|\s)@all(?![\p{L}\p{N}_])/iu

type MentionOption = { kind: 'all' } | { kind: 'member'; member: ChatMember }

/** One open conversation — store channel or DM. Polls while visible; resets when
 * `convKey` changes. `io` may be a fresh closure each render (read via a ref). */
export function ChatThread({
  convKey,
  io,
  header,
  peerName,
  placeholder,
  onBack,
  onActivity,
  members = [],
  canMentionAll = false,
}: {
  convKey: string
  io: ThreadIO
  header: ReactNode
  peerName?: string
  placeholder: string
  onBack: () => void
  onActivity?: () => void
  /** channel members — enables @-mentions (store threads only) */
  members?: ChatMember[]
  /** managers/owners get an "@all" option that pings the whole channel */
  canMentionAll?: boolean
}) {
  const t = useT()
  const confirm = useConfirm()
  const ioRef = useRef(io)
  const actRef = useRef(onActivity)
  useLayoutEffect(() => {
    ioRef.current = io
    actRef.current = onActivity
  })

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // @-mention autocomplete
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [menu, setMenu] = useState<{ q: string; at: number } | null>(null)
  const [menuIdx, setMenuIdx] = useState(0)
  const options: MentionOption[] = menu
    ? [
        ...(canMentionAll && 'all'.startsWith(menu.q.toLowerCase()) ? [{ kind: 'all' as const }] : []),
        ...members
          .filter((m) => m.name.toLowerCase().includes(menu.q.toLowerCase()))
          .map((member) => ({ kind: 'member' as const, member })),
      ].slice(0, 6)
    : []

  function syncMenu(el: HTMLTextAreaElement) {
    if (members.length === 0 && !canMentionAll) return
    const caret = el.selectionStart ?? el.value.length
    const m = /(?:^|\s)@(\S*)$/.exec(el.value.slice(0, caret))
    if (m) {
      setMenu({ q: m[1], at: caret - m[1].length - 1 })
      setMenuIdx(0)
    } else {
      setMenu(null)
    }
  }

  function insertMention(name: string) {
    const el = taRef.current
    const caret = el?.selectionStart ?? draft.length
    const at = menu?.at ?? caret
    const insert = `@${name} `
    const next = draft.slice(0, at) + insert + draft.slice(caret)
    setDraft(next)
    setMenu(null)
    requestAnimationFrame(() => {
      const pos = at + insert.length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  function pickOption(opt: MentionOption) {
    insertMention(opt.kind === 'all' ? 'all' : opt.member.name)
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lastId = messages.length ? messages[messages.length - 1].id : 0

  useEffect(() => {
    let live = true
    setLoading(true)
    setMessages([])
    stick.current = true
    ioRef.current
      .fetchPage()
      .then((r) => {
        if (!live) return
        setMessages(r.messages)
        setHasMore(r.hasMore)
        void ioRef.current.markRead().then(() => actRef.current?.()).catch(() => {})
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load messages'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [convKey])

  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await ioRef.current.fetchPage({ after: lastId })
        if (r.messages.length === 0) return
        setMessages((cur) => {
          const seen = new Set(cur.map((m) => m.id))
          return [...cur, ...r.messages.filter((m) => !seen.has(m.id))]
        })
        void ioRef.current.markRead().then(() => actRef.current?.()).catch(() => {})
      } catch {
        /* keep polling */
      }
    }
    const h = setInterval(tick, POLL_MS)
    return () => clearInterval(h)
  }, [convKey, lastId])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useLayoutEffect(() => {
    if (stick.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  async function deleteMessage(id: number) {
    if (!ioRef.current.deleteMessage) return
    if (!(await confirm(t('chat.confirmDeleteMessage'), { tone: 'danger', confirmLabel: t('stores.delete') }))) return
    try {
      await ioRef.current.deleteMessage(id)
      setMessages((cur) => cur.filter((m) => m.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete message')
    }
  }

  const loadEarlier = useCallback(async () => {
    if (messages.length === 0) return
    const el = scrollRef.current
    const prev = el?.scrollHeight ?? 0
    try {
      const r = await ioRef.current.fetchPage({ before: messages[0].id })
      stick.current = false
      setHasMore(r.hasMore)
      setMessages((cur) => {
        const seen = new Set(cur.map((m) => m.id))
        return [...r.messages.filter((m) => !seen.has(m.id)), ...cur]
      })
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prev
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load older messages')
    }
  }, [messages])

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const mentionAll = canMentionAll && ALL_RE.test(body)
      const { message } = await ioRef.current.send(body, deriveMentions(body, members), mentionAll)
      setDraft('')
      setMenu(null)
      stick.current = true
      setMessages((cur) => (cur.some((m) => m.id === message.id) ? cur : [...cur, message]))
      actRef.current?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border-[2.5px] border-ink bg-paper shadow-[3px_3px_0_var(--color-ink)]">
      <div className="flex items-center gap-1.5 border-b-2 border-ink/10 bg-cream px-2 py-2">
        <button
          onClick={onBack}
          aria-label={t('chat.everyone')}
          className="shrink-0 rounded-full px-2 font-heading text-xl font-bold leading-none text-ink hover:text-sky-dark"
        >
          ‹
        </button>
        {header}
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="max-h-[calc(100dvh-15rem)] min-h-[14rem] flex-1 overflow-y-auto px-3 py-3 sm:px-4"
      >
        {loading ? (
          <p className="py-8 text-center font-body text-sm text-muted-ink">{t('common.loading')}</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center font-body text-sm text-muted-ink">{t('chat.noMessages')}</p>
        ) : (
          <>
            {hasMore && (
              <div className="mb-2 text-center">
                <button
                  onClick={() => void loadEarlier()}
                  className="rounded-full border-2 border-ink/30 px-3 py-1 font-heading text-[11px] font-bold text-ink hover:border-ink"
                >
                  {t('chat.loadEarlier')}
                </button>
              </div>
            )}
            <MessageList
              messages={messages}
              peerName={peerName}
              memberNames={members.length > 0 ? [...members.map((m) => m.name), 'all'] : []}
              onDelete={io.deleteMessage ? deleteMessage : undefined}
            />
          </>
        )}
      </div>
      <div className="flex items-end gap-2 border-t-2 border-ink/10 p-2.5">
        <div className="relative flex-1">
          {options.length > 0 && (
            <ul className="absolute bottom-full left-0 z-10 mb-1 max-h-52 w-56 overflow-y-auto rounded-xl border-2 border-ink bg-paper shadow-[3px_3px_0_var(--color-ink)]">
              {options.map((opt, i) => (
                <li key={opt.kind === 'all' ? 'all' : opt.member.userId}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pickOption(opt)
                    }}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-body text-sm ${
                      i === menuIdx ? 'bg-cream' : ''
                    }`}
                  >
                    {opt.kind === 'all' ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-orange text-[11px]">
                        📣
                      </span>
                    ) : (
                      <FruitAvatar
                        kind={fruitForPerson({ employeeId: opt.member.avatarKey, avatarFruit: opt.member.avatarFruit })}
                        size={20}
                      />
                    )}
                    <span className="truncate text-ink">
                      {opt.kind === 'all' ? t('chat.mentionAll') : opt.member.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              syncMenu(e.currentTarget)
            }}
            onClick={(e) => syncMenu(e.currentTarget)}
            onKeyUp={(e) => {
              if (!['Enter', 'ArrowUp', 'ArrowDown', 'Escape', 'Tab'].includes(e.key)) {
                syncMenu(e.currentTarget)
              }
            }}
            onKeyDown={(e) => {
              if (options.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setMenuIdx((i) => (i + 1) % options.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMenuIdx((i) => (i - 1 + options.length) % options.length)
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  pickOption(options[menuIdx])
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setMenu(null)
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={1}
            placeholder={placeholder}
            className="max-h-32 min-h-[2.5rem] w-full resize-none rounded-xl border-2 border-ink bg-cream px-3 py-2 font-body text-sm text-ink outline-none focus:bg-paper"
          />
        </div>
        <Button onClick={() => void send()} disabled={sending || !draft.trim()} className="shrink-0">
          {sending ? '…' : t('common.send')}
        </Button>
      </div>
      {error && (
        <p className="border-t border-ink/10 px-3 py-1 font-body text-xs font-bold text-coral-dark">{error}</p>
      )}
    </div>
  )
}
