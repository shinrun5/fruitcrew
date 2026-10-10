import type { DayOfWeek } from '../types'
import type { DayPerson } from './ScheduleCards'
import { ShareImageButtons } from './ShareImageButtons'
import { CAPTION_H, GRID_PAD, gridCanvas, widestText } from '../lib/canvasGrid'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS, toMinutes, weekRangeLabel } from '../lib/time'

const COLORS = {
  ink: '#1A1A1A',
  grid: '#B0B0B0',
  headerBg: '#C4C4C4',
  paper: '#FFFFFF',
  muted: '#6B6B6B',
}

export interface ExportDay {
  day: DayOfWeek
  people: DayPerson[]
  /** the window a "full day" (✓) means for this day — null if nothing's configured */
  opStart: number | null
  opEnd: number | null
}

export interface ExportEmployee {
  id: number
  name: string
  /** shown as "(Training)" next to the name — a NEW-tier worker at this store */
  training: boolean
}

/** "270" -> "4:30", "240" -> "4" (no AM/PM — matches how a manager writes it by hand). */
function compact(mins: number): string {
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, '0')}`
}

function cellText(spans: { start: number; end: number }[], opStart: number | null, opEnd: number | null): string {
  if (spans.length === 0) return ''
  return spans
    .map((sp) => {
      if (opStart != null && opEnd != null && sp.start <= opStart && sp.end >= opEnd) return '✓'
      const end = opEnd != null && sp.end === opEnd ? 'close' : compact(sp.end)
      return `${compact(sp.start)}-${end}`
    })
    .join(', ')
}

const NAME_COL_MIN = 140
const DAY_COL_W = 118
const HEADER_H = 44
const ROW_H = 34
const FOOTER_H = 36

/** Renders the week as a name-by-day grid — ✓ for a full day, otherwise the
 * actual hours, matching the spreadsheet a manager would hand-build for the crew. */
function drawGrid(
  storeName: string,
  weekStart: string,
  employees: ExportEmployee[],
  days: ExportDay[],
  strings: { fullDayLegend: string; formatName: (e: ExportEmployee) => string },
): HTMLCanvasElement {
  const byDay = new Map(days.map((d) => [d.day, d]))
  const dayCols = DAYS.map((d) => byDay.get(d) ?? { day: d, people: [], opStart: null, opEnd: null })

  const longestName = widestText([strings.fullDayLegend, ...employees.map(strings.formatName)])
  const nameColW = Math.max(NAME_COL_MIN, Math.round(longestName) + 24)

  const width = nameColW + DAY_COL_W * 7 + GRID_PAD * 2
  const height = CAPTION_H + HEADER_H + employees.length * ROW_H + FOOTER_H + GRID_PAD * 2
  const { canvas, cell, centeredText, leftText } = gridCanvas(
    width,
    height,
    `${storeName} · Week of ${weekRangeLabel(weekStart)}`,
    { ...COLORS, lineWidth: 1, labelWeight: 600 },
  )

  const gridTop = GRID_PAD + CAPTION_H
  const colX = (i: number) => GRID_PAD + nameColW + i * DAY_COL_W
  const rowY = (i: number) => gridTop + HEADER_H + i * ROW_H

  // header row
  cell(GRID_PAD, gridTop, nameColW, HEADER_H, COLORS.headerBg)
  dayCols.forEach((d, i) => {
    const date = new Date(`${weekStart.slice(0, 10)}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() + i)
    const label = `${DAY_LABEL[d.day]} ${date.getUTCMonth() + 1}-${date.getUTCDate()}`
    cell(colX(i), gridTop, DAY_COL_W, HEADER_H, COLORS.headerBg)
    centeredText(label, colX(i), gridTop, DAY_COL_W, HEADER_H, true)
  })

  // one row per employee
  employees.forEach((emp, r) => {
    const y = rowY(r)
    cell(GRID_PAD, y, nameColW, ROW_H, COLORS.paper)
    leftText(strings.formatName(emp), GRID_PAD, y, nameColW, ROW_H)
    dayCols.forEach((d, i) => {
      const spans = d.people
        .filter((p) => p.employeeId === emp.id)
        .map((p) => ({ start: toMinutes(p.start), end: toMinutes(p.end) }))
      cell(colX(i), y, DAY_COL_W, ROW_H, COLORS.paper)
      centeredText(cellText(spans, d.opStart, d.opEnd), colX(i), y, DAY_COL_W, ROW_H)
    })
  })

  // footer: what "✓" means each day
  const footY = rowY(employees.length)
  cell(GRID_PAD, footY, nameColW, FOOTER_H, COLORS.paper)
  leftText(strings.fullDayLegend, GRID_PAD, footY, nameColW, FOOTER_H)
  dayCols.forEach((d, i) => {
    const label = d.opStart != null && d.opEnd != null ? `${compact(d.opStart)}-${compact(d.opEnd)}` : '—'
    cell(colX(i), footY, DAY_COL_W, FOOTER_H, COLORS.paper)
    centeredText(label, colX(i), footY, DAY_COL_W, FOOTER_H)
  })

  return canvas
}

/** Save or share the week as a PNG. */
export function ExportSchedule({
  storeName,
  weekStart,
  employees,
  days,
}: {
  storeName: string
  weekStart: string
  employees: ExportEmployee[]
  days: ExportDay[]
}) {
  const t = useT()
  return (
    <ShareImageButtons
      filename={`${storeName.replace(/\s+/g, '-')}-${weekStart.slice(0, 10)}.png`}
      shareTitle={t('schedule.export.shareTitle', { store: storeName })}
      draw={() =>
        drawGrid(storeName, weekStart, employees, days, {
          fullDayLegend: t('schedule.export.fullDayLegend'),
          formatName: (e) => (e.training ? t('schedule.export.trainingName', { name: e.name }) : e.name),
        })
      }
    />
  )
}
