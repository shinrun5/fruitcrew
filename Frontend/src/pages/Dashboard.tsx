import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AssignPopover } from '../components/AssignPopover'
import { DayDeck } from '../components/DayDeck'
import { ExportSchedule, type ExportDay, type ExportEmployee } from '../components/ExportSchedule'
import { DayCard } from '../components/ScheduleCards'
import { SlotEditor } from '../components/SlotEditor'
import { Header } from '../components/Header'
import { Closing } from './Closing'
import { PastWeekBoard } from '../components/PastWeekBoard'
import {
  availabilityIssue,
  availabilityNote,
  type AvailabilityConfirmation,
  type BoardData,
  buildView,
  dayOperatingWindow,
  loadBoard,
  type WorkerLoad,
} from '../lib/board'
import { UntrackedWorkload, WeekAvailability } from '../components/WeekAvailability'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useT } from '../lib/i18n'
import { useAddon } from '../lib/addons'
import { useStore } from '../lib/store-context'
import { type Candidate, computeCandidates } from '../lib/candidates'
import { type SwapOption, computeSwapOptions } from '../lib/swaps'
import { effectiveCanOpen } from '../lib/openers'
import { isNarrowScreen } from '../lib/use-narrow'
import {
  DAYS,
  DAY_LABEL,
  dayDate,
  localMondayYMD,
  shiftWeekYMD,
  timeRange,
  toHHMM24,
  toMinutes,
  windowsOverlap,
  withTime,
} from '../lib/time'
import type {
  DayOfWeek,
  EditLogEntry,
  FixedShift,
  GenerateScheduleResult,
  RecurringAvailability,
  ShiftRequirement,
  SnapshotDetail,
} from '../types'
import { useRefreshOnReturn } from '../lib/use-refresh-on-return'
import { hapticSuccess } from '../lib/haptics'

interface PickerState {
  anchorRect: DOMRect
  storeId: number
  day: DayOfWeek
  start: string
  end: string
  /** the person's merged shift rows (empty = filling an open slot -> POST) */
  shiftIds: number[]
  /** the section those rows are on (null for a gap, or none set) */
  sectionId: number | null
  requirementId: number | null
  excludeIds: Set<number>
  requireOpener: boolean
  graceMinutes: number
  personId: number | null
  personName: string | null
  candidates: Candidate[]
  candidatesAll: Candidate[]
  swaps: SwapOption[]
  /** This person's other shifts this week (any store), for context when the
   * full week isn't visible at once (the mobile day deck) — empty for a gap. */
  weekShifts: { day: DayOfWeek; storeName: string; start: string; end: string }[]
  title: string
  subtitle: string
}

export function Dashboard() {
  const t = useT()
  const confirm = useConfirm()
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
  // edits to the posted week workers don't have yet (person by day)
  const [unposted, setUnposted] = useState<{ employeeId: number | null; day: DayOfWeek }[]>([])
  const [publishBusy, setPublishBusy] = useState(false)
  const [justPublished, setJustPublished] = useState(false)
  const [weekStart, setWeekStart] = useState<string | null>(null)
  // which week the manager is looking at — equals weekStart for the live editor,
  // an earlier value while browsing a past week (read-only until Resume)
  const [viewWeek, setViewWeek] = useState<string | null>(null)
  const [pastWeeks, setPastWeeks] = useState<string[]>([])
  const [pastView, setPastView] = useState<SnapshotDetail | null>(null)
  const [pastLoading, setPastLoading] = useState(false)
  // retroactive edits made to this past week (empty if it's never been
  // touched after its dates passed) — see getScheduleEditLog
  const [editLog, setEditLog] = useState<EditLogEntry[]>([])
  // the board's own week has already ended, calendar-wise, but nobody's
  // advanced past it yet — still editable, just stale
  const [liveWeekStale, setLiveWeekStale] = useState(false)
  // a past week on/after this date can still be edited (tap something -> confirm
  // -> resume); strictly before it, the board renders read-only, no popup offered
  const [editableCutoff, setEditableCutoff] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)
  // Closing lives inside this page (it only applies to some stores) rather
  // than as its own top-level nav tab
  const [subView, setSubView] = useState<'schedule' | 'closing'>('schedule')
  // weeks the crew already has that are still going while the board drafts a
  // later one (this week, once next week is up) — "YYYY-MM-DD"
  const [liveWeeks, setLiveWeeks] = useState<string[]>([])
  const { storeId, stores, loading: storesLoading } = useStore()

  // viewing a running week: the normal board, edited live — no resume, and
  // next week's draft stays put
  const runningWeek =
    viewWeek && weekStart && viewWeek.slice(0, 10) !== weekStart.slice(0, 10) && liveWeeks.includes(viewWeek.slice(0, 10))
      ? viewWeek.slice(0, 10)
      : null
  // the week whose shifts the board is showing
  const boardWeek = runningWeek ?? weekStart

  useEffect(() => {
    let live = true
    loadBoard(runningWeek)
      .then((b) => live && setBoard(b))
      .catch((e) => live && setLoadError(String(e)))
    return () => {
      live = false
    }
  }, [runningWeek])
  const reloadBoard = async () => setBoard(await loadBoard(runningWeek))
  // new shifts go on the week on screen
  const onWeek = runningWeek ? { weekStart: runningWeek } : {}

  const loadStatus = useCallback((storeId: number, resetView = false, openOnToday = false) => {
    return api
      .getScheduleStatus(storeId)
      .then((s) => {
        // publishedAt is when the store last posted — only "this board is
        // posted" if the week on the board IS that posted week. Otherwise
        // (a next-week draft, e.g. the weekend auto-draft) it's unposted and
        // workers are still on postedWeekStart.
        const boardIsPosted =
          !!s.postedWeekStart && s.postedWeekStart.slice(0, 10) === String(s.weekStart).slice(0, 10)
        setPublishedAt(boardIsPosted ? s.publishedAt : null)
        setWeekStart(s.weekStart)
        setPostedWeekStart(s.postedWeekStart)
        setPastWeeks(s.pastWeeks)
        setLiveWeeks(s.liveWeeks.map((w) => w.slice(0, 10)))
        setUnposted(s.unpostedChanges)
        setLiveWeekStale(s.liveWeekStale)
        setEditableCutoff(s.editableCutoff)
        setViewWeek((v) => {
          if (!resetView && v != null) return v
          // a phone opens on the week we're in once next week's draft is up —
          // today's crew is what's needed on the floor, and › goes on to the draft
          const today = localMondayYMD()
          const onToday =
            openOnToday &&
            isNarrowScreen() &&
            String(s.weekStart).slice(0, 10) > today &&
            (s.liveWeeks.some((w) => w.slice(0, 10) === today) ||
              // posted before running weeks stayed live: its archived copy
              (s.postedWeekStart?.slice(0, 10) === today && s.pastWeeks.some((w) => w.slice(0, 10) === today)))
          return onToday ? today : s.weekStart
        })
      })
      .catch(() => {})
  }, [])

  // someone else may have changed the schedule while this was in the
  // background — reload it, unless an edit is mid-flight on screen
  useRefreshOnReturn(
    () => {
      if (storeId != null) void loadStatus(storeId)
      return reloadBoard()
    },
    picker !== null || slotEditor !== null || generating || resuming || publishBusy,
  )

  // Bring a saved week back onto the live board. There's no hard cutoff on how
  // far back this can reach — someone leaving early or a no-show often isn't
  // noticed until later — but editing a week that's already passed is easy to
  // do by mistake, so confirm before touching it.
  async function resumeWeek(id: number, thisWeek: boolean) {
    if (storeId == null) return
    if (!(await confirm(t(thisWeek ? 'dashboard.confirmEditThisWeek' : 'dashboard.confirmEditPastWeek')))) return
    setResuming(true)
    setError(null)
    try {
      const { weekStart: restored } = await api.restoreSnapshot(storeId, id)
      setViewWeek(restored)
      await loadStatus(storeId, true)
      setBoard(await loadBoard())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setResuming(false)
    }
  }

  useEffect(() => {
    if (storeId == null) return
    setJustPublished(false)
    void loadStatus(storeId, true, true)
  }, [storeId, loadStatus])

  // viewing a past week -> pull its frozen roster
  const isPast =
    !!viewWeek && !!weekStart && viewWeek.slice(0, 10) < weekStart.slice(0, 10) && !runningWeek
  // within the last PAST_WEEK_EDITABLE_WEEKS -> tapping something offers to
  // resume it (with a confirm popup); older -> read-only, nothing to tap
  const isEditableWindow =
    !!viewWeek && !!editableCutoff && viewWeek.slice(0, 10) >= editableCutoff.slice(0, 10)
  useEffect(() => {
    if (storeId == null || !isPast || !viewWeek) {
      setPastView(null)
      setEditLog([])
      return
    }
    let live = true
    setPastLoading(true)
    api
      .getScheduleWeekView(storeId, viewWeek.slice(0, 10))
      .then((s) => live && setPastView(s))
      .catch(() => live && setPastView(null))
      .finally(() => live && setPastLoading(false))
    api
      .getScheduleEditLog(storeId, viewWeek.slice(0, 10))
      .then((rows) => live && setEditLog(rows))
      .catch(() => live && setEditLog([]))
    return () => {
      live = false
    }
  }, [storeId, isPast, viewWeek])

  // one-week availability overrides for the week on the board (candidate picker
  // should honour "just this week I can only work Monday", same as the solver)
  const [weekOverrides, setWeekOverrides] = useState<{
    /** the board week these are for — a week change refetches, and until it's
     * back these are the old week's (see availability flags below) */
    week: string
    overriddenEmployeeIds: number[]
    windows: { employeeId: number; day: DayOfWeek; start: string; end: string }[]
  } | null>(null)
  useEffect(() => {
    if (!boardWeek) {
      setWeekOverrides(null)
      return
    }
    let live = true
    api
      .getWeekAvailability(boardWeek.slice(0, 10))
      .then((r) => live && setWeekOverrides({ week: boardWeek, ...r }))
      .catch(() => live && setWeekOverrides(null))
    return () => {
      live = false
    }
  }, [boardWeek])

  // standing (fixed) shifts — what someone on a fixed schedule always works, so
  // they're never flagged as off their availability for one
  const [fixedShifts, setFixedShifts] = useState<{ storeId: number; rows: FixedShift[] } | null>(null)
  useEffect(() => {
    if (storeId == null) return
    let live = true
    api
      .getFixedShifts(storeId)
      .then((rows) => live && setFixedShifts({ storeId, rows }))
      .catch(() => live && setFixedShifts(null))
    return () => {
      live = false
    }
  }, [storeId])

  // each worker's availability for the week on the board + whether they've checked it
  const [avConfirm, setAvConfirm] = useState<AvailabilityConfirmation[]>([])
  // false until this week's list arrives — so nothing reads "no availability
  // on file" just because it hasn't loaded yet
  const [avLoaded, setAvLoaded] = useState(false)
  const [showAvailability, setShowAvailability] = useState(false)
  const [showHours, setShowHours] = useState(false)
  useEffect(() => {
    if (!boardWeek) {
      setAvConfirm([])
      return
    }
    let live = true
    setAvLoaded(false)
    api
      .getAvailabilityConfirmations(boardWeek.slice(0, 10))
      .then((r) => live && setAvConfirm(r.workers))
      .catch(() => live && setAvConfirm([]))
      .finally(() => live && setAvLoaded(true))
    return () => {
      live = false
    }
  }, [boardWeek])

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

  // the selected store's sections (Front, Produce…) — each shift's is set from the picker
  const [sections, setSections] = useState<{ id: number; name: string }[]>([])
  useEffect(() => {
    if (storeId == null) return
    let live = true
    api
      .getResponsibilities(storeId)
      .then((rs) => live && setSections(rs.filter((r) => r.scope === 'SECTION')))
      .catch(() => live && setSections([]))
    return () => {
      live = false
    }
  }, [storeId])
  const sectionNames = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections])

  // open shift notes for the selected store
  const [openNotes, setOpenNotes] = useState<{ count: number; latest: string | null }>({ count: 0, latest: null })
  const notesOn = useAddon('notes')
  const closingOn = useAddon('closing')
  useEffect(() => {
    // notes switched off for this business: no chip, and nothing to ask for
    if (storeId == null || !notesOn) return setOpenNotes({ count: 0, latest: null })
    let live = true
    api
      .getNotes(storeId)
      .then((r) => live && setOpenNotes({ count: r.open.length, latest: r.open[0]?.body ?? null }))
      .catch(() => live && setOpenNotes({ count: 0, latest: null }))
    return () => {
      live = false
    }
  }, [storeId, notesOn])

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
    // taking a posted week down hides it from every worker — never on a stray tap
    if (!next && !(await confirm(t('schedule.confirmUnpost'), { tone: 'danger', confirmLabel: t('schedule.header.unpostBtn') })))
      return
    setPublishBusy(true)
    try {
      const s = next ? await api.publishSchedule(storeId) : await api.unpublishSchedule(storeId)
      setPublishedAt(s.publishedAt)
      setJustPublished(next)
      if (next) hapticSuccess()
      await loadStatus(storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishBusy(false)
    }
  }

  // ‹ › on the toolbar: step through past weeks (read-only until Resume) and
  // back to the live one. Going forward from the live week starts the next
  // week — which freezes the current one.
  async function navWeek(delta: number) {
    if (!weekStart || !viewWeek || storeId == null) return
    const weeks = [...new Set([...pastWeeks, ...liveWeeks, weekStart].map((w) => w.slice(0, 10)))].sort()
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
    if (!(await confirm(t('dashboard.confirmNextWeek')))) return
    try {
      const { weekStart: next } = await api.setScheduleWeek(storeId, shiftWeekYMD(weekStart, 1))
      setWeekStart(next)
      setViewWeek(next)
      await loadStatus(storeId, true)
      setBoard(await loadBoard())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
      hapticSuccess()
      setBoard(await loadBoard())
      await loadStatus(storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
    partlyBusy = false,
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
      partlyBusy,
      noBackToBack: store?.noBackToBackDays.includes(day) ?? false,
    })
  }

  function openPickerFor(args: {
    e: MouseEvent<HTMLButtonElement>
    storeId: number
    day: DayOfWeek
    start: string
    end: string
    shiftIds: number[]
    sectionId: number | null
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
    // someone already working part of this window (tonight's shift, when this is
    // the morning) is still offered, for the part they're free
    const candidates = candidatesForWindow(storeId, day, start, end, excludeIds, requireOpener, graceMinutes, false, true)
    const candidatesAll = candidatesForWindow(storeId, day, start, end, excludeIds, requireOpener, graceMinutes, true, true)

    // direct-swap partners, and this person's other shifts this week (any
    // store, for context when the full week isn't on screen at once — the
    // mobile day deck) — both only for an existing person's shift, off the
    // same already-merged view so a shift never double-counts as two rows
    let swaps: SwapOption[] = []
    let weekShifts: PickerState['weekShifts'] = []
    if (rest.shiftIds.length > 0 && rest.personId != null) {
      const v = buildView(board, sectionNames)
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

      const sortedIds = (ids: number[]) => [...ids].sort().join(',')
      const clickedSpan = sortedIds(rest.shiftIds)
      weekShifts = spans
        .filter((s) => s.employeeId === rest.personId && sortedIds(s.shiftIds) !== clickedSpan)
        .map((s) => ({ day: s.day, storeName: s.storeName, start: s.start, end: s.end }))
        .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start.localeCompare(b.start))
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
      weekShifts,
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
      await reloadBoard()
      if (storeId != null) await loadStatus(storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
    const { shiftIds, storeId, day, start, end, sectionId } = picker
    setPicker(null)
    try {
      if (which === 'tail') {
        if (shiftIds.length > 0) await collapseTo(shiftIds, start, withTime(end, splitAt))
        // taking over the end of someone's shift = the same section; a gap gets the taker's usual one
        await api.createShift({
          employeeId,
          storeId,
          day,
          start: withTime(start, splitAt),
          end,
          ...(shiftIds.length > 0 ? { sectionId } : {}),
          ...onWeek,
        })
      } else {
        await api.createShift({ employeeId, storeId, day, start, end: withTime(end, splitAt), ...onWeek })
      }
      await reloadBoard()
      if (storeId != null) await loadStatus(storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
        await api.createShift({ employeeId, storeId, day, start: clampStart, end: clampEnd, ...onWeek })
      }
      // gap cards are derived from real coverage on the next render, so just reload
      await reloadBoard()
      await loadStatus(storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleRemove() {
    if (!picker || picker.shiftIds.length === 0) return
    const { shiftIds, personName } = picker
    const confirmMsg = personName
      ? t('schedule.assign.confirmRemove', { name: personName })
      : t('schedule.assign.confirmRemoveGeneric')
    if (!(await confirm(confirmMsg, { tone: 'danger' }))) return
    setPicker(null)
    try {
      await Promise.all(shiftIds.map((id) => api.deleteShift(id)))
      await reloadBoard()
      if (storeId != null) await loadStatus(storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleSetSection(sectionId: number | null) {
    if (!picker || picker.shiftIds.length === 0) return
    const { shiftIds } = picker
    setPicker(null)
    try {
      await Promise.all(shiftIds.map((id) => api.updateShift(id, { sectionId })))
      await reloadBoard()
      if (storeId != null) await loadStatus(storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleEditHours(startHHMM: string, endHHMM: string) {
    if (!picker || picker.shiftIds.length === 0) return
    const { shiftIds, start, end } = picker
    setPicker(null)
    try {
      await collapseTo(shiftIds, withTime(start, startHHMM), withTime(end, endHHMM))
      await reloadBoard()
      if (storeId != null) await loadStatus(storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function openSlotEditor(e: MouseEvent<HTMLButtonElement>, requirements: ShiftRequirement[]) {
    if (requirements.length === 0) return
    setSlotEditor({ anchorRect: e.currentTarget.getBoundingClientRect(), requirements })
  }

  async function toggleNoBackToBack(storeId: number, day: DayOfWeek) {
    const store = board?.stores.find((s) => s.id === storeId)
    if (!store) return
    try {
      const { noBackToBackDays } = await api.setNoBackToBack(storeId, day, !store.noBackToBackDays.includes(day))
      setBoard((b) => b && { ...b, stores: b.stores.map((s) => (s.id === storeId ? { ...s, noBackToBackDays } : s)) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleSaveRequirement(
    requirementId: number,
    patch: { regularRequired: number; needOpen: boolean },
  ) {
    setSlotEditor(null)
    try {
      await api.updateRequirement(requirementId, patch)
      await reloadBoard()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loadError) {
    return (
      <div className="flex h-dvh items-center justify-center font-body text-coral-dark">
        {t('dashboard.loadError', { error: loadError })}
      </div>
    )
  }

  // (or still holding the other week's shifts, just after switching weeks)
  if (!board || board.week !== runningWeek) {
    return (
      <div className="flex h-dvh items-center justify-center font-body text-muted-ink">
        {t('common.loading')}
      </div>
    )
  }

  if (storeId == null) {
    return (
      <div className="flex h-dvh items-center justify-center font-body text-muted-ink">
        {/* still fetching the store list → don't flash "No stores yet" at someone who has stores */}
        {storesLoading ? t('common.loading') : stores.length === 0 ? t('dashboard.noStores') : t('dashboard.pickStore')}
      </div>
    )
  }

  const tracksClosing = closingOn && (stores.find((s) => s.id === storeId)?.tracksClosingDuties ?? false)
  const subTabs = tracksClosing && (
    <div className="flex gap-1.5 px-4 pt-3 pb-3 sm:px-8">
      {(['schedule', 'closing'] as const).map((v) => (
        <button
          key={v}
          onClick={() => setSubView(v)}
          className={`rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold capitalize ${
            subView === v ? 'bg-ink text-white' : 'bg-paper text-ink'
          }`}
        >
          {v === 'schedule' ? t('nav.mgr.schedule') : t('nav.closing')}
        </button>
      ))}
    </div>
  )

  if (tracksClosing && subView === 'closing') {
    return (
      <>
        {subTabs}
        <Closing initialWeek={viewWeek} />
      </>
    )
  }

  // browsing a saved past week — the normal-looking board, in one of two modes:
  // within the editable window, tapping anyone pops the confirm-then-resume
  // flow (see resumeWeek); past it, purely read-only (see PastWeekBoard)
  if (isPast) {
    return (
      <>
        {subTabs}
        <Header
          weekStart={viewWeek ?? undefined}
          onWeekChange={(d) => void navWeek(d)}
          gapCount={null}
          generating={false}
          onGenerate={() => {}}
          readOnly
          readOnlyLabel={pastView?.live ? t('schedule.header.thisWeekPosted') : undefined}
        />
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <PastWeekBoard
          snap={pastView}
          loading={pastLoading}
          storeId={storeId}
          employees={board.employees}
          employeeStores={board.employeeStores}
          stores={board.stores}
          requirements={board.requirements}
          isEditableWindow={isEditableWindow}
          resuming={resuming}
          onEdit={pastView ? () => void resumeWeek(pastView.id, !!pastView.live) : undefined}
          editLog={editLog}
        />
      </>
    )
  }

  // just the selected store
  const storeShifts = board.shifts.filter((s) => s.storeId === storeId)
  const full = buildView(board, sectionNames)
  const view = { ...full, stores: full.stores.filter((s) => s.id === storeId) }
  const solved = lastResult !== null || storeShifts.length > 0
  // days of the week that are already over can't be staffed any more, so they
  // don't count toward "N short" (same rule as Home's count, by the store's day)
  const nowD = new Date()
  const daysIn = boardWeek
    ? Math.floor((Date.UTC(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()) - new Date(boardWeek).getTime()) / 86_400_000)
    : 0
  const totalShort =
    view.stores[0]?.days
      .filter((d) => DAYS.indexOf(d.day as (typeof DAYS)[number]) >= daysIn)
      .reduce((n, d) => n + d.gaps.reduce((m, g) => m + g.shortBy, 0), 0) ?? 0

  // employees who work the selected store, with their shift-day count there
  const storeEmpIds = new Set(
    board.employeeStores.filter((es) => es.storeId === storeId).map((es) => es.employeeId),
  )
  const weekLoad: WorkerLoad[] = board.employees
    .filter((e) => storeEmpIds.has(e.id))
    .map((e) => {
      // hours are a whole-person weekly cap, so they're summed across every
      // store the person works, not just the one currently shown
      const allShifts = board.shifts.filter((s) => s.employeeId === e.id)
      const minutes = allShifts.reduce((sum, s) => sum + (toMinutes(s.end) - toMinutes(s.start)), 0)
      return {
        id: e.id,
        name: e.name,
        count: new Set(storeShifts.filter((s) => s.employeeId === e.id).map((s) => s.day)).size,
        max: e.maxShifts,
        minutes,
        hourLimit: e.hourLimit,
      }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  // for the exported grid: everyone who actually works this week (nobody with
  // an all-blank row), and each day's full-operating window (what a ✓ means)
  const exportDays: ExportDay[] = DAYS.map((day) => {
    const { dayReqs, opStart, opEnd } = dayOperatingWindow(board.requirements, storeId, day)
    return {
      day,
      people: view.stores[0]?.days.find((d) => d.day === day)?.people ?? [],
      opStart: dayReqs.length ? opStart : null,
      opEnd: dayReqs.length ? opEnd : null,
    }
  })
  const workingIds = new Set(exportDays.flatMap((d) => d.people.map((p) => p.employeeId)))
  const exportRoster: ExportEmployee[] = board.employees
    .filter((e) => storeEmpIds.has(e.id) && workingIds.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      training: board.employeeStores.some(
        (es) => es.employeeId === e.id && es.storeId === storeId && es.proficiency === 'NEW',
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      {subTabs}
      <Header
        weekStart={viewWeek ?? weekStart ?? undefined}
        onWeekChange={(d) => void navWeek(d)}
        gapCount={solved ? totalShort : null}
        generating={generating}
        onGenerate={handleGenerate}
        running={!!runningWeek}
        unpostedCount={runningWeek ? 0 : unposted.length}
        {...(runningWeek
          ? {}
          : {
              publishedAt,
              workersSeeWeek: !publishedAt ? postedWeekStart : null,
              onPublish: () => void togglePublish(true),
              onUnpublish: () => void togglePublish(false),
              publishBusy,
              // the posted week can't be regenerated (the server refuses), so
              // its main button moves on to next week — edited or not
              onPlanNext:
                postedWeekStart && weekStart && postedWeekStart.slice(0, 10) === weekStart.slice(0, 10)
                  ? () => void navWeek(1)
                  : undefined,
            })}
        extra={
          // the "just published" banner right below has its own copy of these
          // same buttons as its call to action — never show both at once
          !justPublished && boardWeek && view.stores[0] ? (
            <ExportSchedule
              storeName={view.stores[0].name}
              weekStart={boardWeek}
              employees={exportRoster}
              days={exportDays}
            />
          ) : undefined
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {justPublished && weekStart && view.stores[0] && (
        <div className="flex flex-wrap items-center gap-3 border-b-2 border-ink/10 bg-green/10 px-4 py-2 sm:px-8">
          <span className="font-body text-[11px] font-bold text-ink">{t('dashboard.justPublished')}</span>
          <ExportSchedule
            storeName={view.stores[0].name}
            weekStart={weekStart}
            employees={exportRoster}
            days={exportDays}
          />
          <button
            onClick={() => setJustPublished(false)}
            aria-label={t('dashboard.dismiss')}
            className="ml-auto font-heading text-xs font-bold text-muted-ink hover:text-ink"
          >
            ×
          </button>
        </div>
      )}

      {(() => {
        // things worth knowing about this week, as one row of small chips
        // rather than a separate full-width strip for each — so the board
        // itself starts higher up the screen, especially on a phone
        let inWeek: typeof holidays = []
        if (boardWeek) {
          const wk0 = boardWeek.slice(0, 10)
          const wkEnd = new Date(boardWeek)
          wkEnd.setUTCDate(wkEnd.getUTCDate() + 6)
          const wk6 = wkEnd.toISOString().slice(0, 10)
          inWeek = holidays.filter((h) => h.date >= wk0 && h.date <= wk6)
        }
        if (!liveWeekStale && openNotes.count === 0 && inWeek.length === 0) return null
        const chip = 'rounded-full border-2 px-2.5 py-0.5 font-body text-[11px] font-bold text-ink'
        return (
          <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-ink/10 bg-paper px-4 py-2 sm:px-8">
            {liveWeekStale && <span className={`${chip} border-orange bg-orange/10`}>{t('dashboard.weekStale')}</span>}
            {inWeek.map((h) => (
              <span key={h.id} className={`${chip} border-coral bg-coral-bg`}>
                <span className="text-coral-dark">{t('dashboard.holidayThisWeek')}</span>{' '}
                {new Date(`${h.date}T00:00:00Z`).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                })}
                {h.label ? ` · ${h.label}` : ''} —{' '}
                {h.closed
                  ? t('dashboard.holiday.closed')
                  : t('dashboard.holiday.hours', { open: h.openTime ?? '?', close: h.closeTime ?? '?' })}
              </span>
            ))}
            {openNotes.count > 0 && (
              <Link
                to="/notes"
                title={openNotes.latest ?? undefined}
                className={`${chip} border-orange bg-orange/10 hover:bg-orange/20`}
              >
                {openNotes.count === 1
                  ? t('dashboard.openNotes.count.one', { n: openNotes.count })
                  : t('dashboard.openNotes.count', { n: openNotes.count })}{' '}
                <span className="text-sky-dark">{t('dashboard.seeAll')}</span>
              </Link>
            )}
          </div>
        )
      })()}

      {boardWeek && (
        <WeekAvailability
          weekStart={boardWeek}
          storeId={storeId}
          avConfirm={avConfirm}
          weekLoad={weekLoad}
          solved={solved}
          showAvailability={showAvailability}
          onToggleAvailability={() => setShowAvailability((v) => !v)}
          showHours={showHours}
          onToggleHours={() => setShowHours((v) => !v)}
        />
      )}

      {solved && avLoaded && <UntrackedWorkload storeId={storeId} avConfirm={avConfirm} weekLoad={weekLoad} />}

      <div className="flex flex-1 flex-col gap-8 p-4 sm:p-8">
        {view.stores.length === 0 && <p className="font-body text-muted-ink">{t('dashboard.noStoresConfigured')}</p>}
        {view.stores.map((store) => (
          <div key={store.id} className="flex flex-col gap-3">
            {/* no store-name heading: the board only ever shows the store picked up top */}
            {store.days.length > 0 && (
              <>
                {(() => {
                  const dayCards = store.days.map((d) => {
                    const opStart = d.requirements.length
                      ? Math.min(...d.requirements.map((r) => toMinutes(r.start)))
                      : 0
                    const needsOpen = d.requirements.some((r) => r.needOpen)
                    const graceAt = (isoStart: string) =>
                      d.requirements.find(
                        (r) => toMinutes(r.start) <= toMinutes(isoStart) && toMinutes(isoStart) < toMinutes(r.end),
                      )?.graceMinutes ?? 0
                    // anyone scheduled off their availability for this week (time
                    // off, or outside the hours they gave) — only once this week's
                    // overrides and time off are in, so nobody's flagged by mistake
                    const flagsReady =
                      weekOverrides?.week === boardWeek && avLoaded && fixedShifts?.storeId === store.id
                    const people = d.people.map((p) => ({
                      ...p,
                      unavailable: flagsReady
                        ? availabilityIssue({
                            start: p.start,
                            end: p.end,
                            graceMinutes: graceAt(p.start),
                            windows: effectiveAvailability.filter(
                              (a) => a.employeeId === p.employeeId && a.day === d.day,
                            ),
                            fixed: fixedShifts.rows
                              .filter((f) => f.employeeId === p.employeeId && f.day === d.day)
                              .map((f) => ({ start: `1970-01-01T${f.start}:00.000Z`, end: `1970-01-01T${f.end}:00.000Z` })),
                            onLeave: !!avConfirm.find((w) => w.employeeId === p.employeeId)?.timeOff.includes(d.day),
                            standby: !!board.employees.find((emp) => emp.id === p.employeeId)?.standby,
                          })
                        : null,
                      // edited since it was posted — workers get it on the repost
                      changed: !runningWeek && unposted.some((c) => c.employeeId === p.employeeId && c.day === d.day),
                    }))

                    const content = (
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={(e) => openSlotEditor(e, d.requirements)}
                          className={`flex flex-col items-center leading-tight transition-opacity hover:opacity-60 ${
                            d.gaps.length ? 'text-coral-dark' : 'text-ink'
                          }`}
                        >
                          <span className="font-heading text-xs font-bold">{DAY_LABEL[d.day]}</span>
                          {boardWeek && (
                            <span className="font-body text-[10px] font-semibold text-muted-ink">
                              {dayDate(boardWeek, DAYS.indexOf(d.day))}
                            </span>
                          )}
                        </button>
                        <DayCard
                          people={people}
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
                              sectionId: person.sectionId,
                              requirementId: null,
                              personId: person.employeeId,
                              personName: person.name,
                              // anyone else working all of this window drops out on
                              // its own; someone working part of it can take the rest
                              excludeIds: new Set([person.employeeId]),
                              requireOpener,
                              graceMinutes: graceAt(person.start),
                              title: t('dashboard.insteadOf', { name: person.name }),
                              subtitle: [
                                timeRange(person.start, person.end),
                                requireOpener ? t('dashboard.mustOpen') : null,
                                person.unavailable ? availabilityNote(person.unavailable, t) : null,
                              ]
                                .filter(Boolean)
                                .join(' · '),
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
                              sectionId: null,
                              requirementId: g.requirementId,
                              personId: null,
                              personName: null,
                              // whoever's working all of the gap drops out on its own;
                              // someone on just part of it (tonight's shift overlapping
                              // a morning gap) can be stretched over the rest
                              excludeIds: new Set(),
                              requireOpener,
                              graceMinutes: graceAt(g.start),
                              title: t('dashboard.whoCanCover'),
                              subtitle: requireOpener
                                ? `${timeRange(g.start, g.end)} — ${g.detail} · ${t('dashboard.mustOpen')}`
                                : `${timeRange(g.start, g.end)} — ${g.detail}`,
                            })
                          }}
                        />
                      </div>
                    )
                    return { day: d.day, flagged: d.gaps.length > 0 || people.some((p) => p.unavailable), content }
                  })

                  return (
                    <>
                      {/* desktop: the whole week side by side, unchanged */}
                      <div
                        className="hidden gap-3.5 overflow-x-auto pb-1 sm:grid"
                        style={{ gridTemplateColumns: `repeat(${dayCards.length}, minmax(150px, 1fr))` }}
                      >
                        {dayCards.map((dc) => (
                          <div key={dc.day}>{dc.content}</div>
                        ))}
                      </div>
                      {/* mobile: one day at a time, swipeable — the full week's
                       * cards side by side needed horizontal scrolling to read */}
                      <DayDeck days={dayCards} weekStart={boardWeek} />
                    </>
                  )
                })()}
              </>
            )}
          </div>
        ))}
        {view.stores.every((s) => s.days.length === 0) && (
          <p className="font-body text-muted-ink">
            {t('dashboard.noShiftsBoard')}
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
          section={
            picker.shiftIds.length > 0 && sections.length > 0
              ? { options: sections, current: picker.sectionId, onSet: handleSetSection }
              : undefined
          }
          swaps={picker.personId != null ? picker.swaps : undefined}
          weekShifts={picker.personId != null ? picker.weekShifts : undefined}
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
          noBackToBack={
            !!board.stores
              .find((s) => s.id === slotEditor.requirements[0]?.storeId)
              ?.noBackToBackDays?.includes(slotEditor.requirements[0]!.day)
          }
          onToggleNoBackToBack={() =>
            toggleNoBackToBack(slotEditor.requirements[0]!.storeId, slotEditor.requirements[0]!.day)
          }
          onSave={handleSaveRequirement}
          onClose={() => setSlotEditor(null)}
        />
      )}
    </>
  )
}

/** A failed action (generate, publish, restore, …) — dismissible, and doesn't
 * take over the page like the fatal "board never loaded" error does. */
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const t = useT()
  return (
    <div className="flex items-start gap-2 border-b-2 border-ink/10 bg-coral-bg px-4 py-2 font-body text-[11px] font-bold text-coral-dark sm:px-8">
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button onClick={onDismiss} aria-label={t('dashboard.dismiss')} className="shrink-0 leading-none text-coral-dark/70 hover:text-coral-dark">
        ✕
      </button>
    </div>
  )
}
