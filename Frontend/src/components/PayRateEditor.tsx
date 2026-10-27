import { useState } from 'react'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { money } from '../lib/pay'

/** A worker's hourly pay on their Team page — shown only to someone who can see pay. */
export function PayRateEditor({
  employeeId,
  rateCents,
  weekMinutes,
  onSaved,
}: {
  employeeId: number
  rateCents: number | null
  /** scheduled this week, for "about $X this week" */
  weekMinutes: number
  onSaved: () => void
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(rateCents != null ? (rateCents / 100).toFixed(2) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const over = Math.max(0, weekMinutes - 40 * 60)
  const weekPay = rateCents != null ? Math.round(((weekMinutes - over + over * 1.5) / 60) * rateCents) : null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api.setPayRate(employeeId, value.trim() === '' ? null : Number(value))
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('team.pay.err'))
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs">
        {rateCents != null ? (
          <span>
            <b className="text-ink">{t('team.pay.rate', { rate: money(rateCents, { cents: true }) })}</b>
            {weekPay != null && weekMinutes > 0 && (
              <span className="text-muted-ink"> · {t('team.pay.week', { pay: money(weekPay) })}</span>
            )}
          </span>
        ) : (
          <span className="text-muted-ink">{t('team.pay.none')}</span>
        )}
        <button onClick={() => setEditing(true)} className="font-bold text-sky-dark">
          {rateCents != null ? t('team.pay.change') : t('team.pay.set')}
        </button>
      </div>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="flex flex-wrap items-center gap-2 font-body text-xs"
    >
      <span className="font-bold text-muted-ink">$</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={1000}
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t('team.pay.label')}
        className="w-24 rounded-lg border-2 border-ink bg-cream px-2 py-1 text-xs text-ink outline-none"
      />
      <span className="text-muted-ink">{t('team.pay.perHour')}</span>
      <button
        type="submit"
        disabled={busy}
        className="rounded-full border-2 border-ink bg-green px-3 py-0.5 font-heading text-[11px] font-bold text-white disabled:opacity-50"
      >
        {t('common.save')}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="font-bold text-muted-ink underline">
        {t('common.cancel')}
      </button>
      {error && <span className="basis-full font-bold text-coral-dark">{error}</span>}
    </form>
  )
}
