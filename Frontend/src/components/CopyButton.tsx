import { cn } from '../lib/cn'

const TONE_CLASS = {
  ink: 'text-ink',
  sky: 'text-sky-dark',
  coral: 'text-coral-dark',
} as const

/** The underlined "copy code" / "copy link" text action reused across every
 * invite-link flow, paired with useCopy(). */
export function CopyButton({
  copied,
  onClick,
  label,
  copiedLabel,
  tone = 'ink',
  className,
}: {
  copied: boolean
  onClick: () => void
  label: string
  copiedLabel: string
  tone?: keyof typeof TONE_CLASS
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('font-bold underline transition-colors duration-150 ease-out', TONE_CLASS[tone], className)}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}
