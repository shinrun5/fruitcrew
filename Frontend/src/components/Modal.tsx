import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'

const EXIT_MS = 150

/** Dimmed, centered overlay — generalizes the one backdrop pattern that
 * already existed (Chat's image/action sheet) into a reusable primitive.
 * Stays mounted through its exit animation instead of vanishing instantly. */
export function Modal({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
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
        'fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 transition-opacity',
        visible ? 'opacity-100 duration-200 ease-out' : 'opacity-0 duration-150 ease-in',
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={cn(
          'w-full max-w-sm rounded-2xl border-[2.5px] border-ink bg-paper p-5 shadow-ink-pop transition-[transform,opacity]',
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
