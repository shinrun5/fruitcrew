import { useState } from 'react'
import { type Candidate, limitWarning } from '../lib/candidates'
import { popoverBox } from '../lib/popover'
import type { SwapOption } from '../lib/swaps'
import { fruitForPerson } from '../lib/fruit'
import { clockToMin, DAY_LABEL, minToClock, timeRangeCompact, to12Hour } from '../lib/time'
import { useT } from '../lib/i18n'
import { FruitAvatar } from './FruitAvatar'
import type { DayOfWeek } from '../types'

/** A sensible default split point: the window's midpoint, snapped to the half hour. */
function defaultSplit(windowStart: string, windowEnd: string): string {
  const a = clockToMin(windowStart)
  const b = clockToMin(windowEnd)
  const snapped = Math.round((a + b) / 2 / 30) * 30
  const mid = a + 30 < b - 30 ? Math.min(Math.max(snapped, a + 30), b - 30) : Math.round((a + b) / 2)
  return minToClock(mid)
}

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

export function CandidateList({
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
            {c.alreadyWorking.length > 0 && c.coveredWindow ? (
              <span className="pl-7 font-body text-[10px] text-muted-ink">
                {t('schedule.assign.alreadyWorking', {
                  hours: hoursLabel(c.alreadyWorking),
                  covered: hoursLabel([c.coveredWindow]),
                })}
              </span>
            ) : (
              !c.coversFull &&
              c.availWindows.length > 0 && (
                <span className="pl-7 font-body text-[10px] text-muted-ink">
                  {t('schedule.assign.freeHours', { hours: hoursLabel(c.availWindows) })}
                </span>
              )
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
  removeLabel,
  onOffer,
  section,
  editHours,
  split,
  swaps,
  onSwap,
  weekShifts,
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
  /** what the remove button says, when it isn't taking a person off (an open shift) */
  removeLabel?: string
  /** put this shift out for the crew to pick up (a gap, or someone who can't make it) */
  onOffer?: { label: string; hint: string; onClick: () => void }
  /** Present only for an existing shift at a store with sections — which part
   * of the store this shift is on. Tapping the current one clears it. */
  section?: { options: { id: number; name: string }[]; current: number | null; onSet: (sectionId: number | null) => void }
  /** Present only for an existing shift — change just this person's own start/end. */
  editHours?: { start: string; end: string; label?: string; onSave: (startHHMM24: string, endHHMM24: string) => void }
  split?: SplitConfig
  /** Direct-swap partners (both people cover both shifts). Existing shift only. */
  swaps?: SwapOption[]
  onSwap?: (option: SwapOption) => void
  /** This person's other shifts this week (any store) — existing shift only,
   * undefined for a gap. Context for when the whole week isn't on screen at
   * once (the mobile day deck), but shown everywhere since it's cheap. */
  weekShifts?: { day: DayOfWeek; storeName: string; start: string; end: string }[]
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
        style={popoverBox(anchorRect)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-sm font-bold text-ink">{title}</span>
            {subtitle && <span className="font-body text-[11px] font-semibold text-muted-ink">{subtitle}</span>}
          </div>

          {section && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-body text-[11px] font-bold text-muted-ink">{t('schedule.assign.section')}</span>
              {section.options.map((o) => {
                const on = o.id === section.current
                return (
                  <button
                    key={o.id}
                    onClick={() => section.onSet(on ? null : o.id)}
                    aria-pressed={on}
                    className={`rounded-full border-2 px-2 py-0.5 font-body text-[11px] font-bold ${
                      on ? 'border-grape bg-grape/20 text-ink' : 'border-ink/30 text-muted-ink hover:border-ink hover:text-ink'
                    }`}
                  >
                    {o.name}
                  </button>
                )
              })}
            </div>
          )}

          {weekShifts && weekShifts.length > 0 && (
            <div className="flex flex-col gap-1 rounded-xl bg-cream px-2 py-1.5">
              <span className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
                {t('schedule.assign.alsoWorking')}
              </span>
              {weekShifts.map((s, i) => (
                <span key={i} className="font-body text-[11px] text-ink">
                  <b>{DAY_LABEL[s.day]}</b> {timeRangeCompact(s.start, s.end)} · {s.storeName}
                </span>
              ))}
            </div>
          )}

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
              {editHours.label ?? t('schedule.assign.adjustHours')}
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

        {onOffer && (
          <button
            onClick={onOffer.onClick}
            className="flex flex-col gap-0.5 rounded-xl border-2 border-dashed border-orange bg-orange/10 px-2 py-1.5 text-left transition-opacity hover:opacity-80"
          >
            <span className="font-body text-[11px] font-bold text-ink">{onOffer.label}</span>
            <span className="font-body text-[10px] text-muted-ink">{onOffer.hint}</span>
          </button>
        )}

        {onRemove && (
          <button
            onClick={onRemove}
            className="border-t-2 border-dashed border-cream pt-2.5 text-left font-body text-[11px] font-bold text-coral-dark transition-opacity hover:opacity-70"
          >
            {removeLabel ?? t('schedule.assign.removeShift')}
          </button>
        )}
      </div>
    </>
  )
}
