import { type FormEvent, useEffect, useState } from 'react'
import { Button } from './Button'
import { Card } from './Card'
import { Field } from './Field'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import type { TimeOffRequest, TimeOffState } from '../types'

const BADGE_CLS: Record<TimeOffState, string> = {
  upcoming: 'border-sky bg-sky/10 text-sky-dark',
  active: 'border-green bg-green/10 text-green-dark',
  past: 'border-ink/25 text-muted-ink',
  cancelled: 'border-ink/25 text-muted-ink',
}
const badgeKey = (s: TimeOffState) => `timeoff.state.${s}` as const

const DAY_MS = 86_400_000
const ymd = (d: Date) => d.toISOString().slice(0, 10)
/** "Sep 15" from "YYYY-MM-DD" */
function pretty(s: string) {
  const d = new Date(`${s}T00:00:00.000Z`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function spanDays(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS) + 1
}

/** Employee: file and track vacation / leave requests (>= 1 week, >= 1 week ahead). */
export function TimeOffPanel() {
  const t = useT()
  const [rows, setRows] = useState<TimeOffRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | 'new' | null>(null)

  const [minStart] = useState(() => ymd(new Date(Date.now() + 7 * DAY_MS)))

  function refresh() {
    return api
      .getMyTimeOff()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load time off'))
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function withdraw(id: number) {
    setBusy(id)
    setError(null)
    try {
      await api.cancelTimeOff(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not withdraw')
    } finally {
      setBusy(null)
    }
  }

  if (!rows) return <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-xs text-muted-ink">{t('timeoff.intro')}</p>
      {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}

      <NewRequest
        minStart={minStart}
        busy={busy === 'new'}
        onSubmit={async (input) => {
          setBusy('new')
          setError(null)
          try {
            await api.requestTimeOff(input)
            await refresh()
            return true
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save')
            return false
          } finally {
            setBusy(null)
          }
        }}
      />

      {rows.length === 0 ? (
        <p className="font-body text-sm text-muted-ink">{t('timeoff.none')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const canCancel = r.state === 'upcoming'
            return (
              <Card key={r.id} padded={false} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-heading text-sm font-bold text-ink">
                    {pretty(r.startDate)} – {pretty(r.endDate)}
                  </span>
                  <span className="font-body text-[11px] text-muted-ink">
                    {t('timeoff.days', { n: spanDays(r.startDate, r.endDate) })}
                  </span>
                  <span
                    className={`rounded-full border px-1.5 py-px font-body text-[10px] font-bold ${BADGE_CLS[r.state]}`}
                  >
                    {t(badgeKey(r.state))}
                  </span>
                  {canCancel && (
                    <button
                      disabled={busy === r.id}
                      onClick={() => void withdraw(r.id)}
                      className="ml-auto font-body text-[11px] font-bold text-muted-ink underline"
                    >
                      {t('timeoff.withdraw')}
                    </button>
                  )}
                </div>
                {r.note && <p className="mt-1 font-body text-xs italic text-ink">“{r.note}”</p>}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NewRequest({
  minStart,
  busy,
  onSubmit,
}: {
  minStart: string
  busy: boolean
  onSubmit: (input: { startDate: string; endDate: string; note?: string }) => Promise<boolean>
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLocalErr(null)
    if (!start || !end) return setLocalErr(t('timeoff.errBothDates'))
    if (end < start) return setLocalErr(t('timeoff.errEndBeforeStart'))
    if (spanDays(start, end) < 7) return setLocalErr(t('timeoff.errTooShort'))
    if (start < minStart) return setLocalErr(t('timeoff.errTooSoon'))
    const ok = await onSubmit({ startDate: start, endDate: end, note: note.trim() || undefined })
    if (ok) {
      setStart('')
      setEnd('')
      setNote('')
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        {t('timeoff.add')}
      </Button>
    )
  }

  return (
    <Card as="form" onSubmit={submit} padded={false} className="flex flex-col gap-2 p-3">
      <Field
        label={t('timeoff.firstDay')}
        type="date"
        min={minStart}
        value={start}
        onChange={(e) => setStart(e.target.value)}
      />
      <Field
        label={t('timeoff.lastDay')}
        type="date"
        min={start || minStart}
        value={end}
        onChange={(e) => setEnd(e.target.value)}
      />
      <Field placeholder={t('timeoff.reason')} value={note} onChange={(e) => setNote(e.target.value)} />
      {localErr && <p className="font-body text-xs font-bold text-coral-dark">{localErr}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? t('common.saving') : t('timeoff.post')}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-body text-xs font-bold text-muted-ink underline"
        >
          {t('common.cancel')}
        </button>
      </div>
    </Card>
  )
}
