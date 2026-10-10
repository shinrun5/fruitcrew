import type { ClosingDutyDay, Responsibility } from '../types'
import { ShareImageButtons } from './ShareImageButtons'
import { CAPTION_H, GRID_PAD, gridCanvas, widestText } from '../lib/canvasGrid'
import { closingRoleLabel } from '../lib/closingRoles'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS, weekRangeLabel } from '../lib/time'

// The app's own palette instead of a generic corporate gray, so a downloaded/
// shared grid still looks like Fruit Crew and not a spreadsheet export.
const COLORS = {
  ink: '#3A2B4D',
  grid: '#3A2B4D',
  dayColBg: '#FFF8EC',
  paper: '#FFFFFF',
  muted: '#7A6E8C',
}

// One tint per role, cycling a fixed palette by position — mirrors
// lib/closingRoles.ts's own TONE_PALETTE so the exported grid's columns match
// what's on screen, however many closing roles this store has defined.
const HEADER_TINTS = ['#9B7EDE33', '#52C7E833', '#FFA23C33', '#5FBE6B33', '#FF6F6133', '#FFC94D33'] as const
const tintFor = (i: number) => HEADER_TINTS[i % HEADER_TINTS.length]!

const DAY_COL_W = 110
const HEADER_H = 34
const ROW_H = 36

function namesFor(day: ClosingDutyDay, responsibilityId: number): string {
  const ids = day.duty?.assignments.find((a) => a.responsibilityId === responsibilityId)?.employeeIds ?? []
  if (ids.length === 0) return '—'
  return ids.map((id) => day.crew.find((c) => c.employeeId === id)?.name ?? '—').join(' / ')
}

/** Renders the closing-duty week as a day-by-role grid, matching the on-screen table. */
function drawGrid(
  days: ClosingDutyDay[],
  responsibilities: Responsibility[],
  caption: string,
  t: ReturnType<typeof useT>,
): HTMLCanvasElement {
  const byDay = new Map(days.map((d) => [d.day, d]))
  const labels = responsibilities.map((resp) => closingRoleLabel(t, resp.name))

  const roleColWidths = responsibilities.map((resp, i) => {
    const longest = widestText([
      labels[i]!,
      ...DAYS.map((d) => {
        const day = byDay.get(d)
        return day ? namesFor(day, resp.id) : ''
      }),
    ])
    return Math.max(90, Math.round(longest) + 24)
  })

  const width = GRID_PAD * 2 + DAY_COL_W + roleColWidths.reduce((a, b) => a + b, 0)
  const height = CAPTION_H + HEADER_H + DAYS.length * ROW_H + GRID_PAD * 2
  const { canvas, cell, centeredText, leftText } = gridCanvas(width, height, caption, {
    ...COLORS,
    lineWidth: 1.5,
    labelWeight: 700,
  })

  const gridTop = GRID_PAD + CAPTION_H
  const colX = (i: number) => GRID_PAD + DAY_COL_W + roleColWidths.slice(0, i).reduce((a, b) => a + b, 0)
  const rowY = (i: number) => gridTop + HEADER_H + i * ROW_H

  // header row — a tint per role instead of one flat gray strip
  cell(GRID_PAD, gridTop, DAY_COL_W, HEADER_H, COLORS.dayColBg)
  responsibilities.forEach((_resp, i) => {
    cell(colX(i), gridTop, roleColWidths[i]!, HEADER_H, tintFor(i))
    centeredText(labels[i]!, colX(i), gridTop, roleColWidths[i]!, HEADER_H, true)
  })

  // one row per day
  DAYS.forEach((dayKey, r) => {
    const y = rowY(r)
    const day = byDay.get(dayKey)
    cell(GRID_PAD, y, DAY_COL_W, ROW_H, COLORS.dayColBg)
    leftText(DAY_LABEL[dayKey], GRID_PAD, y, DAY_COL_W, ROW_H)
    responsibilities.forEach((resp, i) => {
      cell(colX(i), y, roleColWidths[i]!, ROW_H, COLORS.paper)
      centeredText(day ? namesFor(day, resp.id) : '—', colX(i), y, roleColWidths[i]!, ROW_H)
    })
  })

  return canvas
}

/** Save or share the closing-duty week as a PNG. */
export function ExportClosingDuties({
  storeName,
  weekStart,
  responsibilities,
  days,
}: {
  storeName: string
  weekStart: string
  responsibilities: Responsibility[]
  days: ClosingDutyDay[]
}) {
  const t = useT()
  return (
    <ShareImageButtons
      filename={`${storeName.replace(/\s+/g, '-')}-closing-${weekStart.slice(0, 10)}.png`}
      shareTitle={t('closing.export.shareTitle', { store: storeName })}
      draw={() =>
        drawGrid(
          days,
          responsibilities,
          `${storeName} · ${t('closing.title')} · ${t('closing.weekOf', { range: weekRangeLabel(weekStart) })}`,
          t,
        )
      }
    />
  )
}
