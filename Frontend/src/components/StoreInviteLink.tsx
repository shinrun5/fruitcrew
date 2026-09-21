import { useEffect, useState } from 'react'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { CopyButton } from './CopyButton'
import { api } from '../lib/api'
import { useCopy } from '../lib/use-copy'
import { useT } from '../lib/i18n'
import type { StoreInvite } from '../types'

/** A store's reusable sign-up link — any number of workers can use the same
 * link over time to join this store themselves, instead of a manager making
 * their profile first. Regenerating replaces the code, invalidating any
 * copies already shared; turning it off removes it entirely. */
export function StoreInviteLink({ storeId }: { storeId: number }) {
  const t = useT()
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
      .catch((e) => setError(e instanceof Error ? e.message : t('stores.invite.loadError')))
      .finally(() => setLoading(false))
  }, [storeId])

  const link = invite ? `${window.location.origin}/register-store?code=${encodeURIComponent(invite.code)}` : ''

  async function act(fn: () => Promise<StoreInvite | null>) {
    setBusy(true)
    setError(null)
    try {
      setInvite(await fn())
    } catch (e) {
      setError(e instanceof Error ? e.message : t('stores.invite.genericError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-ink/10 pt-2">
      <span className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
        {t('stores.invite.subtitle')}
      </span>
      {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
      {loading ? (
        <p className="font-body text-xs text-muted-ink">{t('common.loading')}</p>
      ) : invite ? (
        <div className="flex flex-wrap items-center gap-2 font-body text-[11px]">
          <CopyButton
            copied={copiedKey === 'link'}
            onClick={() => copy('link', link)}
            label={t('stores.invite.copyLink')}
            copiedLabel={t('stores.invite.copiedLink')}
            tone="sky"
          />
          <button
            disabled={busy}
            onClick={() => void act(() => api.createStoreInvite(storeId))}
            className="font-bold text-ink underline disabled:opacity-50"
          >
            {t('stores.invite.regenerate')}
          </button>
          <button
            disabled={busy}
            onClick={() => setConfirmingTurnOff(true)}
            className="ml-auto font-bold text-coral-dark underline disabled:opacity-50"
          >
            {t('stores.invite.turnOff')}
          </button>
        </div>
      ) : (
        <Button onClick={() => void act(() => api.createStoreInvite(storeId))} disabled={busy}>
          {busy ? t('stores.invite.generating') : t('stores.invite.generate')}
        </Button>
      )}

      <ConfirmDialog
        open={confirmingTurnOff}
        title={t('stores.invite.confirmTurnOff.title')}
        body={t('stores.invite.confirmTurnOff.body')}
        confirmLabel={t('stores.invite.confirmTurnOff.confirm')}
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
