import { type FormEvent, useState } from 'react'
import { Button } from './Button'
import { DayPrefsEditor } from './DayPrefsEditor'
import { Field } from './Field'
import { FruitPicker } from './FruitPicker'
import { PersonFieldsForm, ShiftLimitsFields } from './PersonFields'
import { StarBadgeIcon } from './icons'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { fruitFor } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS, to12Hour } from '../lib/time'
import type { DayOfWeek, FixedShift, Responsibility, RosterWorker, Store, Tier } from '../types'
import { formatPhone } from '../lib/phone'

// The per-worker editors, shared by the Team roster (adding someone) and each
// worker's own profile page (everything else).

export const TIERS: Tier[] = ['NEW', 'REGULAR', 'SENIOR', 'MANAGER']
export const TIER_LABEL_KEY = {
  NEW: 'workers.tier.NEW',
  REGULAR: 'workers.tier.REGULAR',
  SENIOR: 'workers.tier.SENIOR',
  MANAGER: 'workers.tier.MANAGER',
} as const satisfies Record<Tier, string>

/** A store's responsibility checklist for one worker — click a chip's badge
 * (the responsibility count) to open this; toggling grants/revokes it there. */
export function ResponsibilityPanel({
  worker,
  storeId,
  storeName,
  responsibilities,
  savingKey,
  onToggle,
}: {
  worker: RosterWorker
  storeId: number
  storeName: string
  responsibilities: Responsibility[]
  savingKey: string | null
  onToggle: (responsibilityId: number, granted: boolean) => void
}) {
  const t = useT()
  const link = worker.stores.find((s) => s.storeId === storeId)
  const granted = new Set(link?.responsibilityIds ?? [])
  const busy = savingKey === `${worker.id}:${storeId}`

  if (responsibilities.length === 0) {
    return (
      <p className="mt-1.5 font-body text-[11px] text-muted-ink">
        {t('workers.responsibilities.none', { store: storeName })}
      </p>
    )
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border-2 border-ink/15 bg-cream/60 p-2">
      <span className="basis-full font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
        {t('workers.responsibilities.label', { store: storeName })}
      </span>
      {responsibilities.map((r) => {
        const on = granted.has(r.id)
        return (
          <button
            key={r.id}
            disabled={busy}
            onClick={() => onToggle(r.id, !on)}
            className={`flex items-center gap-1 rounded-full border-2 px-2 py-0.5 font-body text-[10px] font-bold disabled:opacity-50 ${
              on ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
            }`}
          >
            {r.builtin && <StarBadgeIcon size={9} />}
            {r.name}
          </button>
        )
      })}
    </div>
  )
}

export function AddWorkerForm({
  stores,
  defaultStoreId,
  responsibilities,
  onDone,
  onError,
}: {
  stores: Store[]
  defaultStoreId?: number
  responsibilities: Record<number, Responsibility[]>
  onDone: () => void
  onError: (msg: string) => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [hourLimit, setHourLimit] = useState(30)
  const [maxShifts, setMaxShifts] = useState(5)
  const [storeId, setStoreId] = useState<number | ''>(defaultStoreId ?? stores[0]?.id ?? '')
  const [proficiency, setProficiency] = useState<Tier>('REGULAR')
  const [responsibilityIds, setResponsibilityIds] = useState<number[]>([])
  const [standby, setStandby] = useState(false)
  const [busy, setBusy] = useState(false)

  const storeResponsibilities = storeId === '' ? [] : (responsibilities[storeId] ?? [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.createWorker({
        name: name.trim(),
        hourLimit,
        maxShifts,
        standby,
        store: storeId === '' ? undefined : { storeId, proficiency, responsibilityIds },
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
          onChange={(e) => {
            setStoreId(e.target.value === '' ? '' : Number(e.target.value))
            setResponsibilityIds([])
          }}
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
      {storeResponsibilities.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-body text-[10px] font-bold text-muted-ink">{t('workers.form.responsibilities')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {storeResponsibilities.map((r) => {
              const on = responsibilityIds.includes(r.id)
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() =>
                    setResponsibilityIds((ids) => (on ? ids.filter((id) => id !== r.id) : [...ids, r.id]))
                  }
                  className={`flex items-center gap-1 rounded-full border-2 px-2 py-0.5 font-body text-[10px] font-bold ${
                    on ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
                  }`}
                >
                  {r.builtin && <StarBadgeIcon size={9} />}
                  {r.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
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

export function EditWorkerForm({
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
  const [phone, setPhone] = useState(worker.phone ? formatPhone(worker.phone) : '')
  const [hourLimit, setHourLimit] = useState(worker.hourLimit)
  const [maxShifts, setMaxShifts] = useState(worker.maxShifts)
  const [targetHours, setTargetHours] = useState(worker.targetHours == null ? '' : String(worker.targetHours))
  const [standby, setStandby] = useState(worker.standby)
  const [fullDayOnly, setFullDayOnly] = useState(worker.fullDayOnly)
  const [hireDate, setHireDate] = useState(worker.hireDate ?? '')
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
        targetHours: targetHours.trim() ? Number(targetHours) : null,
        standby,
        fullDayOnly,
        avatarFruit: fruit,
        hireDate: hireDate || null,
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
      <span title={t('workers.form.targetHoursHint')}>
        <Field
          label={t('workers.form.targetHours')}
          type="number"
          inputMode="numeric"
          min={1}
          max={hourLimit}
          placeholder={t('workers.form.targetHoursNone')}
          value={targetHours}
          onChange={(e) => setTargetHours(e.target.value)}
          size="sm"
          className="w-20"
        />
      </span>
      <label className="flex items-center gap-1.5 pb-1.5">
        <input type="checkbox" checked={standby} onChange={(e) => setStandby(e.target.checked)} />
        <span className="font-body text-[11px] font-bold text-muted-ink">{t('profile.onCall')}</span>
      </label>
      <label className="flex items-center gap-1.5 pb-1.5" title={t('workers.form.fullDayOnlyHint')}>
        <input type="checkbox" checked={fullDayOnly} onChange={(e) => setFullDayOnly(e.target.checked)} />
        <span className="font-body text-[11px] font-bold text-muted-ink">{t('workers.form.fullDayOnly')}</span>
      </label>
      <Field
        label={t('workers.form.hireDate')}
        type="date"
        value={hireDate}
        onChange={(e) => setHireDate(e.target.value)}
        size="sm"
      />
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

/** Either-or-days + no-consecutive-days for one worker — the same solver day
 * preferences the worker can already set for themselves on their own
 * Availability page (AvailabilityExtras.tsx), now also manager-editable. */
export function DayRulesPanel({
  worker,
  onChange,
  onError,
}: {
  worker: RosterWorker
  onChange: () => void
  onError: (m: string | null) => void
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [ncBusy, setNcBusy] = useState(false)

  // PUT /employees/:id requires name+hourLimit alongside whatever's actually
  // changing (see EditWorkerForm) — this panel isn't a full edit form, so it
  // just resubmits the worker's current values for those unchanged fields.
  const base = {
    name: worker.name,
    hourLimit: worker.hourLimit,
    maxShifts: worker.maxShifts,
    standby: worker.standby,
    fullDayOnly: worker.fullDayOnly,
  }

  async function saveGroups(next: DayOfWeek[][]) {
    onError(null)
    setBusy(true)
    try {
      await api.updateWorker(worker.id, { ...base, eitherOrDays: next })
      onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : t('workers.err.saveChanges'))
    } finally {
      setBusy(false)
    }
  }

  async function toggleNoConsecutive() {
    onError(null)
    setNcBusy(true)
    try {
      await api.updateWorker(worker.id, { ...base, noConsecutiveDays: !worker.noConsecutiveDays })
      onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : t('workers.err.saveChanges'))
    } finally {
      setNcBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-xl border-2 border-ink/15 bg-cream/60 p-2.5">
      <p className="font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
        {t('workers.dayRules.heading', { name: worker.name })}
      </p>
      <DayPrefsEditor
        groups={worker.eitherOrDays}
        noConsecutive={worker.noConsecutiveDays}
        busy={busy}
        ncBusy={ncBusy}
        onSaveGroups={(next) => void saveGroups(next)}
        onToggleNoConsecutive={() => void toggleNoConsecutive()}
        onError={onError}
      />
    </div>
  )
}

export function FixedShiftRow({
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
  const confirm = useConfirm()
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
    if (!(await confirm(t('workers.fixed.confirmRemove'), { tone: 'danger' }))) return
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
