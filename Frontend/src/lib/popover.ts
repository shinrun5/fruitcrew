const WIDTH = 260

/** Where a popover anchored under `anchorRect` goes: kept on screen, its height
 * capped so tall content scrolls inside rather than running off the bottom. */
export function popoverBox(anchorRect: DOMRect) {
  const maxHeight = Math.min(560, window.innerHeight - 24)
  const left = Math.min(Math.max(anchorRect.left, 8), window.innerWidth - WIDTH - 8)
  const top = Math.max(8, Math.min(anchorRect.bottom + 8, window.innerHeight - 8 - maxHeight))
  return { top, left, width: WIDTH, maxHeight }
}
