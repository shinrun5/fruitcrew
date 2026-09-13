import { useState } from 'react'
import type { DayOfWeek } from '../types'
import type { DayPerson } from './ScheduleCards'
import { DAY_LABEL, DAYS, dayDate, to12Hour, toHHMM24, weekRangeLabel } from '../lib/time'

const COLORS = {
  ink: '#3A2B4D',
  cream: '#FFF8EC',
  paper: '#FFFFFF',
  muted: '#7A6E8C',
  accents: ['#5FBE6B', '#52C7E8', '#9B7EDE', '#FFA23C'],
}

const W = 800
const PAD = 40
const HEADER_H = 128
const DAY_PILL_H = 34
const LINE_H = 30
const DAY_GAP = 22
const FOOTER_H = 56

interface ExportDay {
  day: DayOfWeek
  people: DayPerson[]
}

function personLine(p: DayPerson): string {
  const time = `${to12Hour(toHHMM24(p.start))}–${to12Hour(toHHMM24(p.end))}`
  const note = p.note?.comesIn ? ` (in at ${p.note.comesIn})` : p.note?.leaves ? ` (out ${p.note.leaves})` : ''
  return `${time}   ${p.name}${note}`
}

/** Renders a store's week to a shareable PNG — day headers + who's on, nothing a
 * manager wouldn't want a crew group chat to see (no gaps, no store internals). */
function drawSchedule(storeName: string, weekStart: string, days: ExportDay[]): HTMLCanvasElement {
  const shown = days.filter((d) => d.people.length > 0)
  const bodyH = shown.reduce((n, d) => n + DAY_PILL_H + 8 + d.people.length * LINE_H + DAY_GAP, 0)
  const height = HEADER_H + Math.max(bodyH, LINE_H) + FOOTER_H

  const scale = 2 // crisp on phone screens
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  ctx.fillStyle = COLORS.cream
  ctx.fillRect(0, 0, W, height)

  // header
  ctx.fillStyle = COLORS.muted
  ctx.font = '700 13px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText('🍎 FRUIT CREW', PAD, PAD)

  ctx.fillStyle = COLORS.ink
  ctx.font = '800 30px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText(storeName, PAD, PAD + 42)

  ctx.fillStyle = COLORS.muted
  ctx.font = '600 16px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText(`Week of ${weekRangeLabel(weekStart)}`, PAD, PAD + 68)

  ctx.strokeStyle = `${COLORS.ink}33`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, HEADER_H - 8)
  ctx.lineTo(W - PAD, HEADER_H - 8)
  ctx.stroke()

  let y = HEADER_H + 14
  if (shown.length === 0) {
    ctx.fillStyle = COLORS.muted
    ctx.font = '600 15px -apple-system, "Segoe UI", Roboto, sans-serif'
    ctx.fillText('Nothing scheduled yet.', PAD, y + 8)
    y += LINE_H
  }

  shown.forEach((d, i) => {
    const accent = COLORS.accents[i % COLORS.accents.length]!
    const label = `${DAY_LABEL[d.day]} · ${dayDate(weekStart, DAYS.indexOf(d.day))}`

    ctx.font = '800 13px -apple-system, "Segoe UI", Roboto, sans-serif'
    const pillW = ctx.measureText(label).width + 28
    ctx.fillStyle = accent
    roundRect(ctx, PAD, y, pillW, DAY_PILL_H, 17)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(label, PAD + 14, y + DAY_PILL_H / 2 + 4)

    y += DAY_PILL_H + 10
    ctx.font = '600 15px -apple-system, "Segoe UI", Roboto, sans-serif'
    for (const p of d.people) {
      ctx.fillStyle = COLORS.ink
      ctx.fillText(personLine(p), PAD + 4, y + 12)
      y += LINE_H
    }
    y += DAY_GAP - 10
  })

  ctx.strokeStyle = `${COLORS.ink}22`
  ctx.beginPath()
  ctx.moveTo(PAD, height - FOOTER_H + 10)
  ctx.lineTo(W - PAD, height - FOOTER_H + 10)
  ctx.stroke()
  ctx.fillStyle = COLORS.muted
  ctx.font = '600 12px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Shared from Fruit Crew', W / 2, height - FOOTER_H + 32)
  ctx.textAlign = 'left'

  return canvas
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Button that renders the week to a PNG and shares (mobile) or downloads (desktop) it. */
export function ExportSchedule({
  storeName,
  weekStart,
  days,
}: {
  storeName: string
  weekStart: string
  days: ExportDay[]
}) {
  const [busy, setBusy] = useState(false)

  async function share() {
    setBusy(true)
    try {
      const canvas = drawSchedule(storeName, weekStart, days)
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return
      const filename = `${storeName.replace(/\s+/g, '-')}-${weekStart.slice(0, 10)}.png`
      const file = new File([blob], filename, { type: 'image/png' })

      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean }
      if (nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: `${storeName} schedule` })
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // AbortError etc. from a cancelled share sheet — nothing to show for it
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={() => void share()}
      disabled={busy}
      className="rounded-full border-2 border-ink bg-paper px-3 py-1.5 font-heading text-xs font-bold text-ink disabled:opacity-50"
    >
      {busy ? 'Preparing…' : '📤 Export'}
    </button>
  )
}
