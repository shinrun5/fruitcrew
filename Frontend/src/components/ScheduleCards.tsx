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
  /** edited since the week was posted — not on workers' phones until a repost */
  changed?: boolean
}

/** A shift nobody's on yet, offered to the crew — it's in their Market for anyone to pick up. */
export interface OpenSlot {
  shiftIds: number[]
  start: string
  end: string
  sectionId: number | null
  section: string | null
}

// every row is the same 3 columns (avatar · name · time) so the times line up
// regardless of name length and never wrap onto a second line. In the desktop
// week the columns are narrow, so the time drops under the name there instead
// of squeezing the name down to a letter or two.
const ROW = 'grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-1.5 rounded-lg px-1 py-0.5 text-left sm:grid-cols-[22px_minmax(0,1fr)]'

/** One card per store/day: a line per person (full-day shifts shown as one span) plus
 * any coverage gaps, all in time order. `readOnly` renders the same rows as inert
 * (non-interactive) — used for a frozen past week nothing can be tapped on. */
export function DayCard({
  people,
  gaps,
  open = [],
  onPersonClick,
  onGapClick,
  onOpenClick,
  onAdd,
  readOnly,
}: {
  people: DayPerson[]
  gaps: GapCardData[]
  open?: OpenSlot[]
  onPersonClick?: (person: DayPerson, e: MouseEvent<HTMLButtonElement>) => void
  onGapClick?: (gap: GapCardData, e: MouseEvent<HTMLButtonElement>) => void
  onOpenClick?: (slot: OpenSlot, e: MouseEvent<HTMLButtonElement>) => void
  /** a "+ Add shift" row at the bottom — anyone, any time */
  onAdd?: (e: MouseEvent<HTMLButtonElement>) => void
  readOnly?: boolean
}) {
  const t = useT()
  const rows = [
    ...people.map((p) => ({ start: p.start, kind: 'person' as const, p })),
    ...gaps.map((g) => ({ start: g.start, kind: 'gap' as const, g })),
    ...open.map((o) => ({ start: o.start, kind: 'open' as const, o })),
  ].sort((a, b) => a.start.localeCompare(b.start))

  if (rows.length === 0 && (readOnly || !onAdd)) return null

  return (
    <div className="flex flex-col gap-1 rounded-2xl border-[2.5px] border-ink bg-paper px-2 py-1.5 shadow-[3px_3px_0_var(--color-ink)]">
      {rows.map((row) => {
        if (row.kind === 'open') {
          return (
            <button
              key={`o${row.o.shiftIds.join(',')}`}
              type="button"
              onClick={readOnly ? undefined : (e) => onOpenClick?.(row.o, e)}
              className={`${ROW} border border-dashed border-orange bg-orange/10 ${readOnly ? 'cursor-default' : 'cursor-pointer transition-opacity hover:opacity-80'}`}
            >
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-dashed border-orange font-heading text-[11px] font-bold text-orange">
                ?
              </span>
              <span className="truncate font-body text-[11px] font-bold text-ink">{t('schedule.open.row')}</span>
              <span className="whitespace-nowrap font-body text-[10px] font-semibold text-muted-ink sm:hidden">
                {timeRangeCompact(row.o.start, row.o.end)}
              </span>
              <span
                className={`col-span-2 col-start-2 min-w-0 flex-wrap items-center gap-1 sm:col-[2/3] ${row.o.section ? 'flex' : 'hidden sm:flex'}`}
              >
                <span className="hidden whitespace-nowrap font-body text-[10px] font-semibold text-muted-ink sm:inline">
                  {timeRangeCompact(row.o.start, row.o.end)}
                </span>
                {row.o.section && <SectionTag name={row.o.section} />}
              </span>
            </button>
          )
        }
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
              <span className="whitespace-nowrap font-body text-[10px] font-semibold text-coral-dark sm:col-start-2">
                {timeRangeCompact(row.g.start, row.g.end)}
              </span>
            </button>
          )
        }
        // scheduled off their availability: tinted, with a warning after the
        // name and the reason on hover (tapping shows it in the picker too)
        const issue = row.p.unavailable ? availabilityNote(row.p.unavailable, t) : null
        const time = row.p.fullDay ? t('schedule.fullDay') : timeRangeCompact(row.p.start, row.p.end)
        const timeTone = row.p.note?.leaves ? 'text-coral-dark' : 'text-muted-ink'
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
              {row.p.changed && (
                <span
                  role="img"
                  aria-label={t('schedule.changedSincePosted')}
                  title={t('schedule.changedSincePosted')}
                  className="h-2 w-2 shrink-0 rounded-full bg-orange"
                />
              )}
              {issue && (
                <span role="img" aria-label={issue} className="shrink-0">
                  <WarningIcon size={11} />
                </span>
              )}
            </span>
            <span className={`whitespace-nowrap font-body text-[10px] font-semibold sm:hidden ${timeTone}`}>{time}</span>
            {/* its own line under name + time, so a long one isn't cut off in a narrow week column */}
            <span
              className={`col-span-2 col-start-2 min-w-0 flex-wrap items-center gap-1 sm:col-[2/3] ${row.p.section ? 'flex' : 'hidden sm:flex'}`}
            >
              <span className={`hidden whitespace-nowrap font-body text-[10px] font-semibold sm:inline ${timeTone}`}>{time}</span>
              {row.p.section && <SectionTag name={row.p.section} />}
            </span>
          </button>
        )
      })}
      {onAdd && !readOnly && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-dashed border-ink/25 px-1 py-1 font-body text-[11px] font-bold text-muted-ink transition-colors hover:border-ink hover:text-ink"
        >
          {t('schedule.addShift')}
        </button>
      )}
    </div>
  )
}

function SectionTag({ name }: { name: string }) {
  return (
    <span className="max-w-full truncate rounded-full border border-grape bg-grape/15 px-1.5 font-body text-[9px] font-bold leading-[13px] text-ink">
      {name}
    </span>
  )
}
