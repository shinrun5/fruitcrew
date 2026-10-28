import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/** A row in a list that folds open in place: icon, title, a one-line summary
 * of what's inside, and a chevron. Long pages (Profile, Help) become a short
 * menu you can take in at a glance, with each part a tap away. Put several in
 * one padded={false} Card; the dividers come from here. */
export function Disclosure({
  icon,
  title,
  summary,
  open,
  onToggle,
  danger,
  children,
}: {
  icon?: ReactNode
  title: ReactNode
  summary?: ReactNode
  open: boolean
  onToggle: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <div className="border-t-2 border-ink/10 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out hover:bg-cream active:bg-cream"
      >
        {icon && (
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-cream',
              danger ? 'border-coral-dark/30 text-coral-dark' : 'border-ink/20 text-ink',
            )}
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block font-heading text-sm font-bold', danger ? 'text-coral-dark' : 'text-ink')}>
            {title}
          </span>
          {summary && <span className="block truncate font-body text-xs text-muted-ink">{summary}</span>}
        </span>
        <span
          aria-hidden
          className={cn('font-heading text-lg leading-none text-muted-ink transition-transform', open && 'rotate-90')}
        >
          ›
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}
