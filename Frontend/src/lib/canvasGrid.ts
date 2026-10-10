// Drawing shared by the grids that get exported as PNGs — the week schedule
// (ExportSchedule.tsx) and the closing-duty week (ExportClosingDuties.tsx).

const FONT = '-apple-system, "Segoe UI", Roboto, sans-serif'
export const font = (weight: number, px = 13) => `${weight} ${px}px ${FONT}`

export const GRID_PAD = 16
export const CAPTION_H = 30

/** Widest of `texts` in the grid's cell font, in CSS px — for sizing a column to fit. */
export function widestText(texts: string[]): number {
  const measurer = document.createElement('canvas').getContext('2d')!
  measurer.font = font(600, 14)
  return Math.max(...texts.map((t) => measurer.measureText(t).width))
}

interface GridStyle {
  ink: string
  grid: string
  paper: string
  muted: string
  lineWidth: number
  /** font weight of the left-hand row labels */
  labelWeight: number
}

/** A 2x-resolution canvas of `width`×`height` CSS px on a paper background,
 * `caption` across the top, plus painters for the grid's cells and text. */
export function gridCanvas(width: number, height: number, caption: string, style: GridStyle) {
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  ctx.fillStyle = style.paper
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = style.muted
  ctx.font = font(700)
  ctx.fillText(caption, GRID_PAD, GRID_PAD + 12)

  const inset = style.lineWidth / 2
  const cell = (x: number, y: number, w: number, h: number, bg: string) => {
    ctx.fillStyle = bg
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = style.grid
    ctx.lineWidth = style.lineWidth
    ctx.strokeRect(x + inset, y + inset, w - style.lineWidth, h - style.lineWidth)
  }
  const centeredText = (text: string, x: number, y: number, w: number, h: number, bold = false) => {
    ctx.fillStyle = style.ink
    ctx.font = font(bold ? 700 : 600)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + w / 2, y + h / 2, w - 10)
  }
  const leftText = (text: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = style.ink
    ctx.font = font(style.labelWeight)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + 8, y + h / 2, w - 14)
  }

  return { canvas, cell, centeredText, leftText }
}
