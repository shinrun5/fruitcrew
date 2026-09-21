import type { ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

/** Themed replacement for window.confirm() — every existing confirm() site
 * in the app is a plain yes/no with no extra input, so this one shape covers
 * all of them. Labels are props, not hard-coded, since some call sites use
 * i18n and others don't. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal open={open} onClose={onCancel} className="max-w-sm">
      <h2 className="font-heading text-base font-extrabold text-ink">{title}</h2>
      {body && <p className="mt-2 font-body text-sm text-muted-ink">{body}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={tone === 'danger' ? 'alert' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
