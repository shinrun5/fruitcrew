import type { MouseEvent } from 'react'
import { FruitAvatar } from './FruitAvatar'
import { StarBadgeIcon, WarningIcon } from './icons'
import { availabilityNote, type AvailabilityIssue } from '../lib/board'
import { fruitForPerson } from '../lib/fruit'
import type { GapCardData } from '../lib/gaps'
import { useT } from '../lib/i18n'
import { timeRangeCompact } from '../lib/time'

export interface DayPerson {
  employeeId: number
  name: string
  avatarFruit: string | null
  /** one or more DB shift rows, merged into a single contiguous span */
  shiftIds: number[]
  start: string
  end: string
  /** the part of the store they're on for this span (Front, Produce…) */
  sectionId: number | null
  section: string | null
  /** span runs open-to-close -> shown as "Full Day" instead of a time range */
  fullDay: boolean
  isOpener: boolean
  /** set when the person isn't there the whole operating day (came in late / left early) */
  note?: { comesIn?: string; leaves?: string }
  /** scheduled off their availability (time off, or outside the hours they gave) */
  unavailable?: AvailabilityIssue | null
}

// every row is the same 3 columns (avatar · name · time) so the times line up
// regardless of name length and never wrap onto a second line
const ROW = 'grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-1.5 rounded-lg px-1 py-0.5 text-left'

/** One card per store/day: a line per person (full-day shifts shown as one span) plus
 * any coverage gaps, all in time order. `readOnly` renders the same rows as inert
 * (non-interactive) — used for a frozen past week nothing can be tapped on. */
export function DayCard({
  people,
  gaps,
  onPersonClick,
  onGapClick,
  readOnly,
}: {
  people: DayPerson[]
  gaps: GapCardData[]
  onPersonClick?: (person: DayPerson, e: MouseEvent<HTMLButtonElement>) => void
  onGapClick?: (gap: GapCardData, e: MouseEvent<HTMLButtonElement>) => void
  readOnly?: boolean
}) {
  const t = useT()
  const rows = [
    ...people.map((p) => ({ start: p.start, kind: 'person' as const, p })),
    ...gaps.map((g) => ({ start: g.start, kind: 'gap' as const, g })),
  ].sort((a, b) => a.start.localeCompare(b.start))

  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-1 rounded-2xl border-[2.5px] border-ink bg-paper px-2 py-1.5 shadow-[3px_3px_0_var(--color-ink)]">
      {rows.map((row) => {
        if (row.kind === 'gap') {
          return (
            <button
              key={`g${row.g.requirementId}-${row.g.start}-${row.g.detail}`}
              type="button"
              onClick={readOnly ? undefined : (e) => onGapClick?.(row.g, e)}
              className={`${ROW} border border-dashed border-coral bg-coral-bg ${readOnly ? 'cursor-default' : 'cursor-pointer transition-opacity hover:opacity-80'}`}
            >
              <div className="flex h-[22px] w-[22px] items-center justify-center">
                <WarningIcon size={13} />
              </div>
              <span className="break-words font-body text-[10px] font-bold leading-tight text-coral-dark">{row.g.detail}</span>
              <span className="whitespace-nowrap font-body text-[10px] font-semibold text-coral-dark">
                {timeRangeCompact(row.g.start, row.g.end)}
              </span>
            </button>
          )
        }
        // scheduled off their availability: tinted, with a warning after the
        // name and the reason on hover (tapping shows it in the picker too)
        const issue = row.p.unavailable ? availabilityNote(row.p.unavailable, t) : null
        return (
          <button
            key={`p${row.p.employeeId}-${row.p.start}`}
            type="button"
            title={issue ?? undefined}
            onClick={readOnly ? undefined : (e) => onPersonClick?.(row.p, e)}
            className={`${ROW} ${issue ? 'bg-coral-bg/60' : ''} ${readOnly ? 'cursor-default' : 'cursor-pointer transition-colors hover:bg-cream'}`}
          >
            <div className="relative h-[22px] w-[22px]">
              <FruitAvatar kind={fruitForPerson(row.p)} size={22} />
              {row.p.isOpener && (
                <div className="absolute -bottom-1 -right-1">
                  <StarBadgeIcon size={11} />
                </div>
              )}
            </div>
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate font-body text-xs font-bold text-ink">{row.p.name}</span>
              {issue && (
                <span role="img" aria-label={issue} className="shrink-0">
                  <WarningIcon size={11} />
                </span>
              )}
            </span>
            <span
              className={`whitespace-nowrap font-body text-[10px] font-semibold ${
                row.p.note?.leaves ? 'text-coral-dark' : 'text-muted-ink'
              }`}
            >
              {row.p.fullDay ? t('schedule.fullDay') : timeRangeCompact(row.p.start, row.p.end)}
            </span>
            {/* its own line under name + time, so a long one isn't cut off in a narrow week column */}
            {row.p.section && (
              <span className="col-span-2 col-start-2 max-w-full justify-self-start truncate rounded-full border border-grape bg-grape/15 px-1.5 font-body text-[9px] font-bold leading-[13px] text-ink">
                {row.p.section}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
