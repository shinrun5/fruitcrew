import { useState } from 'react'
import type { DayOfWeek } from '../types'
import type { DayPerson } from './ScheduleCards'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS, weekRangeLabel } from '../lib/time'

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

const minsOf = (iso: string) => {
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
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
const PAD = 16

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

  const scale = 2
  const measurer = document.createElement('canvas').getContext('2d')!
  measurer.font = '600 14px -apple-system, "Segoe UI", Roboto, sans-serif'
  const longestName = Math.max(
    measurer.measureText(strings.fullDayLegend).width,
    ...employees.map((e) => measurer.measureText(strings.formatName(e)).width),
  )
  const nameColW = Math.max(NAME_COL_MIN, Math.round(longestName) + 24)

  const caption = `${storeName} · Week of ${weekRangeLabel(weekStart)}`
  const captionH = 30
  const width = nameColW + DAY_COL_W * 7 + PAD * 2
  const height = captionH + HEADER_H + employees.length * ROW_H + FOOTER_H + PAD * 2

  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  ctx.fillStyle = COLORS.paper
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = COLORS.muted
  ctx.font = '700 13px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText(caption, PAD, PAD + 12)

  const gridTop = PAD + captionH
  const colX = (i: number) => PAD + nameColW + i * DAY_COL_W
  const rowY = (i: number) => gridTop + HEADER_H + i * ROW_H

  const cell = (x: number, y: number, w: number, h: number, bg: string) => {
    ctx.fillStyle = bg
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  }
  const centeredText = (text: string, x: number, y: number, w: number, h: number, bold = false) => {
    ctx.fillStyle = COLORS.ink
    ctx.font = `${bold ? 700 : 600} 13px -apple-system, "Segoe UI", Roboto, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + w / 2, y + h / 2, w - 10)
  }
  const leftText = (text: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = COLORS.ink
    ctx.font = '600 13px -apple-system, "Segoe UI", Roboto, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + 8, y + h / 2, w - 14)
  }

  // header row
  cell(PAD, gridTop, nameColW, HEADER_H, COLORS.headerBg)
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
    cell(PAD, y, nameColW, ROW_H, COLORS.paper)
    leftText(strings.formatName(emp), PAD, y, nameColW, ROW_H)
    dayCols.forEach((d, i) => {
      const spans = d.people
        .filter((p) => p.employeeId === emp.id)
        .map((p) => ({ start: minsOf(p.start), end: minsOf(p.end) }))
      cell(colX(i), y, DAY_COL_W, ROW_H, COLORS.paper)
      centeredText(cellText(spans, d.opStart, d.opEnd), colX(i), y, DAY_COL_W, ROW_H)
    })
  })

  // footer: what "✓" means each day
  const footY = rowY(employees.length)
  cell(PAD, footY, nameColW, FOOTER_H, COLORS.paper)
  leftText(strings.fullDayLegend, PAD, footY, nameColW, FOOTER_H)
  dayCols.forEach((d, i) => {
    const label = d.opStart != null && d.opEnd != null ? `${compact(d.opStart)}-${compact(d.opEnd)}` : '—'
    cell(colX(i), footY, DAY_COL_W, FOOTER_H, COLORS.paper)
    centeredText(label, colX(i), footY, DAY_COL_W, FOOTER_H)
  })

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  return canvas
}

async function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Buttons that render the week to a PNG, then either save it or open the
 * native share sheet (WeChat, Messages, whatever's installed). */
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
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)
  const canShareFiles =
    typeof navigator.share === 'function' &&
    typeof (navigator as Navigator & { canShare?: unknown }).canShare === 'function'
  const filename = `${storeName.replace(/\s+/g, '-')}-${weekStart.slice(0, 10)}.png`

  async function run(mode: 'download' | 'share') {
    setBusy(mode)
    try {
      const canvas = drawGrid(storeName, weekStart, employees, days, {
        fullDayLegend: t('schedule.export.fullDayLegend'),
        formatName: (e) => (e.training ? t('schedule.export.trainingName', { name: e.name }) : e.name),
      })
      const blob = await toPngBlob(canvas)
      if (!blob) return
      if (mode === 'share') {
        const file = new File([blob], filename, { type: 'image/png' })
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
        if (nav.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: t('schedule.export.shareTitle', { store: storeName }) })
          return
        }
      }
      download(blob, filename)
    } catch {
      // share sheet cancelled, etc. — nothing to show for it
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Share (native share sheet) already covers "save this" wherever it's
       * available — its own "Save Image"/"Save to Files" destinations — so
       * Download only needs to show where Share isn't an option (desktop
       * browsers mostly). Keeping both would also risk Download silently
       * doing nothing in a bare WebView with no download manager wired up. */}
      {!canShareFiles && (
        <button
          onClick={() => void run('download')}
          disabled={busy !== null}
          className="rounded-full border-2 border-ink bg-paper px-2 py-1 font-heading text-[10px] font-bold text-ink disabled:opacity-50 sm:px-3 sm:py-1.5 sm:text-xs"
        >
          {busy === 'download' ? t('schedule.export.preparing') : t('schedule.export.download')}
        </button>
      )}
      {canShareFiles && (
        <button
          onClick={() => void run('share')}
          disabled={busy !== null}
          className="rounded-full border-2 border-ink bg-paper px-2 py-1 font-heading text-[10px] font-bold text-ink disabled:opacity-50 sm:px-3 sm:py-1.5 sm:text-xs"
        >
          {busy === 'share' ? t('schedule.export.preparing') : t('schedule.export.share')}
        </button>
      )}
    </div>
  )
}
