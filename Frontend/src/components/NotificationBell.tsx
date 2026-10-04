import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellIcon } from './icons'
import { api } from '../lib/api'
import { PUSH_RECEIVED_EVENT } from '../lib/push'
import { useT } from '../lib/i18n'
import { relativeTime } from '../lib/time'
import type { NotificationItem } from '../types'

export function NotificationBell() {
  const t = useT()
  const navigate = useNavigate()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    api
      .getNotifications()
      .then((r) => {
        setItems(r.items)
        setUnread(r.unread)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    window.addEventListener(PUSH_RECEIVED_EVENT, load)
    return () => {
      clearInterval(t)
      window.removeEventListener(PUSH_RECEIVED_EVENT, load)
    }
  }, [load])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function openItem(n: NotificationItem) {
    if (!n.readAt) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)))
      setUnread((u) => Math.max(0, u - 1))
      await api.markNotificationRead(n.id).catch(() => {})
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  async function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })))
    setUnread(0)
    await api.markAllNotificationsRead().catch(() => {})
  }

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notif.title')}
        className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-paper text-ink"
      >
        <BellIcon size={16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-ink bg-coral px-1 font-heading text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[19rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border-[2.5px] border-ink bg-paper shadow-[4px_4px_0_var(--color-ink)]">
          <div className="flex items-center justify-between border-b-2 border-ink/10 px-3 py-2">
            <span className="font-heading text-sm font-bold text-ink">{t('notif.title')}</span>
            {unread > 0 && (
              <button onClick={() => void markAll()} className="font-body text-[11px] font-bold text-sky-dark">
                {t('notif.markAll')}
              </button>
            )}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center font-body text-xs text-muted-ink">{t('notif.empty')}</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => void openItem(n)}
                  className={`flex w-full flex-col gap-0.5 border-b border-ink/10 px-3 py-2.5 text-left last:border-b-0 hover:bg-cream ${
                    n.readAt ? '' : 'bg-sky/10'
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-body text-xs font-bold text-ink">
                    {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-coral" />}
                    {n.title}
                  </span>
                  {n.body && <span className="font-body text-[11px] leading-snug text-muted-ink">{n.body}</span>}
                  <span className="font-body text-[10px] text-muted-ink">{relativeTime(n.createdAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
