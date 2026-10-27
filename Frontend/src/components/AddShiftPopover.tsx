import { useState } from 'react'
import { type Candidate, limitWarning } from '../lib/candidates'
import { useT } from '../lib/i18n'
import { popoverBox } from '../lib/popover'
import { CandidateList } from './AssignPopover'

/** Add a shift on any day, at any time — not just into a gap the shift needs
 * left. Pick the hours (and section), then who: someone free then, someone who
 * isn't (last-minute), or nobody yet — it goes out to the crew as an open
 * shift. Opened from an empty spot in someone's row, the person is already
 * picked and it's just the hours. */
export function AddShiftPopover({
  anchorRect,
  title,
  defaultStart,
  defaultEnd,
  sections,
  person,
  candidatesFor,
  onAdd,
  onClose,
}: {
  anchorRect: DOMRect
  title: string
  /** "HH:MM" 24h */
  defaultStart: string
  defaultEnd: string
  /** the store's sections — none picked = the person's usual one */
  sections: { id: number; name: string }[]
  /** already chosen (tapped in their row) */
  person?: { employeeId: number; name: string }
  /** who could work these hours: `free` honours availability, `all` doesn't */
  candidatesFor: (startHHMM: string, endHHMM: string) => { free: Candidate[]; all: Candidate[] }
  onAdd: (args: { employeeId: number | null; start: string; end: string; sectionId: number | null }) => void
  onClose: () => void
}) {
  const t = useT()
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const [sectionId, setSectionId] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  const valid = start !== '' && end !== '' && start < end
  const { free, all } = valid ? candidatesFor(start, end) : { free: [], all: [] }
  const add = (employeeId: number | null) => onAdd({ employeeId, start, end, sectionId })

  // the chosen person, as the picker sees them for these hours (missing = already working then)
  const me = person ? all.find((c) => c.employeeId === person.employeeId) : undefined
  const note = !person
    ? null
    : !me
      ? t('schedule.add.busy', { name: person.name })
      : [me.available && me.coversFull ? null : t('schedule.add.notFree', { name: person.name }), limitWarning(me, t)]
          .filter(Boolean)
          .join(' · ') || null

  const timeInput = 'rounded-lg border-2 border-ink px-1.5 py-0.5 font-body text-xs font-bold text-ink'
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 flex flex-col gap-3 overflow-y-auto rounded-2xl border-[2.5px] border-ink bg-paper p-3 shadow-[4px_4px_0_var(--color-ink)]"
        style={popoverBox(anchorRect)}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="font-heading text-sm font-bold text-ink">{title}</span>

        <div className="flex items-center gap-1.5">
          <input
            type="time"
            aria-label={t('schedule.add.start')}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={timeInput}
          />
          <span className="font-body text-xs font-bold text-muted-ink">–</span>
          <input
            type="time"
            aria-label={t('schedule.add.end')}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={timeInput}
          />
        </div>
        {!valid && <span className="font-body text-[11px] font-bold text-coral-dark">{t('schedule.add.endAfterStart')}</span>}

        {sections.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-body text-[11px] font-bold text-muted-ink">{t('schedule.assign.section')}</span>
            {sections.map((o) => {
              const on = o.id === sectionId
              return (
                <button
                  key={o.id}
                  onClick={() => setSectionId(on ? null : o.id)}
                  aria-pressed={on}
                  className={`rounded-full border-2 px-2 py-0.5 font-body text-[11px] font-bold ${
                    on ? 'border-grape bg-grape/20 text-ink' : 'border-ink/30 text-muted-ink hover:border-ink hover:text-ink'
                  }`}
                >
                  {o.name}
                </button>
              )
            })}
          </div>
        )}

        {person ? (
          <>
            {valid && note && <span className="font-body text-[11px] font-bold text-coral-dark">{note}</span>}
            <button
              disabled={!valid || !me}
              onClick={() => add(person.employeeId)}
              className="self-start rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-xs font-bold text-white disabled:opacity-40"
            >
              {t('schedule.add.addFor', { name: person.name })}
            </button>
          </>
        ) : (
          valid && (
            <div className="flex flex-col gap-2 border-t-2 border-dashed border-cream pt-2.5">
              <span className="font-body text-[11px] font-bold text-muted-ink">{t('schedule.add.who')}</span>
              <CandidateList
                candidates={showAll ? all : free}
                onPick={(id) => add(id)}
                empty={t('schedule.add.nobodyFree')}
              />
              <button
                onClick={() => setShowAll((v) => !v)}
                className="self-start font-body text-[10px] font-bold text-sky-dark transition-opacity hover:opacity-70"
              >
                {showAll ? t('schedule.assign.onlyFree') : t('schedule.assign.addNotFree')}
              </button>
              <button
                onClick={() => add(null)}
                className="flex flex-col gap-0.5 rounded-xl border-2 border-dashed border-orange bg-orange/10 px-2 py-1.5 text-left transition-opacity hover:opacity-80"
              >
                <span className="font-body text-[11px] font-bold text-ink">{t('schedule.open.offer')}</span>
                <span className="font-body text-[10px] text-muted-ink">{t('schedule.open.offerHint')}</span>
              </button>
            </div>
          )
        )}
      </div>
    </>
  )
}
