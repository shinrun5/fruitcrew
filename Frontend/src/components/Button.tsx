import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'

const VARIANT_CLASS = {
  primary: 'bg-green text-white hover:brightness-95',
  secondary: 'bg-paper text-ink hover:bg-cream',
  alert: 'bg-coral text-white hover:brightness-95',
} as const

// "sm" is the flatter pill-chip tier used for tags/filters/inline row
// actions — a different elevation, not a smaller primary button, so it has
// no shadow to drop and presses with a scale instead of a translate.
const SIZE_CLASS = {
  md: 'gap-2 rounded-full border-[3px] px-[22px] py-3 text-[15px] shadow-ink-pop active:translate-x-1 active:translate-y-1 active:shadow-none',
  sm: 'gap-1 rounded-full border-2 px-3 py-0.5 text-[11px] active:scale-95',
} as const

type Variant = keyof typeof VARIANT_CLASS
type Size = keyof typeof SIZE_CLASS

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

/** Chunky pill button. The "pressed" look from the style guide is just
 * active: — no JS needed to fake the shadow-drop-and-shift. */
export function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center border-ink font-heading font-bold',
        'transition-[transform,box-shadow,filter] duration-100 ease-out',
        'disabled:pointer-events-none disabled:opacity-50',
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}
