import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'

const EXIT_MS = 150

/** Dimmed overlay — generalizes the one backdrop pattern that already
 * existed (Chat's image/action sheet) into a reusable primitive. Stays
 * mounted through its exit animation instead of vanishing instantly.
 * Centered by default; pass `sheet` for a panel that docks to the bottom on
 * phones and centers on wider screens (a searchable list reads better than
 * a small centered box there). Caller supplies width via className (no
 * default max-width, so it doesn't fight a className override). */
export function Modal({
  open,
  onClose,
  children,
  className,
  sheet,
  padded = true,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  sheet?: boolean
  padded?: boolean
}) {
  const [rendered, setRendered] = useState(open)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      setRendered(true)
      const id = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(id)
    }
    setVisible(false)
    const id = setTimeout(() => setRendered(false), EXIT_MS)
    return () => clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!rendered) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [rendered, onClose])

  if (!rendered) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center bg-ink/30 transition-opacity',
        sheet ? 'items-end sm:items-center' : 'items-center p-4',
        visible ? 'opacity-100 duration-200 ease-out' : 'opacity-0 duration-150 ease-in',
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={cn(
          'w-full border-[2.5px] border-ink bg-paper shadow-ink-pop transition-[transform,opacity]',
          sheet ? 'rounded-t-2xl sm:rounded-2xl' : 'rounded-2xl',
          padded && 'p-5',
          visible
            ? 'translate-y-0 scale-100 opacity-100 duration-200 ease-out'
            : 'translate-y-1 scale-[0.98] opacity-0 duration-150 ease-in',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
