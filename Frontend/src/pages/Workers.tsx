import { type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { FruitAvatar } from '../components/FruitAvatar'
import { InviteShare } from '../components/InviteShare'
import { AddWorkerForm, TIER_LABEL_KEY } from '../components/WorkerEditors'
import { api } from '../lib/api'
import { fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { durationLabel } from '../lib/time'
import { useStore } from '../lib/store-context'
import type { Responsibility, RosterWorker, Store } from '../types'

/** The Team list: one compact row per person, who needs something from you
 * first. Everything about a person lives on their own profile (TeamMember). */
export function Workers() {
  const t = useT()
  const { storeId } = useStore()
  const [workers, setWorkers] = useState<RosterWorker[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [responsibilities, setResponsibilities] = useState<Record<number, Responsibility[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  // who was just added, and their invite (when a phone or email came with them)
  const [added, setAdded] = useState<{ worker: RosterWorker; email: string; inviteCode: string | null; emailed: boolean } | null>(
    null,
  )
  const [inviting, setInviting] = useState(false)
  const [allStores, setAllStores] = useState(false)

  function refresh() {
    return api
      .getStores()
      .then(async (s) => {
        setStores(s)
        const [w, resp] = await Promise.all([
          api.getRoster(),
          Promise.all(s.map((st) => api.getResponsibilities(st.id).catch(() => [] as Responsibility[]))),
        ])
        setWorkers(w)
        setResponsibilities(Object.fromEntries(s.map((st, i) => [st.id, resp[i]!])))
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('workers.err.loadWorkers')))
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? t('workers.storeFallback', { id })
  const waiting = (w: RosterWorker) => !!w.account && !w.account.approved
  // scheduled past their own weekly cap this week
  const over = (w: RosterWorker) => (w.weekMinutes ?? 0) > w.hourLimit * 60
  // the top-bar store switcher scopes this page by default — but anyone waiting
  // on your approval always shows (Home sends you here to approve them, whatever
  // store happens to be picked), floated to the top
  const scoped = !allStores && storeId != null
  const shown = workers
    .filter((w) => !scoped || waiting(w) || w.stores.some((s) => s.storeId === storeId))
    .sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || a.name.localeCompare(b.name))
  // the section(s) someone looks after, at the picked store (or everywhere, on All stores)
  const sectionsOf = (w: RosterWorker) =>
    w.stores
      .filter((s) => !scoped || s.storeId === storeId)
      .flatMap((s) => (responsibilities[s.storeId] ?? []).filter((r) => r.scope === 'SECTION' && s.responsibilityIds.includes(r.id)))

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="font-heading text-lg font-bold text-ink">{t('nav.mgr.workers')}</h1>
        {adding ? (
          <Button variant="secondary" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </Button>
        ) : (
          <Button
            onClick={() => {
              setAdded(null)
              setAdding(true)
            }}
          >
            {t('workers.addWorker')}
          </Button>
        )}
      </div>
      {storeId != null && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(
            [
              [false, storeName(storeId)],
              [true, t('team.allStores')],
            ] as const
          ).map(([all, label]) => (
            <button
              key={String(all)}
              onClick={() => setAllStores(all)}
              className={`rounded-full border-2 border-ink px-3 py-0.5 font-heading text-[11px] font-bold ${
                allStores === all ? 'bg-ink text-white' : 'bg-paper text-ink'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="font-body text-xs text-muted-ink">
            {shown.length === 1 ? t('workers.countHint.one', { n: shown.length }) : t('workers.countHint', { n: shown.length })}
          </span>
        </div>
      )}

      {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {adding && (
        <AddWorkerForm
          stores={stores}
          defaultStoreId={storeId ?? undefined}
          responsibilities={responsibilities}
          onDone={async (a) => {
            setAdding(false)
            setAdded(a)
            await refresh()
          }}
          onError={setError}
        />
      )}

      {added && (
        <div className="mb-4 flex flex-col gap-2 rounded-2xl border-[2.5px] border-green bg-paper p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="font-body text-sm font-bold text-ink">
              {added.emailed
                ? t('workers.added.emailed', { name: added.worker.name, email: added.email })
                : t('workers.added', { name: added.worker.name })}
            </p>
            <button
              onClick={() => setAdded(null)}
              aria-label={t('dashboard.dismiss')}
              className="font-heading text-sm font-bold text-muted-ink hover:text-ink"
            >
              ×
            </button>
          </div>
          {added.inviteCode ? (
            <InviteShare
              worker={{ ...added.worker, inviteCode: added.inviteCode }}
              storeName={added.worker.stores[0] ? storeName(added.worker.stores[0].storeId) : ''}
              defaultEmail={added.emailed ? '' : added.email}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-body text-xs text-muted-ink">{t('workers.added.inviteHint')}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={inviting}
                onClick={async () => {
                  setInviting(true)
                  try {
                    const r = await api.inviteWorker(added.worker.id)
                    setAdded({ ...added, inviteCode: r.inviteCode })
                  } catch (e) {
                    setError(e instanceof Error ? e.message : t('workers.err.createInvite'))
                  } finally {
                    setInviting(false)
                  }
                }}
              >
                {t('workers.sendInvite')}
              </Button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="font-body text-sm text-muted-ink">
          {workers.length === 0
            ? t('workers.empty.none')
            : t('workers.empty.atStore', { store: storeId != null ? storeName(storeId) : t('workers.thisStore') })}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((w) => (
            <li key={w.id}>
              <Link
                to={`/team/${w.id}`}
                className="flex items-center gap-3 rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)] transition-transform duration-150 ease-out hover:-translate-y-0.5"
              >
                <FruitAvatar kind={fruitForPerson({ employeeId: w.id, avatarFruit: w.avatarFruit })} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-heading text-sm font-bold text-ink">{w.name}</span>
                    {sectionsOf(w).map((r) => (
                      <Chip key={r.id} tone="section">
                        {r.name}
                      </Chip>
                    ))}
                    {w.standby && <Chip>{t('profile.onCall')}</Chip>}
                    {waiting(w) ? (
                      <Chip tone="act">{t('team.status.waiting')}</Chip>
                    ) : !w.account ? (
                      <Chip>{w.inviteCode ? t('team.status.invited') : t('team.status.noLogin')}</Chip>
                    ) : null}
                  </span>
                  <span className="block truncate font-body text-[11px] text-muted-ink">
                    {w.stores.length === 0
                      ? t('workers.noStoreAssigned')
                      : w.stores.map((s) => `${storeName(s.storeId)} · ${t(TIER_LABEL_KEY[s.proficiency])}`).join(', ')}
                  </span>
                </span>
                {w.weekMinutes !== undefined && (
                  <span
                    className={`shrink-0 text-right font-body leading-tight ${over(w) ? 'text-coral-dark' : 'text-muted-ink'}`}
                    title={over(w) ? t('team.overLimit', { limit: w.hourLimit }) : undefined}
                  >
                    <span className="block text-xs font-bold">
                      {over(w) && '⚠ '}
                      {durationLabel(w.weekMinutes)}
                    </span>
                    <span className="block text-[10px]">{t('team.thisWeek')}</span>
                  </span>
                )}
                <span aria-hidden className="font-heading text-lg text-muted-ink">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'act' | 'section' }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-px font-body text-[9px] font-bold ${
        tone === 'act'
          ? 'border-coral bg-coral-bg text-coral-dark'
          : tone === 'section'
            ? 'border-grape bg-grape/15 text-ink'
            : 'border-ink/25 text-muted-ink'
      }`}
    >
      {children}
    </span>
  )
}
