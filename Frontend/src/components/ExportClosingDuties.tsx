import { useRef, useState } from 'react'
import { Button } from './Button'
import type { ClosingDutyDay } from '../types'
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

const ROLE_LABELS = ['Closing', 'Bathroom', 'Sweep', 'Mop'] as const
type Role = (typeof ROLE_LABELS)[number]
// One tint per role, echoing the on-screen badge colors, so the columns read
// apart at a glance instead of one flat gray header strip.
const ROLE_HEADER_BG: Record<Role, string> = {
  Closing: '#9B7EDE33',
  Bathroom: '#52C7E833',
  Sweep: '#FFA23C33',
  Mop: '#5FBE6B33',
}

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
function drawGrid(
  days: ClosingDutyDay[],
  strings: { caption: string; roleLabel: (r: Role) => string },
): HTMLCanvasElement {
  const byDay = new Map(days.map((d) => [d.day, d]))

  const scale = 2
  const measurer = document.createElement('canvas').getContext('2d')!
  measurer.font = '600 14px -apple-system, "Segoe UI", Roboto, sans-serif'
  const roleColWidths = ROLE_LABELS.map((label) => {
    const longest = Math.max(
      measurer.measureText(strings.roleLabel(label)).width,
      ...DAYS.map((d) => {
        const day = byDay.get(d)
        return day ? measurer.measureText(roleText(day, label)).width : 0
      }),
    )
    return Math.max(90, Math.round(longest) + 24)
  })

  const caption = strings.caption
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
    ctx.lineWidth = 1.5
    ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5)
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

  // header row — a tint per role instead of one flat gray strip
  cell(PAD, gridTop, DAY_COL_W, HEADER_H, COLORS.dayColBg)
  ROLE_LABELS.forEach((label, i) => {
    cell(colX(i), gridTop, roleColWidths[i]!, HEADER_H, ROLE_HEADER_BG[label])
    centeredText(strings.roleLabel(label), colX(i), gridTop, roleColWidths[i]!, HEADER_H, true)
  })

  // one row per day
  DAYS.forEach((dayKey, r) => {
    const y = rowY(r)
    const day = byDay.get(dayKey)
    cell(PAD, y, DAY_COL_W, ROW_H, COLORS.dayColBg)
    leftText(DAY_LABEL[dayKey], PAD, y, DAY_COL_W, ROW_H)
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
  const t = useT()
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)
  // synchronous re-entrancy guard — disabled= only takes effect after a
  // re-render, a beat too slow to stop a fast double-tap from firing run()
  // twice (e.g. two share sheets, two of the same image sent)
  const running = useRef(false)
  const canShareFiles =
    typeof navigator.share === 'function' &&
    typeof (navigator as Navigator & { canShare?: unknown }).canShare === 'function'
  const filename = `${storeName.replace(/\s+/g, '-')}-closing-${weekStart.slice(0, 10)}.png`

  const ROLE_KEY: Record<Role, 'closing.role.closing' | 'closing.role.bathroom' | 'closing.role.sweep' | 'closing.role.mop'> = {
    Closing: 'closing.role.closing',
    Bathroom: 'closing.role.bathroom',
    Sweep: 'closing.role.sweep',
    Mop: 'closing.role.mop',
  }

  async function run(mode: 'download' | 'share') {
    if (running.current) return
    running.current = true
    setBusy(mode)
    try {
      const canvas = drawGrid(days, {
        caption: `${storeName} · ${t('closing.title')} · ${t('closing.weekOf', { range: weekRangeLabel(weekStart) })}`,
        roleLabel: (r) => t(ROLE_KEY[r]),
      })
      const blob = await toPngBlob(canvas)
      if (!blob) return
      if (mode === 'share') {
        const file = new File([blob], filename, { type: 'image/png' })
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
        if (nav.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: t('closing.export.shareTitle', { store: storeName }) })
          return
        }
      }
      download(blob, filename)
    } catch {
      // share sheet cancelled, etc. — nothing to show for it
    } finally {
      running.current = false
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Share already covers "save this" wherever it's available (its own
       * "Save Image"/"Save to Files" destinations), and Download's <a
       * download> blob trick is unreliable inside a bare WebView with no
       * download manager wired up — show at most one, not both. */}
      {!canShareFiles && (
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run('download')}>
          {busy === 'download' ? t('schedule.export.preparing') : t('schedule.export.download')}
        </Button>
      )}
      {canShareFiles && (
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run('share')}>
          {busy === 'share' ? t('schedule.export.preparing') : t('schedule.export.share')}
        </Button>
      )}
    </div>
  )
}
