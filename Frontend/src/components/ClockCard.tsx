import { useCallback, useEffect, useState } from 'react'
import { ClockIcon } from './icons'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { hapticSuccess } from '../lib/haptics'
import { useT } from '../lib/i18n'
import { stampMinutes, stampTime, workedMinutes } from '../lib/timeClock'
import { durationLabel } from '../lib/time'
import { useRefreshOnReturn } from '../lib/use-refresh-on-return'
import type { ClockStatus } from '../types'

/** Clocking in and out, on top of My Shifts — only where a store has the
 * FruitCrew time clock on (Settings › Time clock); nothing at all otherwise. */
export function ClockCard({ preferStoreId }: { preferStoreId?: number | null }) {
  const t = useT()
  const confirm = useConfirm()
  const [status, setStatus] = useState<ClockStatus | null>(null)
  // whole minutes since it was read, so the running time keeps counting between reads
  const [since, setSince] = useState(0)
  const [storeId, setStoreId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      api
        .getClock()
        .then((s) => {
          setStatus(s)
          setSince(0)
        })
        .catch(() => {}),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])
  useRefreshOnReturn(load)
  useEffect(() => {
    if (!status?.open) return
    const readAt = Date.now()
    const h = setInterval(() => setSince(Math.floor((Date.now() - readAt) / 60_000)), 30_000)
    return () => clearInterval(h)
  }, [status])

  if (!status || (status.stores.length === 0 && !status.open)) return null

  // the stores' clock now: what the server said, plus however long since
  const nowMin = stampMinutes(status.now) + since
  const nowStamp = new Date(nowMin * 60_000).toISOString().slice(0, 16)
  const open = status.open
  const pick =
    storeId ??
    (status.stores.some((s) => s.storeId === preferStoreId) ? preferStoreId! : status.stores[0]?.storeId ?? null)
  const doneToday = status.today.reduce((n, e) => n + workedMinutes(e), 0)

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      hapticSuccess()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('clock.err'))
    } finally {
      setBusy(false)
    }
  }

  const btn = 'rounded-full border-2 border-ink px-3.5 py-1.5 font-heading text-xs font-bold disabled:opacity-50'
  return (
    <div
      className={`mt-3 flex flex-col gap-2 rounded-2xl border-[2.5px] border-ink p-3 shadow-[3px_3px_0_var(--color-ink)] ${
        open ? (open.onBreakSince ? 'bg-orange/15' : 'bg-green/15') : 'bg-paper'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-ink">
          <ClockIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-heading text-sm font-bold text-ink">
            {!open
              ? t('clock.off')
              : open.onBreakSince
                ? t('clock.onBreak', { time: stampTime(open.onBreakSince) })
                : t('clock.on', { time: stampTime(open.clockIn) })}
          </div>
          <div className="font-body text-[11px] text-muted-ink">
            {open
              ? workedMinutes(open, nowStamp) < 1 && !open.onBreakSince
                ? t('clock.justIn')
                : t('clock.soFar', { time: durationLabel(workedMinutes(open, nowStamp)) })
              : doneToday > 0
                ? t('clock.today', { time: durationLabel(doneToday) })
                : t('clock.offHint')}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!open ? (
          <>
            {status.stores.length > 1 && (
              <select
                value={pick ?? ''}
                onChange={(e) => setStoreId(Number(e.target.value))}
                aria-label={t('clock.where')}
                className="min-w-0 max-w-[12rem] rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none"
              >
                {status.stores.map((s) => (
                  <option key={s.storeId} value={s.storeId}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <button
              disabled={busy || pick == null}
              onClick={() => pick != null && void act(() => api.clockIn(pick))}
              className={`${btn} bg-green text-white`}
            >
              {t('clock.in')}
            </button>
          </>
        ) : (
          <>
            <button
              disabled={busy}
              onClick={() => void act(() => api.setBreak(!open.onBreakSince))}
              className={`${btn} bg-paper text-ink`}
            >
              {open.onBreakSince ? t('clock.breakEnd') : t('clock.breakStart')}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void confirm(t('clock.outConfirm'), { confirmLabel: t('clock.out') }).then((ok) => {
                  if (ok) void act(() => api.clockOut())
                })
              }
              className={`${btn} bg-ink text-white`}
            >
              {t('clock.out')}
            </button>
          </>
        )}
      </div>
      {error && <span className="font-body text-[11px] font-bold text-coral-dark">{error}</span>}
    </div>
  )
}
