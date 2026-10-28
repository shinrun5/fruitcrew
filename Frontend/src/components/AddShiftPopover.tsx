import { useState } from 'react'
import { type Candidate, limitWarning } from '../lib/candidates'
import { useT } from '../lib/i18n'
import { CandidateList } from './AssignPopover'
import { SheetClose, SheetPopover } from './SheetPopover'

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

  const timeInput = 'min-w-0 rounded-lg border-2 border-ink bg-paper px-1.5 py-1 font-body text-xs font-bold text-ink'
  const label = 'font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink'
  return (
    <SheetPopover anchorRect={anchorRect} label={title} onClose={onClose} width={300}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 font-heading text-base font-bold leading-tight text-ink">{title}</span>
          <SheetClose onClose={onClose} label={t('common.close')} />
        </div>

        <div className="flex flex-col gap-1.5 border-t-2 border-ink/10 pt-3">
          <span className={label}>{t('schedule.assign.hoursLabel')}</span>
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
        </div>

        {sections.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className={label}>{t('schedule.assign.section')}</span>
            <div className="flex flex-wrap gap-1.5">
              {sections.map((o) => {
                const on = o.id === sectionId
                return (
                  <button
                    key={o.id}
                    onClick={() => setSectionId(on ? null : o.id)}
                    aria-pressed={on}
                    className={`rounded-full border-2 px-2.5 py-1 font-body text-xs font-bold ${
                      on ? 'border-grape bg-grape/20 text-ink' : 'border-ink/30 text-muted-ink hover:border-ink hover:text-ink'
                    }`}
                  >
                    {on && '✓ '}
                    {o.name}
                  </button>
                )
              })}
            </div>
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
            <div className="flex flex-col gap-2 border-t-2 border-ink/10 pt-3">
              <span className={label}>{t('schedule.add.who')}</span>
              <CandidateList
                candidates={showAll ? all : free}
                onPick={(id) => add(id)}
                empty={t('schedule.add.nobodyFree')}
              />
              <button
                onClick={() => setShowAll((v) => !v)}
                className="self-start font-body text-[11px] font-bold text-sky-dark transition-opacity hover:opacity-70"
              >
                {showAll ? t('schedule.assign.onlyFree') : t('schedule.assign.addNotFree')}
              </button>
              <button
                onClick={() => add(null)}
                className="mt-1 flex flex-col gap-0.5 rounded-xl border-2 border-dashed border-orange bg-orange/10 px-3 py-2 text-left transition-opacity hover:opacity-80"
              >
                <span className="font-body text-xs font-bold text-ink">{t('schedule.open.offer')}</span>
                <span className="font-body text-[11px] text-muted-ink">{t('schedule.open.offerHint')}</span>
              </button>
            </div>
          )
        )}
      </div>
    </SheetPopover>
  )
}
