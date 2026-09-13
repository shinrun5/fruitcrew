import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AssignPopover } from '../components/AssignPopover'
import { ExportSchedule } from '../components/ExportSchedule'
import { DayCard, type DayPerson } from '../components/ScheduleCards'
import { SlotEditor } from '../components/SlotEditor'
import { Header } from '../components/Header'
import { api } from '../lib/api'
import { useStore } from '../lib/store-context'
import { type Candidate, computeCandidates } from '../lib/candidates'
import { type SwapOption, computeSwapOptions } from '../lib/swaps'
import { computeGapCards, type GapCardData } from '../lib/gaps'
import { effectiveCanOpen } from '../lib/openers'
import {
  DAYS,
  DAY_LABEL,
  dayDate,
  shiftWeekYMD,
  thisMondayYMD,
  timeRange,
  to12Hour,
  toHHMM24,
  toMinutes,
  weekRangeLabel,
  windowsOverlap,
  withTime,
} from '../lib/time'
import type {
  DayOfWeek,
  Employee,
  EmployeeStore,
  GenerateScheduleResult,
  RecurringAvailability,
  Shift,
  ShiftRequirement,
  SnapshotDetail,
  Store,
} from '../types'

interface BoardData {
  stores: Store[]
  employees: Employee[]
  employeeStores: EmployeeStore[]
  shifts: Shift[]
  requirements: ShiftRequirement[]
  availability: RecurringAvailability[]
}

async function loadBoard(): Promise<BoardData> {
  const [stores, employees, employeeStores, shifts, requirements, availability] = await Promise.all([
    api.getStores(),
    api.getEmployees(),
    api.getEmployeeStores(),
    api.getShifts(),
    api.getShiftRequirements(),
    api.getAvailability(),
  ])
  return { stores, employees, employeeStores, shifts, requirements, availability }
}

interface PickerState {
  anchorRect: DOMRect
  storeId: number
  day: DayOfWeek
  start: string
  end: string
  /** the person's merged shift rows (empty = filling an open slot -> POST) */
  shiftIds: number[]
  requirementId: number | null
  excludeIds: Set<number>
  requireOpener: boolean
  graceMinutes: number
  personId: number | null
  personName: string | null
  candidates: Candidate[]
  candidatesAll: Candidate[]
  swaps: SwapOption[]
  title: string
  subtitle: string
}

export function Dashboard() {
  const [board, setBoard] = useState<BoardData | null>(null)
  // fatal — the board itself never loaded, so there's nothing to show at all
  const [loadError, setLoadError] = useState<string | null>(null)
  // everything else (generate/publish/restore/etc. failing) — shown as a
  // dismissible banner over the board, which stays usable underneath
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [lastResult, setLastResult] = useState<GenerateScheduleResult | null>(null)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [slotEditor, setSlotEditor] = useState<{ anchorRect: DOMRect; requirements: ShiftRequirement[] } | null>(null)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [postedWeekStart, setPostedWeekStart] = useState<string | null>(null)
  const [publishBusy, setPublishBusy] = useState(false)
  const [weekStart, setWeekStart] = useState<string | null>(null)
  // which week the manager is looking at — equals weekStart for the live editor,
  // an earlier value while browsing locked past weeks (read-only)
  const [viewWeek, setViewWeek] = useState<string | null>(null)
  const [pastWeeks, setPastWeeks] = useState<string[]>([])
  const [pastView, setPastView] = useState<SnapshotDetail | null>(null)
  const [pastLoading, setPastLoading] = useState(false)
  // the board's own week has already ended, calendar-wise, but nobody's
  // advanced past it yet — still editable, just stale
  const [liveWeekStale, setLiveWeekStale] = useState(false)
  const [resuming, setResuming] = useState(false)
  const { storeId, stores } = useStore()

  useEffect(() => {
    loadBoard().then(setBoard).catch((e) => setLoadError(String(e)))
  }, [])

  const loadStatus = useCallback((storeId: number, resetView = false) => {
    return api
      .getScheduleStatus(storeId)
      .then((s) => {
        setPublishedAt(s.publishedAt)
        setWeekStart(s.weekStart)
        setPostedWeekStart(s.postedWeekStart)
        setPastWeeks(s.pastWeeks)
        setLiveWeekStale(s.liveWeekStale)
        setViewWeek((v) => (resetView || v == null ? s.weekStart : v))
      })
      .catch(() => {})
  }, [])

  // Bring a saved week back onto the live board — the backend only allows this
  // while that week's own calendar dates haven't passed, regardless of whether
  // the board (or even a later week's publish) has since moved past it.
  async function resumeWeek(id: number) {
    if (storeId == null) return
    setResuming(true)
    setError(null)
    try {
      const { weekStart: restored } = await api.restoreSnapshot(storeId, id)
      setViewWeek(restored)
      await loadStatus(storeId, true)
      setBoard(await loadBoard())
    } catch (e) {
      setError(String(e))
    } finally {
      setResuming(false)
    }
  }

  useEffect(() => {
    if (storeId == null) return
    void loadStatus(storeId, true)
  }, [storeId, loadStatus])

  // viewing a locked past week -> pull its frozen roster
  const isPast =
    !!viewWeek && !!weekStart && viewWeek.slice(0, 10) < weekStart.slice(0, 10)
  useEffect(() => {
    if (storeId == null || !isPast || !viewWeek) {
      setPastView(null)
      return
    }
    let live = true
    setPastLoading(true)
    api
      .getScheduleWeekView(storeId, viewWeek.slice(0, 10))
      .then((s) => live && setPastView(s))
      .catch(() => live && setPastView(null))
      .finally(() => live && setPastLoading(false))
    return () => {
      live = false
    }
  }, [storeId, isPast, viewWeek])

  // one-week availability overrides for the week on the board (candidate picker
  // should honour "just this week I can only work Monday", same as the solver)
  const [weekOverrides, setWeekOverrides] = useState<{
    overriddenEmployeeIds: number[]
    windows: { employeeId: number; day: DayOfWeek; start: string; end: string }[]
  } | null>(null)
  useEffect(() => {
    if (!weekStart) {
      setWeekOverrides(null)
      return
    }
    let live = true
    api
      .getWeekAvailability(weekStart.slice(0, 10))
      .then((r) => live && setWeekOverrides(r))
      .catch(() => live && setWeekOverrides(null))
    return () => {
      live = false
    }
  }, [weekStart])

  // each worker's availability for the week on the board + whether they've checked it
  type AvRow = Awaited<ReturnType<typeof api.getAvailabilityConfirmations>>['workers'][number]
  const [avConfirm, setAvConfirm] = useState<AvRow[]>([])
  const [showHours, setShowHours] = useState(false)
  useEffect(() => {
    if (!weekStart) {
      setAvConfirm([])
      return
    }
    let live = true
    api
      .getAvailabilityConfirmations(weekStart.slice(0, 10))
      .then((r) => live && setAvConfirm(r.workers))
      .catch(() => live && setAvConfirm([]))
    return () => {
      live = false
    }
  }, [weekStart])

  // holidays configured for the selected store
  const [holidays, setHolidays] = useState<Awaited<ReturnType<typeof api.getStoreHours>>['holidays']>([])
  useEffect(() => {
    if (storeId == null) return
    let live = true
    api
      .getStoreHours(storeId)
      .then((c) => live && setHolidays(c.holidays))
      .catch(() => live && setHolidays([]))
    return () => {
      live = false
    }
  }, [storeId])

  // open shift notes for the selected store
  const [openNotes, setOpenNotes] = useState<{ count: number; latest: string | null }>({ count: 0, latest: null })
  useEffect(() => {
    if (storeId == null) return
    let live = true
    api
      .getNotes(storeId)
      .then((r) => live && setOpenNotes({ count: r.open.length, latest: r.open[0]?.body ?? null }))
      .catch(() => live && setOpenNotes({ count: 0, latest: null }))
    return () => {
      live = false
    }
  }, [storeId])

  const effectiveAvailability = useMemo<RecurringAvailability[]>(() => {
    if (!board) return []
    if (!weekOverrides || weekOverrides.overriddenEmployeeIds.length === 0) return board.availability
    const overridden = new Set(weekOverrides.overriddenEmployeeIds)
    const asRows: RecurringAvailability[] = weekOverrides.windows.map((w, i) => ({
      id: -1 - i,
      employeeId: w.employeeId,
      day: w.day,
      start: `1970-01-01T${w.start}:00.000Z`,
      end: `1970-01-01T${w.end}:00.000Z`,
    }))
    return [...board.availability.filter((a) => !overridden.has(a.employeeId)), ...asRows]
  }, [board, weekOverrides])

  async function togglePublish(next: boolean) {
    if (storeId == null) return
    setPublishBusy(true)
    try {
      const s = next ? await api.publishSchedule(storeId) : await api.unpublishSchedule(storeId)
      setPublishedAt(s.publishedAt)
      await loadStatus(storeId)
    } catch (e) {
      setError(String(e))
    } finally {
      setPublishBusy(false)
    }
  }

  // ‹ › on the toolbar: step through past (locked) weeks and back to the live
  // one. Going forward from the live week starts the next week — which freezes
  // the current one.
  async function navWeek(delta: number) {
    if (!weekStart || !viewWeek || storeId == null) return
    const weeks = [...new Set([...pastWeeks, weekStart].map((w) => w.slice(0, 10)))].sort()
    const here = weeks.indexOf(viewWeek.slice(0, 10))
    if (delta < 0) {
      if (here > 0) setViewWeek(weeks[here - 1])
      return
    }
    // delta > 0
    if (viewWeek.slice(0, 10) < weekStart.slice(0, 10)) {
      if (here >= 0 && here < weeks.length - 1) setViewWeek(weeks[here + 1])
      return
    }
    // on the live week -> advance to next week
    if (
      !window.confirm(
        'Start next week? This week moves into history — you can still come back and edit it (‹) until its dates actually pass.',
      )
    )
      return
    try {
      const { weekStart: next } = await api.setScheduleWeek(storeId, shiftWeekYMD(weekStart, 1))
      setWeekStart(next)
      setViewWeek(next)
      await loadStatus(storeId, true)
      setBoard(await loadBoard())
    } catch (e) {
      setError(String(e))
    }
  }

  async function handleGenerate() {
    if (storeId == null) return
    setGenerating(true)
    setError(null)
    try {
      // never lose the current schedule to a regenerate — auto-save it first
      const hadShifts = (board?.shifts.filter((s) => s.storeId === storeId).length ?? 0) > 0
      const result = await api.generateSchedule(storeId, { saveFirst: hadShifts })
      setLastResult(result)
      setBoard(await loadBoard())
      await loadStatus(storeId)
    } catch (e) {
      setError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  function candidatesForWindow(
    storeId: number,
    day: DayOfWeek,
    start: string,
    end: string,
    excludeIds: Set<number>,
    requireOpener = false,
    graceMinutes = 0,
    ignoreAvailability = false,
  ) {
    if (!board) return []
    const store = board.stores.find((s) => s.id === storeId)
    return computeCandidates({
      storeId,
      day,
      start,
      end,
      excludeEmployeeIds: excludeIds,
      employees: board.employees,
      employeeStores: board.employeeStores,
      availability: effectiveAvailability,
      shifts: board.shifts,
      requireOpener,
      storeRequiresOpenerSkill: store?.requiresOpenerSkill ?? true,
      graceMinutes,
      ignoreAvailability,
    })
  }

  function openPickerFor(args: {
    e: MouseEvent<HTMLButtonElement>
    storeId: number
    day: DayOfWeek
    start: string
    end: string
    shiftIds: number[]
    requirementId: number | null
    personId: number | null
    personName: string | null
    excludeIds: Set<number>
    requireOpener: boolean
    graceMinutes: number
    title: string
    subtitle: string
  }) {
    if (!board) return
    const { e, storeId, day, start, end, excludeIds, requireOpener, graceMinutes, ...rest } = args
    const candidates = candidatesForWindow(storeId, day, start, end, excludeIds, requireOpener, graceMinutes)
    const candidatesAll = candidatesForWindow(storeId, day, start, end, excludeIds, requireOpener, graceMinutes, true)

    // direct-swap partners: only for an existing person's shift
    let swaps: SwapOption[] = []
    if (rest.shiftIds.length > 0 && rest.personId != null) {
      const v = buildView(board)
      const spans = v.stores.flatMap((st) =>
        st.days.flatMap((d) =>
          d.people.map((p) => ({
            employeeId: p.employeeId,
            name: p.name,
            avatarFruit: p.avatarFruit,
            storeId: st.id,
            storeName: st.name,
            day: d.day,
            start: p.start,
            end: p.end,
            shiftIds: p.shiftIds,
          })),
        ),
      )
      const storeName = board.stores.find((s) => s.id === storeId)?.name ?? `Store ${storeId}`
      swaps = computeSwapOptions({
        a: {
          employeeId: rest.personId,
          name: rest.personName ?? '',
          avatarFruit: board.employees.find((emp) => emp.id === rest.personId)?.avatarFruit ?? null,
          storeId,
          storeName,
          day,
          start,
          end,
          shiftIds: rest.shiftIds,
        },
        spans,
        employeeStores: board.employeeStores,
        availability: effectiveAvailability,
      })
    }

    setPicker({
      anchorRect: e.currentTarget.getBoundingClientRect(),
      storeId,
      day,
      start,
      end,
      excludeIds,
      requireOpener,
      graceMinutes,
      candidates,
      candidatesAll,
      swaps,
      ...rest,
    })
  }

  async function handleSwap(o: SwapOption) {
    if (!picker || picker.personId == null) return
    const aId = picker.personId
    const aRows = picker.shiftIds
    setPicker(null)
    try {
      await Promise.all(aRows.map((id) => api.updateShift(id, { employeeId: o.employeeId })))
      await Promise.all(o.theirShift.shiftIds.map((id) => api.updateShift(id, { employeeId: aId })))
      setBoard(await loadBoard())
    } catch (e) {
      setError(String(e))
    }
  }

  /** Commit a last-resort split. tail: hand [T,end] to someone (and, for an existing
   * shift, shorten the original to end at T). head: hand [start,T] to someone (gaps only). */
  /** Collapse a person's (possibly merged) shift rows into a single row [from, to]. */
  async function collapseTo(shiftIds: number[], from: string, to: string) {
    const [first, ...rest] = shiftIds
    if (first === undefined) return
    await api.updateShift(first, { start: from, end: to })
    await Promise.all(rest.map((id) => api.deleteShift(id)))
  }

  async function commitSplit({
    which,
    splitAt,
    employeeId,
  }: {
    which: 'head' | 'tail'
    splitAt: string
    employeeId: number
  }) {
    if (!picker || !board) return
    const { shiftIds, storeId, day, start, end } = picker
    setPicker(null)
    try {
      if (which === 'tail') {
        if (shiftIds.length > 0) await collapseTo(shiftIds, start, withTime(end, splitAt))
        await api.createShift({ employeeId, storeId, day, start: withTime(start, splitAt), end })
      } else {
        await api.createShift({ employeeId, storeId, day, start, end: withTime(end, splitAt) })
      }
      setBoard(await loadBoard())
    } catch (e) {
      setError(String(e))
    }
  }

  async function handlePick(employeeId: number, covered?: { start: string; end: string }) {
    if (!picker || !board) return
    const { shiftIds, storeId, day, start, end } = picker
    setPicker(null)
    // `covered` = the person only works part of this window; clamp their shift to
    // it and let the uncovered part fall out as an open gap.
    const clampStart = covered ? withTime(start, covered.start) : start
    const clampEnd = covered ? withTime(end, covered.end) : end
    try {
      if (shiftIds.length > 0) {
        if (covered) {
          if (shiftIds.length > 1) await collapseTo(shiftIds, clampStart, clampEnd)
          await api.updateShift(shiftIds[0], { employeeId, start: clampStart, end: clampEnd })
        } else {
          await Promise.all(shiftIds.map((id) => api.updateShift(id, { employeeId })))
        }
      } else {
        await api.createShift({ employeeId, storeId, day, start: clampStart, end: clampEnd })
      }
      // gap cards are derived from real coverage on the next render, so just reload
      setBoard(await loadBoard())
    } catch (e) {
      setError(String(e))
    }
  }

  async function handleRemove() {
    if (!picker || picker.shiftIds.length === 0) return
    const { shiftIds } = picker
    setPicker(null)
    try {
      await Promise.all(shiftIds.map((id) => api.deleteShift(id)))
      setBoard(await loadBoard())
    } catch (e) {
      setError(String(e))
    }
  }

  async function handleEditHours(startHHMM: string, endHHMM: string) {
    if (!picker || picker.shiftIds.length === 0) return
    const { shiftIds, start, end } = picker
    setPicker(null)
    try {
      await collapseTo(shiftIds, withTime(start, startHHMM), withTime(end, endHHMM))
      setBoard(await loadBoard())
    } catch (e) {
      setError(String(e))
    }
  }

  function openSlotEditor(e: MouseEvent<HTMLButtonElement>, requirements: ShiftRequirement[]) {
    if (requirements.length === 0) return
    setSlotEditor({ anchorRect: e.currentTarget.getBoundingClientRect(), requirements })
  }

  async function handleSaveRequirement(
    requirementId: number,
    patch: { regularRequired: number; needOpen: boolean },
  ) {
    setSlotEditor(null)
    try {
      await api.updateRequirement(requirementId, patch)
      setBoard(await loadBoard())
    } catch (e) {
      setError(String(e))
    }
  }

  if (loadError) {
    return (
      <div className="flex h-dvh items-center justify-center font-body text-coral-dark">
        Couldn't load the schedule: {loadError}
      </div>
    )
  }

  if (!board) {
    return (
      <div className="flex h-dvh items-center justify-center font-body text-muted-ink">
        Loading…
      </div>
    )
  }

  if (storeId == null) {
    return (
      <div className="flex h-dvh items-center justify-center font-body text-muted-ink">
        {stores.length === 0 ? 'No stores yet.' : 'Pick a store above.'}
      </div>
    )
  }

  // browsing a saved past week — read-only roster; still editable-again (via
  // Resume) as long as its own calendar week hasn't ended yet
  if (isPast) {
    const locked = !!viewWeek && viewWeek.slice(0, 10) < thisMondayYMD()
    return (
      <>
        <Header
          weekStart={viewWeek ?? undefined}
          onWeekChange={(d) => void navWeek(d)}
          gapCount={null}
          generating={false}
          onGenerate={() => {}}
          readOnly
        />
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <PastWeekBody
          snap={pastView}
          loading={pastLoading}
          storeId={storeId}
          locked={locked}
          resuming={resuming}
          onResume={pastView && !locked ? () => void resumeWeek(pastView.id) : undefined}
        />
      </>
    )
  }

  // just the selected store
  const storeShifts = board.shifts.filter((s) => s.storeId === storeId)
  const full = buildView(board)
  const view = { ...full, stores: full.stores.filter((s) => s.id === storeId) }
  const solved = lastResult !== null || storeShifts.length > 0
  const totalShort =
    view.stores[0]?.days.reduce(
      (n, d) => n + d.gaps.reduce((m, g) => m + g.shortBy, 0),
      0,
    ) ?? 0

  // employees who work the selected store, with their shift-day count there
  const storeEmpIds = new Set(
    board.employeeStores.filter((es) => es.storeId === storeId).map((es) => es.employeeId),
  )
  const weekLoad = board.employees
    .filter((e) => storeEmpIds.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      count: new Set(storeShifts.filter((s) => s.employeeId === e.id).map((s) => s.day)).size,
      max: e.maxShifts,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return (
    <>
      <Header
        weekStart={viewWeek ?? weekStart ?? undefined}
        onWeekChange={(d) => void navWeek(d)}
        gapCount={solved ? totalShort : null}
        generating={generating}
        onGenerate={handleGenerate}
        publishedAt={publishedAt}
        workersSeeWeek={!publishedAt ? postedWeekStart : null}
        onPublish={() => void togglePublish(true)}
        onUnpublish={() => void togglePublish(false)}
        publishBusy={publishBusy}
        extra={
          weekStart && view.stores[0] ? (
            <ExportSchedule storeName={view.stores[0].name} weekStart={weekStart} days={view.stores[0].days} />
          ) : undefined
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {liveWeekStale && (
        <div className="flex flex-wrap items-center gap-2 border-b-2 border-ink/10 bg-orange/10 px-4 py-2 font-body text-[11px] font-bold text-ink sm:px-8">
          <span>This week&rsquo;s dates have already passed — start next week (›) when you&rsquo;re ready.</span>
        </div>
      )}

      {openNotes.count > 0 && (
        <Link
          to="/notes"
          className="flex items-center gap-2 border-b-2 border-ink/10 bg-orange/10 px-4 py-2 font-body text-[11px] font-bold text-ink hover:bg-orange/20 sm:px-8"
        >
          <span className="shrink-0 rounded-full border-2 border-ink bg-paper px-2 py-0.5">
            {openNotes.count} open note{openNotes.count === 1 ? '' : 's'}
          </span>
          {openNotes.latest && (
            <span className="min-w-0 flex-1 truncate font-normal text-muted-ink">
              {openNotes.latest}
            </span>
          )}
          <span className="shrink-0 text-sky-dark">see all ›</span>
        </Link>
      )}

      {weekStart &&
        (() => {
          const wk0 = weekStart.slice(0, 10)
          const wkEnd = new Date(weekStart)
          wkEnd.setUTCDate(wkEnd.getUTCDate() + 6)
          const wk6 = wkEnd.toISOString().slice(0, 10)
          const inWeek = holidays.filter((h) => h.date >= wk0 && h.date <= wk6)
          if (inWeek.length === 0) return null
          return (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-ink/10 bg-coral-bg px-4 py-2 sm:px-8">
              <span className="font-heading text-[11px] font-bold uppercase tracking-wide text-coral-dark">
                Holiday this week
              </span>
              {inWeek.map((h) => (
                <span key={h.id} className="font-body text-[11px] font-bold text-ink">
                  {new Date(`${h.date}T00:00:00Z`).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                  {h.label ? ` · ${h.label}` : ''} —{' '}
                  {h.closed
                    ? 'closed, no shifts generated that day'
                    : `${h.openTime ?? '?'}–${h.closeTime ?? '?'} (adjust shifts by hand)`}
                </span>
              ))}
            </div>
          )
        })()}

      {weekStart &&
        (() => {
          const rows = avConfirm
            .filter((w) => w.storeIds.includes(storeId ?? -1))
            .sort((a, b) => a.name.localeCompare(b.name))
          if (rows.length === 0) return null
          const ready = rows.filter((w) => w.state !== 'pending').length
          return (
            <div className="border-b-2 border-ink/10 bg-paper px-4 py-2.5 sm:px-8">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 font-heading text-[11px] font-bold uppercase tracking-wide text-muted-ink">
                  Availability {weekRangeLabel(weekStart)} · {ready}/{rows.length} in
                </span>
                {rows.map((w) => (
                  <span
                    key={w.employeeId}
                    title={
                      w.state === 'changed'
                        ? 'set their own hours for this week'
                        : w.state === 'confirmed'
                          ? 'confirmed their usual hours'
                          : "hasn't checked yet"
                    }
                    className={`rounded-full border-2 px-2 py-0.5 font-body text-[11px] font-bold ${
                      w.state === 'changed'
                        ? 'border-sky-dark bg-sky/10 text-sky-dark'
                        : w.state === 'confirmed'
                          ? 'border-green bg-green/10 text-green-dark'
                          : 'border-ink/20 text-muted-ink'
                    }`}
                  >
                    {w.state === 'changed' ? '✎ ' : w.state === 'confirmed' ? '✓ ' : ''}
                    {w.name}
                  </span>
                ))}
                <button
                  onClick={() => setShowHours((v) => !v)}
                  className="ml-auto font-body text-[11px] font-bold text-sky-dark"
                >
                  {showHours ? 'Hide hours ▴' : "Everyone's hours ▾"}
                </button>
              </div>

              {showHours && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse font-body text-[11px]">
                    <thead>
                      <tr className="text-muted-ink">
                        <th className="p-1 text-left font-bold">Worker</th>
                        {DAYS.map((d) => (
                          <th key={d} className="p-1 text-left font-bold">
                            {DAY_LABEL[d]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((w) => (
                        <tr key={w.employeeId} className="border-t border-ink/10 align-top">
                          <td className="whitespace-nowrap p-1 font-bold text-ink">
                            {w.name}
                            {w.source === 'override' && (
                              <span className="ml-1 font-normal text-sky-dark">· wk</span>
                            )}
                          </td>
                          {DAYS.map((d) => {
                            const off = w.timeOff.includes(d)
                            const wins = w.days[d] ?? []
                            return (
                              <td key={d} className="p-1">
                                {off ? (
                                  <span className="text-coral-dark">leave</span>
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
            </div>
          )
        })()}

      {solved && weekLoad.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-ink/10 bg-paper px-4 py-2.5 sm:px-8">
          <span className="mr-1 font-heading text-[11px] font-bold uppercase tracking-wide text-muted-ink">
            Shifts this week
          </span>
          {weekLoad.map((l) => (
            <span
              key={l.id}
              title={l.count > l.max ? `over their ${l.max}-day limit` : undefined}
              className={`rounded-full border-2 px-2 py-0.5 font-body text-[11px] font-bold ${
                l.count > l.max
                  ? 'border-coral bg-coral-bg text-coral-dark'
                  : l.count === 0
                    ? 'border-ink/20 text-muted-ink'
                    : 'border-ink bg-paper text-ink'
              }`}
            >
              {l.name} · {l.count}
              {l.count > l.max ? `/${l.max}` : ''}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-8 p-4 sm:p-8">
        {view.stores.length === 0 && <p className="font-body text-muted-ink">No stores set up yet.</p>}
        {view.stores.map((store) => (
          <div key={store.id} className="flex flex-col gap-3">
            {store.days.length > 0 && (
              <>
                <div className="flex items-center gap-2.5">
                  <div className={`h-2.5 w-2.5 rounded-full ${store.accentClass}`} />
                  <span className="font-heading text-lg font-bold text-ink">{store.name}</span>
                </div>
                <div
                  className="grid gap-3.5 overflow-x-auto pb-1"
                  style={{ gridTemplateColumns: `repeat(${store.days.length}, minmax(150px, 1fr))` }}
                >
                  {store.days.map((d) => {
                    const opStart = d.requirements.length
                      ? Math.min(...d.requirements.map((r) => toMinutes(r.start)))
                      : 0
                    const needsOpen = d.requirements.some((r) => r.needOpen)
                    const graceAt = (isoStart: string) =>
                      d.requirements.find(
                        (r) => toMinutes(r.start) <= toMinutes(isoStart) && toMinutes(isoStart) < toMinutes(r.end),
                      )?.graceMinutes ?? 0

                    return (
                      <div key={d.day} className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={(e) => openSlotEditor(e, d.requirements)}
                          className={`flex flex-col items-center leading-tight transition-opacity hover:opacity-60 ${
                            d.gaps.length ? 'text-coral-dark' : 'text-ink'
                          }`}
                        >
                          <span className="font-heading text-xs font-bold">{DAY_LABEL[d.day]}</span>
                          {weekStart && (
                            <span className="font-body text-[10px] font-semibold text-muted-ink">
                              {dayDate(weekStart, DAYS.indexOf(d.day))}
                            </span>
                          )}
                        </button>
                        <DayCard
                          people={d.people}
                          gaps={d.gaps}
                          onPersonClick={(person, e) => {
                            const requireOpener =
                              person.isOpener &&
                              !d.people.some((p) => p.employeeId !== person.employeeId && p.isOpener)
                            openPickerFor({
                              e,
                              storeId: store.id,
                              day: d.day,
                              start: person.start,
                              end: person.end,
                              shiftIds: person.shiftIds,
                              requirementId: null,
                              personId: person.employeeId,
                              personName: person.name,
                              excludeIds: new Set(
                                d.people
                                  .filter((p) =>
                                    windowsOverlap(
                                      toMinutes(p.start),
                                      toMinutes(p.end),
                                      toMinutes(person.start),
                                      toMinutes(person.end),
                                    ),
                                  )
                                  .map((p) => p.employeeId),
                              ),
                              requireOpener,
                              graceMinutes: graceAt(person.start),
                              title: `Instead of ${person.name}`,
                              subtitle: requireOpener
                                ? `${timeRange(person.start, person.end)} · must be able to open`
                                : timeRange(person.start, person.end),
                            })
                          }}
                          onGapClick={(g, e) => {
                            const already = board.shifts.filter(
                              (s) =>
                                s.storeId === store.id &&
                                s.day === d.day &&
                                s.employeeId !== null &&
                                windowsOverlap(
                                  toMinutes(s.start),
                                  toMinutes(s.end),
                                  toMinutes(g.start),
                                  toMinutes(g.end),
                                ),
                            )
                            const alreadyCanOpen = already.some((s) =>
                              effectiveCanOpen(board.employeeStores, board.stores, s.employeeId as number, store.id),
                            )
                            const requireOpener =
                              needsOpen && toMinutes(g.start) <= opStart && !alreadyCanOpen
                            openPickerFor({
                              e,
                              storeId: store.id,
                              day: d.day,
                              start: g.start,
                              end: g.end,
                              shiftIds: [],
                              requirementId: g.requirementId,
                              personId: null,
                              personName: null,
                              excludeIds: new Set(already.map((s) => s.employeeId as number)),
                              requireOpener,
                              graceMinutes: graceAt(g.start),
                              title: 'Who can cover this?',
                              subtitle: requireOpener
                                ? `${timeRange(g.start, g.end)} — ${g.detail} · must be able to open`
                                : `${timeRange(g.start, g.end)} — ${g.detail}`,
                            })
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        ))}
        {view.stores.every((s) => s.days.length === 0) && (
          <p className="font-body text-muted-ink">
            No shifts on the board yet — click Generate Schedule to run the solver.
          </p>
        )}
      </div>
      {picker && (
        <AssignPopover
          key={`${picker.storeId}-${picker.day}-${picker.start}-${picker.shiftIds.join(',') || 'gap'}`}
          title={picker.title}
          subtitle={picker.subtitle}
          candidates={picker.candidates}
          candidatesAll={picker.candidatesAll}
          anchorRect={picker.anchorRect}
          onPick={handlePick}
          onClose={() => setPicker(null)}
          onRemove={picker.shiftIds.length > 0 ? handleRemove : undefined}
          swaps={picker.personId != null ? picker.swaps : undefined}
          onSwap={handleSwap}
          editHours={
            picker.shiftIds.length > 0
              ? { start: toHHMM24(picker.start), end: toHHMM24(picker.end), onSave: handleEditHours }
              : undefined
          }
          split={{
            windowStart: toHHMM24(picker.start),
            windowEnd: toHHMM24(picker.end),
            headStaysWith: picker.personName,
            candidatesFor: (fromHHMM, toHHMM) => {
              // the head sub-window covers open time, so it inherits the opener
              // requirement and the late-arrival grace; the tail is a mid-window handoff
              const isHead = fromHHMM === toHHMM24(picker.start)
              return candidatesForWindow(
                picker.storeId,
                picker.day,
                withTime(picker.start, fromHHMM),
                withTime(picker.start, toHHMM),
                picker.excludeIds,
                isHead && picker.requireOpener,
                isHead ? picker.graceMinutes : 0,
              )
            },
            commit: commitSplit,
          }}
        />
      )}
      {slotEditor && (
        <SlotEditor
          anchorRect={slotEditor.anchorRect}
          requirements={slotEditor.requirements}
          storeName={board.stores.find((s) => s.id === slotEditor.requirements[0]?.storeId)?.name ?? ''}
          onSave={handleSaveRequirement}
          onClose={() => setSlotEditor(null)}
        />
      )}
    </>
  )
}

/** Read-only roster for a locked past week — a frozen snapshot, current store only. */
/** A failed action (generate, publish, restore, …) — dismissible, and doesn't
 * take over the page like the fatal "board never loaded" error does. */
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 border-b-2 border-ink/10 bg-coral-bg px-4 py-2 font-body text-[11px] font-bold text-coral-dark sm:px-8">
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 leading-none text-coral-dark/70 hover:text-coral-dark">
        ✕
      </button>
    </div>
  )
}

function PastWeekBody({
  snap,
  loading,
  storeId,
  locked,
  resuming,
  onResume,
}: {
  snap: SnapshotDetail | null
  loading: boolean
  storeId: number
  locked: boolean
  resuming: boolean
  onResume?: () => void
}) {
  if (loading) {
    return <p className="p-4 font-body text-sm text-muted-ink sm:p-8">Loading…</p>
  }
  if (!snap) {
    return (
      <p className="p-4 font-body text-sm text-muted-ink sm:p-8">
        No saved schedule for that week.
      </p>
    )
  }
  const rows = snap.shifts.filter((s) => s.storeId === storeId)
  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-8">
      {locked ? (
        <p className="mb-3 font-body text-xs text-muted-ink">
          This week is locked — its dates have passed, so it&rsquo;s here for reference only.
        </p>
      ) : (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink/20 bg-cream px-3 py-2">
          <p className="flex-1 font-body text-xs text-ink">
            This week&rsquo;s dates haven&rsquo;t passed yet — you can bring it back to keep editing.
          </p>
          {onResume && (
            <button
              onClick={onResume}
              disabled={resuming}
              className="shrink-0 rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-[11px] font-bold text-white disabled:opacity-50"
            >
              {resuming ? 'Resuming…' : 'Resume editing'}
            </button>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="font-body text-sm text-muted-ink">No shifts were scheduled that week.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DAYS.map((day, i) => {
            const dayRows = rows
              .filter((s) => s.day === day)
              .sort((a, b) => a.start.localeCompare(b.start))
            if (dayRows.length === 0) return null
            return (
              <div
                key={day}
                className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)]"
              >
                <p className="font-heading text-xs font-bold text-ink">
                  {DAY_LABEL[day]}{' '}
                  <span className="font-body font-semibold text-muted-ink">
                    {dayDate(snap.weekStart, i)}
                  </span>
                </p>
                <div className="mt-1.5 flex flex-col gap-1">
                  {dayRows.map((r, j) => (
                    <p key={j} className="font-body text-[13px] text-ink">
                      {r.employeeName ?? '(open)'}{' '}
                      <span className="text-muted-ink">
                        {to12Hour(r.start)}–{to12Hour(r.end)}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ViewStore {
  id: number
  name: string
  accentClass: string
  days: {
    day: DayOfWeek
    people: DayPerson[]
    gaps: GapCardData[]
    requirements: ShiftRequirement[]
  }[]
}

const ACCENT_CLASSES = ['bg-green', 'bg-sky', 'bg-grape', 'bg-orange'] as const

function buildView({
  stores,
  employees,
  employeeStores,
  shifts,
  requirements,
}: BoardData): { stores: ViewStore[]; totalShort: number } {
  const employeeName = new Map(employees.map((e) => [e.id, e.name]))
  const employeeFruit = new Map(employees.map((e) => [e.id, e.avatarFruit]))

  // gaps reflect ACTUAL current coverage, not the solver's original report
  const gapsByStoreDay =
    shifts.length > 0 ? computeGapCards(requirements, shifts, employeeStores, stores) : new Map<string, GapCardData[]>()
  let totalShort = 0
  for (const list of gapsByStoreDay.values()) for (const g of list) totalShort += g.shortBy

  const viewStores: ViewStore[] = stores.map((store, i) => {
    // per day: employeeId -> their shift rows, later merged into contiguous spans
    const byDay = new Map<DayOfWeek, Map<number, Shift[]>>()
    for (const shift of shifts) {
      if (shift.storeId !== store.id || shift.employeeId === null) continue
      const dayMap = byDay.get(shift.day) ?? new Map<number, Shift[]>()
      byDay.set(shift.day, dayMap)
      const list = dayMap.get(shift.employeeId) ?? []
      list.push(shift)
      dayMap.set(shift.employeeId, list)
    }

    const days = DAYS.filter((d) => byDay.has(d) || gapsByStoreDay.has(`${store.id}:${d}`)).map((day) => {
      const dayReqs = requirements
        .filter((r) => r.storeId === store.id && r.day === day)
        .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
      // the store's operating window that day, and its opening time
      const opStart = dayReqs.length ? Math.min(...dayReqs.map((r) => toMinutes(r.start))) : 0
      const opEnd = dayReqs.length ? Math.max(...dayReqs.map((r) => toMinutes(r.end))) : 0
      const needsOpen = dayReqs.some((r) => r.needOpen)

      const people: DayPerson[] = []
      for (const [employeeId, rows] of byDay.get(day) ?? []) {
        rows.sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
        // merge back-to-back / overlapping rows into spans
        const spans: { start: string; end: string; shiftIds: number[] }[] = []
        for (const s of rows) {
          const last = spans[spans.length - 1]
          if (last && toMinutes(s.start) <= toMinutes(last.end)) {
            if (toMinutes(s.end) > toMinutes(last.end)) last.end = s.end
            last.shiftIds.push(s.id)
          } else {
            spans.push({ start: s.start, end: s.end, shiftIds: [s.id] })
          }
        }
        for (const span of spans) {
          const ss = toMinutes(span.start)
          const se = toMinutes(span.end)
          const fullDay = ss <= opStart && se >= opEnd
          const isOpener =
            needsOpen && ss <= opStart && effectiveCanOpen(employeeStores, stores, employeeId, store.id)
          const comesIn = ss > opStart ? to12Hour(toHHMM24(span.start)) : undefined
          const leaves = se < opEnd ? to12Hour(toHHMM24(span.end)) : undefined
          people.push({
            employeeId,
            name: employeeName.get(employeeId) ?? `#${employeeId}`,
            avatarFruit: employeeFruit.get(employeeId) ?? null,
            shiftIds: span.shiftIds,
            start: span.start,
            end: span.end,
            fullDay,
            isOpener,
            note: comesIn || leaves ? { comesIn, leaves } : undefined,
          })
        }
      }
      people.sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || a.name.localeCompare(b.name))

      return { day, people, gaps: gapsByStoreDay.get(`${store.id}:${day}`) ?? [], requirements: dayReqs }
    })

    return { id: store.id, name: store.name, accentClass: ACCENT_CLASSES[i % ACCENT_CLASSES.length], days }
  })

  return { stores: viewStores, totalShort }
}
