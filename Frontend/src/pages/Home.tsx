import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../components/Card'
import { FruitAvatar } from '../components/FruitAvatar'
import { GettingStarted } from '../components/GettingStarted'
import { CalendarIcon, ChecklistIcon, NoteIcon, PeopleIcon, StoreIcon, SwapIcon, WarningIcon } from '../components/icons'
import { api } from '../lib/api'
import { fruitForPerson } from '../lib/fruit'
import { money } from '../lib/pay'
import { useT } from '../lib/i18n'
import { useStore } from '../lib/store-context'
import { clockToMin, durationLabel, relativeTime, to12Hour, weekRangeLabel } from '../lib/time'
import type { HomeData } from '../types'
import { useRefreshOnReturn } from '../lib/use-refresh-on-return'

type Tone = 'act' | 'info'
interface Row {
  key: string
  icon: ReactNode
  text: string
  tone: Tone
  go: () => void
}

/** A manager's landing screen: everything waiting on them first, then how
 * each store's week looks. Every row goes straight to where it's handled. */
export function Home() {
  const t = useT()
  const [data, setData] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { setStoreId } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    api
      .getHome()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : t('home.err.load')))
  }, [t])
  useRefreshOnReturn(() => api.getHome().then(setData))

  if (error) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!data) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  const openStore = (storeId: number, path = '/schedule') => {
    setStoreId(storeId)
    navigate(path)
  }
  const plural = (n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0], vars = {}) =>
    t(n === 1 ? one : many, { n, ...vars })

  const a = data.attention
  const rows: Row[] = []
  if (a.approvals)
    rows.push({
      key: 'approvals',
      icon: <SwapIcon size={18} />,
      text: plural(a.approvals, 'home.row.approvals.one', 'home.row.approvals'),
      tone: 'act',
      go: () => navigate('/requests'),
    })
  if (a.signups)
    rows.push({
      key: 'signups',
      icon: <PeopleIcon size={18} />,
      text: plural(a.signups, 'home.row.signups.one', 'home.row.signups'),
      tone: 'act',
      go: () => navigate('/team'),
    })
  for (const d of a.draftsReady)
    rows.push({
      key: `draft-${d.storeId}`,
      icon: <CalendarIcon size={18} />,
      text: t('home.row.draftReady', { store: d.name }),
      tone: 'act',
      go: () => openStore(d.storeId),
    })
  if (a.gaps) {
    const worst = [...data.stores].sort((x, y) => y.gapCount - x.gapCount)[0]
    rows.push({
      key: 'gaps',
      icon: <WarningIcon size={18} />,
      text: plural(a.gaps, 'home.row.gaps.one', 'home.row.gaps'),
      tone: 'act',
      go: () => (worst ? openStore(worst.storeId) : navigate('/schedule')),
    })
  }
  for (const s of a.needsSetup)
    rows.push({
      key: `setup-${s.storeId}`,
      icon: <StoreIcon size={18} />,
      text: t('home.row.needsSetup', { store: s.name }),
      tone: 'act',
      go: () => navigate('/settings'),
    })
  if (a.timeOff)
    rows.push({
      key: 'timeoff',
      icon: <ChecklistIcon size={18} />,
      text: plural(a.timeOff, 'home.row.timeOff.one', 'home.row.timeOff'),
      tone: 'info',
      go: () => navigate('/requests'),
    })
  if (a.availability.total > 0 && a.availability.answered < a.availability.total)
    rows.push({
      key: 'availability',
      icon: <CalendarIcon size={18} />,
      text: t('home.row.availability', {
        n: a.availability.answered,
        total: a.availability.total,
        range: weekRangeLabel(a.availability.weekStart),
      }),
      tone: 'info',
      go: () => navigate('/schedule'),
    })
  if (a.openNotes)
    rows.push({
      key: 'notes',
      icon: <NoteIcon size={18} />,
      text: plural(a.openNotes, 'home.row.notes.one', 'home.row.notes'),
      tone: 'info',
      go: () => navigate('/notes'),
    })

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('home.title')}</h1>

      <GettingStarted setup={data.setup} />

      {/* with no store yet there's nothing to report — the checklist is the page */}
      {data.setup.hasStore && (
        <>
          <h2 className="mt-4 font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
            {t('home.attention')}
          </h2>
          {rows.length === 0 ? (
            <Card className="mt-2 flex items-center gap-3">
              <FruitAvatar kind="banana" size={40} />
              <div>
                <p className="font-heading text-sm font-bold text-ink">{t('home.allClear.title')}</p>
                <p className="font-body text-xs text-muted-ink">{t('home.allClear.body')}</p>
              </div>
            </Card>
          ) : (
            <Card padded={false} className="mt-2 overflow-hidden">
              <ul className="divide-y-2 divide-ink/10">
                {rows.map((r) => (
                  <li key={r.key}>
                    <button
                      onClick={r.go}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out hover:bg-cream active:bg-cream"
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${
                          r.tone === 'act'
                            ? 'border-coral bg-coral-bg text-coral-dark'
                            : 'border-ink/20 bg-cream text-muted-ink'
                        }`}
                      >
                        {r.icon}
                      </span>
                      <span className="min-w-0 flex-1 font-body text-sm font-semibold text-ink">{r.text}</span>
                      <span aria-hidden className="font-heading text-lg text-muted-ink">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Today today={data.today} multiStore={data.stores.length > 1} />

          <h2 className="mt-6 font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
            {t('home.thisWeek')}
          </h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {data.stores.map((s) => (
              <Card key={s.storeId} clickable onClick={() => openStore(s.storeId)} className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-heading text-base font-extrabold text-ink">{s.name}</span>
                  {s.draftReady ? (
                    <span className="shrink-0 rounded-full border-2 border-orange bg-orange/10 px-2 py-0.5 font-body text-[10px] font-bold text-ink">
                      {t('home.draftNotPosted')}
                    </span>
                  ) : s.publishedAt ? (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full border-2 border-green bg-paper px-2 py-0.5 font-body text-[10px] font-bold text-ink">
                      <span className="h-1.5 w-1.5 rounded-full bg-green" />
                      {t('overview.posted', {
                        ago: relativeTime(s.publishedAt),
                      })}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border-2 border-ink/25 px-2 py-0.5 font-body text-[10px] font-bold text-muted-ink">
                      {t('overview.notPosted')}
                    </span>
                  )}
                </div>
                {s.weekStart && (
                  <span className="font-body text-[11px] text-muted-ink">
                    {t('overview.weekOf', {
                      range: weekRangeLabel(s.weekStart),
                    })}
                  </span>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-body text-xs">
                  <Stat
                    label={t('overview.stat.scheduled')}
                    value={plural(s.shiftCount, 'overview.shiftCount.one', 'overview.shiftCount')}
                  />
                  <Stat label={t('overview.stat.staffHours')} value={durationLabel(s.staffMinutes)} />
                  {s.requirementCount === 0 ? (
                    <Stat label={t('overview.stat.setup')} value={t('overview.noShiftNeeds')} tone="warn" />
                  ) : s.gapCount > 0 ? (
                    <Stat
                      label={t('overview.stat.coverage')}
                      value={t('overview.short', { n: s.gapCount })}
                      tone="warn"
                    />
                  ) : s.shiftCount > 0 ? (
                    <Stat label={t('overview.stat.coverage')} value={t('overview.full')} tone="ok" />
                  ) : null}
                  {s.openShifts > 0 && <Stat label={t('overview.stat.open')} value={`${s.openShifts}`} tone="warn" />}
                  {s.laborCents !== undefined && s.staffMinutes > 0 && (
                    <Stat
                      label={t('overview.stat.labor')}
                      value={
                        (s.unratedCount ?? 0) > 0
                          ? t('overview.laborPartial', { cost: money(s.laborCents), n: s.unratedCount ?? 0 })
                          : money(s.laborCents)
                      }
                    />
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Who's on the floor right now and who's still coming in today, by the
 * stores' clock — the first thing a manager checks when something comes up. */
function Today({ today, multiStore }: { today: HomeData['today']; multiStore: boolean }) {
  const t = useT()
  const now = today.nowMinute
  const onNow = today.shifts.filter((s) => clockToMin(s.start) <= now && now < clockToMin(s.end))
  const later = today.shifts.filter((s) => clockToMin(s.start) > now)
  const done = today.shifts.length - onNow.length - later.length
  const date = new Date(`${today.date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const row = (s: HomeData['today']['shifts'][number], when: string) => (
    <li key={`${s.employeeId}-${s.storeId}-${s.start}`} className="flex items-center gap-2.5 px-4 py-2">
      <FruitAvatar kind={fruitForPerson({ employeeId: s.employeeId, avatarFruit: s.avatarFruit })} size={24} />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="font-body text-sm font-semibold text-ink">{s.name}</span>
        {s.section && (
          <span className="rounded-full border border-grape bg-grape/15 px-1.5 py-px font-body text-[9px] font-bold text-ink">
            {s.section}
          </span>
        )}
        {multiStore && <span className="w-full font-body text-[11px] text-muted-ink">{s.storeName}</span>}
      </span>
      <span className="shrink-0 font-body text-[11px] font-semibold text-muted-ink">{when}</span>
    </li>
  )
  const heading = (text: string) => (
    <li className="bg-cream px-4 py-1 font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">{text}</li>
  )
  return (
    <>
      <h2 className="mt-6 font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
        {t('home.today', { date })}
      </h2>
      {today.shifts.length === 0 ? (
        <Card className="mt-2 font-body text-xs text-muted-ink">{t('home.today.nobody')}</Card>
      ) : (
        <Card padded={false} className="mt-2 overflow-hidden">
          <ul className="divide-y-2 divide-ink/10">
            {heading(t('home.today.onNow', { n: onNow.length }))}
            {onNow.length === 0 ? (
              <li className="px-4 py-2 font-body text-xs text-muted-ink">{t('home.today.nobodyNow')}</li>
            ) : (
              onNow.map((s) => row(s, t('home.today.until', { time: to12Hour(s.end) })))
            )}
            {later.length > 0 && heading(t('home.today.later', { n: later.length }))}
            {later.map((s) => row(s, `${to12Hour(s.start)}–${to12Hour(s.end)}`))}
            {done > 0 && (
              <li className="px-4 py-1.5 font-body text-[11px] text-muted-ink">
                {t(done === 1 ? 'home.today.done.one' : 'home.today.done', { n: done })}
              </li>
            )}
          </ul>
        </Card>
      )}
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  const color = tone === 'warn' ? 'text-coral-dark' : tone === 'ok' ? 'text-green' : 'text-ink'
  return (
    <span>
      <b className={`font-bold ${color}`}>{value}</b> <span className="text-muted-ink">{label}</span>
    </span>
  )
}
