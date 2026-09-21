import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { cn } from '../lib/cn'

const BASE = 'rounded-2xl border-[2.5px] border-ink bg-paper shadow-ink-card text-left'
const CLICKABLE =
  'transition-[transform,box-shadow] duration-150 ease-ink hover:-translate-y-0.5 hover:shadow-ink-pop active:translate-y-0 active:shadow-ink-card'

type CardProps<T extends ElementType> = {
  as?: T
  clickable?: boolean
  /** Set false for list-style cards whose children own their own padding
   * (a header bar + divided rows) instead of one uniform inset. Default true. */
  padded?: boolean
  className?: string
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>

/** The standard chunky card surface. Polymorphic via `as` so it can render as
 * a div, a form, a button, or a router Link while keeping one visual spec.
 * Pass `clickable` only when the whole card is itself the action (e.g. a
 * store picker) — it adds a hover lift and real press feedback; plain
 * display cards stay still. Defaults to `button` when clickable and no `as`
 * is given, since a clickable card is normally a real action, not a link. */
export function Card<T extends ElementType = 'div'>({
  as,
  clickable,
  padded = true,
  className,
  children,
  ...rest
}: CardProps<T>) {
  const Component = (as ?? (clickable ? 'button' : 'div')) as ElementType
  const extra = Component === 'button' ? { type: (rest as { type?: string }).type ?? 'button' } : {}
  return (
    <Component className={cn(BASE, padded && 'p-4', clickable && CLICKABLE, className)} {...extra} {...rest}>
      {children}
    </Component>
  )
}

/** Centered dashed placeholder for "nothing here yet" states — the empty
 * marketplace/shift-list look, standardized in one place. */
export function EmptyState({
  icon,
  title,
  body,
  className,
}: {
  icon?: ReactNode
  title: string
  body?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-2xl border-[2.5px] border-dashed border-ink/25 bg-paper/60 px-6 py-10 text-center',
        className,
      )}
    >
      {icon}
      <p className="font-heading text-sm font-bold text-ink">{title}</p>
      {body && <p className="font-body text-xs text-muted-ink">{body}</p>}
    </div>
  )
}
