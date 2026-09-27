import { useRef, useState } from 'react'
import { Button } from './Button'
import type { ClosingDutyDay, Responsibility } from '../types'
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
const PAD = 16

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

  const scale = 2
  const measurer = document.createElement('canvas').getContext('2d')!
  measurer.font = '600 14px -apple-system, "Segoe UI", Roboto, sans-serif'
  const roleColWidths = responsibilities.map((resp, i) => {
    const longest = Math.max(
      measurer.measureText(labels[i]!).width,
      ...DAYS.map((d) => {
        const day = byDay.get(d)
        return day ? measurer.measureText(namesFor(day, resp.id)).width : 0
      }),
    )
    return Math.max(90, Math.round(longest) + 24)
  })

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
  responsibilities.forEach((_resp, i) => {
    cell(colX(i), gridTop, roleColWidths[i]!, HEADER_H, tintFor(i))
    centeredText(labels[i]!, colX(i), gridTop, roleColWidths[i]!, HEADER_H, true)
  })

  // one row per day
  DAYS.forEach((dayKey, r) => {
    const y = rowY(r)
    const day = byDay.get(dayKey)
    cell(PAD, y, DAY_COL_W, ROW_H, COLORS.dayColBg)
    leftText(DAY_LABEL[dayKey], PAD, y, DAY_COL_W, ROW_H)
    responsibilities.forEach((resp, i) => {
      cell(colX(i), y, roleColWidths[i]!, ROW_H, COLORS.paper)
      centeredText(day ? namesFor(day, resp.id) : '—', colX(i), y, roleColWidths[i]!, ROW_H)
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
  responsibilities,
  days,
}: {
  storeName: string
  weekStart: string
  responsibilities: Responsibility[]
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

  async function run(mode: 'download' | 'share') {
    if (running.current) return
    running.current = true
    setBusy(mode)
    try {
      const canvas = drawGrid(
        days,
        responsibilities,
        `${storeName} · ${t('closing.title')} · ${t('closing.weekOf', { range: weekRangeLabel(weekStart) })}`,
        t,
      )
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
