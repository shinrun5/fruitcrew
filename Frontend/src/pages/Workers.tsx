import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { FruitAvatar } from '../components/FruitAvatar'
import { FruitPicker } from '../components/FruitPicker'
import { PersonFieldsForm, ShiftLimitsFields } from '../components/PersonFields'
import { CopyButton } from '../components/CopyButton'
import { StarBadgeIcon } from '../components/icons'
import { api } from '../lib/api'
import { fruitFor, fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS, to12Hour } from '../lib/time'
import { useCopy } from '../lib/use-copy'
import { useStore } from '../lib/store-context'
import type { DayOfWeek, FixedShift, RosterWorker, Store, Tier } from '../types'

const TIERS: Tier[] = ['NEW', 'REGULAR', 'SENIOR', 'MANAGER']
const TIER_LABEL_KEY = {
  NEW: 'workers.tier.NEW',
  REGULAR: 'workers.tier.REGULAR',
  SENIOR: 'workers.tier.SENIOR',
  MANAGER: 'workers.tier.MANAGER',
} as const satisfies Record<Tier, string>

export function Workers() {
  const t = useT()
  const { storeId } = useStore()
  const [workers, setWorkers] = useState<RosterWorker[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [fixed, setFixed] = useState<FixedShift[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const { copiedKey, copy } = useCopy()
  const [savingTier, setSavingTier] = useState<string | null>(null)

  function refresh() {
    return api
      .getStores()
      .then(async (s) => {
        setStores(s)
        const [w, ...fx] = await Promise.all([
          api.getRoster(),
          ...s.map((st) => api.getFixedShifts(st.id).catch(() => [] as FixedShift[])),
        ])
        setWorkers(w)
        setFixed(fx.flat())
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('workers.err.loadWorkers')))
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? t('workers.storeFallback', { id })
  // the top-bar store switcher scopes this page
  const shown =
    storeId == null ? workers : workers.filter((w) => w.stores.some((s) => s.storeId === storeId))

  async function invite(id: number) {
    try {
      await api.inviteWorker(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('workers.err.createInvite'))
    }
  }

  async function remove(w: RosterWorker) {
    if (!window.confirm(t('workers.confirmRemove', { name: w.name }))) return
    try {
      await api.deleteWorker(w.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('workers.err.removeWorker'))
    }
  }

  async function unlinkStore(employeeId: number, storeId: number) {
    const w = workers.find((x) => x.id === employeeId)
    if (!window.confirm(t('workers.confirmUnlinkStore', { name: w?.name ?? '', store: storeName(storeId) }))) return
    setError(null)
    try {
      await api.removeWorkerFromStore(employeeId, storeId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('workers.err.updateStores'))
    }
  }
  async function linkStore(employeeId: number, storeId: number) {
    setError(null)
    try {
      await api.addWorkerToStore({ employeeId, storeId, proficiency: 'REGULAR' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('workers.err.updateStores'))
    }
  }
  async function changeTier(employeeId: number, storeId: number, proficiency: Tier) {
    setError(null)
    setSavingTier(`${employeeId}:${storeId}`)
    try {
      await api.updateWorkerStore(employeeId, storeId, { proficiency })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('workers.err.changeTier'))
    } finally {
      setSavingTier(null)
    }
  }
  async function toggleCanClose(employeeId: number, storeId: number, canClose: boolean) {
    setError(null)
    setSavingTier(`${employeeId}:${storeId}`)
    try {
      await api.updateWorkerStore(employeeId, storeId, { canClose })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('workers.err.toggleClose'))
    } finally {
      setSavingTier(null)
    }
  }

  const inviteLink = (code: string) => `${window.location.origin}/register?code=${encodeURIComponent(code)}`

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="font-heading text-lg font-bold text-ink">{t('nav.mgr.workers')}</h1>
        <Button onClick={() => setAdding((v) => !v)}>{adding ? t('common.cancel') : t('workers.addWorker')}</Button>
      </div>
      {storeId != null && (
        <p className="mb-3 font-body text-xs text-muted-ink">
          {t('workers.scopedTo.prefix')}<b className="text-ink">{storeName(storeId)}</b>{t('workers.scopedTo.suffix')}{' '}
          {shown.length === 1
            ? t('workers.countHint.one', { n: shown.length })
            : t('workers.countHint', { n: shown.length })}
        </p>
      )}

      {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {adding && (
        <AddWorkerForm
          stores={stores}
          defaultStoreId={storeId ?? undefined}
          onDone={async () => {
            setAdding(false)
            await refresh()
          }}
          onError={setError}
        />
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
        <div className="flex flex-col gap-2.5">
          {shown.map((w) => (
            <div
              key={w.id}
              className="rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-2.5">
                  <span className="mt-0.5 shrink-0">
                    <FruitAvatar
                      kind={fruitForPerson({ employeeId: w.id, avatarFruit: w.avatarFruit })}
                      size={34}
                    />
                  </span>
                  <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-sm font-bold text-ink">{w.name}</span>
                    {w.standby && (
                      <span className="rounded-full border border-ink/25 px-1.5 py-px font-body text-[9px] font-bold text-muted-ink">
                        {t('profile.onCall')}
                      </span>
                    )}
                  </div>
                  <span className="font-body text-[11px] text-muted-ink">
                    {t('workers.hoursAndDays', { hours: w.hourLimit, days: w.maxShifts })}
                    {w.phone && <> · {w.phone}</>}
                  </span>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {w.stores.length === 0 && (
                      <span className="font-body text-[11px] text-coral-dark">{t('workers.noStoreAssigned')}</span>
                    )}
                    {w.stores.map((s) => (
                      <span
                        key={s.storeId}
                        className="flex items-center gap-1 rounded-full border-2 border-ink bg-cream px-2 py-0.5 font-body text-[10px] font-bold text-ink"
                      >
                        {storeName(s.storeId)} ·{' '}
                        <select
                          value={s.proficiency}
                          disabled={savingTier === `${w.id}:${s.storeId}`}
                          onChange={(e) => void changeTier(w.id, s.storeId, e.target.value as Tier)}
                          aria-label={t('workers.tierAt', { store: storeName(s.storeId) })}
                          className="cursor-pointer appearance-none border-none bg-transparent p-0 font-body text-[10px] font-bold text-ink outline-none disabled:opacity-50"
                        >
                          {TIERS.map((tier) => (
                            <option key={tier} value={tier}>
                              {t(TIER_LABEL_KEY[tier])}
                            </option>
                          ))}
                        </select>
                        {s.canOpen && <StarBadgeIcon size={10} />}
                        <button
                          onClick={() => void toggleCanClose(w.id, s.storeId, !s.canClose)}
                          disabled={savingTier === `${w.id}:${s.storeId}`}
                          title={s.canClose ? t('workers.canClose.on') : t('workers.canClose.off')}
                          className={`rounded-full border px-1 py-px text-[9px] font-bold leading-none disabled:opacity-50 ${
                            s.canClose ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
                          }`}
                        >
                          🔒
                        </button>
                        <button
                          onClick={() => void unlinkStore(w.id, s.storeId)}
                          aria-label={t('workers.removeFromStore', { store: storeName(s.storeId) })}
                          className="ml-0.5 font-heading text-xs leading-none text-muted-ink hover:text-coral-dark"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {stores
                      .filter((st) => !w.stores.some((s) => s.storeId === st.id))
                      .map((st) => (
                        <button
                          key={st.id}
                          onClick={() => void linkStore(w.id, st.id)}
                          className="rounded-full border-2 border-dashed border-ink/40 px-2 py-0.5 font-body text-[10px] font-bold text-muted-ink hover:border-ink hover:text-ink"
                        >
                          + {st.name}
                        </button>
                      ))}
                  </div>
                  {w.stores.length > 0 && (
                    <FixedShiftRow
                      worker={w}
                      storeName={storeName}
                      fixed={fixed.filter((f) => f.employeeId === w.id)}
                      onChange={() => void refresh()}
                      onError={setError}
                    />
                  )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    onClick={() => setEditing((id) => (id === w.id ? null : w.id))}
                    className="rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink"
                  >
                    {editing === w.id ? t('common.close') : t('workers.edit')}
                  </button>
                  <button
                    onClick={() => void remove(w)}
                    className="rounded-full border-2 border-coral px-2.5 py-0.5 font-heading text-[11px] font-bold text-coral-dark"
                  >
                    {t('workers.removeBtn')}
                  </button>
                </div>
              </div>

              {editing === w.id && (
                <EditWorkerForm
                  worker={w}
                  takenFruits={
                    new Set(
                      workers
                        .filter(
                          (o) =>
                            o.id !== w.id &&
                            o.stores.some((s) => w.stores.some((ws) => ws.storeId === s.storeId)),
                        )
                        .map((o) => o.avatarFruit ?? fruitFor(o.id)),
                    )
                  }
                  onDone={() => {
                    setEditing(null)
                    void refresh()
                  }}
                  onError={setError}
                />
              )}

              <div className="mt-2 border-t border-ink/10 pt-2 font-body text-[11px]">
                {w.account ? (
                  <span className="font-bold text-green">{t('workers.signedUp', { email: w.account.email })}</span>
                ) : w.inviteCode ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-ink">{t('workers.inviteLabel')}</span>
                    <code className="rounded bg-cream px-1.5 py-0.5 font-bold text-ink">{w.inviteCode}</code>
                    <CopyButton
                      copied={copiedKey === `${w.id}:code`}
                      onClick={() => copy(`${w.id}:code`, w.inviteCode!)}
                      label={t('workers.copyCode')}
                      copiedLabel={t('workers.copied')}
                    />
                    <CopyButton
                      copied={copiedKey === `${w.id}:link`}
                      onClick={() => copy(`${w.id}:link`, inviteLink(w.inviteCode!))}
                      label={t('workers.copySignupLink')}
                      copiedLabel={t('workers.linkCopied')}
                      tone="sky"
                    />
                    <span className="text-muted-ink">{t('workers.notSignedUp')}</span>
                  </span>
                ) : (
                  <button
                    onClick={() => void invite(w.id)}
                    className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading font-bold text-ink"
                  >
                    {t('workers.sendInvite')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AddWorkerForm({
  stores,
  defaultStoreId,
  onDone,
  onError,
}: {
  stores: Store[]
  defaultStoreId?: number
  onDone: () => void
  onError: (msg: string) => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [hourLimit, setHourLimit] = useState(30)
  const [maxShifts, setMaxShifts] = useState(5)
  const [storeId, setStoreId] = useState<number | ''>(defaultStoreId ?? stores[0]?.id ?? '')
  const [proficiency, setProficiency] = useState<Tier>('REGULAR')
  const [canOpen, setCanOpen] = useState(false)
  const [canClose, setCanClose] = useState(false)
  const [standby, setStandby] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.createWorker({
        name: name.trim(),
        hourLimit,
        maxShifts,
        standby,
        store: storeId === '' ? undefined : { storeId, proficiency, canOpen, canClose },
      })
      onDone()
    } catch (err) {
      onError(err instanceof Error ? err.message : t('workers.err.addWorker'))
    } finally {
      setBusy(false)
    }
  }

  const field = 'rounded-lg border-2 border-ink bg-cream px-2 py-1 font-body text-xs text-ink outline-none'

  return (
    <form
      onSubmit={submit}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[3px_3px_0_var(--color-ink)]"
    >
      <label className="flex flex-col gap-1">
        <span className="font-body text-[10px] font-bold text-muted-ink">{t('profile.name')}</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[10px] font-bold text-muted-ink">{t('workers.form.hoursPerWeek')}</span>
        <input
          type="number"
          min={1}
          max={80}
          value={hourLimit}
          onChange={(e) => setHourLimit(Number(e.target.value))}
          className={`${field} w-20`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[10px] font-bold text-muted-ink">{t('workers.form.maxDays')}</span>
        <input
          type="number"
          min={1}
          max={7}
          value={maxShifts}
          onChange={(e) => setMaxShifts(Number(e.target.value))}
          className={`${field} w-16`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[10px] font-bold text-muted-ink">{t('workers.form.store')}</span>
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value === '' ? '' : Number(e.target.value))}
          className={field}
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[10px] font-bold text-muted-ink">{t('workers.form.tier')}</span>
        <select
          value={proficiency}
          onChange={(e) => setProficiency(e.target.value as Tier)}
          className={field}
        >
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {t(TIER_LABEL_KEY[tier])}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 pb-1.5">
        <input type="checkbox" checked={canOpen} onChange={(e) => setCanOpen(e.target.checked)} />
        <span className="font-body text-[11px] font-bold text-muted-ink">{t('workers.form.canOpen')}</span>
      </label>
      <label className="flex items-center gap-1.5 pb-1.5">
        <input type="checkbox" checked={canClose} onChange={(e) => setCanClose(e.target.checked)} />
        <span className="font-body text-[11px] font-bold text-muted-ink">{t('workers.form.canClose')}</span>
      </label>
      <label className="flex items-center gap-1.5 pb-1.5" title={t('workers.form.standbyHint')}>
        <input type="checkbox" checked={standby} onChange={(e) => setStandby(e.target.checked)} />
        <span className="font-body text-[11px] font-bold text-muted-ink">{t('profile.onCall')}</span>
      </label>
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? t('workers.form.adding') : t('workers.form.add')}
      </Button>
    </form>
  )
}

function EditWorkerForm({
  worker,
  takenFruits,
  onDone,
  onError,
}: {
  worker: RosterWorker
  takenFruits: Set<string>
  onDone: () => void
  onError: (msg: string | null) => void
}) {
  const t = useT()
  const [name, setName] = useState(worker.name)
  const [phone, setPhone] = useState(worker.phone ?? '')
  const [hourLimit, setHourLimit] = useState(worker.hourLimit)
  const [maxShifts, setMaxShifts] = useState(worker.maxShifts)
  const [standby, setStandby] = useState(worker.standby)
  const [fruit, setFruit] = useState<string>(worker.avatarFruit ?? fruitFor(worker.id))
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    onError(null)
    if (!name.trim()) return onError(t('profile.nameEmpty'))
    setBusy(true)
    try {
      await api.updateWorker(worker.id, {
        name: name.trim(),
        phone: phone.trim() || null,
        hourLimit,
        maxShifts,
        standby,
        avatarFruit: fruit,
      })
      onDone()
    } catch (err) {
      onError(err instanceof Error ? err.message : t('workers.err.saveChanges'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-2 flex flex-wrap items-end gap-3 rounded-xl border-2 border-ink/15 bg-cream/60 p-2.5"
    >
      <PersonFieldsForm name={name} onNameChange={setName} phone={phone} onPhoneChange={setPhone} size="sm" />
      <ShiftLimitsFields
        maxShifts={maxShifts}
        onMaxShiftsChange={(v) => setMaxShifts(Number(v))}
        hourLimit={hourLimit}
        onHourLimitChange={(v) => setHourLimit(Number(v))}
        size="sm"
      />
      <label className="flex items-center gap-1.5 pb-1.5">
        <input type="checkbox" checked={standby} onChange={(e) => setStandby(e.target.checked)} />
        <span className="font-body text-[11px] font-bold text-muted-ink">{t('profile.onCall')}</span>
      </label>
      <div className="flex w-full flex-col gap-1">
        <span className="font-body text-[10px] font-bold text-muted-ink">
          {t('workers.form.fruit')}{' '}
          <span className="font-normal normal-case">{t('workers.form.fruitTaken')}</span>
        </span>
        <FruitPicker value={fruit} taken={takenFruits} onChange={setFruit} size={22} />
      </div>
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? t('common.saving') : t('common.save')}
      </Button>
    </form>
  )
}

function FixedShiftRow({
  worker,
  storeName,
  fixed,
  onChange,
  onError,
}: {
  worker: RosterWorker
  storeName: (id: number) => string
  fixed: FixedShift[]
  onChange: () => void
  onError: (m: string | null) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [storeId, setStoreId] = useState<number>(worker.stores[0]?.storeId ?? 0)
  const [day, setDay] = useState<DayOfWeek>('MONDAY')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [busy, setBusy] = useState(false)

  async function add() {
    if (start >= end) return onError(t('workers.err.startBeforeEnd'))
    setBusy(true)
    onError(null)
    try {
      await api.addFixedShift({ employeeId: worker.id, storeId, day, start, end })
      setOpen(false)
      onChange()
    } catch (e) {
      onError(e instanceof Error ? e.message : t('workers.err.addFixedShift'))
    } finally {
      setBusy(false)
    }
  }
  async function del(id: number) {
    if (!window.confirm(t('workers.fixed.confirmRemove'))) return
    onError(null)
    try {
      await api.removeFixedShift(id)
      onChange()
    } catch (e) {
      onError(e instanceof Error ? e.message : t('workers.err.removeFixedShift'))
    }
  }

  const sel = 'rounded-lg border-2 border-ink bg-cream px-1.5 py-1 font-body text-[10px] font-bold text-ink outline-none'

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
        {t('workers.fixed.alwaysWorks')}
      </span>
      {fixed.length === 0 && !open && (
        <span className="font-body text-[10px] text-muted-ink">{t('workers.fixed.none')}</span>
      )}
      {fixed.map((f) => (
        <span
          key={f.id}
          className="flex items-center gap-1 rounded-full border-2 border-grape/60 bg-grape/10 px-2 py-0.5 font-body text-[10px] font-bold text-ink"
        >
          {DAY_LABEL[f.day]} · {storeName(f.storeId)} · {to12Hour(f.start)}–{to12Hour(f.end)}
          <button
            onClick={() => void del(f.id)}
            aria-label={t('workers.fixed.removeAria')}
            className="ml-0.5 font-heading text-xs leading-none text-muted-ink hover:text-coral-dark"
          >
            ×
          </button>
        </span>
      ))}
      {fixed.length > 0 && (
        <span className="basis-full font-body text-[10px] italic text-muted-ink">
          {t('workers.fixed.onlyTheseDays', {
            stores: [...new Set(fixed.map((f) => storeName(f.storeId)))].join(', '),
          })}
        </span>
      )}
      {open ? (
        <span className="flex flex-wrap items-center gap-1">
          <select value={storeId} onChange={(e) => setStoreId(Number(e.target.value))} className={sel}>
            {worker.stores.map((s) => (
              <option key={s.storeId} value={s.storeId}>
                {storeName(s.storeId)}
              </option>
            ))}
          </select>
          <select value={day} onChange={(e) => setDay(e.target.value as DayOfWeek)} className={sel}>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {DAY_LABEL[d]}
              </option>
            ))}
          </select>
          <input type="time" step={1800} value={start} onChange={(e) => setStart(e.target.value)} className={sel} />
          <input type="time" step={1800} value={end} onChange={(e) => setEnd(e.target.value)} className={sel} />
          <button
            disabled={busy}
            onClick={() => void add()}
            className="rounded-full border-2 border-ink bg-green px-2 py-0.5 font-heading text-[10px] font-bold text-white"
          >
            {t('workers.form.add')}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="font-heading text-[10px] font-bold text-muted-ink"
          >
            {t('common.cancel')}
          </button>
        </span>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border-2 border-dashed border-grape/50 px-2 py-0.5 font-body text-[10px] font-bold text-grape hover:border-grape"
        >
          {t('workers.fixed.addDay')}
        </button>
      )}
    </div>
  )
}
