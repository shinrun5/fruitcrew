import { useEffect, useState } from 'react'
import { Button } from './Button'
import { CopyButton } from './CopyButton'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useCopy } from '../lib/use-copy'
import { useT } from '../lib/i18n'
import type { ManagerInvite, ManagerRow, Role, Store } from '../types'

/** Owner-only: manage the people who run the company — other owners and managers. */
export function ManagersSection({ stores }: { stores: Store[] }) {
  const t = useT()
  const confirm = useConfirm()
  const [people, setPeople] = useState<ManagerRow[]>([])
  const [invites, setInvites] = useState<ManagerInvite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<null | 'manager' | 'owner'>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const { copiedKey, copy } = useCopy()

  function refresh() {
    return Promise.all([api.getTeam(), api.getManagerInvites()])
      .then(([p, i]) => {
        setPeople(p)
        setInvites(i)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('stores.managers.loadError')))
  }
  useEffect(() => {
    refresh()
  }, [])

  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? t('stores.managers.storeFallback', { id })
  const roleLabel = (role: Role) =>
    role === 'OWNER'
      ? t('stores.managers.roleOwner')
      : role === 'MANAGER'
        ? t('stores.managers.roleManager')
        : role.toLowerCase()
  const owners = people.filter((p) => p.role === 'OWNER')
  const soleOwner = owners.length <= 1
  const ordered = [...people].sort((a, b) =>
    a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'OWNER' ? -1 : 1,
  )

  async function act(id: number | null, fn: () => Promise<unknown>) {
    setBusy(id ?? -1)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('stores.managers.genericError'))
    } finally {
      setBusy(null)
    }
  }

  const inviteLink = (code: string) => `${window.location.origin}/register-manager?code=${encodeURIComponent(code)}`

  return (
    <div className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading text-sm font-bold text-ink">{t('stores.managers.title')}</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => setAdding((v) => (v === 'manager' ? null : 'manager'))}
            className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink"
          >
            {adding === 'manager' ? t('stores.managers.cancel') : t('stores.managers.addManager')}
          </button>
          <button
            onClick={() => setAdding((v) => (v === 'owner' ? null : 'owner'))}
            className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink"
          >
            {adding === 'owner' ? t('stores.managers.cancel') : t('stores.managers.addOwner')}
          </button>
        </div>
      </div>
      {error && <p className="mt-1 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {adding && (
        <InviteForm
          stores={stores}
          role={adding === 'owner' ? 'OWNER' : 'MANAGER'}
          onCreate={(input) => act(null, () => api.createManagerInvite(input)).then(() => setAdding(null))}
        />
      )}

      {invites.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-ink/10 pt-2">
          <span className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
            {t('stores.managers.pendingInvites')}
          </span>
          {invites.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center gap-2 font-body text-[11px]">
              <span className="rounded-full border border-ink/25 px-1.5 py-px font-bold text-muted-ink">
                {roleLabel(inv.role)}
              </span>
              {inv.storeIds.length > 0 && (
                <span className="text-muted-ink">{inv.storeIds.map(storeName).join(', ')}</span>
              )}
              <CopyButton
                copied={copiedKey === `${inv.id}:code`}
                onClick={() => copy(`${inv.id}:code`, inv.code)}
                label={t('stores.managers.copyCode')}
                copiedLabel={t('stores.managers.copiedCode')}
              />
              <CopyButton
                copied={copiedKey === `${inv.id}:link`}
                onClick={() => copy(`${inv.id}:link`, inviteLink(inv.code))}
                label={t('stores.managers.copyLink')}
                copiedLabel={t('stores.managers.copiedLink')}
                tone="sky"
              />
              <button
                disabled={busy === inv.id}
                onClick={() => {
                  void confirm(t('stores.managers.confirmRevoke', { role: roleLabel(inv.role) }), { tone: 'danger' }).then(
                    (ok) => {
                      if (ok) void act(inv.id, () => api.cancelManagerInvite(inv.id))
                    },
                  )
                }}
                className="ml-auto font-bold text-coral-dark underline disabled:opacity-50"
              >
                {t('stores.managers.revoke')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-2">
        {ordered.map((p) => {
          const lockRole = p.isSelf || (p.role === 'OWNER' && soleOwner)
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-2 border-t border-ink/10 pt-2">
              <span className="font-body text-xs font-bold text-ink">{p.email}</span>
              <span
                className={`rounded-full border px-1.5 py-px font-body text-[9px] font-bold ${
                  p.role === 'OWNER'
                    ? 'border-grape/50 text-grape'
                    : 'border-ink/25 text-muted-ink'
                }`}
              >
                {roleLabel(p.role)}
              </span>
              {p.isSelf && (
                <span className="font-body text-[10px] font-bold text-muted-ink">{t('stores.managers.you')}</span>
              )}
              {p.isEmployee && (
                <span className="rounded-full border border-ink/25 px-1.5 py-px font-body text-[9px] font-bold text-muted-ink">
                  {t('stores.managers.alsoWorksHere')}
                </span>
              )}

              {p.role === 'MANAGER' && (
                <StorePicker
                  stores={stores}
                  picked={p.storeIds}
                  disabled={busy === p.id}
                  onToggle={(id) =>
                    act(p.id, () =>
                      api.setManagerStores(
                        p.id,
                        p.storeIds.includes(id) ? p.storeIds.filter((x) => x !== id) : [...p.storeIds, id],
                      ),
                    )
                  }
                />
              )}

              <div className="ml-auto flex gap-1.5">
                {!lockRole && p.role === 'MANAGER' && (
                  <button
                    disabled={busy === p.id}
                    onClick={() => void act(p.id, () => api.setPersonRole(p.id, 'OWNER'))}
                    className="rounded-full border-2 border-grape/60 px-2 py-0.5 font-heading text-[10px] font-bold text-grape"
                  >
                    {t('stores.managers.makeOwner')}
                  </button>
                )}
                {!lockRole && p.role === 'OWNER' && (
                  <button
                    disabled={busy === p.id}
                    onClick={() => {
                      void confirm(t('stores.managers.confirmMakeManager', { email: p.email })).then(
                        (ok) => {
                          if (ok) void act(p.id, () => api.setPersonRole(p.id, 'MANAGER'))
                        },
                      )
                    }}
                    className="rounded-full border-2 border-ink/40 px-2 py-0.5 font-heading text-[10px] font-bold text-muted-ink"
                  >
                    {t('stores.managers.makeManager')}
                  </button>
                )}
                {!p.isSelf && !(p.role === 'OWNER' && soleOwner) && (
                  <button
                    disabled={busy === p.id}
                    onClick={() => {
                      void confirm(t('stores.managers.confirmRemove', { email: p.email }), { tone: 'danger' }).then(
                        (ok) => {
                          if (ok) void act(p.id, () => api.removePerson(p.id))
                        },
                      )
                    }}
                    className="rounded-full border-2 border-coral px-2 py-0.5 font-heading text-[10px] font-bold text-coral-dark"
                  >
                    {t('stores.managers.remove')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InviteForm({
  stores,
  role,
  onCreate,
}: {
  stores: Store[]
  role: 'OWNER' | 'MANAGER'
  onCreate: (input: { role: 'OWNER' | 'MANAGER'; storeIds?: number[] }) => void
}) {
  const t = useT()
  const [picked, setPicked] = useState<number[]>([])

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-ink/10 pt-2">
      {role === 'MANAGER' ? (
        <StorePicker
          stores={stores}
          picked={picked}
          onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
        />
      ) : (
        <span className="font-body text-[10px] text-muted-ink">{t('stores.managers.ownersSeeEvery')}</span>
      )}
      <Button onClick={() => onCreate({ role, storeIds: picked })} className="self-start">
        {t('stores.managers.generateInvite')}
      </Button>
    </div>
  )
}

/** Store/section picker shared by a fresh manager invite and an existing
 * manager's own store toggles. A section always grants real access (that's
 * where the actual schedule/requirements/chat live); its parent store, once
 * it has sections, is never itself scheduled — picking it only grants the
 * store-wide stuff (hours, sign-up link, adding/removing sections), so it's
 * shown separately with a hint rather than looking like just another store. */
function StorePicker({
  stores,
  picked,
  onToggle,
  disabled,
}: {
  stores: Store[]
  picked: number[]
  onToggle: (id: number) => void
  disabled?: boolean
}) {
  const t = useT()
  const topLevel = stores.filter((s) => s.parentStoreId == null)
  const sectionsOf = (id: number) => stores.filter((s) => s.parentStoreId === id)

  const pill = (s: Store, on: boolean) => (
    <button
      key={s.id}
      type="button"
      disabled={disabled}
      onClick={() => onToggle(s.id)}
      className={`rounded-full border-2 px-2 py-0.5 font-heading text-[10px] font-bold ${
        on ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
      }`}
    >
      {s.name}
    </button>
  )

  return (
    <div className="flex flex-col gap-1.5">
      {topLevel.map((s) => {
        const sections = sectionsOf(s.id)
        return (
          <div key={s.id}>
            <div className="flex flex-wrap items-center gap-1.5">
              {pill(s, picked.includes(s.id))}
              {sections.length > 0 && (
                <span className="font-body text-[9px] text-muted-ink">{t('stores.managers.parentGrants')}</span>
              )}
            </div>
            {sections.length > 0 && (
              <div className="ml-3 mt-1 flex flex-wrap gap-1.5 border-l-2 border-ink/15 pl-2">
                {sections.map((sec) => pill(sec, picked.includes(sec.id)))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
