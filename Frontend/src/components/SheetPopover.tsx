import type { ReactNode } from 'react'
import { popoverBox } from '../lib/popover'
import { useIsNarrow } from '../lib/use-narrow'

/** The box the schedule's shift panels open in: on a phone, a full-width sheet
 * up from the bottom over a dimmed page (thumb-reachable, nothing cut off at
 * the sides); on a computer, a popover next to whatever was tapped. Tapping
 * outside closes it either way. */
export function SheetPopover({
  anchorRect,
  label,
  onClose,
  width = 320,
  children,
}: {
  anchorRect: DOMRect
  /** what a screen reader announces it as */
  label: string
  onClose: () => void
  width?: number
  children: ReactNode
}) {
  const narrow = useIsNarrow()
  return (
    <>
      <div className={`fixed inset-0 z-40 ${narrow ? 'bg-ink/30' : ''}`} onClick={onClose} />
      <div
        role="dialog"
        aria-label={label}
        className={`fixed z-50 flex flex-col overflow-y-auto border-[2.5px] border-ink bg-paper ${
          narrow
            ? 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl border-b-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2'
            : 'rounded-2xl p-3.5 shadow-[4px_4px_0_var(--color-ink)]'
        }`}
        style={narrow ? undefined : popoverBox(anchorRect, width)}
        onClick={(e) => e.stopPropagation()}
      >
        {narrow && <span aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-ink/20" />}
        {children}
      </div>
    </>
  )
}

/** The × in a panel's header. */
export function SheetClose({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button
      onClick={onClose}
      aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink/20 font-heading text-base leading-none text-ink hover:border-ink"
    >
      ×
    </button>
  )
}
