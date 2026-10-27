import type { MouseEvent } from 'react'
import { FruitAvatar } from './FruitAvatar'
import { WarningIcon } from './icons'
import type { DayPerson, OpenSlot } from './ScheduleCards'
import { availabilityNote } from '../lib/board'
import { fruitForPerson } from '../lib/fruit'
import type { GapCardData } from '../lib/gaps'
import { useT } from '../lib/i18n'
import { money } from '../lib/pay'
import { DAY_LABEL, DAYS, dayDate, durationLabel, timeRangeCompact, toMinutes } from '../lib/time'
import type { DayOfWeek } from '../types'

/** A worker's row: who, and their week so far (every store) against their caps. */
export interface PeopleRow {
  employeeId: number
  name: string
  avatarFruit: string | null
  minutes: number
  hourLimit: number
  days: number
  maxShifts: number
}

export interface PeopleGridDay {
  day: DayOfWeek
  people: DayPerson[]
  gaps: GapCardData[]
  open: OpenSlot[]
  /** people on time off that day */
  away: Set<number>
  onPerson: (p: DayPerson, e: MouseEvent<HTMLButtonElement>) => void
  onGap: (g: GapCardData, e: MouseEvent<HTMLButtonElement>) => void
  onOpen: (o: OpenSlot, e: MouseEvent<HTMLButtonElement>) => void
  onAdd: (e: MouseEvent<HTMLButtonElement>, employeeId: number) => void
}

/** The week as one row per person and a column per day — the way the big
 * scheduling apps lay it out — with each person's hours for the week next to
 * their name, so whoever's running long (or short) stands out. Shortfalls and
 * open shifts get a row of their own up top. Tap a shift to change it, or an
 * empty spot to give that person a shift that day. */
export function PeopleGrid({
  weekStart,
  days,
  rows,
  pay,
}: {
  weekStart: string | null
  days: PeopleGridDay[]
  rows: PeopleRow[]
  /** what it all costs, for whoever can see pay: per person, per day, and the week */
  pay?: { person: Map<number, number>; rated: Set<number>; day: Map<DayOfWeek, number>; total: number }
}) {
  const t = useT()
  const hasNeeds = days.some((d) => d.gaps.length > 0 || d.open.length > 0)
  const dayMinutes = days.map((d) => d.people.reduce((n, p) => n + toMinutes(p.end) - toMinutes(p.start), 0))
  const weekMinutes = dayMinutes.reduce((a, b) => a + b, 0)
  const cell = 'border-t border-ink/10 p-1 align-top'
  const sticky = 'sticky left-0 z-10 border-r border-ink/10 bg-paper'

  return (
    <div className="overflow-x-auto rounded-2xl border-[2.5px] border-ink bg-paper shadow-[3px_3px_0_var(--color-ink)]">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 font-body text-[11px]">
        <thead>
          <tr>
            <th className={`${sticky} w-[120px] p-2 text-left font-heading text-[11px] font-bold text-muted-ink sm:w-[150px]`}>
              {t('schedule.people.person')}
            </th>
            {days.map((d) => (
              <th key={d.day} className="p-1.5 text-left">
                <span className="block font-heading text-[11px] font-bold text-ink">{DAY_LABEL[d.day]}</span>
                {weekStart && (
                  <span className="block text-[10px] font-semibold text-muted-ink">{dayDate(weekStart, DAYS.indexOf(d.day))}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasNeeds && (
            <tr>
              <td className={`${sticky} ${cell} p-2 font-bold text-coral-dark`}>{t('schedule.people.needs')}</td>
              {days.map((d) => (
                <td key={d.day} className={cell}>
                  <div className="flex flex-col gap-1">
                    {d.gaps.map((g) => (
                      <button
                        key={`g${g.requirementId}-${g.start}-${g.detail}`}
                        onClick={(e) => d.onGap(g, e)}
                        title={g.detail}
                        className="rounded-lg border border-dashed border-coral bg-coral-bg px-1.5 py-0.5 text-left font-semibold text-coral-dark hover:opacity-80"
                      >
                        <span className="block whitespace-nowrap">{timeRangeCompact(g.start, g.end)}</span>
                        <span className="block text-[10px] leading-tight">{g.detail}</span>
                      </button>
                    ))}
                    {d.open.map((o) => (
                      <button
                        key={`o${o.shiftIds.join(',')}`}
                        onClick={(e) => d.onOpen(o, e)}
                        className="rounded-lg border border-dashed border-orange bg-orange/10 px-1.5 py-0.5 text-left font-semibold text-ink hover:opacity-80"
                      >
                        <span className="block whitespace-nowrap">{timeRangeCompact(o.start, o.end)}</span>
                        <span className="block text-[10px] leading-tight text-muted-ink">{t('schedule.open.row')}</span>
                      </button>
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          )}
          {rows.map((r) => {
            const overHours = r.minutes > r.hourLimit * 60
            const overDays = r.days > r.maxShifts
            return (
              <tr key={r.employeeId}>
                <td className={`${sticky} ${cell} p-2`}>
                  <div className="flex items-center gap-1.5">
                    <FruitAvatar kind={fruitForPerson(r)} size={20} />
                    <span className="min-w-0 truncate font-bold text-ink">{r.name}</span>
                  </div>
                  <div
                    className={`mt-0.5 pl-[26px] text-[10px] font-semibold ${overHours || overDays ? 'text-coral-dark' : 'text-muted-ink'}`}
                    title={[
                      overHours ? t('dashboard.overHoursLimit', { limit: r.hourLimit }) : null,
                      overDays ? t('dashboard.overDaysLimit', { max: r.maxShifts }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined}
                  >
                    {t('schedule.people.load', { hours: durationLabel(r.minutes), limit: r.hourLimit })}
                    {(overHours || overDays) && ' ⚠'}
                  </div>
                  {pay && (
                    <div className="pl-[26px] text-[10px] font-semibold text-muted-ink">
                      {pay.rated.has(r.employeeId) ? money(pay.person.get(r.employeeId) ?? 0) : t('schedule.people.noRate')}
                    </div>
                  )}
                </td>
                {days.map((d) => {
                  const mine = d.people.filter((p) => p.employeeId === r.employeeId)
                  const away = d.away.has(r.employeeId)
                  return (
                    <td key={d.day} className={cell}>
                      <div className="flex flex-col gap-1">
                        {away && <span className="px-1 text-[10px] font-bold text-coral-dark">{t('dashboard.onLeave')}</span>}
                        {mine.map((p) => {
                          const issue = p.unavailable ? availabilityNote(p.unavailable, t) : null
                          return (
                            <button
                              key={p.shiftIds.join(',')}
                              onClick={(e) => d.onPerson(p, e)}
                              title={issue ?? undefined}
                              className={`rounded-lg border px-1.5 py-0.5 text-left transition-colors hover:border-ink ${
                                issue ? 'border-coral bg-coral-bg/60' : 'border-ink/20 bg-cream'
                              }`}
                            >
                              <span className="flex items-center gap-1 whitespace-nowrap font-semibold text-ink">
                                {p.fullDay ? t('schedule.fullDay') : timeRangeCompact(p.start, p.end)}
                                {issue && <WarningIcon size={10} />}
                                {p.changed && (
                                  <span
                                    role="img"
                                    aria-label={t('schedule.changedSincePosted')}
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange"
                                  />
                                )}
                              </span>
                              {p.section && (
                                <span className="block truncate text-[9px] font-bold text-grape">{p.section}</span>
                              )}
                            </button>
                          )
                        })}
                        <button
                          onClick={(e) => d.onAdd(e, r.employeeId)}
                          aria-label={t('schedule.people.addFor', { name: r.name, day: DAY_LABEL[d.day] })}
                          className={`rounded-lg border border-dashed border-transparent py-0.5 font-heading text-xs font-bold text-ink/25 transition-colors hover:border-ink/30 hover:text-ink ${
                            mine.length > 0 ? 'opacity-0 hover:opacity-100 focus:opacity-100 [@media(hover:none)]:hidden' : ''
                          }`}
                        >
                          +
                        </button>
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${sticky} ${cell} p-2 font-bold text-ink`}>
              {t('schedule.people.total', { hours: durationLabel(weekMinutes) })}
              {pay && <span className="block text-[10px] text-muted-ink">{t('schedule.labor.cost', { cost: money(pay.total) })}</span>}
            </td>
            {dayMinutes.map((m, i) => (
              <td key={days[i]!.day} className={`${cell} px-1.5 font-semibold text-muted-ink`}>
                {m > 0 ? durationLabel(m) : '—'}
                {pay && m > 0 && <span className="block text-[10px]">{money(pay.day.get(days[i]!.day) ?? 0)}</span>}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
