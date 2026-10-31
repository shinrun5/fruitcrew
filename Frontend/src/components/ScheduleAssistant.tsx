import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { isNativeApp } from '../lib/pricing'
import { DAY_LABEL, durationLabel, shortDate, to12HourCompact, weekRangeLabel } from '../lib/time'
import { useIsNarrow } from '../lib/use-narrow'
import type { AssistantAllowance, AssistantAnswer, AssistantChange, AssistantShift, AssistantWarning } from '../types'
import { Button } from './Button'
import { Modal } from './Modal'
import { AssistantIcon } from './icons'

interface Turn {
  role: 'manager' | 'assistant'
  text: string
  answer?: AssistantAnswer
  applied?: boolean
  /** why Apply didn't go through */
  applyError?: string
  /** the board moved on since — this one can't be applied any more */
  stale?: boolean
  /** a request that failed — shown, never sent back as history */
  failed?: boolean
}

const WARNING_KEY = {
  closed: 'assistant.warn.closed',
  timeOff: 'assistant.warn.timeOff',
  availability: 'assistant.warn.availability',
  noAvailability: 'assistant.warn.noAvailability',
  standby: 'assistant.warn.standby',
  hours: 'assistant.warn.hours',
  days: 'assistant.warn.days',
} as const satisfies Record<AssistantWarning, string>

const time = (s: AssistantShift) => `${to12HourCompact(s.start)}–${to12HourCompact(s.end)}`
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/** One suggested change, as it'd look on the board. */
function ChangeRow({ c, who }: { c: AssistantChange; who: (id: number | null) => string }) {
  const t = useT()
  const s = (c.after ?? c.before)!
  let main: ReactNode
  let sub: ReactNode
  if (c.op === 'assign' && c.before && c.after) {
    main = time(c.after)
    sub = (
      <>
        {who(c.before.employeeId)} → <b className="text-ink">{who(c.after.employeeId)}</b>
      </>
    )
  } else if (c.op === 'retime' && c.before && c.after) {
    main = who(c.after.employeeId)
    sub = (
      <>
        {time(c.before)} → <b className="text-ink">{time(c.after)}</b>
      </>
    )
  } else if (c.op === 'add' && c.after) {
    main = (
      <>
        <span className="mr-1 rounded-full bg-green/15 px-1.5 text-[10px] font-extrabold text-green-dark">{t('assistant.tag.new')}</span>
        {time(c.after)}
      </>
    )
    sub = <b className="text-ink">{who(c.after.employeeId)}</b>
  } else {
    main = (
      <>
        <span className="mr-1 rounded-full bg-coral-bg px-1.5 text-[10px] font-extrabold text-coral-dark">
          {t('assistant.tag.removed')}
        </span>
        <s>{time(s)}</s>
      </>
    )
    sub = who(s.employeeId)
  }
  return (
    <li className="flex gap-2.5 py-2">
      <span className="mt-0.5 w-10 shrink-0 self-start rounded-md border-2 border-ink/15 bg-cream py-0.5 text-center font-heading text-[10px] font-extrabold text-ink">
        {DAY_LABEL[s.day]}
      </span>
      <div className="min-w-0 flex-1 font-body text-xs text-muted-ink">
        <p className="font-bold text-ink">{main}</p>
        <p>{sub}</p>
        {c.why && <p className="mt-0.5 text-[11px] italic">{c.why}</p>}
        {c.warnings.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {c.warnings.map((w) => (
              <span key={w} className="rounded-full border border-coral bg-coral-bg px-1.5 py-px text-[10px] font-bold text-coral-dark">
                ⚠ {t(WARNING_KEY[w])}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

/** Schedule › Ask AI: a manager says what to change in plain words ("give Owen
 * more hours"), sees the changes it suggests, and applies them — nothing on
 * the board moves until then. The button and its panel; renders nothing until
 * the server says the assistant is switched on. One conversation per store and
 * week (the board keys it), since every answer is about the week on screen. */
export function ScheduleAssistant({
  storeId,
  weekStart,
  team,
  onApplied,
}: {
  storeId: number
  /** the week on the board, "YYYY-MM-DD" */
  weekStart: string
  /** the store's people, fewest hours first — for the example requests */
  team: string[]
  onApplied: () => void
}) {
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const narrow = useIsNarrow()
  const [ready, setReady] = useState(false)
  const [allowance, setAllowance] = useState<AssistantAllowance | null>(null)
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let live = true
    api
      .getAssistant(storeId)
      .then(({ ready, ...a }) => {
        if (!live) return
        setReady(ready)
        setAllowance(a)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [storeId])

  // keep the newest message in view
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, turns, busy])

  if (!ready) return null

  const atLimit = !!allowance && allowance.used >= allowance.limit
  const left = allowance ? Math.max(0, allowance.limit - allowance.used) : null

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy || atLimit) return
    // what was said before, for "and do the same on Sunday" — the server sends the week as it is now.
    // Exchanges that went nowhere (failed, off topic) are left out, question and answer both.
    const dropped = (x?: Turn) => !!x && (!!x.failed || !!x.answer?.offTopic)
    const history = turns
      .filter((x, i) => !dropped(x) && !(x.role === 'manager' && dropped(turns[i + 1])))
      .map((x) => ({
        role: x.role,
        text: x.applied ? `${x.text}\n(The manager applied these changes.)` : x.text,
      }))
    setTurns((ts) => [...ts, { role: 'manager', text: message }])
    setDraft('')
    setBusy(true)
    try {
      const answer = await api.askAssistant({
        storeId,
        weekStart,
        message,
        history,
        language: lang,
      })
      setAllowance(answer.allowance)
      setTurns((ts) => [...ts, { role: 'assistant', text: answer.offTopic ? t('assistant.offTopic') : answer.reply, answer }])
    } catch (e) {
      if (e instanceof ApiError && e.status === 429 && e.data?.code === 'limit') {
        // out of requests: take the message back so it isn't lost
        setAllowance(e.data as unknown as AssistantAllowance)
        setTurns((ts) => ts.slice(0, -1))
        setDraft(message)
      } else {
        const code = e instanceof ApiError ? e.data?.code : undefined
        const wait = e instanceof ApiError && typeof e.data?.retryAfter === 'number' ? Math.ceil(e.data.retryAfter / 60) : null
        const msg = !(e instanceof ApiError)
          ? t('assistant.error')
          : code === 'busy'
          ? t('assistant.busyOne')
          : code === 'rate' && wait
          ? t('assistant.tooFast.wait', { n: wait })
          : e.status === 429
          ? t('assistant.tooFast')
          : code === 'paused'
          ? t('assistant.paused')
          : e.status === 409
          ? t('assistant.weekLocked')
          : e.status >= 500
          ? t('assistant.error')
          : e.message
        setTurns((ts) => [...ts, { role: 'assistant', text: msg, failed: true }])
      }
    } finally {
      setBusy(false)
    }
  }

  async function applyTurn(i: number) {
    const answer = turns[i]?.answer
    if (!answer || applying !== null) return
    setApplying(i)
    try {
      await api.applyAssistant(answer.id, storeId)
      setTurns((ts) => ts.map((x, j) => (j === i ? { ...x, applied: true, applyError: undefined } : x)))
      onApplied()
    } catch (e) {
      const stale = e instanceof ApiError && e.status === 409
      const msg = stale ? t('assistant.stale') : e instanceof Error ? e.message : t('assistant.error')
      setTurns((ts) => ts.map((x, j) => (j === i ? { ...x, applyError: msg, stale } : x)))
    } finally {
      setApplying(null)
    }
  }

  const examples = [
    team[0] ? t('assistant.example.more', { name: firstName(team[0]) }) : null,
    t('assistant.example.open'),
    team[1] ? t('assistant.example.off', { name: firstName(team[1]) }) : null,
    t('assistant.example.even'),
  ].filter((x): x is string => !!x)

  const who = (answer: AssistantAnswer, id: number | null) =>
    id == null ? t('assistant.openShift') : answer.names[String(id)] ?? t('assistant.someone')

  const canBuyMore = user?.role === 'OWNER' && !isNativeApp() && !allowance?.extra

  return (
    <>
      <Button variant="secondary" size={narrow ? 'sm' : 'md'} onClick={() => setOpen(true)} className={narrow ? 'py-1' : undefined}>
        <AssistantIcon size={narrow ? 14 : 18} />
        {t('assistant.btn')}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} sheet padded={false} className="flex h-[85dvh] max-w-lg flex-col sm:h-[70vh]">
        <div className="flex items-center gap-2 border-b-2 border-ink/10 px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-sky text-ink">
            <AssistantIcon size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-base font-extrabold leading-tight text-ink">{t('assistant.title')}</h2>
            <p className="truncate font-body text-[11px] text-muted-ink">
              {t('assistant.week', { range: weekRangeLabel(weekStart) })}
              {left !== null && <> · {t('assistant.left', { n: left, limit: allowance!.limit })}</>}
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label={t('assistant.close')}
            className="h-8 w-8 shrink-0 rounded-full font-heading text-lg font-bold text-muted-ink hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
          {turns.length === 0 && (
            <div>
              <p className="font-body text-sm text-ink">{t('assistant.intro')}</p>
              {!atLimit && (
                <>
                  <p className="mt-3 font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">{t('assistant.tryOne')}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {examples.map((ex) => (
                      <button
                        key={ex}
                        onClick={() => {
                          setDraft(ex)
                          inputRef.current?.focus()
                        }}
                        className="rounded-full border-2 border-ink/20 bg-cream px-2.5 py-1 text-left font-body text-xs font-bold text-ink hover:border-ink"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {turns.map((x, i) =>
            x.role === 'manager' ? (
              <div key={i} className="mt-2.5 flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl border-2 border-ink bg-sky px-3 py-1.5 font-body text-sm text-ink">
                  {x.text}
                </p>
              </div>
            ) : (
              <div key={i} className="mt-2.5">
                <p
                  className={`max-w-[92%] whitespace-pre-wrap break-words rounded-2xl border-2 px-3 py-1.5 font-body text-sm ${
                    x.failed ? 'border-coral bg-coral-bg text-coral-dark' : 'border-ink bg-cream text-ink'
                  }`}
                >
                  {x.text}
                </p>
                {x.answer && x.answer.changes.length > 0 && (
                  <div className="mt-2 rounded-2xl border-2 border-ink bg-paper px-3 py-1 shadow-[2px_2px_0_var(--color-ink)]">
                    <ul className="divide-y-2 divide-ink/5">
                      {x.answer.changes.map((c, j) => (
                        <ChangeRow key={j} c={c} who={(id) => who(x.answer!, id)} />
                      ))}
                    </ul>
                    {x.answer.hours.length > 0 && (
                      <div className="border-t-2 border-ink/10 py-2">
                        <p className="font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">{t('assistant.hours')}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {x.answer.hours.map((h) => (
                            <span
                              key={h.employeeId}
                              className="rounded-full border border-ink/20 px-2 py-px font-body text-[11px] text-ink"
                            >
                              <b>{firstName(h.name)}</b> {durationLabel(h.before)} → {durationLabel(h.after)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {x.answer.problems.length > 0 && (
                      <p className="border-t-2 border-ink/10 py-2 font-body text-[11px] text-muted-ink">
                        {t(x.answer.problems.length === 1 ? 'assistant.leftOut.one' : 'assistant.leftOut', { n: x.answer.problems.length })}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 border-t-2 border-ink/10 py-2">
                      {x.applied ? (
                        <span className="font-body text-xs font-bold text-green-dark">✓ {t('assistant.applied')}</span>
                      ) : x.stale ? null : (
                        <Button size="sm" onClick={() => void applyTurn(i)} disabled={applying !== null} className="py-1 text-xs">
                          {applying === i
                            ? t('assistant.applying')
                            : t(x.answer.changes.length === 1 ? 'assistant.apply.one' : 'assistant.apply', { n: x.answer.changes.length })}
                        </Button>
                      )}
                      {x.applyError && <span className="font-body text-[11px] font-bold text-coral-dark">{x.applyError}</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          )}

          {busy && (
            <div className="mt-2.5">
              <p className="inline-flex items-center gap-1.5 rounded-2xl border-2 border-ink/30 bg-cream px-3 py-1.5 font-body text-sm text-muted-ink">
                <span className="inline-flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-ink" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-ink [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-ink [animation-delay:240ms]" />
                </span>
                {t('assistant.thinking')}
              </p>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t-2 border-ink/10 px-4 py-3">
          {atLimit ? (
            <div className="rounded-xl border-2 border-ink/15 bg-cream px-3 py-2 font-body text-xs text-ink">
              <p className="font-bold">
                {t('assistant.limit', {
                  limit: allowance!.limit,
                  date: shortDate(`${allowance!.resetsOn}T12:00:00Z`),
                })}
              </p>
              {canBuyMore && (
                <p className="mt-1 text-muted-ink">
                  {t('assistant.limit.more')}{' '}
                  <Link to="/settings" className="font-bold text-sky-dark underline">
                    {t('assistant.limit.go')}
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter that picks a character in a Chinese/Japanese keyboard isn't "send"
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send(draft)
                    }
                  }}
                  maxLength={500}
                  rows={2}
                  placeholder={t('assistant.placeholder')}
                  aria-label={t('assistant.placeholder')}
                  className="min-w-0 flex-1 resize-none rounded-xl border-2 border-ink bg-paper px-3 py-2 font-body text-sm text-ink outline-none placeholder:text-muted-ink/70 focus:border-sky-dark"
                />
                <Button
                  size="sm"
                  onClick={() => void send(draft)}
                  disabled={busy || !draft.trim()}
                  className="mb-0.5 px-3.5 py-1.5 text-xs"
                >
                  {t('assistant.send')}
                </Button>
              </div>
              <p className="mt-1.5 font-body text-[10px] text-muted-ink">{t('assistant.footnote')}</p>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
