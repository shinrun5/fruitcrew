import { useEffect, useMemo, useState } from 'react'
import { Button } from './Button'
import { Card } from './Card'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS } from '../lib/time'
import type { DayHours, DayOfWeek } from '../types'

export interface AvailWindow {
  day: DayOfWeek
  start: string // "HH:MM" 24h
  end: string
}

interface Row extends AvailWindow {
  key: string
}

const newKey = () => Math.random().toString(36).slice(2)

/** normalized, comparable snapshot of the current windows */
function signature(rows: Row[]): string {
  return JSON.stringify(rows.map((r) => `${r.day} ${r.start} ${r.end}`).sort())
}

/** Weekly-availability editor. `load`/`save` decide whether it edits the standing
 * set (/availability/mine) or a one-week override. `barClass` is the sticky save
 * bar's bottom offset — clear the bottom tab bar on phones. The page wrapping
 * this must leave matching bottom padding so the last row isn't covered. */
export function AvailabilityEditor({
  barClass,
  load,
  save,
  idleText,
  hoursByDay,
}: {
  barClass: string
  load: () => Promise<AvailWindow[]>
  save: (windows: AvailWindow[]) => Promise<AvailWindow[]>
  idleText: string
  /** the store's resolved hours per weekday — drives the quick-add buttons */
  hoursByDay?: Partial<Record<DayOfWeek, DayHours>>
}) {
  const t = useT()
  const [rows, setRows] = useState<Row[]>([])
  const [savedSig, setSavedSig] = useState('[]')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    let live = true
    load()
      .then((windows) => {
        if (!live) return
        const loaded = windows.map<Row>((w) => ({ key: newKey(), day: w.day, start: w.start, end: w.end }))
        setRows(loaded)
        setSavedSig(signature(loaded))
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load your availability'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [load])

  const invalidKeys = useMemo(
    () => new Set(rows.filter((r) => r.start >= r.end).map((r) => r.key)),
    [rows],
  )
  const dirty = signature(rows) !== savedSig
  const canSave = dirty && invalidKeys.size === 0 && !saving

  function pushRow(day: DayOfWeek, start: string, end: string) {
    setRows((rs) => [...rs, { key: newKey(), day, start, end }])
    setJustSaved(false)
  }

  const hoursFor = (day: DayOfWeek): DayHours =>
    hoursByDay?.[day] ?? { open: '09:00', close: '21:00', night: { start: '17:00', end: '21:00' }, closed: false }

  function addRow(day: DayOfWeek) {
    const prev = rows.filter((r) => r.day === day).at(-1)
    const start = prev ? prev.end : hoursFor(day).open
    const [h] = start.split(':').map(Number)
    const end = `${String(Math.min((h ?? 17) + 4, 23)).padStart(2, '0')}:00`
    pushRow(day, start, end > start ? end : '23:00')
  }

  function addAllDay(day: DayOfWeek) {
    const d = hoursFor(day)
    pushRow(day, d.open, d.close)
  }

  function addNight(day: DayOfWeek) {
    const n = hoursFor(day).night
    pushRow(day, n.start, n.end)
  }
  function patchRow(key: string, patch: Partial<Pick<Row, 'start' | 'end'>>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setJustSaved(false)
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key))
    setJustSaved(false)
  }

  async function persist() {
    setSaving(true)
    setError(null)
    try {
      const saved = await save(rows.map((r) => ({ day: r.day, start: r.start, end: r.end })))
      const fresh = saved.map<Row>((w) => ({ key: newKey(), day: w.day, start: w.start, end: w.end }))
      setRows(fresh)
      setSavedSig(signature(fresh))
      setJustSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const status = error
    ? { text: error, tone: 'text-coral-dark' }
    : invalidKeys.size > 0
      ? { text: t('avail.fixTimes'), tone: 'text-coral-dark' }
      : dirty
        ? { text: t('avail.unsaved'), tone: 'text-ink' }
        : justSaved
          ? { text: t('common.saved'), tone: 'text-green-dark' }
          : { text: idleText, tone: 'text-muted-ink' }
  const showSave = dirty || saving || invalidKeys.size > 0

  const timeInput =
    'w-[6.75rem] shrink-0 rounded-lg border-2 bg-cream px-1.5 py-1 font-body text-[13px] text-ink outline-none transition-colors duration-150 ease-out sm:w-[7rem] sm:px-2 sm:text-sm'

  if (loading) return <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>

  return (
    <>
      <Card padded={false} className="overflow-hidden">
        {DAYS.map((day) => {
          const dayRows = rows.filter((r) => r.day === day)
          const storeClosed = hoursByDay?.[day]?.closed
          return (
            <div
              key={day}
              className="flex gap-2.5 border-b-2 border-ink/10 px-2.5 py-2.5 last:border-b-0 sm:gap-3 sm:px-3"
            >
              <span className="w-8 shrink-0 pt-1.5 font-heading text-sm font-bold text-ink">
                {DAY_LABEL[day]}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {dayRows.length === 0 && (
                  <span className="font-body text-xs text-muted-ink">
                    {storeClosed ? t('avail.storeClosed') : t('avail.notAvailable')}
                  </span>
                )}
                {dayRows.map((r) => {
                  const bad = invalidKeys.has(r.key)
                  return (
                    <span key={r.key} className="flex flex-wrap items-center gap-x-1 gap-y-1">
                      <input
                        type="time"
                        value={r.start}
                        step={1800}
                        onChange={(e) => patchRow(r.key, { start: e.target.value })}
                        className={`${timeInput} ${bad ? 'border-coral' : 'border-ink'}`}
                      />
                      <span className="font-body text-xs text-muted-ink">–</span>
                      <input
                        type="time"
                        value={r.end}
                        step={1800}
                        onChange={(e) => patchRow(r.key, { end: e.target.value })}
                        className={`${timeInput} ${bad ? 'border-coral' : 'border-ink'}`}
                      />
                      <button
                        onClick={() => removeRow(r.key)}
                        aria-label={t('avail.remove')}
                        className="rounded-full px-1 font-heading text-base font-bold leading-none text-muted-ink hover:text-coral-dark"
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
                <div className="flex flex-wrap gap-1.5">
                  {!storeClosed && (
                    <button
                      onClick={() => addAllDay(day)}
                      className="rounded-full border-2 border-ink/30 px-2.5 py-1 font-heading text-[11px] font-bold text-green-dark transition-colors duration-150 ease-out hover:border-ink"
                    >
                      {t('avail.addAllDay')}
                    </button>
                  )}
                  {!storeClosed && (
                    <button
                      onClick={() => addNight(day)}
                      className="rounded-full border-2 border-ink/30 px-2.5 py-1 font-heading text-[11px] font-bold text-grape transition-colors duration-150 ease-out hover:border-ink"
                    >
                      {t('avail.addNight')}
                    </button>
                  )}
                  <button
                    onClick={() => addRow(day)}
                    className="rounded-full border-2 border-ink/30 px-2.5 py-1 font-heading text-[11px] font-bold text-sky-dark transition-colors duration-150 ease-out hover:border-ink"
                  >
                    {t('avail.addHours')}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </Card>

      <div
        className={`sticky z-20 flex items-center gap-2 rounded-2xl border-[2.5px] border-ink px-3 py-2 shadow-[3px_3px_0_var(--color-ink)] transition-colors sm:px-4 sm:py-2.5 ${barClass} ${
          dirty || invalidKeys.size > 0 || error ? 'bg-coral-bg' : 'bg-paper'
        } ${showSave ? 'justify-between' : 'justify-center'}`}
      >
        <span className={`min-w-0 flex-1 truncate font-body text-xs font-bold ${status.tone}`}>
          {status.text}
        </span>
        {showSave && (
          <Button onClick={() => void persist()} disabled={!canSave} className="shrink-0">
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        )}
      </div>
    </>
  )
}
