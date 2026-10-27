import { useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { dateRangeLabel } from '../lib/time'
import {
  type ColumnMap,
  type Field,
  detectColumns,
  mapComplete,
  matchPerson,
  parseCsv,
  readRows,
} from '../lib/timeImport'
import type { Timesheet } from '../types'

type Parsed = { rows: string[][]; headerRow: number; headers: string[] }
type Result = { added: number; updated: number; unchanged: number; skipped: number }
const CHUNK = 400
const SKIP = -1

/** Bringing in hours from the store's POS: pick its time-entries export,
 * check who's who, import. Columns and names are matched on their own where
 * they can be; anything that can't, the manager picks once (names are
 * remembered for next time). */
export function TimeImport({
  storeId,
  storeName,
  people,
  onDone,
}: {
  storeId: number
  /** an export covering several locations starts on the one named like this store */
  storeName: string
  people: Timesheet['people']
  onDone: (range: { from: string; to: string } | null) => void
}) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [map, setMap] = useState<ColumnMap>({})
  const [location, setLocation] = useState<string | null>(null)
  // export name → person id (SKIP = leave out), for names that didn't match on their own
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  async function readFile(file: File) {
    setError(null)
    setResult(null)
    const rows = parseCsv(await file.text())
    if (rows.length < 2) {
      setError(t('timesheet.import.empty'))
      return
    }
    const d = detectColumns(rows)
    setParsed({ rows, headerRow: d.headerRow, headers: d.headers })
    setMap(d.map)
    setPicked({})
    setLocation(null)
  }

  const all = useMemo(
    () => (parsed && mapComplete(map) ? readRows(parsed.rows, parsed.headerRow, parsed.headers, map) : []),
    [parsed, map],
  )
  const locations = [...new Set(all.map((r) => r.location).filter((l): l is string => !!l))].sort()
  const sameName = locations.find((l) => l.trim().toLowerCase() === storeName.trim().toLowerCase())
  const where = locations.length > 1 ? (location ?? sameName ?? locations[0]!) : null
  const rows = where ? all.filter((r) => r.location === where) : all
  const names = [...new Set(rows.map((r) => r.name))].sort()
  const auto = new Map(names.map((n) => [n, matchPerson(n, people)]))
  const who = (n: string) => picked[n] ?? auto.get(n) ?? null
  const unmatched = names.filter((n) => auto.get(n) == null)
  const ready = rows.filter((r) => r.clockIn && r.clockOut && (who(r.name) ?? SKIP) !== SKIP)
  const stillOn = rows.filter((r) => r.clockIn && !r.clockOut).length
  const unreadable = rows.filter((r) => !r.clockIn).length
  const days = ready.map((r) => r.clockIn!.slice(0, 10)).sort()
  const range = days.length ? { from: days[0]!, to: days[days.length - 1]! } : null

  async function runImport() {
    setBusy(true)
    setError(null)
    try {
      const payload = ready.map((r) => ({ employeeId: who(r.name)!, clockIn: r.clockIn!, clockOut: r.clockOut!, breakMinutes: r.breakMinutes }))
      // remember the names someone had to pick, so next time they match on their own
      const remember = unmatched
        .filter((n) => (picked[n] ?? SKIP) !== SKIP)
        .map((n) => ({ employeeId: picked[n]!, name: n }))
      const total: Result = { added: 0, updated: 0, unchanged: 0, skipped: 0 }
      for (let i = 0; i < payload.length; i += CHUNK) {
        const r = await api.importTime({ storeId, rows: payload.slice(i, i + CHUNK), ...(i === 0 ? { names: remember } : {}) })
        total.added += r.added
        total.updated += r.updated
        total.unchanged += r.unchanged
        total.skipped += r.skipped
      }
      setResult(total)
      setParsed(null)
      onDone(range)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('timesheet.import.err'))
    } finally {
      setBusy(false)
    }
  }

  const select = 'min-w-0 max-w-full rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none'
  const label = 'flex flex-wrap items-center gap-1.5 font-body text-[11px] font-bold text-muted-ink'
  const columnPick = (field: Field, text: string) => (
    <label key={field} className={label}>
      {text}
      <select
        value={map[field] ?? ''}
        onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value === '' ? undefined : Number(e.target.value) }))}
        className={select}
      >
        <option value="">—</option>
        {parsed!.headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `#${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="flex flex-col gap-2.5">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void readFile(f)
        }}
      />
      {!parsed && (
        <button
          onClick={() => fileRef.current?.click()}
          className="self-start rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-xs font-bold text-white"
        >
          {t('timesheet.import.pick')}
        </button>
      )}
      {result && (
        <p className="font-body text-xs font-bold text-green-dark">
          {t('timesheet.import.done', { added: result.added, updated: result.updated, unchanged: result.unchanged })}
          {result.skipped > 0 && ` ${t('timesheet.import.doneSkipped', { n: result.skipped })}`}
        </p>
      )}

      {parsed && (
        <div className="flex flex-col gap-2.5 rounded-xl border-2 border-ink/15 bg-cream/40 p-2.5">
          {!mapComplete(map) ? (
            <>
              <p className="font-body text-[11px] text-ink">{t('timesheet.import.columns')}</p>
              {columnPick('name', t('timesheet.import.col.name'))}
              {columnPick('in', t('timesheet.import.col.in'))}
              {columnPick('out', t('timesheet.import.col.out'))}
              {columnPick('date', t('timesheet.import.col.date'))}
              {columnPick('break', t('timesheet.import.col.break'))}
            </>
          ) : (
            <>
              {locations.length > 1 && (
                <label className={label}>
                  {t('timesheet.import.location')}
                  <select value={where ?? ''} onChange={(e) => setLocation(e.target.value)} className={select}>
                    {locations.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="font-body text-xs text-ink">
                <b>{t(ready.length === 1 ? 'timesheet.import.found.one' : 'timesheet.import.found', { n: ready.length })}</b>
                {range && ` · ${dateRangeLabel(range.from, range.to)}`}
              </p>
              {unmatched.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="font-body text-[11px] font-bold text-coral-dark">
                    {t('timesheet.import.whoIs')}
                  </span>
                  {unmatched.map((n) => (
                    <label key={n} className="flex flex-wrap items-center gap-1.5 font-body text-xs text-ink">
                      <span className="min-w-0 font-bold">{n}</span>
                      <span className="text-muted-ink">→</span>
                      <select
                        value={picked[n] ?? SKIP}
                        onChange={(e) => setPicked((p) => ({ ...p, [n]: Number(e.target.value) }))}
                        className={select}
                      >
                        <option value={SKIP}>{t('timesheet.import.skip')}</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {(stillOn > 0 || unreadable > 0) && (
                <p className="font-body text-[11px] text-muted-ink">
                  {[
                    stillOn > 0 && t('timesheet.import.stillOn', { n: stillOn }),
                    unreadable > 0 && t('timesheet.import.unreadable', { n: unreadable }),
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </p>
              )}
            </>
          )}
          {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy || ready.length === 0}
              onClick={() => void runImport()}
              className="rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-xs font-bold text-white disabled:opacity-40"
            >
              {busy ? t('timesheet.import.importing') : t('timesheet.import.go', { n: ready.length })}
            </button>
            <button
              onClick={() => setParsed(null)}
              className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {!parsed && error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
    </div>
  )
}
