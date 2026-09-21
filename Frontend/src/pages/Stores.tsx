import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { ManagersSection } from '../components/ManagersSection'
import { RequirementsEditor } from '../components/RequirementsEditor'
import { StoreHoursEditor } from '../components/StoreHoursEditor'
import { StoreInviteLink } from '../components/StoreInviteLink'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import type { EmployeeStore, ShiftRequirement, Store } from '../types'

type StorePatch = {
  name: string
  requiresOpenerSkill: boolean
  pairNewWorkers: boolean
  tracksClosingDuties?: boolean
  openTime?: string | null
  closeTime?: string | null
  nightStart?: string | null
}

const to12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const ap = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}

export function Stores() {
  const t = useT()
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const [stores, setStores] = useState<Store[]>([])
  const [links, setLinks] = useState<EmployeeStore[]>([])
  const [reqs, setReqs] = useState<ShiftRequirement[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<number | null>(null)
  const [showNeeds, setShowNeeds] = useState<number | null>(null)
  const [showHours, setShowHours] = useState<number | null>(null)
  const [showInvite, setShowInvite] = useState<number | null>(null)
  const [org, setOrg] = useState<{ id: number; name: string } | null>(null)

  useEffect(() => {
    if (isOwner) api.getOrg().then(setOrg).catch(() => {})
  }, [isOwner])

  function refresh() {
    return Promise.all([api.getStores(), api.getEmployeeStores(), api.getShiftRequirements()])
      .then(([s, l, r]) => {
        setStores(s)
        setLinks(l)
        setReqs(r)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('stores.errLoad')))
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  const workerCount = (storeId: number) => links.filter((l) => l.storeId === storeId).length
  const reqCount = (storeId: number) => reqs.filter((r) => r.storeId === storeId).length

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      setEditing(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('stores.errGeneric'))
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-16 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('nav.mgr.stores')}</h1>
      <p className="mt-1 font-body text-xs text-muted-ink">{t('stores.subtitle')}</p>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {isOwner && (
        <>
          {org && (
            <div className="mt-3">
              <OrgNameEditor org={org} onSaved={setOrg} />
            </div>
          )}
          <AddStore onAdd={(patch) => act(() => api.createStore(patch))} />
          {!loading && stores.length > 0 && (
            <div className="mt-3">
              <ManagersSection stores={stores} />
            </div>
          )}
        </>
      )}

      {loading ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {stores.map((s) =>
            editing === s.id ? (
              <EditStore
                key={s.id}
                store={s}
                onSave={(patch) => act(() => api.updateStore(s.id, patch))}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div
                key={s.id}
                className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)]"
              >
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                  <div className="min-w-0 flex-1">
                    <span className="font-heading text-sm font-bold text-ink">{s.name}</span>
                    <span className="mt-0.5 block font-body text-[11px] text-muted-ink">
                      {workerCount(s.id) === 1
                        ? t('stores.workerCount.one', { n: workerCount(s.id) })
                        : t('stores.workerCount', { n: workerCount(s.id) })}{' '}
                      ·{' '}
                      {s.requiresOpenerSkill ? t('stores.openerRequired') : t('stores.anyoneCanOpen')}
                      {s.pairNewWorkers && ` · ${t('stores.newWorkersPaired')}`}
                      {!s.tracksClosingDuties && ` · ${t('stores.noClosingDuties')}`}
                      {s.openTime && s.closeTime && (
                        <>
                          {' · '}
                          {to12(s.openTime)}–{to12(s.closeTime)}
                          {s.nightStart && `, ${t('stores.nightFrom', { time: to12(s.nightStart) })}`}
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button
                      onClick={() => setShowNeeds((v) => (v === s.id ? null : s.id))}
                      className={`rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold ${
                        reqCount(s.id) === 0 ? 'bg-coral-bg text-coral-dark' : 'bg-cream text-ink'
                      }`}
                    >
                      {t('stores.shiftNeeds', { n: reqCount(s.id) })}
                    </button>
                    <button
                      onClick={() => setShowHours((v) => (v === s.id ? null : s.id))}
                      className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink"
                    >
                      {t('stores.hoursBtn')}
                    </button>
                    <button
                      onClick={() => setShowInvite((v) => (v === s.id ? null : s.id))}
                      className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink"
                    >
                      {t('stores.signupLink')}
                    </button>
                    <button
                      onClick={() => setEditing(s.id)}
                      className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink"
                    >
                      {t('stores.edit')}
                    </button>
                    {isOwner && (
                      <button
                        onClick={() => {
                          if (window.confirm(t('stores.confirmDelete', { name: s.name })))
                            void act(() => api.deleteStore(s.id))
                        }}
                        className="rounded-full border-2 border-coral px-2.5 py-0.5 font-heading text-[11px] font-bold text-coral-dark"
                      >
                        {t('stores.delete')}
                      </button>
                    )}
                  </div>
                </div>
                {showNeeds === s.id && (
                  <RequirementsEditor storeId={s.id} onChange={() => void refresh()} />
                )}
                {showHours === s.id && <StoreHoursEditor storeId={s.id} />}
                {showInvite === s.id && <StoreInviteLink storeId={s.id} />}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

function OrgNameEditor({
  org,
  onSaved,
}: {
  org: { id: number; name: string }
  onSaved: (org: { id: number; name: string }) => void
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(org.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim() || name.trim() === org.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.updateOrgName(name.trim()))
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('stores.errRenameOrg'))
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-heading text-base font-extrabold text-ink">{org.name}</span>
        <button
          onClick={() => {
            setName(org.name)
            setEditing(true)
          }}
          className="font-body text-[11px] font-bold text-muted-ink underline"
        >
          {t('stores.rename')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        className="rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-sm text-ink outline-none"
      />
      <button
        disabled={busy || !name.trim()}
        onClick={() => void save()}
        className="rounded-full border-2 border-ink bg-green px-3 py-0.5 font-heading text-[11px] font-bold text-white disabled:opacity-50"
      >
        {t('common.save')}
      </button>
      <button
        onClick={() => setEditing(false)}
        className="rounded-full border-2 border-ink bg-cream px-3 py-0.5 font-heading text-[11px] font-bold text-ink"
      >
        {t('stores.cancel')}
      </button>
      {error && <p className="w-full font-body text-xs font-bold text-coral-dark">{error}</p>}
    </div>
  )
}

const checkboxRow =
  'flex items-center gap-1.5 font-body text-[11px] font-bold text-muted-ink'

function AddStore({ onAdd }: { onAdd: (patch: StorePatch) => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [requiresOpenerSkill, setRequiresOpenerSkill] = useState(true)
  const [pairNewWorkers, setPairNewWorkers] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onAdd({ name: name.trim(), requiresOpenerSkill, pairNewWorkers })
    setName('')
    setRequiresOpenerSkill(true)
    setPairNewWorkers(false)
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)]"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('stores.newStoreNamePlaceholder')}
        className="rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none"
      />
      <label className={checkboxRow}>
        <input
          type="checkbox"
          checked={requiresOpenerSkill}
          onChange={(e) => setRequiresOpenerSkill(e.target.checked)}
        />
        {t('stores.openerSkillLabel')}
      </label>
      <label className={checkboxRow}>
        <input
          type="checkbox"
          checked={pairNewWorkers}
          onChange={(e) => setPairNewWorkers(e.target.checked)}
        />
        {t('stores.pairNewWorkersLabel')}
      </label>
      <Button type="submit" disabled={!name.trim()}>
        {t('stores.addStore')}
      </Button>
    </form>
  )
}

function EditStore({
  store,
  onSave,
  onCancel,
}: {
  store: Store
  onSave: (patch: StorePatch) => void
  onCancel: () => void
}) {
  const t = useT()
  const [name, setName] = useState(store.name)
  const [requiresOpenerSkill, setRequiresOpenerSkill] = useState(store.requiresOpenerSkill)
  const [pairNewWorkers, setPairNewWorkers] = useState(store.pairNewWorkers)
  const [tracksClosingDuties, setTracksClosingDuties] = useState(store.tracksClosingDuties)
  const [openTime, setOpenTime] = useState(store.openTime ?? '')
  const [closeTime, setCloseTime] = useState(store.closeTime ?? '')
  const [nightStart, setNightStart] = useState(store.nightStart ?? '')

  const timeInput =
    'w-[7rem] rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none'

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)]">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none"
      />
      <label className={checkboxRow}>
        <input
          type="checkbox"
          checked={requiresOpenerSkill}
          onChange={(e) => setRequiresOpenerSkill(e.target.checked)}
        />
        {t('stores.openerSkillRequiredLabel')}
      </label>
      <label className={checkboxRow}>
        <input
          type="checkbox"
          checked={pairNewWorkers}
          onChange={(e) => setPairNewWorkers(e.target.checked)}
        />
        {t('stores.pairNewWorkersLabel')}
      </label>
      <label className={checkboxRow}>
        <input
          type="checkbox"
          checked={tracksClosingDuties}
          onChange={(e) => setTracksClosingDuties(e.target.checked)}
        />
        {t('stores.tracksClosingDutiesLabel')}
      </label>
      <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
          {t('stores.hoursHeading')}
        </span>
        <label className="flex items-center gap-1 font-body text-[10px] font-bold text-muted-ink">
          {t('stores.timeOpen')}
          <input type="time" step={1800} value={openTime} onChange={(e) => setOpenTime(e.target.value)} className={timeInput} />
        </label>
        <label className="flex items-center gap-1 font-body text-[10px] font-bold text-muted-ink">
          {t('stores.timeClose')}
          <input type="time" step={1800} value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className={timeInput} />
        </label>
        <label className="flex items-center gap-1 font-body text-[10px] font-bold text-muted-ink">
          {t('stores.nightFromLabel')}
          <input type="time" step={1800} value={nightStart} onChange={(e) => setNightStart(e.target.value)} className={timeInput} />
        </label>
        <span className="font-body text-[10px] text-muted-ink">{t('stores.hoursHint')}</span>
      </div>
      <div className="ml-auto flex gap-2">
        <button
          onClick={() =>
            name.trim() &&
            onSave({
              name: name.trim(),
              requiresOpenerSkill,
              pairNewWorkers,
              tracksClosingDuties,
              openTime: openTime || null,
              closeTime: closeTime || null,
              nightStart: nightStart || null,
            })
          }
          className="rounded-full border-2 border-ink bg-green px-3 py-0.5 font-heading text-[11px] font-bold text-white"
        >
          {t('common.save')}
        </button>
        <button
          onClick={onCancel}
          className="rounded-full border-2 border-ink bg-cream px-3 py-0.5 font-heading text-[11px] font-bold text-ink"
        >
          {t('stores.cancel')}
        </button>
      </div>
    </div>
  )
}
