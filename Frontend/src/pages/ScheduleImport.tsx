import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Toggle, ToggleGroup } from '../components/Toggle'
import { CalendarIcon } from '../components/icons'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { FileProblem, prepareScheduleFile } from '../lib/scheduleFile'
import { useStore } from '../lib/store-context'
import { DAY_LABEL, DAYS, durationLabel, weekRangeLabel } from '../lib/time'
import { matchPerson } from '../lib/timeImport'
import { useIsNarrow } from '../lib/use-narrow'
import type { DayOfWeek, ImportContext, ImportResult, ReadSchedule } from '../types'

type Row = { key: number; person: string; day: DayOfWeek; start: string; end: string; section: string; unsure: boolean }
/** who a name on the file is: someone on the team, someone new, or nobody (left off) */
type Pick = number | 'add' | 'skip'
type FileKey = 'type' | 'empty' | 'unreadable' | 'too-big'

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Schedule › Import: bring the schedule a store already has — a photo of
 * the paper one, a PDF, or the spreadsheet — into FruitCrew. It's read for
 * them, they check every name and shift, and it lands on the week they're
 * planning, ready to post. Keyed on the store, so switching stores starts over. */
export function ScheduleImport() {
  const { storeId } = useStore()
  return <ImportFlow key={storeId ?? 'none'} storeId={storeId} />
}

function ImportFlow({ storeId }: { storeId: number | null }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const narrow = useIsNarrow()
  const { stores } = useStore()
  const storeName = stores.find((s) => s.id === storeId)?.name ?? ''
  const [ctx, setCtx] = useState<ImportContext | null>(null)
  const [step, setStep] = useState<'pick' | 'reading' | 'review' | 'saving' | 'done'>('pick')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [read, setRead] = useState<ReadSchedule | null>(null)
  const [people, setPeople] = useState<{ name: string; pick: Pick }[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [opts, setOpts] = useState({ needs: true, usual: true, sections: false })
  const [result, setResult] = useState<ImportResult | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const nextKey = useRef(10_000)

  useEffect(() => {
    if (storeId == null) return
    api
      .getImportContext(storeId)
      .then(setCtx)
      .catch((e) => setError(e instanceof Error ? e.message : t('import.err.load')))
  }, [storeId, t])

  // a label on the file that means one of the store's sections lands on it
  const sectionFor = (role: string) =>
    !role ? '' : (ctx?.sections.find((s) => s.name.trim().toLowerCase() === role.trim().toLowerCase())?.name ?? role)

  async function readFile(f: File) {
    if (storeId == null || !ctx) return
    setError(null)
    setFileName(f.name)
    setStep('reading')
    try {
      const prepared = await prepareScheduleFile(f)
      const r = await api.readSchedule(storeId, prepared, lang)
      if (r.shifts.length === 0) throw new Error(t('import.err.noShifts'))
      setRead(r)
      setPeople(r.people.map((p) => ({ name: p.name, pick: matchPerson(p.name, ctx.people) ?? 'add' })))
      setRows(r.shifts.map((s, i) => ({ key: i, person: s.person, day: s.day, start: s.start, end: s.end, section: sectionFor(s.role), unsure: s.unsure })))
      setOpts({ needs: !ctx.hasNeeds, usual: true, sections: false })
      setStep('review')
    } catch (e) {
      setError(e instanceof FileProblem ? t(`import.file.${e.message as FileKey}`) : e instanceof Error ? e.message : t('import.err.read'))
      setStep('pick')
    }
  }

  const pickOf = (name: string) => people.find((p) => p.name === name)?.pick ?? 'skip'
  const kept = rows.filter((r) => r.person === '' || pickOf(r.person) !== 'skip')
  const bad = rows.filter((r) => !r.start || !r.end || r.start >= r.end)
  const unsure = rows.filter((r) => r.unsure).length
  const newSections = useMemo(
    () => [...new Set(rows.map((r) => r.section).filter((n) => n && !ctx?.sections.some((s) => s.name === n)))],
    [rows, ctx],
  )
  const adding = people.filter((p) => p.pick === 'add').length

  function edit(key: number, patch: Partial<Row>) {
    // touching a row is checking it
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, unsure: false } : r)))
  }

  async function save() {
    if (storeId == null || !ctx) return
    setStep('saving')
    setError(null)
    try {
      const r = await api.applyImport({
        storeId,
        people: people.map((p) =>
          p.pick === 'add' ? { name: p.name, add: true } : p.pick === 'skip' ? { name: p.name } : { name: p.name, employeeId: p.pick },
        ),
        shifts: rows.map((r) => ({ person: r.person, day: r.day, start: r.start, end: r.end, section: r.section })),
        setUpNeeds: opts.needs && !ctx.hasNeeds,
        usualHours: opts.usual,
        addSections: opts.sections,
      })
      setResult(r)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('import.err.save'))
      setStep('review')
    }
  }

  const page = (children: ReactNode) => (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-8">
      <Link to="/schedule" className="font-body text-xs font-bold text-sky-dark">
        ‹ {t('nav.mgr.schedule')}
      </Link>
      {children}
    </div>
  )
  const errorBox = error && (
    <p className="mt-3 rounded-xl border-2 border-coral bg-coral-bg px-3 py-2 font-body text-xs font-bold text-coral-dark">{error}</p>
  )

  if (storeId == null) return page(<p className="mt-4 font-body text-sm text-muted-ink">{t('import.noStore')}</p>)
  if (!ctx) return page(error ? errorBox : <p className="mt-4 font-body text-sm text-muted-ink">{t('common.loading')}</p>)
  const range = weekRangeLabel(ctx.weekStart)

  // ---- 1. pick a file
  if (step === 'pick' || step === 'reading') {
    const blocked = !ctx.ready || ctx.posted
    return page(
      <>
        <h1 className="mt-2 font-heading text-lg font-bold text-ink">{t('import.title')}</h1>
        <p className="mt-1 font-body text-sm text-muted-ink">{t('import.lead')}</p>

        {step === 'reading' ? (
          <Card className="mt-4 flex flex-col items-center gap-3 py-8 text-center">
            <span aria-hidden className="h-10 w-10 animate-spin rounded-full border-4 border-ink/15 border-t-green" />
            <p className="font-heading text-base font-bold text-ink">{t('import.reading')}</p>
            <p className="max-w-xs font-body text-xs text-muted-ink">{t('import.readingHint', { file: fileName })}</p>
          </Card>
        ) : (
          <Card className="mt-4 flex flex-col gap-4">
            <ol className="flex flex-col gap-2.5">
              {(['import.step.1', 'import.step.2', 'import.step.3'] as const).map((k, i) => (
                <li key={k} className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink font-heading text-[11px] font-bold text-ink">
                    {i + 1}
                  </span>
                  <span className="font-body text-sm text-ink">{t(k)}</span>
                </li>
              ))}
            </ol>

            {ctx.posted ? (
              <div className="rounded-xl border-2 border-coral bg-coral-bg px-3 py-2 font-body text-xs text-coral-dark">
                <b>{t('import.posted', { range })}</b> {t('import.postedHint')}{' '}
                <Link to="/schedule" className="font-bold underline">
                  {t('import.goSchedule')}
                </Link>
              </div>
            ) : !ctx.ready ? (
              <p className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-2 font-body text-xs text-ink">{t('import.notReady')}</p>
            ) : (
              <div className="flex items-start gap-2 rounded-xl bg-cream px-3 py-2">
                <span className="mt-0.5 text-ink">
                  <CalendarIcon size={16} />
                </span>
                <p className="font-body text-xs text-ink">{t('import.target', { range, store: storeName })}</p>
              </div>
            )}

            <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void readFile(f)
            }} />
            <input ref={fileRef} type="file" accept="image/*,.pdf,.xlsx,.csv,.tsv,.txt" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void readFile(f)
            }} />
            <div className="flex flex-wrap gap-2">
              {narrow && (
                <Button disabled={blocked} onClick={() => photoRef.current?.click()}>
                  {t('import.photo')}
                </Button>
              )}
              <Button variant={narrow ? 'secondary' : 'primary'} disabled={blocked} onClick={() => fileRef.current?.click()}>
                {t('import.choose')}
              </Button>
            </div>
            <ul className="flex flex-col gap-1 font-body text-[11px] text-muted-ink">
              <li>• {t('import.tip.types')}</li>
              <li>• {t('import.tip.photo')}</li>
              <li>• {t('import.tip.week')}</li>
            </ul>
          </Card>
        )}
        {errorBox}
      </>,
    )
  }

  // ---- 3. saved
  if (step === 'done' && result) {
    const lines = [
      t(result.shifts === 1 ? 'import.done.shifts.one' : 'import.done.shifts', { n: result.shifts, range: weekRangeLabel(result.weekStart) }),
      result.added > 0 && t(result.added === 1 ? 'import.done.people.one' : 'import.done.people', { n: result.added }),
      result.needs > 0 && t('import.done.needs', { n: result.needs }),
      result.sections > 0 && t(result.sections === 1 ? 'import.done.sections.one' : 'import.done.sections', { n: result.sections }),
      result.leftOff > 0 && t('import.done.leftOff', { n: result.leftOff }),
    ].filter((l): l is string => !!l)
    return page(
      <Card className="mt-4 flex flex-col gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-green bg-green/15 font-heading text-2xl text-green-dark">
          ✓
        </span>
        <h1 className="font-heading text-lg font-bold text-ink">{t('import.done.title')}</h1>
        <ul className="flex flex-col gap-1">
          {lines.map((l) => (
            <li key={l} className="font-body text-sm text-ink">
              • {l}
            </li>
          ))}
        </ul>
        <p className="font-body text-xs text-muted-ink">{t('import.done.next')}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate('/schedule', { state: { draft: true } })}>{t('import.done.see')}</Button>
          {result.added > 0 && (
            <Button variant="secondary" onClick={() => navigate('/team')}>
              {t('import.done.invite')}
            </Button>
          )}
        </div>
      </Card>,
    )
  }

  // ---- 2. check it
  const label = 'font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink'
  const select = 'min-w-0 rounded-lg border-2 bg-paper px-2 py-1 font-body text-xs text-ink outline-none'
  const time = 'min-w-0 rounded-lg border-2 border-ink bg-paper px-1.5 py-1 font-body text-xs font-bold text-ink'
  const shiftsOf = (name: string) => rows.filter((r) => r.person === name)
  return page(
    <>
      <h1 className="mt-2 font-heading text-lg font-bold text-ink">{t('import.review.title')}</h1>
      <p className="mt-1 font-body text-sm text-muted-ink">
        {t('import.review.summary', { people: people.length, shifts: rows.length, file: fileName })}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-start gap-2 rounded-xl bg-cream px-3 py-2">
          <span className="mt-0.5 text-ink">
            <CalendarIcon size={16} />
          </span>
          <p className="font-body text-xs text-ink">
            {t('import.target', { range, store: storeName })}
            {read?.weekOf && read.weekOf !== ctx.weekStart && ` ${t('import.otherWeek', { range: weekRangeLabel(read.weekOf) })}`}
          </p>
        </div>
        {(unsure > 0 || (read?.notes.length ?? 0) > 0) && (
          <div className="rounded-xl border-2 border-orange bg-orange/10 px-3 py-2">
            {unsure > 0 && (
              <p className="font-body text-xs font-bold text-ink">
                {t(unsure === 1 ? 'import.unsure.one' : 'import.unsure', { n: unsure })}
              </p>
            )}
            {read?.notes.map((n) => (
              <p key={n} className="mt-0.5 font-body text-xs text-ink">
                {n}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* who's who */}
      <h2 className={`mt-5 ${label}`}>{t('import.people.title')}</h2>
      <p className="mt-0.5 font-body text-xs text-muted-ink">{t('import.people.hint')}</p>
      <Card padded={false} className="mt-2 overflow-hidden">
        <ul className="divide-y-2 divide-ink/10">
          {people.map((p) => {
            const theirs = shiftsOf(p.name)
            const mins = theirs.reduce((n, r) => n + Math.max(0, minutes(r.end) - minutes(r.start)), 0)
            const tone = p.pick === 'skip' ? 'border-ink/20 text-muted-ink' : p.pick === 'add' ? 'border-sky-dark' : 'border-green'
            return (
              <li key={p.name} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-body text-sm font-bold ${p.pick === 'skip' ? 'text-muted-ink line-through' : 'text-ink'}`}>{p.name}</div>
                  <div className="font-body text-[11px] text-muted-ink">
                    {theirs.length === 0 ? t('import.people.none') : t(theirs.length === 1 ? 'import.people.count.one' : 'import.people.count', { n: theirs.length, time: durationLabel(mins) })}
                  </div>
                </div>
                <select
                  aria-label={t('import.people.who', { name: p.name })}
                  value={String(p.pick)}
                  onChange={(e) => {
                    const v = e.target.value
                    const pick: Pick = v === 'add' || v === 'skip' ? v : Number(v)
                    setPeople((ps) => ps.map((x) => (x.name === p.name ? { ...x, pick } : x)))
                  }}
                  className={`${select} max-w-[12.5rem] ${tone}`}
                >
                  <option value="add">{t('import.people.add')}</option>
                  <option value="skip">{t('import.people.skip')}</option>
                  <optgroup label={t('import.people.team')}>
                    {ctx.people.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </li>
            )
          })}
        </ul>
      </Card>

      {/* every shift, by day */}
      <h2 className={`mt-5 ${label}`}>{t('import.shifts.title')}</h2>
      <p className="mt-0.5 font-body text-xs text-muted-ink">{t('import.shifts.hint')}</p>
      <div className="mt-2 flex flex-col gap-3">
        {DAYS.map((day) => {
          const dayRows = rows.filter((r) => r.day === day).sort((a, b) => a.start.localeCompare(b.start))
          return (
            <Card key={day} padded={false} className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b-2 border-ink/10 bg-cream px-3 py-1.5">
                <span className="font-heading text-sm font-bold text-ink">
                  {DAY_LABEL[day]}
                  <span className="ml-1.5 font-body text-[11px] font-normal text-muted-ink">
                    {dayRows.length === 0 ? t('import.shifts.none') : t('import.shifts.count', { n: dayRows.length })}
                  </span>
                </span>
                <button
                  onClick={() =>
                    setRows((rs) => [...rs, { key: nextKey.current++, person: people[0]?.name ?? '', day, start: '09:00', end: '17:00', section: '', unsure: false }])
                  }
                  className="rounded-full border-2 border-ink bg-paper px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink"
                >
                  {t('import.shifts.add')}
                </button>
              </div>
              {dayRows.length > 0 && (
                <ul className="flex flex-col gap-1.5 p-2">
                  {dayRows.map((r) => {
                    const wrong = !r.start || !r.end || r.start >= r.end
                    const off = r.person !== '' && pickOf(r.person) === 'skip'
                    return (
                      <li
                        key={r.key}
                        className={`rounded-xl border-2 px-2.5 py-2 ${
                          wrong ? 'border-coral bg-coral-bg' : r.unsure ? 'border-orange bg-orange/10' : 'border-ink/10'
                        } ${off ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <select
                            aria-label={t('import.shifts.who')}
                            value={r.person}
                            onChange={(e) => edit(r.key, { person: e.target.value })}
                            className={`${select} flex-1 border-ink/30 font-bold`}
                          >
                            {people.map((p) => (
                              <option key={p.name} value={p.name}>
                                {p.name}
                              </option>
                            ))}
                            <option value="">{t('import.shifts.open')}</option>
                          </select>
                          {r.unsure && (
                            <span className="shrink-0 rounded-full border-2 border-orange px-2 py-px font-body text-[10px] font-bold text-ink">
                              {t('import.shifts.check')}
                            </span>
                          )}
                          <button
                            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                            aria-label={t('import.shifts.remove')}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-heading text-base leading-none text-muted-ink hover:text-coral-dark"
                          >
                            ×
                          </button>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <input type="time" aria-label={t('import.shifts.start')} value={r.start} onChange={(e) => edit(r.key, { start: e.target.value })} className={time} />
                          <span className="font-body text-xs font-bold text-muted-ink">–</span>
                          <input type="time" aria-label={t('import.shifts.end')} value={r.end} onChange={(e) => edit(r.key, { end: e.target.value })} className={time} />
                          {(ctx.sections.length > 0 || newSections.length > 0) && (
                            <select
                              aria-label={t('schedule.assign.section')}
                              value={r.section}
                              onChange={(e) => edit(r.key, { section: e.target.value })}
                              className={`${select} border-ink/30`}
                            >
                              <option value="">{t('import.shifts.noSection')}</option>
                              {ctx.sections.map((s) => (
                                <option key={s.id} value={s.name}>
                                  {s.name}
                                </option>
                              ))}
                              {newSections.map((n) => (
                                <option key={n} value={n}>
                                  {t('import.shifts.newSection', { name: n })}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        {wrong && <p className="mt-1 font-body text-[11px] font-bold text-coral-dark">{t('import.shifts.wrong')}</p>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          )
        })}
      </div>

      {/* what else to set up from it */}
      {(!ctx.hasNeeds || adding > 0 || newSections.length > 0) && (
        <>
          <h2 className={`mt-5 ${label}`}>{t('import.opts.title')}</h2>
          <ToggleGroup className="mt-2">
            {!ctx.hasNeeds && (
              <Toggle plain on={opts.needs} onClick={() => setOpts((o) => ({ ...o, needs: !o.needs }))} label={t('import.opt.needs')} hint={t('import.opt.needsHint')} />
            )}
            {adding > 0 && (
              <Toggle plain on={opts.usual} onClick={() => setOpts((o) => ({ ...o, usual: !o.usual }))} label={t('import.opt.usual')} hint={t('import.opt.usualHint')} />
            )}
            {newSections.length > 0 && (
              <Toggle
                plain
                on={opts.sections}
                onClick={() => setOpts((o) => ({ ...o, sections: !o.sections }))}
                label={t('import.opt.sections', { names: newSections.join(', ') })}
                hint={t('import.opt.sectionsHint')}
              />
            )}
          </ToggleGroup>
        </>
      )}

      {ctx.existingShifts > 0 && (
        <p className="mt-4 rounded-xl border-2 border-ink/15 bg-cream px-3 py-2 font-body text-xs text-ink">
          {t('import.replaces', { n: ctx.existingShifts, range })}
        </p>
      )}
      {errorBox}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={step === 'saving' || bad.length > 0 || kept.length === 0} onClick={() => void save()}>
          {step === 'saving' ? t('import.saving') : t(kept.length === 1 ? 'import.go.one' : 'import.go', { n: kept.length })}
        </Button>
        <Button
          variant="secondary"
          disabled={step === 'saving'}
          onClick={() => {
            setStep('pick')
            setRead(null)
            setError(null)
          }}
        >
          {t('import.startOver')}
        </Button>
      </div>
      {bad.length > 0 && <p className="mt-2 font-body text-[11px] font-bold text-coral-dark">{t('import.fixFirst', { n: bad.length })}</p>}
    </>,
  )
}
