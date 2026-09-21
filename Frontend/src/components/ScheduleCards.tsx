import type { MouseEvent } from 'react'
import { FruitAvatar } from './FruitAvatar'
import { StarBadgeIcon, WarningIcon } from './icons'
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
  /** span runs open-to-close -> shown as "Full Day" instead of a time range */
  fullDay: boolean
  isOpener: boolean
  /** set when the person isn't there the whole operating day (came in late / left early) */
  note?: { comesIn?: string; leaves?: string }
}

// every row is the same 3 columns (avatar · name · time) so the times line up
// regardless of name length and never wrap onto a second line
const ROW = 'grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-1.5 rounded-lg px-1 py-0.5 text-left'

/** One card per store/day: a line per person (full-day shifts shown as one span) plus
 * any coverage gaps, all in time order. */
export function DayCard({
  people,
  gaps,
  onPersonClick,
  onGapClick,
}: {
  people: DayPerson[]
  gaps: GapCardData[]
  onPersonClick: (person: DayPerson, e: MouseEvent<HTMLButtonElement>) => void
  onGapClick: (gap: GapCardData, e: MouseEvent<HTMLButtonElement>) => void
}) {
  const t = useT()
  const rows = [
    ...people.map((p) => ({ start: p.start, kind: 'person' as const, p })),
    ...gaps.map((g) => ({ start: g.start, kind: 'gap' as const, g })),
  ].sort((a, b) => a.start.localeCompare(b.start))

  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-1 rounded-2xl border-[2.5px] border-ink bg-paper px-2 py-1.5 shadow-[3px_3px_0_var(--color-ink)]">
      {rows.map((row) =>
        row.kind === 'person' ? (
          <button
            key={`p${row.p.employeeId}-${row.p.start}`}
            type="button"
            onClick={(e) => onPersonClick(row.p, e)}
            className={`${ROW} transition-colors hover:bg-cream`}
          >
            <div className="relative h-[22px] w-[22px]">
              <FruitAvatar kind={fruitForPerson(row.p)} size={22} />
              {row.p.isOpener && (
                <div className="absolute -bottom-1 -right-1">
                  <StarBadgeIcon size={11} />
                </div>
              )}
            </div>
            <span className="truncate font-body text-xs font-bold text-ink">{row.p.name}</span>
            <span
              className={`whitespace-nowrap font-body text-[10px] font-semibold ${
                row.p.note?.leaves ? 'text-coral-dark' : 'text-muted-ink'
              }`}
            >
              {row.p.fullDay ? t('schedule.fullDay') : timeRangeCompact(row.p.start, row.p.end)}
            </span>
          </button>
        ) : (
          <button
            key={`g${row.g.requirementId}-${row.g.start}`}
            type="button"
            onClick={(e) => onGapClick(row.g, e)}
            className={`${ROW} border border-dashed border-coral bg-coral-bg transition-opacity hover:opacity-80`}
          >
            <div className="flex h-[22px] w-[22px] items-center justify-center">
              <WarningIcon size={13} />
            </div>
            <span className="truncate font-body text-[10px] font-bold text-coral-dark">{row.g.detail}</span>
            <span className="whitespace-nowrap font-body text-[10px] font-semibold text-coral-dark">
              {timeRangeCompact(row.g.start, row.g.end)}
            </span>
          </button>
        ),
      )}
    </div>
  )
}
