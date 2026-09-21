import { useState } from 'react'
import type { Candidate } from '../lib/candidates'
import type { SwapOption } from '../lib/swaps'
import { fruitForPerson } from '../lib/fruit'
import { clockToMin, DAY_LABEL, minToClock, timeRangeCompact, to12Hour } from '../lib/time'
import { useT } from '../lib/i18n'
import { FruitAvatar } from './FruitAvatar'

/** A sensible default split point: the window's midpoint, snapped to the half hour. */
function defaultSplit(windowStart: string, windowEnd: string): string {
  const a = clockToMin(windowStart)
  const b = clockToMin(windowEnd)
  const snapped = Math.round((a + b) / 2 / 30) * 30
  const mid = a + 30 < b - 30 ? Math.min(Math.max(snapped, a + 30), b - 30) : Math.round((a + b) / 2)
  return minToClock(mid)
}

const WIDTH = 260

export interface SplitConfig {
  windowStart: string // HH:MM 24h
  windowEnd: string // HH:MM 24h
  /** Non-null: an existing shift — this person keeps [windowStart, T], only the tail
   * needs a taker. Null: a gap — both halves need one. */
  headStaysWith: string | null
  candidatesFor: (fromHHMM24: string, toHHMM24: string) => Candidate[]
  commit: (args: { which: 'head' | 'tail'; splitAt: string; employeeId: number }) => void
}

/** "9:00 AM–5:00 PM" etc, joined; empty string if no windows. */
function hoursLabel(windows: { start: string; end: string }[]): string {
  return windows.map((w) => `${to12Hour(w.start)}–${to12Hour(w.end)}`).join(', ')
}

/** A heads-up when giving them this shift would cross their weekly hour or day
 * limit — still pickable, just flagged so it's not a silent surprise. */
function limitWarning(c: Candidate, t: ReturnType<typeof useT>): string | null {
  const overHours = c.projectedHours > c.hourLimit
  const overDays = c.projectedDays > c.maxShifts
  if (overHours && overDays) {
    return t('schedule.assign.overBoth', {
      hours: Math.round(c.projectedHours),
      hourLimit: c.hourLimit,
      days: c.projectedDays,
      dayLimit: c.maxShifts,
    })
  }
  if (overHours)
    return t('schedule.assign.overHours', { hours: Math.round(c.projectedHours), hourLimit: c.hourLimit })
  if (overDays) return t('schedule.assign.overDays', { days: c.projectedDays, dayLimit: c.maxShifts })
  return null
}

function CandidateList({
  candidates,
  onPick,
  empty,
}: {
  candidates: Candidate[]
  onPick: (id: number, covered?: { start: string; end: string }) => void
  empty: string
}) {
  const t = useT()
  return (
    <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
      {candidates.length === 0 && <span className="px-2 py-1.5 font-body text-xs text-muted-ink">{empty}</span>}
      {candidates.map((c) => {
        const warning = limitWarning(c, t)
        return (
          <button
            key={c.employeeId}
            onClick={() => onPick(c.employeeId, c.coveredWindow ?? undefined)}
            className="flex flex-col gap-0.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-cream"
          >
            <span className="flex items-center gap-2">
              <FruitAvatar kind={fruitForPerson(c)} size={22} />
              <span className="font-body text-xs font-bold text-ink">{c.name}</span>
              {c.standby && (
                <span className="shrink-0 rounded-full border border-ink/25 px-1.5 py-px font-body text-[10px] font-semibold text-muted-ink">
                  {t('schedule.assign.onCall')}
                </span>
              )}
              {c.coversFull ? null : c.available ? (
                <span className="ml-auto shrink-0 font-body text-[10px] font-semibold text-orange">
                  {t('schedule.assign.partOfShift')}
                </span>
              ) : (
                <span className="ml-auto shrink-0 font-body text-[10px] font-semibold text-muted-ink">
                  {t('schedule.assign.notFree')}
                </span>
              )}
            </span>
            {!c.coversFull && c.availWindows.length > 0 && (
              <span className="pl-7 font-body text-[10px] text-muted-ink">
                {t('schedule.assign.freeHours', { hours: hoursLabel(c.availWindows) })}
              </span>
            )}
            {warning && (
              <span className="pl-7 font-body text-[10px] font-bold text-coral-dark">{warning}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function AssignPopover({
  title,
  subtitle,
  candidates,
  candidatesAll,
  anchorRect,
  onPick,
  onClose,
  onRemove,
  editHours,
  split,
  swaps,
  onSwap,
}: {
  title: string
  subtitle?: string
  candidates: Candidate[]
  /** Same list but including people whose availability doesn't cover the window. */
  candidatesAll: Candidate[]
  anchorRect: DOMRect
  onPick: (employeeId: number, covered?: { start: string; end: string }) => void
  onClose: () => void
  /** Present only for an existing person's shift — take them off it, gap or not. */
  onRemove?: () => void
  /** Present only for an existing shift — change just this person's own start/end. */
  editHours?: { start: string; end: string; onSave: (startHHMM24: string, endHHMM24: string) => void }
  split?: SplitConfig
  /** Direct-swap partners (both people cover both shifts). Existing shift only. */
  swaps?: SwapOption[]
  onSwap?: (option: SwapOption) => void
}) {
  const t = useT()
  const [showAll, setShowAll] = useState(false)
  const [showSwaps, setShowSwaps] = useState(false)
  const [splitTime, setSplitTime] = useState(() =>
    split ? defaultSplit(split.windowStart, split.windowEnd) : '',
  )
  const [editStart, setEditStart] = useState(editHours?.start ?? '')
  const [editEnd, setEditEnd] = useState(editHours?.end ?? '')
  const editDirty = !!editHours && (editStart !== editHours.start || editEnd !== editHours.end)
  const editValid = editStart !== '' && editEnd !== '' && editStart < editEnd

  // Keep the whole popover on screen: cap its height and clamp its top so it never
  // runs off the bottom (or top) edge; tall content scrolls inside.
  const maxHeight = Math.min(560, window.innerHeight - 24)
  const left = Math.min(Math.max(anchorRect.left, 8), window.innerWidth - WIDTH - 8)
  const top = Math.max(8, Math.min(anchorRect.bottom + 8, window.innerHeight - 8 - maxHeight))

  // Splitting is a last resort — only offered when nobody can cover the whole window.
  const someoneCoversWhole = candidates.some((c) => c.coversFull)
  const showSplit = !!split && !someoneCoversWhole
  const splitValid = !!split && splitTime > split.windowStart && splitTime < split.windowEnd

  return (
    <>
      {/* click-outside catcher */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 flex flex-col gap-3 overflow-y-auto rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[4px_4px_0_var(--color-ink)]"
        style={{ top, left, width: WIDTH, maxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-sm font-bold text-ink">{title}</span>
            {subtitle && <span className="font-body text-[11px] font-semibold text-muted-ink">{subtitle}</span>}
          </div>
          <CandidateList
            candidates={showAll ? candidatesAll : candidates}
            onPick={onPick}
            empty={t('schedule.assign.noneAvailable')}
          />
          <button
            onClick={() => setShowAll((v) => !v)}
            className="self-start font-body text-[10px] font-bold text-sky-dark transition-opacity hover:opacity-70"
          >
            {showAll ? t('schedule.assign.onlyFree') : t('schedule.assign.addNotFree')}
          </button>
        </div>

        {swaps && onSwap && (
          <div className="flex flex-col gap-2 border-t-2 border-dashed border-cream pt-2.5">
            <button
              onClick={() => setShowSwaps((v) => !v)}
              className="flex items-center justify-between font-body text-[11px] font-bold text-ink"
            >
              <span>{t('schedule.assign.swapTitle')}</span>
              <span className="font-body text-[10px] font-semibold text-muted-ink">
                {swaps.length} {showSwaps ? '▾' : '▸'}
              </span>
            </button>
            {showSwaps &&
              (swaps.length === 0 ? (
                <span className="font-body text-[10px] text-muted-ink">{t('schedule.assign.noSwaps')}</span>
              ) : (
                <div className="flex max-h-44 flex-col gap-1 overflow-y-auto">
                  {swaps.map((o) => (
                    <button
                      key={`${o.employeeId}-${o.theirShift.shiftIds.join(',')}`}
                      onClick={() => onSwap(o)}
                      className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-cream"
                    >
                      <FruitAvatar kind={fruitForPerson(o)} size={22} />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-body text-xs font-bold text-ink">{o.name}</span>
                        <span className="font-body text-[10px] text-muted-ink">
                          {t('schedule.assign.givesYou', {
                            day: DAY_LABEL[o.theirShift.day],
                            store: o.theirShift.storeName,
                            time: timeRangeCompact(o.theirShift.start, o.theirShift.end),
                          })}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
          </div>
        )}

        {editHours && (
          <div className="flex flex-col gap-2 border-t-2 border-dashed border-cream pt-2.5">
            <span className="font-body text-[11px] font-bold text-muted-ink">
              {t('schedule.assign.adjustHours')}
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
                className="rounded-lg border-2 border-ink px-1.5 py-0.5 font-body text-xs font-bold text-ink"
              />
              <span className="font-body text-xs font-bold text-muted-ink">–</span>
              <input
                type="time"
                value={editEnd}
                onChange={(e) => setEditEnd(e.target.value)}
                className="rounded-lg border-2 border-ink px-1.5 py-0.5 font-body text-xs font-bold text-ink"
              />
              <button
                disabled={!editDirty || !editValid}
                onClick={() => editHours.onSave(editStart, editEnd)}
                className="ml-auto rounded-full border-2 border-ink bg-green px-3 py-0.5 font-heading text-[11px] font-bold text-white disabled:opacity-40"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        )}

        {showSplit && split && (
          <div className="flex flex-col gap-2 border-t-2 border-dashed border-cream pt-2.5">
            <span className="font-body text-[11px] font-bold text-coral-dark">
              {t('schedule.assign.splitWarning')}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-body text-[11px] font-bold text-muted-ink">
                {t('schedule.assign.splitAt')}
              </span>
              <input
                type="time"
                value={splitTime}
                min={split.windowStart}
                max={split.windowEnd}
                onChange={(e) => setSplitTime(e.target.value)}
                className="rounded-lg border-2 border-ink px-1.5 py-0.5 font-body text-xs font-bold text-ink"
              />
            </div>
            {splitValid && (
              <>
                {split.headStaysWith !== null ? (
                  <span className="font-body text-[11px] font-semibold text-muted-ink">
                    {t('schedule.assign.keeps', {
                      name: split.headStaysWith,
                      start: to12Hour(split.windowStart),
                      end: to12Hour(splitTime),
                    })}
                  </span>
                ) : (
                  <>
                    <span className="font-body text-[11px] font-semibold text-muted-ink">
                      {t('schedule.assign.whoCovers', {
                        start: to12Hour(split.windowStart),
                        end: to12Hour(splitTime),
                      })}
                    </span>
                    <CandidateList
                      candidates={split.candidatesFor(split.windowStart, splitTime)}
                      onPick={(id) => split.commit({ which: 'head', splitAt: splitTime, employeeId: id })}
                      empty={t('schedule.assign.noneFirstHalf')}
                    />
                  </>
                )}
                <span className="font-body text-[11px] font-semibold text-muted-ink">
                  {t('schedule.assign.whoCovers', { start: to12Hour(splitTime), end: to12Hour(split.windowEnd) })}
                </span>
                <CandidateList
                  candidates={split.candidatesFor(splitTime, split.windowEnd)}
                  onPick={(id) => split.commit({ which: 'tail', splitAt: splitTime, employeeId: id })}
                  empty={t('schedule.assign.noneSecondHalf')}
                />
              </>
            )}
          </div>
        )}

        {onRemove && (
          <button
            onClick={onRemove}
            className="border-t-2 border-dashed border-cream pt-2.5 text-left font-body text-[11px] font-bold text-coral-dark transition-opacity hover:opacity-70"
          >
            {t('schedule.assign.removeShift')}
          </button>
        )}
      </div>
    </>
  )
}
