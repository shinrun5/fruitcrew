import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card, EmptyState } from '../components/Card'
import { ExportClosingDuties } from '../components/ExportClosingDuties'
import { FruitAvatar } from '../components/FruitAvatar'
import { ChecklistIcon } from '../components/icons'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store-context'
import { DAYS, weekRangeLabel } from '../lib/time'
import type { ClosingCrewMember, ClosingDuty, ClosingDutyDay, ClosingDutyWeek, DayOfWeek } from '../types'

const closingDayKey = (d: DayOfWeek) => `closing.day.${d}` as const

/** One badge color per role — the flat gray spreadsheet header this replaced
 * had no way to tell roles apart at a glance; these do. */
const ROLE_STYLE = {
  closing: 'border-grape bg-grape/10 text-grape',
  bathroom: 'border-sky bg-sky/10 text-sky-dark',
  sweep: 'border-orange bg-orange/10 text-ink',
  mop: 'border-green bg-green/10 text-green-dark',
} as const

/** A single role's assignee: a fruit avatar + name, or — for whoever can
 * reassign it — the same avatar next to an inline select. Native <select>
 * can't render an avatar per option, so the avatar shown always reflects the
 * current pick, not the option being hovered. */
function RoleRow({
  label,
  tone,
  day,
  options,
  value,
  busy,
  editable,
  onChange,
}: {
  label: string
  tone: keyof typeof ROLE_STYLE
  day: ClosingDutyDay
  options?: ClosingCrewMember[]
  value: number | null
  busy: boolean
  editable: boolean
  onChange: (id: number) => void
}) {
  const crew = options ?? day.crew
  const person = crew.find((c) => c.employeeId === value)

  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <span
        className={`w-[4.5rem] shrink-0 rounded-full border-2 px-1.5 py-0.5 text-center font-body text-[10px] font-bold ${ROLE_STYLE[tone]}`}
      >
        {label}
      </span>
      {person ? (
        <FruitAvatar kind={fruitForPerson({ employeeId: person.employeeId, avatarFruit: person.avatarFruit })} size={22} />
      ) : (
        <span className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-dashed border-ink/25" />
      )}
      {editable ? (
        <select
          value={value ?? ''}
          disabled={busy}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-w-0 flex-1 cursor-pointer appearance-none rounded-lg border-2 border-transparent bg-transparent px-1 py-0.5 font-body text-sm font-bold text-ink outline-none transition-colors duration-150 ease-out hover:border-ink/20 disabled:opacity-50"
        >
          {crew.map((c) => (
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
    setWeek((w) => w && { ...w, days: w.days.map((d) => (d.day === day.day ? { ...d, duty: next } : d)) })
    setSavingKey(key)
    setError(null)
    try {
      const updated = await api.setClosingDuty(storeId, weekStart, day.day, next)
      setWeek((w) => w && { ...w, days: w.days.map((d) => (d.day === day.day ? updated : d)) })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('closing.error.save'))
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
            <ExportClosingDuties storeName={storeName} weekStart={weekStart} days={week.days} />
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
                  <RoleRow
                    label={t('closing.role.closing')}
                    tone="closing"
                    day={day}
                    options={day.crew.some((c) => c.canClose) ? day.crew.filter((c) => c.canClose) : day.crew}
                    value={day.duty.closingEmployeeId}
                    busy={savingKey === `${dayKey}:closing`}
                    editable={canEdit}
                    onChange={(id) => void save(day, { ...day.duty!, closingEmployeeId: id }, `${dayKey}:closing`)}
                  />
                  {day.duty.bathroomEmployeeIds.length === 0 ? (
                    <RoleRow
                      label={t('closing.role.bathroom')}
                      tone="bathroom"
                      day={day}
                      value={null}
                      busy={false}
                      editable={false}
                      onChange={() => {}}
                    />
                  ) : (
                    day.duty.bathroomEmployeeIds.map((id, i) => (
                      <RoleRow
                        key={i}
                        label={t('closing.role.bathroom')}
                        tone="bathroom"
                        day={day}
                        value={id}
                        busy={savingKey === `${dayKey}:bathroom${i}`}
                        editable={canEdit}
                        onChange={(newId) => {
                          const ids = [...day.duty!.bathroomEmployeeIds]
                          ids[i] = newId
                          void save(day, { ...day.duty!, bathroomEmployeeIds: ids }, `${dayKey}:bathroom${i}`)
                        }}
                      />
                    ))
                  )}
                  <RoleRow
                    label={t('closing.role.sweep')}
                    tone="sweep"
                    day={day}
                    value={day.duty.sweepEmployeeId}
                    busy={savingKey === `${dayKey}:sweep`}
                    editable={canEdit}
                    onChange={(id) => void save(day, { ...day.duty!, sweepEmployeeId: id }, `${dayKey}:sweep`)}
                  />
                  <RoleRow
                    label={t('closing.role.mop')}
                    tone="mop"
                    day={day}
                    value={day.duty.mopEmployeeId}
                    busy={savingKey === `${dayKey}:mop`}
                    editable={canEdit}
                    onChange={(id) => void save(day, { ...day.duty!, mopEmployeeId: id }, `${dayKey}:mop`)}
                  />
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
