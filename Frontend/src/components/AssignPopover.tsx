import { type ReactNode, useState } from 'react'
import { type Candidate, limitWarning } from '../lib/candidates'
import type { SwapOption } from '../lib/swaps'
import { fruitForPerson } from '../lib/fruit'
import { clockToMin, DAY_LABEL, minToClock, timeRangeCompact, to12Hour } from '../lib/time'
import { useT } from '../lib/i18n'
import { FruitAvatar } from './FruitAvatar'
import { SheetClose, SheetPopover } from './SheetPopover'
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

/** A folded extra inside the panel — swap, split, their week — a row with a
 * count or note on the right that opens in place. */
function Fold({
  label,
  note,
  open,
  onToggle,
  children,
}: {
  label: string
  note?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="border-t-2 border-ink/10">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 py-2.5 text-left">
        <span className="min-w-0 flex-1 font-body text-xs font-bold text-ink">{label}</span>
        {note && <span className="shrink-0 font-body text-[11px] text-muted-ink">{note}</span>}
        <span aria-hidden className={`font-heading text-base leading-none text-muted-ink transition-transform ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
      </button>
      {open && <div className="flex flex-col gap-2 pb-3">{children}</div>}
    </div>
  )
}

const label = 'font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink'

/** Tapping a shift on the schedule (or a gap, or an open shift): who and when
 * up top, then the everyday changes — hours, section, someone else — and the
 * rarer ones (swap, split, their week) folded underneath, with offering it to
 * the crew and taking them off at the bottom. A sheet from the bottom on a
 * phone; a popover beside the shift on a computer. */
export function AssignPopover({
  title,
  subtitle,
  person,
  alerts = [],
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
  /** whose shift it is — their fruit goes next to the title */
  person?: { employeeId: number; avatarFruit: string | null }
  /** things to know before changing it (not free this day, must be able to open) */
  alerts?: string[]
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
  const [fold, setFold] = useState<'swap' | 'split' | 'week' | null>(null)
  const toggle = (f: 'swap' | 'split' | 'week') => setFold((cur) => (cur === f ? null : f))
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
  // a person's shift: the list is who could take it instead; a gap: who could cover it
  const isPersonShift = !!onRemove && !!person
  const time = 'min-w-0 rounded-lg border-2 border-ink bg-paper px-1.5 py-1 font-body text-xs font-bold text-ink'

  return (
    <SheetPopover anchorRect={anchorRect} label={title} onClose={onClose}>
      {/* who and when */}
      <div className="flex items-start gap-2.5">
        {person && <FruitAvatar kind={fruitForPerson(person)} size={34} />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-heading text-base font-bold leading-tight text-ink">{title}</span>
          {subtitle && <span className="font-body text-xs font-semibold text-muted-ink">{subtitle}</span>}
          {alerts.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {alerts.map((a) => (
                <span key={a} className="rounded-full border-2 border-coral bg-coral-bg px-2 py-px font-body text-[11px] font-bold text-coral-dark">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
        <SheetClose onClose={onClose} label={t('common.close')} />
      </div>

      {/* the everyday changes */}
      {(editHours || section) && (
        <div className="mt-3 flex flex-col gap-3 border-t-2 border-ink/10 pt-3">
          {editHours && (
            <div className="flex flex-col gap-1.5">
              <span className={label}>{editHours.label ?? t('schedule.assign.hoursLabel')}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <input type="time" value={editStart} onChange={(e) => setEditStart(e.target.value)} className={time} />
                <span className="font-body text-xs font-bold text-muted-ink">–</span>
                <input type="time" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} className={time} />
                {editDirty && (
                  <button
                    disabled={!editValid}
                    onClick={() => editHours.onSave(editStart, editEnd)}
                    className="rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-xs font-bold text-white disabled:opacity-40"
                  >
                    {t('common.save')}
                  </button>
                )}
              </div>
            </div>
          )}
          {section && (
            <div className="flex flex-col gap-1.5">
              <span className={label}>{t('schedule.assign.section')}</span>
              <div className="flex flex-wrap gap-1.5">
                {section.options.map((o) => {
                  const on = o.id === section.current
                  return (
                    <button
                      key={o.id}
                      onClick={() => section.onSet(on ? null : o.id)}
                      aria-pressed={on}
                      className={`rounded-full border-2 px-2.5 py-1 font-body text-xs font-bold ${
                        on ? 'border-grape bg-grape/20 text-ink' : 'border-ink/30 text-muted-ink hover:border-ink hover:text-ink'
                      }`}
                    >
                      {on && '✓ '}
                      {o.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* someone else */}
      <div className="mt-3 flex flex-col gap-1.5 border-t-2 border-ink/10 pt-3">
        <span className={label}>{isPersonShift ? t('schedule.assign.replaceTitle') : t('schedule.assign.whosFree')}</span>
        <CandidateList
          candidates={showAll ? candidatesAll : candidates}
          onPick={onPick}
          empty={t('schedule.assign.noneAvailable')}
        />
        <button
          onClick={() => setShowAll((v) => !v)}
          className="self-start font-body text-[11px] font-bold text-sky-dark transition-opacity hover:opacity-70"
        >
          {showAll ? t('schedule.assign.onlyFree') : t('schedule.assign.addNotFree')}
        </button>
      </div>

      {/* the rarer ones, folded */}
      <div className="mt-3">
        {swaps && onSwap && (
          <Fold label={t('schedule.assign.swapTitle')} note={String(swaps.length)} open={fold === 'swap'} onToggle={() => toggle('swap')}>
            {swaps.length === 0 ? (
              <span className="font-body text-[11px] text-muted-ink">{t('schedule.assign.noSwaps')}</span>
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
            )}
          </Fold>
        )}

        {showSplit && split && (
          <Fold label={t('schedule.assign.splitTitle')} open={fold === 'split'} onToggle={() => toggle('split')}>
            <span className="font-body text-[11px] text-muted-ink">{t('schedule.assign.splitHint')}</span>
            <label className="flex items-center gap-2">
              <span className="font-body text-[11px] font-bold text-muted-ink">{t('schedule.assign.splitAt')}</span>
              <input
                type="time"
                value={splitTime}
                min={split.windowStart}
                max={split.windowEnd}
                onChange={(e) => setSplitTime(e.target.value)}
                className={time}
              />
            </label>
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
                    <span className="font-body text-[11px] font-semibold text-ink">
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
                <span className="font-body text-[11px] font-semibold text-ink">
                  {t('schedule.assign.whoCovers', { start: to12Hour(splitTime), end: to12Hour(split.windowEnd) })}
                </span>
                <CandidateList
                  candidates={split.candidatesFor(splitTime, split.windowEnd)}
                  onPick={(id) => split.commit({ which: 'tail', splitAt: splitTime, employeeId: id })}
                  empty={t('schedule.assign.noneSecondHalf')}
                />
              </>
            )}
          </Fold>
        )}

        {weekShifts && weekShifts.length > 0 && (
          <Fold
            label={t('schedule.assign.alsoWorking')}
            note={t('schedule.assign.weekCount', { n: weekShifts.length })}
            open={fold === 'week'}
            onToggle={() => toggle('week')}
          >
            <div className="flex flex-col gap-1 rounded-xl bg-cream px-2.5 py-2">
              {weekShifts.map((s, i) => (
                <span key={i} className="flex gap-2 font-body text-xs text-ink">
                  <b className="w-9 shrink-0">{DAY_LABEL[s.day]}</b>
                  <span>{timeRangeCompact(s.start, s.end)}</span>
                  <span className="min-w-0 truncate text-muted-ink">{s.storeName}</span>
                </span>
              ))}
            </div>
          </Fold>
        )}
      </div>

      {/* last: hand it to the crew, or take them off */}
      {(onOffer || onRemove) && (
        <div className="mt-1 flex flex-col gap-2 border-t-2 border-ink/10 pt-3">
          {onOffer && (
            <button
              onClick={onOffer.onClick}
              className="flex flex-col gap-0.5 rounded-xl border-2 border-dashed border-orange bg-orange/10 px-3 py-2 text-left transition-opacity hover:opacity-80"
            >
              <span className="font-body text-xs font-bold text-ink">{onOffer.label}</span>
              <span className="font-body text-[11px] text-muted-ink">{onOffer.hint}</span>
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="self-start rounded-full border-2 border-coral px-3 py-1 font-heading text-xs font-bold text-coral-dark transition-colors hover:bg-coral-bg"
            >
              {removeLabel ?? t('schedule.assign.removeShift')}
            </button>
          )}
        </div>
      )}
    </SheetPopover>
  )
}
