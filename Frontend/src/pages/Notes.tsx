import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { FruitAvatar } from '../components/FruitAvatar'
import { api } from '../lib/api'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { relativeTime } from '../lib/time'
import type { ShiftNote, ShiftNoteCategory, Store } from '../types'

const POLL_MS = 10_000
const STORE_KEY = 'fruitcrew.notesStoreId'

const CATS: { key: ShiftNoteCategory; cls: string }[] = [
  { key: 'GENERAL', cls: 'border-ink/25 bg-cream text-muted-ink' },
  { key: 'REFUND', cls: 'border-green bg-green/10 text-green-dark' },
  { key: 'COMPLAINT', cls: 'border-coral bg-coral-bg text-coral-dark' },
  { key: 'REMAKE', cls: 'border-yellow bg-yellow/10 text-ink' },
  { key: 'LOST_FOUND', cls: 'border-sky-dark bg-sky/10 text-sky-dark' },
  { key: 'STOCK', cls: 'border-orange bg-orange/10 text-ink' },
  { key: 'MAINTENANCE', cls: 'border-grape bg-grape/10 text-grape' },
]
const catOf = (k: string) => CATS.find((c) => c.key === k) ?? CATS[0]
const catKey = (k: ShiftNoteCategory) => `notes.cat.${k}` as const

/** Customer/order details only make sense to jot down for these — a refund,
 * a complaint, or a wrong order the next shift should remake. */
const DETAIL_CATS = new Set<ShiftNoteCategory>(['REFUND', 'COMPLAINT', 'REMAKE'])

const readStoreId = (): number | null => {
  try {
    return Number(localStorage.getItem(STORE_KEY)) || null
  } catch {
    return null
  }
}

export function Notes() {
  const t = useT()
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState<number | null>(null)
  const [open, setOpen] = useState<ShiftNote[]>([])
  const [done, setDone] = useState<ShiftNote[]>([])
  const [loading, setLoading] = useState(true)
  const [showDone, setShowDone] = useState(false)
  const [draft, setDraft] = useState('')
  const [cat, setCat] = useState<ShiftNoteCategory>('GENERAL')
  const [issueAt, setIssueAt] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [orderDetails, setOrderDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sidRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    sidRef.current = storeId
  })

  useEffect(() => {
    api
      .getStores()
      .then((list) => {
        setStores(list)
        const saved = readStoreId()
        setStoreId(list.find((s) => s.id === saved)?.id ?? list[0]?.id ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your stores'))
  }, [])

  const pickStore = (id: number) => {
    setStoreId(id)
    try {
      localStorage.setItem(STORE_KEY, String(id))
    } catch {
      /* ignore */
    }
  }

  const load = useCallback((sid: number, spin = false) => {
    if (spin) setLoading(true)
    return api
      .getNotes(sid)
      .then((r) => {
        if (sidRef.current !== sid) return
        setOpen(r.open)
        setDone(r.recentlyDone)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load notes'))
      .finally(() => spin && setLoading(false))
  }, [])

  useEffect(() => {
    if (storeId == null) return
    void load(storeId, true)
    const h = setInterval(() => {
      if (document.visibilityState === 'visible' && sidRef.current != null) void load(sidRef.current)
    }, POLL_MS)
    return () => clearInterval(h)
  }, [storeId, load])

  async function add() {
    const body = draft.trim()
    if (!body || busy || storeId == null) return
    setBusy(true)
    setError(null)
    try {
      const { note } = await api.addNote({
        storeId,
        body,
        category: cat,
        ...(DETAIL_CATS.has(cat) && issueAt ? { issueAt: new Date(issueAt).toISOString() } : {}),
        ...(DETAIL_CATS.has(cat) && customerName.trim() ? { customerName: customerName.trim() } : {}),
        ...(DETAIL_CATS.has(cat) && customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
        ...(DETAIL_CATS.has(cat) && orderDetails.trim() ? { orderDetails: orderDetails.trim() } : {}),
      })
      setOpen((cur) => [note, ...cur])
      setDraft('')
      setCat('GENERAL')
      setIssueAt('')
      setCustomerName('')
      setCustomerPhone('')
      setOrderDetails('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add note')
    } finally {
      setBusy(false)
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      if (storeId != null) await load(storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col p-4 pb-24 sm:p-6 sm:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-lg font-bold text-ink">{t('notes.title')}</h1>
        {stores.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {stores.map((s) => (
              <button
                key={s.id}
                onClick={() => pickStore(s.id)}
                className={`rounded-full border-2 border-ink px-2.5 py-1 font-heading text-xs font-bold ${
                  s.id === storeId ? 'bg-ink text-white' : 'bg-paper text-ink'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 mb-3 font-body text-xs text-muted-ink">{t('notes.subtitle')}</p>

      {/* composer */}
      <div className="rounded-2xl border-[2.5px] border-ink bg-paper p-2.5 shadow-[3px_3px_0_var(--color-ink)]">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={t('notes.placeholder')}
          className="w-full resize-none rounded-xl border-2 border-ink bg-cream px-3 py-2 font-body text-sm text-ink outline-none focus:bg-paper"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {CATS.map((c) => (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`rounded-full border-2 px-2 py-0.5 font-body text-[11px] font-bold ${
                cat === c.key ? c.cls : 'border-ink/15 text-muted-ink'
              }`}
            >
              {t(catKey(c.key))}
            </button>
          ))}
          <Button
            onClick={() => void add()}
            disabled={busy || !draft.trim()}
            className="ml-auto shrink-0"
          >
            {busy ? '…' : t('common.post')}
          </Button>
        </div>

        {DETAIL_CATS.has(cat) && (
          <div className="mt-2 flex flex-col gap-1.5 border-t-2 border-ink/10 pt-2">
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder={t('notes.details.customerName')}
                className="rounded-lg border-2 border-ink/20 bg-cream px-2 py-1 font-body text-xs text-ink outline-none focus:bg-paper"
              />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder={t('notes.details.customerPhone')}
                className="rounded-lg border-2 border-ink/20 bg-cream px-2 py-1 font-body text-xs text-ink outline-none focus:bg-paper"
              />
            </div>
            <input
              type="text"
              value={orderDetails}
              onChange={(e) => setOrderDetails(e.target.value)}
              placeholder={t('notes.details.order')}
              className="rounded-lg border-2 border-ink/20 bg-cream px-2 py-1 font-body text-xs text-ink outline-none focus:bg-paper"
            />
            <label className="flex items-center gap-1.5 font-body text-[11px] text-muted-ink">
              {t('notes.details.issueAt')}
              <input
                type="datetime-local"
                value={issueAt}
                onChange={(e) => setIssueAt(e.target.value)}
                className="rounded-lg border-2 border-ink/20 bg-cream px-2 py-1 font-body text-xs text-ink outline-none focus:bg-paper"
              />
            </label>
          </div>
        )}
      </div>

      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {loading ? (
        <p className="mt-4 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : open.length === 0 ? (
        <p className="mt-4 font-body text-sm text-muted-ink">{t('notes.allClear')}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {open.map((n) => (
            <NoteCard key={n.id} n={n} onResolve={() => act(() => api.resolveNote(n.id, true))} onDelete={() => act(() => api.deleteNote(n.id))} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowDone((v) => !v)}
            className="font-body text-[11px] font-bold text-sky-dark"
          >
            {showDone ? `${t('notes.hideDone')} ▴` : `${t('notes.recentlyDone', { n: done.length })} ▾`}
          </button>
          {showDone && (
            <div className="mt-2 flex flex-col gap-2">
              {done.map((n) => (
                <NoteCard
                  key={n.id}
                  n={n}
                  onReopen={() => act(() => api.resolveNote(n.id, false))}
                  onDelete={() => act(() => api.deleteNote(n.id))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NoteCard({
  n,
  onResolve,
  onReopen,
  onDelete,
}: {
  n: ShiftNote
  onResolve?: () => void
  onReopen?: () => void
  onDelete: () => void
}) {
  const t = useT()
  const c = catOf(n.category)
  const resolved = !!n.resolvedAt
  return (
    <div
      className={`rounded-2xl border-[2.5px] border-ink p-3 shadow-[3px_3px_0_var(--color-ink)] ${
        resolved ? 'bg-cream/60' : 'bg-paper'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <FruitAvatar
          kind={fruitForPerson({ employeeId: n.authorKey, avatarFruit: n.authorFruit })}
          size={26}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {n.category !== 'GENERAL' && (
              <span className={`rounded-full border-2 px-1.5 py-px font-body text-[10px] font-bold ${c.cls}`}>
                {t(catKey(n.category))}
              </span>
            )}
            <span className="font-body text-[11px] font-bold text-muted-ink">
              {n.mine ? t('common.you') : n.authorName.split(' ')[0]} · {relativeTime(n.createdAt)}
            </span>
          </div>
          <p
            className={`mt-1 whitespace-pre-wrap break-words font-body text-sm ${
              resolved ? 'text-muted-ink line-through' : 'text-ink'
            }`}
          >
            {n.body}
          </p>
          {(n.customerName || n.customerPhone || n.orderDetails || n.issueAt) && (
            <div className="mt-1.5 flex flex-col gap-0.5 rounded-lg border-2 border-ink/10 bg-cream/60 px-2 py-1.5 font-body text-[11px] text-muted-ink">
              {(n.customerName || n.customerPhone) && (
                <span>
                  {n.customerName}
                  {n.customerName && n.customerPhone ? ' · ' : ''}
                  {n.customerPhone}
                </span>
              )}
              {n.orderDetails && <span>{t('notes.details.orderLabel', { order: n.orderDetails })}</span>}
              {n.issueAt && <span>{t('notes.details.issueAtLabel', { ago: relativeTime(n.issueAt) })}</span>}
            </div>
          )}
          {resolved && n.resolvedName && (
            <p className="mt-0.5 font-body text-[11px] text-muted-ink">
              {t('notes.doneBy', {
                name: n.resolvedName.split(' ')[0],
                ago: relativeTime(n.resolvedAt!),
              })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {onResolve && (
            <button
              onClick={onResolve}
              className="rounded-full border-2 border-green bg-green px-2.5 py-0.5 font-heading text-[11px] font-bold text-white"
            >
              {t('notes.markDone')}
            </button>
          )}
          {onReopen && (
            <button
              onClick={onReopen}
              className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink"
            >
              {t('notes.reopen')}
            </button>
          )}
          <button
            onClick={onDelete}
            className="font-body text-[11px] font-bold text-muted-ink underline"
          >
            {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
