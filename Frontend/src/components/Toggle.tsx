import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/** Checkmark-in-a-box toggle row, used for settings-style boolean prefs. Not
 * a native checkbox — a full-width tappable row reads better on mobile than
 * a tiny hit target next to a label. */
export function Toggle({
  on,
  label,
  busy,
  onClick,
  className,
}: {
  on: boolean
  label: ReactNode
  busy?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl border-2 border-ink bg-cream px-3 py-2 text-left transition-opacity disabled:opacity-60',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 border-ink font-heading text-xs font-bold transition-colors duration-150 ease-out',
          on ? 'bg-ink text-paper' : 'bg-paper text-transparent',
        )}
      >
        ✓
      </span>
      <span className="font-body text-xs text-ink">{label}</span>
    </button>
  )
}
