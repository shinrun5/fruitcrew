import { useState } from 'react'
import type { ClosingDutyDay, DayOfWeek } from '../types'
import { DAYS, weekRangeLabel } from '../lib/time'

const FULL_DAY_NAME: Record<DayOfWeek, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
}

const COLORS = {
  ink: '#1A1A1A',
  grid: '#B0B0B0',
  headerBg: '#C4C4C4',
  paper: '#FFFFFF',
  muted: '#6B6B6B',
}

const ROLE_LABELS = ['Closing', 'Bathroom', 'Sweep', 'Mop'] as const
type Role = (typeof ROLE_LABELS)[number]

const DAY_COL_W = 110
const HEADER_H = 34
const ROW_H = 36
const PAD = 16

function nameOf(day: ClosingDutyDay, id: number | null): string {
  if (id == null) return '—'
  return day.crew.find((c) => c.employeeId === id)?.name ?? '—'
}

function roleText(day: ClosingDutyDay, role: Role): string {
  if (!day.duty) return '—'
  if (role === 'Bathroom') {
    return day.duty.bathroomEmployeeIds.length
      ? day.duty.bathroomEmployeeIds.map((id) => nameOf(day, id)).join(' / ')
      : '—'
  }
  const id =
    role === 'Closing' ? day.duty.closingEmployeeId : role === 'Sweep' ? day.duty.sweepEmployeeId : day.duty.mopEmployeeId
  return nameOf(day, id)
}

/** Renders the closing-duty week as a day-by-role grid, matching the on-screen table. */
function drawGrid(storeName: string, weekStart: string, days: ClosingDutyDay[]): HTMLCanvasElement {
  const byDay = new Map(days.map((d) => [d.day, d]))

  const scale = 2
  const measurer = document.createElement('canvas').getContext('2d')!
  measurer.font = '600 14px -apple-system, "Segoe UI", Roboto, sans-serif'
  const roleColWidths = ROLE_LABELS.map((label) => {
    const longest = Math.max(
      measurer.measureText(label).width,
      ...DAYS.map((d) => {
        const day = byDay.get(d)
        return day ? measurer.measureText(roleText(day, label)).width : 0
      }),
    )
    return Math.max(90, Math.round(longest) + 24)
  })

  const caption = `${storeName} · Closing Duties · Week of ${weekRangeLabel(weekStart)}`
  const captionH = 30
  const width = PAD * 2 + DAY_COL_W + roleColWidths.reduce((a, b) => a + b, 0)
  const height = captionH + HEADER_H + DAYS.length * ROW_H + PAD * 2

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
  const colX = (i: number) => PAD + DAY_COL_W + roleColWidths.slice(0, i).reduce((a, b) => a + b, 0)
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
    ctx.font = '700 13px -apple-system, "Segoe UI", Roboto, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + 8, y + h / 2, w - 14)
  }

  // header row
  cell(PAD, gridTop, DAY_COL_W, HEADER_H, COLORS.headerBg)
  ROLE_LABELS.forEach((label, i) => {
    cell(colX(i), gridTop, roleColWidths[i]!, HEADER_H, COLORS.headerBg)
    centeredText(label, colX(i), gridTop, roleColWidths[i]!, HEADER_H, true)
  })

  // one row per day
  DAYS.forEach((dayKey, r) => {
    const y = rowY(r)
    const day = byDay.get(dayKey)
    cell(PAD, y, DAY_COL_W, ROW_H, COLORS.paper)
    leftText(FULL_DAY_NAME[dayKey], PAD, y, DAY_COL_W, ROW_H)
    ROLE_LABELS.forEach((label, i) => {
      cell(colX(i), y, roleColWidths[i]!, ROW_H, COLORS.paper)
      centeredText(day ? roleText(day, label) : '—', colX(i), y, roleColWidths[i]!, ROW_H)
    })
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

/** Buttons that render the closing-duty week to a PNG, then either save it or
 * open the native share sheet (WeChat, Messages, whatever's installed). */
export function ExportClosingDuties({
  storeName,
  weekStart,
  days,
}: {
  storeName: string
  weekStart: string
  days: ClosingDutyDay[]
}) {
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)
  const canShareFiles =
    typeof navigator.share === 'function' &&
    typeof (navigator as Navigator & { canShare?: unknown }).canShare === 'function'
  const filename = `${storeName.replace(/\s+/g, '-')}-closing-${weekStart.slice(0, 10)}.png`

  async function run(mode: 'download' | 'share') {
    setBusy(mode)
    try {
      const canvas = drawGrid(storeName, weekStart, days)
      const blob = await toPngBlob(canvas)
      if (!blob) return
      if (mode === 'share') {
        const file = new File([blob], filename, { type: 'image/png' })
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
        if (nav.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: `${storeName} closing duties` })
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
      <button
        onClick={() => void run('download')}
        disabled={busy !== null}
        className="rounded-full border-2 border-ink bg-paper px-3 py-1.5 font-heading text-xs font-bold text-ink disabled:opacity-50"
      >
        {busy === 'download' ? 'Preparing…' : '⬇ Download'}
      </button>
      {canShareFiles && (
        <button
          onClick={() => void run('share')}
          disabled={busy !== null}
          className="rounded-full border-2 border-ink bg-paper px-3 py-1.5 font-heading text-xs font-bold text-ink disabled:opacity-50"
        >
          {busy === 'share' ? 'Preparing…' : '📤 Share'}
        </button>
      )}
    </div>
  )
}
