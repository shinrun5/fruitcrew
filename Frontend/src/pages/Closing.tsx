import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card, EmptyState } from '../components/Card'
import { ExportClosingDuties } from '../components/ExportClosingDuties'
import { FruitAvatar } from '../components/FruitAvatar'
import { ChecklistIcon } from '../components/icons'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fruitForPerson } from '../lib/fruit'
import { closingRoleLabel, toneFor } from '../lib/closingRoles'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store-context'
import { DAYS, weekRangeLabel } from '../lib/time'
import type { ClosingDuty, ClosingDutyDay, ClosingDutyWeek, DayOfWeek, Responsibility } from '../types'

const closingDayKey = (d: DayOfWeek) => `closing.day.${d}` as const

function withAssignment(duty: ClosingDuty | null, responsibilityId: number, employeeIds: number[]): ClosingDuty {
  const assignments = duty?.assignments ?? []
  const idx = assignments.findIndex((a) => a.responsibilityId === responsibilityId)
  const next = [...assignments]
  if (idx >= 0) next[idx] = { responsibilityId, employeeIds }
  else next.push({ responsibilityId, employeeIds })
  return { assignments: next }
}

/** One responsibility's row(s) for a day — usually one slot, but any role can
 * carry several people (e.g. a shared "Bathroom"), so this renders one row per
 * currently-assigned person (or a single empty one) plus an "add another" for
 * whichever roles the store wants more than one person on. */
function RoleGroup({
  responsibility,
  tone,
  day,
  ids,
  busyKeyPrefix,
  savingKey,
  editable,
  onChange,
}: {
  responsibility: Responsibility
  tone: string
  day: ClosingDutyDay
  ids: number[]
  busyKeyPrefix: string
  savingKey: string | null
  editable: boolean
  onChange: (ids: number[]) => void
}) {
  const t = useT()
  const eligible = day.crew.filter((c) => c.responsibilityIds.includes(responsibility.id))
  const options = eligible.length > 0 ? eligible : day.crew
  const rows = ids.length === 0 ? [null] : ids
  const availableToAdd = options.filter((c) => !ids.includes(c.employeeId))

  return (
    <div className="flex flex-col divide-y divide-ink/10">
      {rows.map((id, i) => {
        const person = day.crew.find((c) => c.employeeId === id)
        const busy = savingKey === `${busyKeyPrefix}${i}`
        return (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2">
            <span
              className={`w-[4.5rem] shrink-0 rounded-full border-2 px-1.5 py-0.5 text-center font-body text-[10px] font-bold ${tone}`}
            >
              {closingRoleLabel(t, responsibility.name)}
            </span>
            {person ? (
              <FruitAvatar kind={fruitForPerson({ employeeId: person.employeeId, avatarFruit: person.avatarFruit })} size={22} />
            ) : (
              <span className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-dashed border-ink/25" />
            )}
            {editable ? (
              <select
                value={id ?? ''}
                disabled={busy}
                onChange={(e) => {
                  const chosen = Number(e.target.value)
                  const next = [...ids]
                  if (id == null) next.push(chosen)
                  else next[i] = chosen
                  onChange(next)
                }}
                className="min-w-0 flex-1 cursor-pointer appearance-none rounded-lg border-2 border-transparent bg-transparent px-1 py-0.5 font-body text-sm font-bold text-ink outline-none transition-colors duration-150 ease-out hover:border-ink/20 disabled:opacity-50"
              >
                {id == null && <option value="">{t('closing.unassigned')}</option>}
                {options.map((c) => (
                  <option key={c.employeeId} value={c.employeeId}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="min-w-0 flex-1 truncate font-body text-sm font-bold text-ink">
                {person?.name ?? '—'}
              </span>
            )}
            {editable && id != null && ids.length > 1 && (
              <button
                onClick={() => onChange(ids.filter((x) => x !== id))}
                aria-label={t('closing.removeAria', { name: person?.name ?? '' })}
                className="font-heading text-xs leading-none text-muted-ink hover:text-coral-dark"
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      {editable && ids.length > 0 && availableToAdd.length > 0 && (
        <button
          onClick={() => onChange([...ids, availableToAdd[0]!.employeeId])}
          className="px-3 py-1.5 text-left font-body text-[11px] font-bold text-muted-ink hover:text-ink"
        >
          {t('closing.addAnother')}
        </button>
      )}
    </div>
  )
}

export function Closing() {
  const t = useT()
  const { user } = useAuth()
  const canEdit = user?.role === 'MANAGER' || user?.role === 'OWNER'
  const { storeId, stores } = useStore()
  const storeName = stores.find((s) => s.id === storeId)?.name ?? ''
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
      .catch((e) => setError(e instanceof Error ? e.message : t('closing.error.load')))
      .finally(() => setLoading(false))
  }, [storeId])

  async function regenerate() {
    if (storeId == null || weekStart == null) return
    if (!window.confirm(t('closing.regenerate.confirm'))) return
    setRegenerating(true)
    setError(null)
    try {
      setWeek(await api.regenerateClosingDuties(storeId, weekStart))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('closing.error.regenerate'))
    } finally {
      setRegenerating(false)
    }
  }

  async function save(day: ClosingDutyDay, next: ClosingDuty, key: string) {
    if (storeId == null || weekStart == null) return
    const previous = day.duty
    setWeek((w) => w && { ...w, days: w.days.map((d) => (d.day === day.day ? { ...d, duty: next } : d)) })
    setSavingKey(key)
    setError(null)
    try {
      const updated = await api.setClosingDuty(storeId, weekStart, day.day, next)
      setWeek((w) => w && { ...w, days: w.days.map((d) => (d.day === day.day ? updated : d)) })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('closing.error.save'))
      // the optimistic write above never landed server-side — put the board back
      setWeek((w) => w && { ...w, days: w.days.map((d) => (d.day === day.day ? { ...d, duty: previous } : d)) })
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) {
    return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>
  }

  if (week && !week.enabled) {
    return (
      <div className="flex flex-1 flex-col p-4 sm:p-8">
        <h1 className="font-heading text-lg font-extrabold text-ink">{t('closing.title')}</h1>
        <EmptyState
          className="mt-4"
          icon={
            <span className="text-muted-ink">
              <ChecklistIcon size={30} />
            </span>
          }
          title={t('closing.disabled.title', { store: storeName || t('closing.disabled.defaultStore') })}
          body={canEdit ? t('closing.disabled.body') : undefined}
        />
      </div>
    )
  }

  const responsibilities = week?.responsibilities ?? []

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-grape">
            <ChecklistIcon size={24} />
          </span>
          <div>
            <h1 className="font-heading text-lg font-extrabold text-ink">{t('closing.title')}</h1>
            {weekStart && (
              <p className="font-body text-xs text-muted-ink">{t('closing.weekOf', { range: weekRangeLabel(weekStart) })}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {weekStart && week && (
            <ExportClosingDuties storeName={storeName} weekStart={weekStart} responsibilities={responsibilities} days={week.days} />
          )}
          {canEdit && (
            <Button size="sm" variant="secondary" disabled={regenerating || !weekStart} onClick={() => void regenerate()}>
              {regenerating ? t('closing.regenerate.busy') : t('closing.regenerate.button')}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border-2 border-coral bg-coral-bg px-3 py-2 font-body text-xs font-bold text-coral-dark">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {DAYS.map((dayKey) => {
          const day = week?.days.find((d) => d.day === dayKey)
          return (
            <Card key={dayKey} padded={false} className="overflow-hidden">
              <div className="border-b-2 border-ink/10 bg-cream px-3 py-1.5">
                <span className="font-heading text-sm font-bold text-ink">{t(closingDayKey(dayKey))}</span>
              </div>
              {!day || !day.duty ? (
                <p className="px-3 py-3 font-body text-sm text-muted-ink">{t('closing.notScheduled')}</p>
              ) : (
                <div className="flex flex-col divide-y divide-ink/10">
                  {responsibilities.map((resp, i) => {
                    const ids = day.duty!.assignments.find((a) => a.responsibilityId === resp.id)?.employeeIds ?? []
                    return (
                      <RoleGroup
                        key={resp.id}
                        responsibility={resp}
                        tone={toneFor(i)}
                        day={day}
                        ids={ids}
                        busyKeyPrefix={`${dayKey}:${resp.id}:`}
                        savingKey={savingKey}
                        editable={canEdit}
                        onChange={(nextIds) =>
                          void save(day, withAssignment(day.duty, resp.id, nextIds), `${dayKey}:${resp.id}:0`)
                        }
                      />
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>
      <p className="font-body text-xs text-muted-ink">
        {t('closing.footer.base')}
        {canEdit ? t('closing.footer.editHint') : t('closing.footer.period')}
      </p>
    </div>
  )
}
