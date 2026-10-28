import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/** On/off settings row: a short bold label, an optional one-line explanation
 * under it, and a switch on the right — the way phone settings read. The
 * whole row is the tap target, not just the switch. Stack several inside a
 * ToggleGroup so they share one box instead of each drawing its own. */
export function Toggle({
  on,
  label,
  hint,
  busy,
  onClick,
  plain,
  className,
}: {
  on: boolean
  label: ReactNode
  hint?: ReactNode
  busy?: boolean
  onClick: () => void
  /** no box of its own — for rows inside a ToggleGroup */
  plain?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={busy}
      className={cn(
        'flex w-full items-center gap-3 text-left transition-opacity disabled:opacity-60',
        plain ? 'py-2.5' : 'rounded-xl border-2 border-ink/15 bg-cream/60 px-3 py-2.5',
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-body text-xs font-bold text-ink first-letter:uppercase">{label}</span>
        {hint && (
          <span className="mt-0.5 block font-body text-[11px] leading-snug text-muted-ink first-letter:uppercase">{hint}</span>
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-full border-2 border-ink transition-colors duration-150 ease-out',
          on ? 'bg-green' : 'bg-ink/10',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-ink bg-paper transition-[left] duration-150 ease-out',
            on ? 'left-[18px]' : 'left-[2px]',
          )}
        />
      </span>
    </button>
  )
}

/** One box for a run of related Toggles, divided by hairlines. */
export function ToggleGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('divide-y-2 divide-ink/10 rounded-xl border-2 border-ink/15 bg-cream/60 px-3', className)}>
      {children}
    </div>
  )
}
