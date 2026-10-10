import { DayDeck } from './DayDeck'
import { DayCard } from './ScheduleCards'
import { buildDayPeople, dayOperatingWindow } from '../lib/board'
import { useT } from '../lib/i18n'
import { DAYS, DAY_LABEL, dayDate, relativeTime } from '../lib/time'
import type { EditLogEntry, Employee, EmployeeStore, ShiftRequirement, SnapshotDetail, Store } from '../types'

/** A past week's roster, current store only — rendered with the exact same
 * fruit-avatar day cards as the live board (via buildDayPeople/DayCard), fed
 * from the frozen ScheduleSnapshot instead of live Shift rows. Within the
 * editable window, tapping a person triggers the confirm-then-resume flow
 * (onEdit, i.e. resumeWeek); past it, DayCard renders read-only and onEdit is
 * never wired up at all. */
export function PastWeekBoard({
  snap,
  loading,
  storeId,
  employees,
  employeeStores,
  stores,
  requirements,
  isEditableWindow,
  resuming,
  onEdit,
  editLog,
}: {
  snap: SnapshotDetail | null
  loading: boolean
  storeId: number
  employees: Employee[]
  employeeStores: EmployeeStore[]
  stores: Store[]
  requirements: ShiftRequirement[]
  isEditableWindow: boolean
  resuming: boolean
  onEdit?: () => void
  editLog: EditLogEntry[]
}) {
  const t = useT()
  if (loading) {
    return <p className="p-4 font-body text-sm text-muted-ink sm:p-8">{t('common.loading')}</p>
  }
  if (!snap) {
    return (
      <p className="p-4 font-body text-sm text-muted-ink sm:p-8">
        {t('dashboard.pastWeek.noSaved')}
      </p>
    )
  }
  const employeeFruit = new Map(employees.map((e) => [e.id, e.avatarFruit]))
  const rows = snap.shifts.filter((s) => s.storeId === storeId && s.employeeId != null)
  const dayCards = DAYS.map((day, i) => {
    const dayRows = rows
      .filter((s) => s.day === day)
      .map((s, j) => ({
        id: -(j + 1), // frozen rows carry no real shift id — never dereferenced (read-only)
        employeeId: s.employeeId as number,
        name: s.employeeName ?? '?',
        start: `1970-01-01T${s.start}:00.000Z`,
        end: `1970-01-01T${s.end}:00.000Z`,
      }))
    const { opStart, opEnd, needsOpen } = dayOperatingWindow(requirements, storeId, day)
    const people = buildDayPeople(dayRows, opStart, opEnd, needsOpen, employeeFruit, employeeStores, stores, storeId)
    return { day, i, people }
  }).filter((d) => d.people.length > 0)

  const editable = isEditableWindow && !!onEdit
  const dayDecks = dayCards.map((d) => ({
    day: d.day,
    hasGaps: false,
    content: (
      <div className="flex flex-col gap-2">
        <div className="flex flex-col items-center leading-tight text-ink">
          <span className="font-heading text-xs font-bold">{DAY_LABEL[d.day]}</span>
          <span className="font-body text-[10px] font-semibold text-muted-ink">{dayDate(snap.weekStart, d.i)}</span>
        </div>
        <DayCard
          people={d.people}
          gaps={[]}
          readOnly={!editable || resuming}
          onPersonClick={editable ? () => onEdit!() : undefined}
        />
      </div>
    ),
  }))

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-8">
      <div className="mb-3 rounded-xl border-2 border-ink/20 bg-cream px-3 py-2">
        <p className="font-body text-xs text-ink">
          {t(isEditableWindow ? 'dashboard.pastWeek.editableNotice' : 'dashboard.pastWeek.lockedNotice')}
        </p>
      </div>
      {editLog.length > 0 && (
        <div className="mb-3 rounded-xl border-2 border-coral/40 bg-coral-bg/40 px-3 py-2">
          <p className="font-heading text-[11px] font-bold text-coral-dark">
            {t('dashboard.pastWeek.editLogTitle')}
          </p>
          <ul className="mt-1 space-y-0.5">
            {editLog.map((e) => (
              <li key={e.id} className="font-body text-xs text-coral-dark">
                {t('dashboard.pastWeek.editLogLine', {
                  name: e.editedBy?.name || e.editedBy?.email || t('dashboard.pastWeek.unknownEditor'),
                  when: relativeTime(e.editedAt),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dayCards.length === 0 ? (
        <p className="font-body text-sm text-muted-ink">{t('dashboard.pastWeek.noShifts')}</p>
      ) : (
        <div className="flex flex-1 flex-col gap-8">
          <div
            className="hidden gap-3.5 overflow-x-auto pb-1 sm:grid"
            style={{ gridTemplateColumns: `repeat(${dayDecks.length}, minmax(150px, 1fr))` }}
          >
            {dayDecks.map((dc) => (
              <div key={dc.day}>{dc.content}</div>
            ))}
          </div>
          <DayDeck days={dayDecks} weekStart={snap.weekStart} />
        </div>
      )}
    </div>
  )
}
