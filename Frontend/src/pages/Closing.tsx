import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../lib/store-context'
import { DAYS, weekRangeLabel } from '../lib/time'
import type { ClosingDuty, ClosingDutyDay, ClosingDutyWeek, DayOfWeek } from '../types'

const FULL_DAY: Record<DayOfWeek, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
}

/** A single role's assignee, editable among that day's closing crew. */
function RoleSelect({
  day,
  value,
  busy,
  onChange,
}: {
  day: ClosingDutyDay
  value: number | null
  busy: boolean
  onChange: (id: number) => void
}) {
  return (
    <select
      value={value ?? ''}
      disabled={busy}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full cursor-pointer appearance-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-center font-body text-sm font-semibold text-ink outline-none hover:border-ink/20 disabled:opacity-50"
    >
      {day.crew.map((c) => (
        <option key={c.employeeId} value={c.employeeId}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

export function Closing() {
  const { storeId } = useStore()
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [week, setWeek] = useState<ClosingDutyWeek | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    if (storeId == null) return
    setLoading(true)
    setError(null)
    api
      .getScheduleStatus(storeId)
      .then((s) => {
        const ws = s.weekStart.slice(0, 10)
        setWeekStart(ws)
        return api.getClosingDuties(storeId, ws)
      })
      .then(setWeek)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load closing duties'))
      .finally(() => setLoading(false))
  }, [storeId])

  async function regenerate() {
    if (storeId == null || weekStart == null) return
    setRegenerating(true)
    setError(null)
    try {
      setWeek(await api.regenerateClosingDuties(storeId, weekStart))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not regenerate')
    } finally {
      setRegenerating(false)
    }
  }

  async function save(day: ClosingDutyDay, next: ClosingDuty, key: string) {
    if (storeId == null || weekStart == null) return
    setWeek((w) => w && { ...w, days: w.days.map((d) => (d.day === day.day ? { ...d, duty: next } : d)) })
    setSavingKey(key)
    setError(null)
    try {
      const updated = await api.setClosingDuty(storeId, weekStart, day.day, next)
      setWeek((w) => w && { ...w, days: w.days.map((d) => (d.day === day.day ? updated : d)) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that change')
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) {
    return <div className="p-6 font-body text-sm text-muted-ink">Loading…</div>
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-lg font-extrabold text-ink">Closing Duties</h1>
          {weekStart && (
            <p className="font-body text-xs text-muted-ink">Week of {weekRangeLabel(weekStart)}</p>
          )}
        </div>
        <button
          onClick={() => void regenerate()}
          disabled={regenerating || !weekStart}
          className="rounded-full border-2 border-ink bg-paper px-3.5 py-1.5 font-heading text-xs font-bold text-ink disabled:opacity-50"
        >
          {regenerating ? 'Regenerating…' : '🔄 Regenerate'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border-2 border-coral bg-coral-bg px-3 py-2 font-body text-xs font-bold text-coral-dark">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border-2 border-ink">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <th className="border-b-2 border-ink bg-paper px-3 py-2 text-left font-heading text-xs font-bold text-ink">
                &nbsp;
              </th>
              {(['Closing', 'Bathroom', 'Sweep', 'Mop'] as const).map((label) => (
                <th
                  key={label}
                  className="border-b-2 border-l-2 border-ink bg-[#C4C4C4] px-3 py-2 text-left font-heading text-xs font-bold text-ink"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((dayKey) => {
              const day = week?.days.find((d) => d.day === dayKey)
              return (
                <tr key={dayKey} className="odd:bg-paper even:bg-cream/40">
                  <td className="border-t-2 border-ink px-3 py-2 font-body text-sm font-bold text-ink">
                    {FULL_DAY[dayKey]}
                  </td>
                  {!day || !day.duty ? (
                    <td colSpan={4} className="border-t-2 border-l-2 border-ink px-3 py-2 text-center font-body text-sm text-muted-ink">
                      Not scheduled
                    </td>
                  ) : (
                    <>
                      <td className="border-t-2 border-l-2 border-ink px-2 py-1.5">
                        <RoleSelect
                          day={day}
                          value={day.duty.closingEmployeeId}
                          busy={savingKey === `${dayKey}:closing`}
                          onChange={(id) =>
                            void save(day, { ...day.duty!, closingEmployeeId: id }, `${dayKey}:closing`)
                          }
                        />
                      </td>
                      <td className="border-t-2 border-l-2 border-ink px-2 py-1.5">
                        <div className="flex flex-col gap-0.5">
                          {day.duty.bathroomEmployeeIds.length === 0 && (
                            <span className="block text-center font-body text-sm text-muted-ink">—</span>
                          )}
                          {day.duty.bathroomEmployeeIds.map((id, i) => (
                            <RoleSelect
                              key={i}
                              day={day}
                              value={id}
                              busy={savingKey === `${dayKey}:bathroom${i}`}
                              onChange={(newId) => {
                                const ids = [...day.duty!.bathroomEmployeeIds]
                                ids[i] = newId
                                void save(day, { ...day.duty!, bathroomEmployeeIds: ids }, `${dayKey}:bathroom${i}`)
                              }}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="border-t-2 border-l-2 border-ink px-2 py-1.5">
                        <RoleSelect
                          day={day}
                          value={day.duty.sweepEmployeeId}
                          busy={savingKey === `${dayKey}:sweep`}
                          onChange={(id) => void save(day, { ...day.duty!, sweepEmployeeId: id }, `${dayKey}:sweep`)}
                        />
                      </td>
                      <td className="border-t-2 border-l-2 border-ink px-2 py-1.5">
                        <RoleSelect
                          day={day}
                          value={day.duty.mopEmployeeId}
                          busy={savingKey === `${dayKey}:mop`}
                          onChange={(id) => void save(day, { ...day.duty!, mopEmployeeId: id }, `${dayKey}:mop`)}
                        />
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="font-body text-xs text-muted-ink">
        Auto-filled from who&rsquo;s closing that day (the senior closes, Daniel gets mop when he&rsquo;s
        in) — tap any name to swap it. Regenerate resets the whole week back to that default.
      </p>
    </div>
  )
}
