import { useState } from 'react'
import { Button } from './Button'
import { Toggle } from './Toggle'
import { useT } from '../lib/i18n'
import { DAY_LABEL } from '../lib/time'
import type { DayOfWeek } from '../types'

const DAY_KEYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const dayLabel = (d: DayOfWeek) => DAY_LABEL[d]

/** The either-or-days + no-consecutive-days editor — the two solver day
 * preferences that aren't plain windows/time-off. Presentational and prop-driven
 * (no API calls of its own) so both the worker's own Availability page
 * (AvailabilityExtras.tsx, self-service) and the manager's Workers page can
 * wrap it with their own persistence + chrome. */
export function DayPrefsEditor({
  groups,
  noConsecutive,
  busy,
  ncBusy,
  onSaveGroups,
  onToggleNoConsecutive,
  onError,
}: {
  groups: DayOfWeek[][]
  noConsecutive: boolean
  busy: boolean
  ncBusy: boolean
  onSaveGroups: (next: DayOfWeek[][]) => void
  onToggleNoConsecutive: () => void
  onError: (m: string | null) => void
}) {
  const t = useT()
  const [draft, setDraft] = useState<DayOfWeek[]>([])

  const toggle = (day: DayOfWeek) =>
    setDraft((cur) => (cur.includes(day) ? cur.filter((x) => x !== day) : [...cur, day]))

  const addGroup = () => {
    if (draft.length < 2) return onError('Pick at least two days for a group')
    if (groups.length >= 5) return onError('That is the most groups you can have')
    onSaveGroups([...groups, draft])
    setDraft([])
  }
  const removeGroup = (i: number) => onSaveGroups(groups.filter((_, idx) => idx !== i))

  return (
    <>
      <Toggle
        on={noConsecutive}
        busy={ncBusy}
        onClick={onToggleNoConsecutive}
        className="mt-2"
        label={
          <>
            <b>{t('profile.noBackToBack')}</b> — {t('profile.noBackToBackHint')}
          </>
        }
      />

      <p className="mt-3 font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
        {t('profile.oneOfThese')}
      </p>
      <p className="mt-0.5 font-body text-xs text-muted-ink">{t('profile.oneOfTheseHint')}</p>

      {groups.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {groups.map((g, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-xl border-2 border-ink bg-cream px-2.5 py-1.5"
            >
              <span className="font-body text-xs font-bold text-ink">
                {g.map(dayLabel).join(` ${t('profile.orJoin')} `)}
              </span>
              <button
                type="button"
                onClick={() => removeGroup(i)}
                disabled={busy}
                className="font-body text-xs font-bold text-coral-dark underline disabled:opacity-50"
              >
                {t('profile.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {DAY_KEYS.map((day) => {
          const on = draft.includes(day)
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggle(day)}
              className={`rounded-full border-2 border-ink px-2.5 py-1 font-body text-xs font-bold ${
                on ? 'bg-ink text-paper' : 'bg-cream text-ink'
              }`}
            >
              {dayLabel(day)}
            </button>
          )
        })}
      </div>
      <div className="mt-3">
        <Button type="button" onClick={addGroup} disabled={busy || draft.length < 2}>
          {busy ? t('common.saving') : t('profile.addGroup')}
        </Button>
      </div>
    </>
  )
}
