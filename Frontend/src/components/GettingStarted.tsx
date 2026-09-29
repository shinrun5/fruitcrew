import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card } from './Card'
import { useT } from '../lib/i18n'
import type { HomeData } from '../types'

type SetupKey = keyof HomeData['setup']
type TKey = Parameters<ReturnType<typeof useT>>[0]

/** The steps from a brand-new business to its first posted schedule, in
 * order. Shared by the Home checklist and the Getting started section of the
 * guide, so the two never drift apart. */
export const SETUP_STEPS: { key: SetupKey; title: TKey; body: TKey; to: string; optional?: boolean }[] = [
  { key: 'hasStore', title: 'setup.store.title', body: 'setup.store.body', to: '/settings' },
  { key: 'hasShiftNeeds', title: 'setup.needs.title', body: 'setup.needs.body', to: '/settings' },
  { key: 'hasTeam', title: 'setup.team.title', body: 'setup.team.body', to: '/team' },
  { key: 'teamOnApp', title: 'setup.app.title', body: 'setup.app.body', to: '/team', optional: true },
  { key: 'generated', title: 'setup.generate.title', body: 'setup.generate.body', to: '/schedule' },
  { key: 'posted', title: 'setup.post.title', body: 'setup.post.body', to: '/schedule' },
]

const HIDE_KEY = 'fruitcrew.setupHidden'

/** A checklist on Home that walks a new owner or manager from an empty
 * account to a posted schedule. Each step ticks itself off from real data;
 * the next one to do is opened up with a button straight to it. Goes away on
 * its own once every required step is done, or when they hide it. */
export function GettingStarted({ setup }: { setup: HomeData['setup'] }) {
  const t = useT()
  const navigate = useNavigate()
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1'
    } catch {
      return false
    }
  })

  // finished once every required step is — the optional one never holds it open
  if (hidden || SETUP_STEPS.every((s) => s.optional || setup[s.key])) return null
  const doneCount = SETUP_STEPS.filter((s) => setup[s.key]).length
  // the first unfinished step (optional ones included — they're still next in line)
  const next = SETUP_STEPS.find((s) => !setup[s.key])

  function hide() {
    try {
      localStorage.setItem(HIDE_KEY, '1')
    } catch {
      /* ignore */
    }
    setHidden(true)
  }

  return (
    <Card className="mt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-extrabold text-ink">{t('setup.title')}</h2>
          <p className="font-body text-xs text-muted-ink">
            {t('setup.progress', { n: doneCount, total: SETUP_STEPS.length })}
          </p>
        </div>
        {/* only offered once they're under way — a brand-new account needs it */}
        {setup.hasStore && (
          <button onClick={hide} className="shrink-0 font-body text-xs font-bold text-muted-ink hover:text-ink">
            {t('setup.hide')}
          </button>
        )}
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full border-2 border-ink bg-cream">
        <div
          className="h-full bg-green transition-[width] duration-300 ease-out"
          style={{ width: `${(doneCount / SETUP_STEPS.length) * 100}%` }}
        />
      </div>

      <ol className="mt-3 flex flex-col gap-1">
        {SETUP_STEPS.map((s, i) => {
          const done = setup[s.key]
          const isNext = s === next
          return (
            <li
              key={s.key}
              className={`rounded-xl px-2 py-2 ${isNext ? 'border-2 border-ink bg-cream' : ''}`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 font-heading text-[11px] font-bold ${
                    done ? 'border-green bg-green text-white' : isNext ? 'border-ink bg-paper text-ink' : 'border-ink/25 text-muted-ink'
                  }`}
                  aria-hidden
                >
                  {done ? '✓' : i + 1}
                </span>
                <span
                  className={`min-w-0 flex-1 font-body text-sm font-semibold ${
                    done ? 'text-muted-ink line-through' : 'text-ink'
                  }`}
                >
                  {t(s.title)}
                  {s.optional && (
                    <span className="ml-1.5 rounded-full border border-ink/25 px-1.5 py-px align-middle font-body text-[9px] font-bold uppercase tracking-wide text-muted-ink no-underline">
                      {t('setup.optional')}
                    </span>
                  )}
                </span>
                {!done && !isNext && (
                  <button
                    onClick={() => navigate(s.to)}
                    aria-label={t(s.title)}
                    className="shrink-0 px-1 font-heading text-lg text-muted-ink hover:text-ink"
                  >
                    ›
                  </button>
                )}
              </div>
              {isNext && (
                <div className="mt-1.5 pl-[34px]">
                  <p className="font-body text-xs text-muted-ink">{t(s.body)}</p>
                  <button
                    onClick={() => navigate(s.to)}
                    className="mt-2 rounded-full border-2 border-ink bg-green px-3 py-1 font-heading text-xs font-bold text-white shadow-[2px_2px_0_var(--color-ink)]"
                  >
                    {t('setup.go')}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <Link to="/help" className="mt-3 inline-block font-body text-xs font-bold text-sky-dark">
        {t('setup.guideLink')}
      </Link>
    </Card>
  )
}
