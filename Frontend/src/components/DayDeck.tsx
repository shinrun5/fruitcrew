import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { DAY_LABEL } from '../lib/time'
import type { DayOfWeek } from '../types'

interface DeckDay {
  day: DayOfWeek
  hasGaps: boolean
  content: ReactNode
}

const SWIPE_THRESHOLD = 60

/** One day at a time on phones, swiped through like a deck of cards, instead
 * of the full week's columns side by side (the sm: grid) — reading that
 * meant scrolling sideways on a narrow screen, which never felt great. The
 * day-pill row above doubles as a direct jump and a "which day" indicator;
 * the thin card edges behind the top one are decorative only (real per-day
 * content varies too much in height to stack live), just enough to read as
 * "there's more in the deck" rather than a dead end. */
export function DayDeck({ days }: { days: DeckDay[] }) {
  const [index, setIndex] = useState(0)
  const [dragX, setDragX] = useState(0)
  const [settling, setSettling] = useState(false)
  const dragging = useRef(false)
  const startX = useRef(0)
  const dragXRef = useRef(0)

  const active = Math.min(index, Math.max(0, days.length - 1))
  const current = days[active]

  if (!current) return null

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    dragging.current = true
    startX.current = e.clientX
    setSettling(false)
    // touch has implicit capture already; explicit capture is what makes
    // mouse-drag testing (desktop browser, simulator) track past the card's
    // own bounds the same way
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    const raw = e.clientX - startX.current
    // rubber-band instead of dragging freely past either end of the week
    const atStart = active === 0 && raw > 0
    const atEnd = active === days.length - 1 && raw < 0
    const next = atStart || atEnd ? raw / 4 : raw
    dragXRef.current = next
    setDragX(next)
  }

  function onPointerEnd() {
    if (!dragging.current) return
    dragging.current = false
    const d = dragXRef.current
    const committed = Math.abs(d) > SWIPE_THRESHOLD && (d < 0 ? active < days.length - 1 : active > 0)
    setSettling(true)
    if (committed) {
      const flingTo = d < 0 ? -window.innerWidth : window.innerWidth
      dragXRef.current = flingTo
      setDragX(flingTo)
      window.setTimeout(() => {
        setIndex(d < 0 ? active + 1 : active - 1)
        setSettling(false)
        dragXRef.current = 0
        setDragX(0)
      }, 180)
    } else {
      dragXRef.current = 0
      setDragX(0)
      window.setTimeout(() => setSettling(false), 200)
    }
  }

  return (
    <div className="sm:hidden">
      <div className="no-scrollbar mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            onClick={() => setIndex(i)}
            className={`shrink-0 rounded-full border-2 px-2.5 py-1 font-heading text-[11px] font-bold transition-colors duration-150 ease-out ${
              i === active
                ? 'border-ink bg-ink text-white'
                : d.hasGaps
                  ? 'border-coral text-coral-dark'
                  : 'border-ink/25 text-muted-ink'
            }`}
          >
            {DAY_LABEL[d.day]}
          </button>
        ))}
      </div>

      <div className="relative">
        {days.length > 1 && (
          <>
            <div className="absolute inset-x-3 -bottom-1.5 h-4 rounded-b-2xl border-2 border-ink/15 bg-paper" />
            <div className="absolute inset-x-5 -bottom-3 h-4 rounded-b-2xl border-2 border-ink/10 bg-paper" />
          </>
        )}
        <div
          className="relative touch-pan-y"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX / 24}deg)`,
            transition: settling ? 'transform 200ms ease-out' : 'none',
          }}
        >
          {current.content}
        </div>
      </div>
    </div>
  )
}
