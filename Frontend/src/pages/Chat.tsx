import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ChatThread, type ThreadIO } from '../components/ChatThread'
import { Field } from '../components/Field'
import { FruitAvatar } from '../components/FruitAvatar'
import { ChatIcon } from '../components/icons'
import { Modal } from '../components/Modal'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { relativeTime } from '../lib/time'
import type { ChatMember, Conversation, DmPeer } from '../types'

type Open =
  | { kind: 'store'; storeId: number; name: string }
  | { kind: 'dm'; userId: number; name: string; avatarKey: number; avatarFruit: string | null }

const LIST_POLL_MS = 12_000

export function Chat() {
  const t = useT()
  const { user } = useAuth()
  const canMentionAll = user?.role === 'MANAGER' || user?.role === 'OWNER'
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  const [open, setOpen] = useState<Open | null>(null)
  const [picking, setPicking] = useState(false)
  const [members, setMembers] = useState<ChatMember[]>([])

  // channel roster for @-mentions — only while a store thread is open
  const storeId = open?.kind === 'store' ? open.storeId : null
  useEffect(() => {
    if (storeId == null) {
      setMembers([])
      return
    }
    let live = true
    api
      .getChatMembers(storeId)
      .then((r) => live && setMembers(r.members))
      .catch(() => live && setMembers([]))
    return () => {
      live = false
    }
  }, [storeId])

  const load = useCallback(
    () => api.getChatConversations().then((r) => setConvos(r.conversations)).catch(() => setConvos([])),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])

  // refresh the list while it's on screen
  useEffect(() => {
    if (open) return
    const h = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, LIST_POLL_MS)
    return () => clearInterval(h)
  }, [open, load])

  const back = () => {
    setOpen(null)
    void load()
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col overflow-x-hidden p-4 pb-24 sm:p-6 sm:pb-8">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate font-heading text-lg font-bold text-ink">
          {open ? open.name : t('chat.title')}
        </h1>
        {!open && (
          <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setPicking(true)}>
            {t('chat.new')}
          </Button>
        )}
      </div>

      {open ? (
        <div className="mt-3">
          {open.kind === 'store' ? (
            <ChatThread
              convKey={`s${open.storeId}`}
              onBack={back}
              onActivity={load}
              members={members}
              canMentionAll={canMentionAll}
              placeholder={t('chat.messagePlaceholder')}
              header={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-muted-ink">
                    <ChatIcon size={18} />
                  </span>
                  <span className="truncate font-heading text-sm font-bold text-ink">
                    {open.name} · {t('chat.store')}
                  </span>
                </span>
              }
              io={
                {
                  fetchPage: (o) => api.getChatMessages(open.storeId, o),
                  send: (b, mentions, mentionAll) => api.sendChatMessage(open.storeId, b, mentions, mentionAll),
                  markRead: () => api.markChatRead(open.storeId),
                } satisfies ThreadIO
              }
            />
          ) : (
            <ChatThread
              convKey={`d${open.userId}`}
              onBack={back}
              onActivity={load}
              peerName={open.name}
              placeholder={t('chat.dmPlaceholder', { name: open.name.split(' ')[0] })}
              header={
                <span className="flex min-w-0 items-center gap-2">
                  <FruitAvatar
                    kind={fruitForPerson({ employeeId: open.avatarKey, avatarFruit: open.avatarFruit })}
                    size={22}
                  />
                  <span className="truncate font-heading text-sm font-bold text-ink">{open.name}</span>
                </span>
              }
              io={
                {
                  fetchPage: (o) => api.getDmMessages(open.userId, o),
                  send: (b) => api.sendDm(open.userId, b),
                  markRead: () => api.markDmRead(open.userId),
                } satisfies ThreadIO
              }
            />
          )}
        </div>
      ) : (
        <ConversationList convos={convos} onOpen={setOpen} />
      )}

      <PeerPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false)
          setOpen({ kind: 'dm', userId: p.userId, name: p.name, avatarKey: p.avatarKey, avatarFruit: p.avatarFruit })
        }}
      />
    </div>
  )
}

function Unread({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span className="shrink-0 rounded-full bg-coral px-1.5 font-body text-[10px] font-bold text-white">
      {n > 9 ? '9+' : n}
    </span>
  )
}

function ConversationList({
  convos,
  onOpen,
}: {
  convos: Conversation[] | null
  onOpen: (o: Open) => void
}) {
  const t = useT()
  if (!convos) return <p className="mt-4 font-body text-sm text-muted-ink">{t('common.loading')}</p>
  if (convos.length === 0) {
    return <p className="mt-4 font-body text-sm text-muted-ink">{t('chat.empty')}</p>
  }
  return (
    <Card padded={false} className="mt-3 flex flex-col overflow-hidden">
      {convos.map((c) => {
        const key = c.kind === 'store' ? `s${c.storeId}` : `d${c.userId}`
        return (
          <button
            key={key}
            onClick={() =>
              onOpen(
                c.kind === 'store'
                  ? { kind: 'store', storeId: c.storeId, name: c.name }
                  : { kind: 'dm', userId: c.userId, name: c.name, avatarKey: c.avatarKey, avatarFruit: c.avatarFruit },
              )
            }
            className="flex w-full items-center gap-2.5 border-b-2 border-ink/10 px-3 py-2.5 text-left transition-colors duration-150 ease-out last:border-b-0 hover:bg-cream"
          >
            <span className="shrink-0">
              {c.kind === 'store' ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-cream text-ink">
                  <ChatIcon size={16} />
                </span>
              ) : (
                <FruitAvatar
                  kind={fruitForPerson({ employeeId: c.avatarKey, avatarFruit: c.avatarFruit })}
                  size={28}
                />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-heading text-sm font-bold text-ink">
                  {c.name}
                  {c.kind === 'store' && (
                    <span className="ml-1 font-body text-[10px] font-semibold text-muted-ink">{t('chat.store')}</span>
                  )}
                </span>
                {c.lastAt && (
                  <span className="shrink-0 whitespace-nowrap font-body text-[10px] text-muted-ink">
                    {relativeTime(c.lastAt)}
                  </span>
                )}
                <Unread n={c.unread} />
              </div>
              <div className="truncate font-body text-xs text-muted-ink">
                {c.lastMessage ?? t('chat.noMessagesYet')}
              </div>
            </div>
          </button>
        )
      })}
    </Card>
  )
}

function PeerPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (p: DmPeer) => void
}) {
  const t = useT()
  const [peers, setPeers] = useState<DmPeer[]>([])
  const [noAccount, setNoAccount] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    api
      .getDmPeers()
      .then((r) => {
        setPeers(r.peers)
        setNoAccount(r.noAccount)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  const term = q.trim().toLowerCase()
  const shown = term ? peers.filter((p) => p.name.toLowerCase().includes(term)) : peers
  const multiStore = new Set(peers.flatMap((p) => p.sharedStores)).size > 1

  return (
    <Modal open={open} onClose={onClose} sheet padded={false} className="max-h-[80vh] max-w-md overflow-hidden">
      <div className="flex items-center gap-2 border-b-2 border-ink/10 px-3 py-2.5">
        <span className="font-heading text-sm font-bold text-ink">{t('chat.newMessage')}</span>
        <button
          onClick={onClose}
          className="ml-auto rounded-full px-2 font-heading text-lg font-bold leading-none text-muted-ink hover:text-ink"
          aria-label={t('common.close')}
        >
          ×
        </button>
      </div>
      <div className="p-3">
        <Field value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('chat.searchCoworkers')} />
      </div>
      <div className="max-h-[52vh] overflow-y-auto px-2 pb-3">
        {loading ? (
          <p className="px-2 py-4 font-body text-sm text-muted-ink">{t('common.loading')}</p>
        ) : shown.length === 0 ? (
          <p className="px-2 py-4 font-body text-sm text-muted-ink">{t('chat.nobodyMatches')}</p>
        ) : (
          shown.map((p) => (
            <button
              key={p.userId}
              onClick={() => onPick(p)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-150 ease-out hover:bg-cream"
            >
              <FruitAvatar
                kind={fruitForPerson({ employeeId: p.avatarKey, avatarFruit: p.avatarFruit })}
                size={26}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-heading text-sm font-bold text-ink">{p.name}</span>
                {multiStore && p.sharedStores.length > 0 && (
                  <span className="block truncate font-body text-[11px] text-muted-ink">
                    {p.sharedStores.join(', ')}
                  </span>
                )}
              </span>
              <Unread n={p.unread} />
            </button>
          ))
        )}
        {!loading && noAccount.length > 0 && (
          <p className="mt-2 px-2 font-body text-[11px] text-muted-ink">
            {t('chat.notOnApp', { names: noAccount.join(', ') })}
          </p>
        )}
      </div>
    </Modal>
  )
}
