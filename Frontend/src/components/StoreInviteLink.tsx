import { useEffect, useState } from 'react'
import { Button } from './Button'
import { api } from '../lib/api'
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
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    api
      .getStoreInvite(storeId)
      .then(setInvite)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the sign-up link'))
      .finally(() => setLoading(false))
  }, [storeId])

  const link = invite ? `${window.location.origin}/register-store?code=${encodeURIComponent(invite.code)}` : ''

  function copy(key: string, text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key)
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
      },
      () => {},
    )
  }

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
          <button onClick={() => copy('link', link)} className="font-bold text-sky-dark underline">
            {copied === 'link' ? 'link copied!' : 'copy sign-up link'}
          </button>
          <button
            disabled={busy}
            onClick={() => void act(() => api.createStoreInvite(storeId))}
            className="font-bold text-ink underline disabled:opacity-50"
          >
            regenerate
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm('Turn off this sign-up link? The old link will stop working.')) {
                void act(() => api.deleteStoreInvite(storeId).then(() => null))
              }
            }}
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
    </div>
  )
}
