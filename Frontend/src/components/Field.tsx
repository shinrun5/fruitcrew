import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

const CHROME =
  'w-full rounded-xl border-[2.5px] border-ink bg-cream px-3 py-2 font-body text-sm text-ink outline-none transition-colors duration-150 ease-out focus:border-ink focus:bg-paper'
const CHROME_SM =
  'rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none transition-colors duration-150 ease-out focus:bg-paper'

type Size = 'md' | 'sm'
const chrome = (size: Size, className?: string) => cn(size === 'sm' ? CHROME_SM : CHROME, className)

// md: a full-width block field with room below for the next one (settings
// forms). sm: an inline flex item sized to its content (dense manager rows)
// — no block/margin, just a label-above-input stack.
const WRAP = { md: 'mb-3 block', sm: 'flex flex-col gap-1' } as const
const LABEL = {
  md: 'mb-1 block font-body text-xs font-bold text-muted-ink',
  sm: 'font-body text-[10px] font-bold text-muted-ink',
} as const

function Label({ label, size }: { label?: string; size: Size }) {
  if (!label) return null
  return <span className={LABEL[size]}>{label}</span>
}

/** Chunky themed text input. `size="sm"` is the dense variant used in
 * manager tables/inline editors — same focus treatment, smaller footprint.
 * (Omits the native `size` DOM attribute — inputs don't use it here, and it
 * would collide with this component's own `size` prop.) */
export function Field({
  label,
  size = 'md',
  className,
  ...props
}: { label?: string; size?: Size } & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>) {
  const input = <input {...props} className={chrome(size, className)} />
  return label ? (
    <label className={WRAP[size]}>
      <Label label={label} size={size} />
      {input}
    </label>
  ) : (
    input
  )
}

export function TextareaField({
  label,
  size = 'md',
  className,
  ...props
}: { label?: string; size?: Size } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textarea = <textarea {...props} className={cn(chrome(size, className), 'resize-none')} />
  return label ? (
    <label className={WRAP[size]}>
      <Label label={label} size={size} />
      {textarea}
    </label>
  ) : (
    textarea
  )
}

export function SelectField({
  label,
  size = 'md',
  className,
  children,
  ...props
}: { label?: string; size?: Size } & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>) {
  const select = (
    <select {...props} className={chrome(size, className)}>
      {children}
    </select>
  )
  return label ? (
    <label className={WRAP[size]}>
      <Label label={label} size={size} />
      {select}
    </label>
  ) : (
    select
  )
}
