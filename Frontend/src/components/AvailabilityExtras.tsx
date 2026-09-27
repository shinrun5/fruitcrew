import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Button } from './Button'
import { Card } from './Card'
import { DayPrefsEditor } from './DayPrefsEditor'
import { ShiftLimitsFields } from './PersonFields'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import type { DayOfWeek } from '../types'

/** The rest of "your availability" that isn't windows/time-off: weekly limits and
 * day preferences. Lives on the hours page (employee + manager-as-worker) so
 * everything about when/how you can work is in one place. */
export function AvailabilityExtras({ onError }: { onError: (m: string | null) => void }) {
  const [data, setData] = useState<{
    hourLimit: number
    maxShifts: number
    eitherOrDays: DayOfWeek[][]
    noConsecutiveDays: boolean
  } | null>(null)

  const load = useCallback(
    () =>
      api
        .getProfile()
        .then((p) => {
          if (!p.employee) return
          setData({
            hourLimit: p.employee.hourLimit,
            maxShifts: p.employee.maxShifts,
            eitherOrDays: p.employee.eitherOrDays,
            noConsecutiveDays: p.employee.noConsecutiveDays,
          })
        })
        .catch((e) => onError(e instanceof Error ? e.message : 'Could not load your limits')),
    [onError],
  )
  useEffect(() => {
    void load()
  }, [load])

  if (!data) return null

  return (
    <>
      <MyLimits hourLimit={data.hourLimit} maxShifts={data.maxShifts} onSaved={load} onError={onError} />
      <DayPrefs groups={data.eitherOrDays} noConsecutive={data.noConsecutiveDays} onSaved={load} onError={onError} />
    </>
  )
}

function MyLimits({
  hourLimit,
  maxShifts,
  onSaved,
  onError,
}: {
  hourLimit: number
  maxShifts: number
  onSaved: () => void | Promise<void>
  onError: (m: string | null) => void
}) {
  const t = useT()
  const [h, setH] = useState(String(hourLimit))
  const [d, setD] = useState(String(maxShifts))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const dirty = h !== String(hourLimit) || d !== String(maxShifts)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    onError(null)
    setDone(false)
    const hn = Math.round(Number(h))
    const dn = Math.round(Number(d))
    if (!Number.isFinite(hn) || hn < 1 || hn > 80) return onError('Max hours must be between 1 and 80')
    if (!Number.isFinite(dn) || dn < 1 || dn > 7) return onError('Max days must be between 1 and 7')
    setBusy(true)
    try {
      await api.updateMyLimits({ hourLimit: hn, maxShifts: dn })
      setDone(true)
      await onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save your limits')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card as="form" onSubmit={submit} className="mt-4">
      <h2 className="font-heading text-sm font-bold text-ink">{t('profile.limits')}</h2>
      <p className="mt-0.5 font-body text-xs text-muted-ink">{t('profile.limitsHint')}</p>
      <div className="mt-2 flex gap-2 [&>label]:flex-1">
        <ShiftLimitsFields maxShifts={d} onMaxShiftsChange={setD} hourLimit={h} onHourLimitChange={setH} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
        {done && !dirty && <span className="font-body text-xs font-bold text-green">{t('common.saved')}</span>}
      </div>
    </Card>
  )
}

function DayPrefs({
  groups,
  noConsecutive,
  onSaved,
  onError,
}: {
  groups: DayOfWeek[][]
  noConsecutive: boolean
  onSaved: () => void | Promise<void>
  onError: (m: string | null) => void
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [ncBusy, setNcBusy] = useState(false)

  async function save(next: DayOfWeek[][]) {
    onError(null)
    setBusy(true)
    try {
      await api.setMyEitherOr(next)
      await onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save your day preference')
    } finally {
      setBusy(false)
    }
  }

  async function toggleNoConsecutive() {
    onError(null)
    setNcBusy(true)
    try {
      await api.setMyNoConsecutive(!noConsecutive)
      await onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save your day preference')
    } finally {
      setNcBusy(false)
    }
  }

  return (
    <Card className="mt-4">
      <h2 className="font-heading text-sm font-bold text-ink">{t('profile.dayPrefs')}</h2>
      <DayPrefsEditor
        groups={groups}
        noConsecutive={noConsecutive}
        busy={busy}
        ncBusy={ncBusy}
        onSaveGroups={(next) => void save(next)}
        onToggleNoConsecutive={() => void toggleNoConsecutive()}
        onError={onError}
      />
    </Card>
  )
}
