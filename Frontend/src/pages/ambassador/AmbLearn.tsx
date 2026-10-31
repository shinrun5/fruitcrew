import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { AmbPage } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { AMB_LESSONS, money, percent } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { ambassadorReferralUrl, SUPPORT_EMAIL } from '../../lib/links'
import { priceOfStore } from '../../lib/pricing'
import type { AmbassadorMe, AmbLesson } from '../../types'

type TKey = Parameters<ReturnType<typeof useT>>[0]
type Vars = Record<string, string | number>

/** /ambassador/learn — what a student needs to answer an owner's questions on
 * the spot: short lessons, each ticked off once read (admins see how far
 * everyone got). Prices and rates come from the live settings, never typed in. */
export function AmbLearn() {
  const t = useT()
  const [me, setMe] = useState<AmbassadorMe | null>(null)
  const [done, setDone] = useState<AmbLesson[]>([])
  const [open, setOpen] = useState<AmbLesson | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getAmbassadorMe()
      .then((m) => {
        setMe(m)
        setDone(m.trainingDone)
        setOpen(AMB_LESSONS.find((l) => !m.trainingDone.includes(l)) ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  async function mark(lesson: AmbLesson, value: boolean) {
    setBusy(true)
    setError(null)
    try {
      const r = await api.setAmbassadorTraining(lesson, value)
      setDone(r.trainingDone)
      // on to the next one they haven't read
      if (value) setOpen(AMB_LESSONS.find((l) => !r.trainingDone.includes(l)) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!me) {
    return (
      <AmbPage title={t('ambLearn.title')}>
        <p className={`mt-3 font-body text-sm ${error ? 'font-bold text-coral-dark' : 'text-muted-ink'}`}>{error ?? t('common.loading')}</p>
      </AmbPage>
    )
  }

  const p = me.program
  const usd = (n: number) => `$${n}`
  const v: Vars = {
    name: me.ambassador.name.split(' ')[0] ?? me.ambassador.name,
    code: me.ambassador.code,
    link: ambassadorReferralUrl(me.ambassador.code),
    first: usd(priceOfStore(1)),
    second: usd(priceOfStore(2)),
    third: usd(priceOfStore(3)),
    floor: usd(priceOfStore(4)),
    addon: usd(2),
    bounty: money(p.bountyCents),
    rate: percent(p.rateBps),
    extra: percent(p.extraStoreRateBps),
    months: p.maxPaidPeriods,
    perMonth: money(p.perMonthCents),
    hold: p.holdDays,
    email: SUPPORT_EMAIL,
    dnc: t('ambPortal.outcome.DO_NOT_CONTACT'),
  }

  return (
    <AmbPage title={t('ambLearn.title')} sub={t('ambLearn.sub')}>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full border-2 border-ink bg-paper">
          <div className="h-full bg-green transition-[width] duration-300" style={{ width: `${(done.length / AMB_LESSONS.length) * 100}%` }} />
        </div>
        <span className="shrink-0 font-heading text-xs font-bold text-ink">{t('ambLearn.progress', { n: done.length, total: AMB_LESSONS.length })}</span>
      </div>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <div className="mt-3 flex flex-col gap-2">
        {AMB_LESSONS.map((id, i) => {
          const isDone = done.includes(id)
          const isOpen = open === id
          return (
            <Card key={id} padded={false} className={isDone ? 'border-green' : ''}>
              <button type="button" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[2.5px] border-ink font-heading text-sm font-bold ${isDone ? 'bg-green text-white' : 'bg-yellow text-ink'}`}
                >
                  {isDone ? '✓' : i + 1}
                </span>
                <span className="min-w-0 flex-1 font-heading text-sm font-bold text-ink">{t(`ambLearn.${id}.title`)}</span>
                <span aria-hidden className={`font-heading text-lg text-muted-ink transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                  ›
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-3 border-t-2 border-ink/10 px-3 pt-3 pb-3 font-body text-sm text-ink">
                  <Lesson id={id} v={v} />
                  {isDone ? (
                    <button type="button" disabled={busy} onClick={() => void mark(id, false)} className="self-start font-body text-xs font-bold text-muted-ink underline">
                      {t('ambLearn.undo')}
                    </button>
                  ) : (
                    <Button size="sm" disabled={busy} className="self-start" onClick={() => void mark(id, true)}>
                      {t('ambLearn.markDone')}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
      {done.length === AMB_LESSONS.length && (
        <p className="mt-3 rounded-xl border-2 border-green bg-green/10 px-3 py-2 font-body text-xs font-bold text-green-dark">{t('ambLearn.allDone')}</p>
      )}
    </AmbPage>
  )
}

function Heading({ children }: { children: string }) {
  return <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-muted-ink">{children}</h3>
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  )
}

function Lesson({ id, v }: { id: AmbLesson; v: Vars }) {
  const t = useT()
  const tt = (k: TKey) => t(k, v)
  switch (id) {
    case 'pitch':
      return (
        <>
          <p>{tt('ambLearn.pitch.intro')}</p>
          <Heading>{tt('ambLearn.pitch.scriptTitle')}</Heading>
          <p className="rounded-xl border-2 border-ink/15 bg-cream/60 px-3 py-2 italic">{tt('ambLearn.pitch.script')}</p>
          <Heading>{tt('ambLearn.pitch.fitTitle')}</Heading>
          <Bullets items={[tt('ambLearn.pitch.fit1'), tt('ambLearn.pitch.fit2'), tt('ambLearn.pitch.fit3')]} />
          <Heading>{tt('ambLearn.pitch.notFitTitle')}</Heading>
          <Bullets items={[tt('ambLearn.pitch.notFit1'), tt('ambLearn.pitch.notFit2')]} />
        </>
      )
    case 'start':
      return (
        <>
          <p>{tt('ambLearn.start.intro')}</p>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            {(['s1', 's2', 's3', 's4'] as const).map((k) => (
              <li key={k}>{tt(`ambLearn.start.${k}`)}</li>
            ))}
          </ol>
          <Heading>{tt('ambLearn.start.countsTitle')}</Heading>
          <p>{tt('ambLearn.start.counts')}</p>
          <p>
            {tt('ambLearn.start.flyer')}{' '}
            <Link to="/ambassador/flyer" className="font-bold text-sky-dark">
              {tt('ambFlyer.open')}
            </Link>
          </p>
          <p className="text-muted-ink">{tt('ambLearn.start.demo')}</p>
        </>
      )
    case 'weekly':
      return (
        <>
          <p>{tt('ambLearn.weekly.intro')}</p>
          <Bullets items={(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'] as const).map((k) => tt(`ambLearn.weekly.${k}`))} />
        </>
      )
    case 'pricing':
      return <Bullets items={(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const).map((k) => tt(`ambLearn.pricing.${k}`))} />
    case 'questions':
      return (
        <>
          <p>{tt('ambLearn.questions.intro')}</p>
          <dl className="flex flex-col gap-2.5">
            {(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11'] as const).map((k) => (
              <div key={k}>
                <dt className="font-bold">{tt(`ambLearn.questions.${k}.q`)}</dt>
                <dd className="mt-0.5">{tt(`ambLearn.questions.${k}.a`)}</dd>
              </div>
            ))}
          </dl>
        </>
      )
    case 'dosDonts':
      return (
        <>
          <Heading>{tt('ambLearn.dosDonts.doTitle')}</Heading>
          <Bullets items={(['do1', 'do2', 'do3', 'do4', 'do5', 'do6'] as const).map((k) => tt(`ambLearn.dosDonts.${k}`))} />
          <Heading>{tt('ambLearn.dosDonts.dontTitle')}</Heading>
          <Bullets items={(['dont1', 'dont2', 'dont3', 'dont4', 'dont5', 'dont6'] as const).map((k) => tt(`ambLearn.dosDonts.${k}`))} />
        </>
      )
    case 'pay':
      return (
        <>
          <p>{tt('ambLearn.pay.link')}</p>
          <p className="break-all rounded-xl border-2 border-ink/15 bg-cream/60 px-3 py-2 font-bold">{v.link}</p>
          <Bullets items={(['p1', 'p2', 'p3', 'p4', 'p5'] as const).map((k) => tt(`ambLearn.pay.${k}`))} />
          <Link to="/ambassador/rules" className="font-bold text-sky-dark">
            {tt('ambLearn.pay.rules')}
          </Link>
        </>
      )
  }
}
