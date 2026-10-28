import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useT } from '../lib/i18n'
import { DAY_LABEL, DAYS, toHHMM24 } from '../lib/time'
import type { DayOfWeek, RequirementInput, ShiftRequirement } from '../types'
import { TrashIcon } from './icons'
import { TIER_LABEL_KEY } from './WorkerEditors'

type Friendly = Omit<RequirementInput, 'storeId'>

function toFriendly(r: ShiftRequirement): Friendly {
  return {
    day: r.day,
    start: toHHMM24(r.start),
    end: toHHMM24(r.end),
    managerRequired: r.managerRequired,
    seniorRequired: r.seniorRequired,
    regularRequired: r.regularRequired,
    newRequired: r.newRequired,
    needOpen: r.needOpen,
    graceMinutes: r.graceMinutes,
  }
}

const blank = (day: DayOfWeek): Friendly => ({
  day,
  start: '11:30',
  end: '17:00',
  managerRequired: 0,
  seniorRequired: 0,
  regularRequired: 1,
  newRequired: 0,
  needOpen: false,
  graceMinutes: 0,
})

/** Per-store editor for the demand windows the scheduler solves against. */
export function RequirementsEditor({ storeId, onChange }: { storeId: number; onChange?: () => void }) {
  const t = useT()
  const [rows, setRows] = useState<ShiftRequirement[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // copying one day's windows onto others (most stores need the same most days)
  const [copyFrom, setCopyFrom] = useState<DayOfWeek | null>(null)
  const [copyTo, setCopyTo] = useState<DayOfWeek[]>([])
  const confirmCopy = useConfirm()

  function refresh() {
    return api
      .getStoreRequirements(storeId)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : t('stores.requirements.errLoad')))
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      await refresh()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('stores.requirements.errGeneric'))
    }
  }

  async function copyDay(from: DayOfWeek, to: DayOfWeek[]) {
    const source = rows.filter((r) => r.day === from)
    const replacing = rows.filter((r) => to.includes(r.day))
    if (replacing.length > 0 && !(await confirmCopy(t('stores.requirements.copyReplace', { n: to.length })))) return
    setCopyFrom(null)
    await act(async () => {
      for (const r of replacing) await api.deleteRequirement(r.id)
      for (const day of to) for (const r of source) await api.createRequirement({ storeId, ...toFriendly(r), day })
    })
  }

  if (loading) return <p className="mt-2 font-body text-xs text-muted-ink">{t('common.loading')}</p>

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-ink/10 pt-3">
      <p className="rounded-lg bg-sky/10 px-2 py-1.5 font-body text-[11px] text-ink">{t('stores.requirements.howItWorks')}</p>
      {error && <p className="font-body text-xs font-bold text-coral-dark">{error}</p>}
      {DAYS.map((day) => {
        const dayRows = rows.filter((r) => r.day === day)
        return (
          <div key={day}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-heading text-xs font-bold text-ink">{DAY_LABEL[day]}</span>
              {dayRows.length > 0 && copyFrom !== day && (
                <button
                  onClick={() => {
                    setCopyFrom(day)
                    setCopyTo(DAYS.filter((d) => d !== day))
                  }}
                  className="ml-auto font-body text-[10px] font-bold text-sky-dark"
                >
                  {t('stores.requirements.copy')}
                </button>
              )}
              <button
                onClick={() => void act(() => api.createRequirement({ storeId, ...blank(day) }))}
                className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 font-heading text-[10px] font-bold text-ink"
              >
                {t('stores.requirements.addWindow')}
              </button>
            </div>
            {copyFrom === day && (
              <div className="mb-1.5 flex flex-col gap-1.5 rounded-lg border-2 border-dashed border-ink/30 p-2">
                <span className="font-body text-[11px] font-bold text-ink">{t('stores.requirements.copyTo')}</span>
                <div className="flex flex-wrap gap-1">
                  {DAYS.filter((d) => d !== day).map((d) => {
                    const on = copyTo.includes(d)
                    return (
                      <button
                        key={d}
                        aria-pressed={on}
                        onClick={() => setCopyTo((ds) => (on ? ds.filter((x) => x !== d) : [...ds, d]))}
                        className={`rounded-full border-2 px-2 py-0.5 font-heading text-[10px] font-bold ${
                          on ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
                        }`}
                      >
                        {DAY_LABEL[d]}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={copyTo.length === 0}
                    onClick={() => void copyDay(day, copyTo)}
                    className="rounded-full border-2 border-ink bg-green px-2.5 py-0.5 font-heading text-[10px] font-bold text-white disabled:opacity-40"
                  >
                    {t('stores.requirements.copyBtn', { n: copyTo.length })}
                  </button>
                  <button onClick={() => setCopyFrom(null)} className="font-body text-[10px] font-bold text-muted-ink underline">
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
            {dayRows.length === 0 ? (
              <span className="font-body text-[11px] text-muted-ink">{t('stores.requirements.noCoverage')}</span>
            ) : (
              <div className="flex flex-col gap-2">
                {dayRows.map((r) => (
                  <Row
                    key={r.id}
                    initial={toFriendly(r)}
                    onSave={(v) => act(() => api.updateRequirementFull(r.id, v))}
                    onDelete={() => act(() => api.deleteRequirement(r.id))}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// lowest level first, the way people think about a crew
const TIER_FIELDS = [
  { key: 'newRequired', labelKey: TIER_LABEL_KEY.NEW },
  { key: 'regularRequired', labelKey: TIER_LABEL_KEY.REGULAR },
  { key: 'seniorRequired', labelKey: TIER_LABEL_KEY.SENIOR },
  { key: 'managerRequired', labelKey: TIER_LABEL_KEY.MANAGER },
] as const

const LATE_CHOICES = [0, 15, 30, 45, 60, 90, 120, 180]

/** One time window as its own little card: the hours on top, then how many
 * people at each level (with − / + rather than tiny number boxes), then the
 * two extras — needs an opener, and how late someone may start. */
function Row({
  initial,
  onSave,
  onDelete,
}: {
  initial: Friendly
  onSave: (v: Friendly) => void
  onDelete: () => void
}) {
  const t = useT()
  const confirm = useConfirm()
  const [v, setV] = useState(initial)
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  const set = (patch: Partial<Friendly>) => setV((x) => ({ ...x, ...patch }))
  const total = v.managerRequired + v.seniorRequired + v.regularRequired + v.newRequired
  // a saved value that isn't one of the choices still shows
  const late = LATE_CHOICES.includes(v.graceMinutes) ? LATE_CHOICES : [...LATE_CHOICES, v.graceMinutes].sort((x, y) => x - y)

  const time = 'min-w-0 rounded-lg border-2 border-ink bg-paper px-1.5 py-1 font-body text-xs text-ink outline-none'
  const step = 'h-5 w-5 shrink-0 rounded-full border-2 border-ink bg-paper font-heading text-xs font-bold leading-none text-ink disabled:opacity-30'

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border-2 border-ink/15 bg-cream/60 p-2.5">
      <div className="flex items-center gap-1.5">
        <input type="time" step={1800} value={v.start} onChange={(e) => set({ start: e.target.value })} className={time} />
        <span className="font-body text-xs text-muted-ink">–</span>
        <input type="time" step={1800} value={v.end} onChange={(e) => set({ end: e.target.value })} className={time} />
        <button
          onClick={() => {
            void confirm(t('stores.requirements.confirmDelete', { start: v.start, end: v.end }), {
              tone: 'danger',
              confirmLabel: t('stores.delete'),
            }).then((ok) => ok && onDelete())
          }}
          aria-label={t('stores.requirements.deleteWindow')}
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-coral text-coral-dark"
        >
          <TrashIcon size={14} />
        </button>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between font-body text-[11px] font-bold text-muted-ink">
          <span>{t('stores.requirements.peopleNeeded')}</span>
          <span className={total < 1 ? 'text-coral-dark' : 'text-ink'}>{t('stores.requirements.total', { n: total })}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {TIER_FIELDS.map(({ key, labelKey }) => (
            <div key={key} className="flex items-center gap-1 rounded-lg bg-paper py-1 pl-2 pr-1">
              <span className="min-w-0 flex-1 truncate font-body text-xs text-ink">{t(labelKey)}</span>
              <button
                type="button"
                aria-label={`${t(labelKey)} −`}
                disabled={v[key] === 0}
                onClick={() => set({ [key]: Math.max(0, v[key] - 1) })}
                className={step}
              >
                −
              </button>
              <span className="w-4 text-center font-heading text-sm font-bold text-ink">{v[key]}</span>
              <button
                type="button"
                aria-label={`${t(labelKey)} +`}
                disabled={v[key] >= 12}
                onClick={() => set({ [key]: Math.min(12, v[key] + 1) })}
                className={step}
              >
                +
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={v.needOpen}
          onClick={() => set({ needOpen: !v.needOpen })}
          className={`rounded-full border-2 px-2.5 py-0.5 font-heading text-[11px] font-bold ${
            v.needOpen ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
          }`}
        >
          {v.needOpen ? '✓ ' : ''}
          {t('stores.requirements.needOpener')}
        </button>
        <label className="flex items-center gap-1.5 font-body text-[11px] font-bold text-muted-ink">
          {t('stores.requirements.lateBy')}
          <select
            value={v.graceMinutes}
            onChange={(e) => set({ graceMinutes: Number(e.target.value) })}
            className="rounded-lg border-2 border-ink bg-paper px-1.5 py-0.5 font-body text-xs text-ink outline-none"
          >
            {late.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? t('stores.requirements.lateNo') : t('stores.requirements.minutes', { n: m })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {dirty && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSave(v)}
            disabled={total < 1}
            className="rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-xs font-bold text-white disabled:opacity-40"
          >
            {t('common.save')}
          </button>
          <button
            onClick={() => setV(initial)}
            className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-heading text-xs font-bold text-ink"
          >
            {t('common.cancel')}
          </button>
          {total < 1 && (
            <span className="font-body text-[11px] font-bold text-coral-dark">{t('stores.requirements.needsOnePerson')}</span>
          )}
        </div>
      )}
    </div>
  )
}
