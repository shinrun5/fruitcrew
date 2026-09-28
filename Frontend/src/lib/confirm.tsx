import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT } from './i18n'

export interface ConfirmOptions {
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

type ConfirmFn = (title: string, opts?: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/** Promise-based replacement for window.confirm() — themed like the rest of
 * the app instead of the OS's own dialog. `await confirm(title)` resolves
 * true/false the same way confirm() returns, so most call sites are a
 * one-line swap. */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext)
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return fn
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [pending, setPending] = useState<{ title: string; opts: ConfirmOptions } | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>(
    (title, opts) =>
      new Promise((resolve) => {
        resolveRef.current = resolve
        setPending({ title, opts: opts ?? {} })
      }),
    [],
  )

  function settle(v: boolean) {
    setPending(null)
    resolveRef.current?.(v)
    resolveRef.current = null
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={pending != null}
        title={pending?.title ?? ''}
        body={pending?.opts.body}
        confirmLabel={pending?.opts.confirmLabel ?? t('common.confirm')}
        cancelLabel={pending?.opts.cancelLabel ?? t('stores.cancel')}
        tone={pending?.opts.tone ?? 'default'}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  )
}
