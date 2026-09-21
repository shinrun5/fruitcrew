import { useEffect, useState } from 'react'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { CopyButton } from './CopyButton'
import { api } from '../lib/api'
import { useCopy } from '../lib/use-copy'
import type { StoreInvite } from '../types'

/** A store's reusable sign-up link — any number of workers can use the same
 * link over time to join this store themselves, instead of a manager making
 * their profile first. Regenerating replaces the code, invalidating any
 * copies already shared; turning it off removes it entirely. */
export function StoreInviteLink({ storeId }: { storeId: number }) {
  const [invite, setInvite] = useState<StoreInvite | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingTurnOff, setConfirmingTurnOff] = useState(false)
  const { copiedKey, copy } = useCopy()

  useEffect(() => {
    api
      .getStoreInvite(storeId)
      .then(setInvite)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the sign-up link'))
      .finally(() => setLoading(false))
  }, [storeId])

  const link = invite ? `${window.location.origin}/register-store?code=${encodeURIComponent(invite.code)}` : ''

  async function act(fn: () => Promise<StoreInvite | null>) {
    setBusy(true)
    setError(null)
    try {
      setInvite(await fn())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-ink/10 pt-2">
      <span className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
        Sign-up link — anyone with it can join this store themselves
      </span>
      {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
      {loading ? (
        <p className="font-body text-xs text-muted-ink">Loading…</p>
      ) : invite ? (
        <div className="flex flex-wrap items-center gap-2 font-body text-[11px]">
          <CopyButton
            copied={copiedKey === 'link'}
            onClick={() => copy('link', link)}
            label="copy sign-up link"
            copiedLabel="link copied!"
            tone="sky"
          />
          <button
            disabled={busy}
            onClick={() => void act(() => api.createStoreInvite(storeId))}
            className="font-bold text-ink underline disabled:opacity-50"
          >
            regenerate
          </button>
          <button
            disabled={busy}
            onClick={() => setConfirmingTurnOff(true)}
            className="ml-auto font-bold text-coral-dark underline disabled:opacity-50"
          >
            turn off
          </button>
        </div>
      ) : (
        <Button onClick={() => void act(() => api.createStoreInvite(storeId))} disabled={busy}>
          {busy ? 'Generating…' : 'Generate sign-up link'}
        </Button>
      )}

      <ConfirmDialog
        open={confirmingTurnOff}
        title="Turn off this sign-up link?"
        body="The old link will stop working."
        confirmLabel="Turn off"
        tone="danger"
        busy={busy}
        onConfirm={() => {
          setConfirmingTurnOff(false)
          void act(() => api.deleteStoreInvite(storeId).then(() => null))
        }}
        onCancel={() => setConfirmingTurnOff(false)}
      />
    </div>
  )
}
