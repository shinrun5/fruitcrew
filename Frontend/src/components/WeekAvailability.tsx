import type { AvailabilityConfirmation, WorkerLoad } from '../lib/board'
import { useT } from '../lib/i18n'
import { DAYS, DAY_LABEL, durationLabel, to12Hour, weekRangeLabel } from '../lib/time'

/** The schedule board's strip of who has confirmed their availability for the
 * week (with each person's days/hours once there's a schedule), and their
 * hours grid on demand. */
export function WeekAvailability({
  weekStart,
  storeId,
  avConfirm,
  weekLoad,
  solved,
  showAvailability,
  onToggleAvailability,
  showHours,
  onToggleHours,
}: {
  weekStart: string
  storeId: number | null
  avConfirm: AvailabilityConfirmation[]
  weekLoad: WorkerLoad[]
  solved: boolean
  showAvailability: boolean
  onToggleAvailability: () => void
  showHours: boolean
  onToggleHours: () => void
}) {
  const t = useT()
  const rows = avConfirm
    .filter((w) => w.storeIds.includes(storeId ?? -1))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (rows.length === 0) return null
  const ready = rows.filter((w) => w.state !== 'pending').length
  // someone with no login can't answer the weekly check — don't count
  // them as outstanding (their standing hours still show below)
  const askable = rows.filter((w) => w.hasLogin || w.state !== 'pending').length
  // shift count/hours fold into the same chip once there's a schedule
  // to count — before that, the row is confirmation-only
  const loadById = new Map(weekLoad.map((l) => [l.id, l]))
  return (
    <div className="border-b-2 border-ink/10 bg-paper px-4 py-2.5 sm:px-8">
      <button
        type="button"
        onClick={onToggleAvailability}
        className="flex w-full items-center gap-1.5 text-left"
      >
        <span className="font-heading text-[11px] font-bold uppercase tracking-wide text-muted-ink">
          {t('dashboard.availability.summary', {
            range: weekRangeLabel(weekStart),
            ready,
            total: askable,
          })}
        </span>
        <span className="ml-auto font-body text-[11px] font-bold text-sky-dark">
          {showAvailability ? '▴' : '▾'}
        </span>
      </button>

      {showAvailability && (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {rows.map((w) => {
              const load = solved ? loadById.get(w.employeeId) : undefined
              const overDays = !!load && load.count > load.max
              const overHours = !!load && load.minutes > load.hourLimit * 60
              const over = overDays || overHours
              const title = [
                w.state === 'changed'
                  ? t('dashboard.avail.state.changed')
                  : w.state === 'confirmed'
                    ? t('dashboard.avail.state.confirmed')
                    : w.hasLogin
                      ? t('dashboard.avail.state.pending')
                      : t('dashboard.avail.state.noLogin'),
                load && overDays ? t('dashboard.overDaysLimit', { max: load.max }) : null,
                load && overHours ? t('dashboard.overHoursLimit', { limit: load.hourLimit }) : null,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <span
                  key={w.employeeId}
                  title={title}
                  className={`rounded-full border-2 px-2 py-0.5 font-body text-[11px] font-bold ${
                    over
                      ? 'border-coral bg-coral-bg text-coral-dark'
                      : w.state === 'changed'
                        ? 'border-sky-dark bg-sky/10 text-sky-dark'
                        : w.state === 'confirmed'
                          ? 'border-green bg-green/10 text-green-dark'
                          : 'border-ink/20 text-muted-ink'
                  }`}
                >
                  {w.state === 'changed' ? '✎ ' : w.state === 'confirmed' ? '✓ ' : ''}
                  {w.name}
                  {load && (
                    <span className="font-normal opacity-70">
                      {' · '}
                      {t('dashboard.workerSummary.short', {
                        count: load.count,
                        daysPart: overDays ? `/${load.max}` : '',
                        hours: durationLabel(load.minutes),
                        hourUnit: '',
                        hoursPart: overHours ? `/${load.hourLimit}${t('dashboard.hourUnit')}` : '',
                      })}
                    </span>
                  )}
                </span>
              )
            })}
            <button
              onClick={onToggleHours}
              className="ml-auto font-body text-[11px] font-bold text-sky-dark"
            >
              {showHours ? t('dashboard.hideHours') : t('dashboard.showHours')}
            </button>
          </div>

          {showHours && (
            // on a phone the week scrolls sideways — the name column stays
            // pinned (sticky, opaque) so you can tell whose hours you're on.
            // border-separate: a collapsed border wouldn't stick with the cell
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-0 font-body text-[11px]">
                <thead>
                  <tr className="text-muted-ink">
                    <th className="sticky left-0 z-10 border-r border-ink/10 bg-paper p-1 pr-2 text-left font-bold">
                      {t('dashboard.worker')}
                    </th>
                    {DAYS.map((d) => (
                      <th key={d} className="p-1 text-left font-bold">
                        {DAY_LABEL[d]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.employeeId} className="align-top [&>td]:border-t [&>td]:border-ink/10">
                      <td className="sticky left-0 z-10 whitespace-nowrap border-r bg-paper p-1 pr-2 font-bold text-ink">
                        {w.name}
                        {w.source === 'override' && (
                          <span className="ml-1 font-normal text-sky-dark">
                            {t('dashboard.weekOverrideAbbrev')}
                          </span>
                        )}
                      </td>
                      {DAYS.map((d) => {
                        const off = w.timeOff.includes(d)
                        const wins = w.days[d] ?? []
                        return (
                          <td key={d} className="p-1">
                            {off ? (
                              <span className="text-coral-dark">{t('dashboard.onLeave')}</span>
                            ) : wins.length === 0 ? (
                              <span className="text-ink/25">—</span>
                            ) : (
                              wins.map((win, i) => (
                                <div key={i} className="whitespace-nowrap text-ink">
                                  {to12Hour(win.start)}–{to12Hour(win.end)}
                                </div>
                              ))
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Workers scheduled this week but missing from the availability strip above
 * (no confirmation on file, e.g. a hand-added shift) — rare, but their hours
 * shouldn't just disappear. */
export function UntrackedWorkload({
  storeId,
  avConfirm,
  weekLoad,
}: {
  storeId: number | null
  avConfirm: AvailabilityConfirmation[]
  weekLoad: WorkerLoad[]
}) {
  const t = useT()
  const trackedIds = new Set(
    avConfirm.filter((w) => w.storeIds.includes(storeId ?? -1)).map((w) => w.employeeId),
  )
  const extra = weekLoad.filter((l) => l.count > 0 && !trackedIds.has(l.id))
  if (extra.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-ink/10 bg-paper px-4 py-2.5 sm:px-8">
      <span className="mr-1 font-body text-[11px] font-bold text-muted-ink">
        {t('dashboard.workerSummary.untracked')}
      </span>
      {extra.map((l) => {
        const overDays = l.count > l.max
        const overHours = l.minutes > l.hourLimit * 60
        const over = overDays || overHours
        return (
          <span
            key={l.id}
            className={`rounded-full border-2 px-2 py-0.5 font-body text-[11px] font-bold ${
              over ? 'border-coral bg-coral-bg text-coral-dark' : 'border-ink/20 text-ink'
            }`}
          >
            {t('dashboard.workerSummary', {
              name: l.name,
              count: l.count,
              daysPart: overDays ? `/${l.max}` : '',
              hours: durationLabel(l.minutes),
              hourUnit: '',
              hoursPart: overHours ? `/${l.hourLimit}${t('dashboard.hourUnit')}` : '',
            })}
          </span>
        )
      })}
    </div>
  )
}
