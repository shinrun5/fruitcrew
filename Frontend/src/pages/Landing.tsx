import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { FruitAvatar } from '../components/FruitAvatar'
import { LANGS, useI18n, useT } from '../lib/i18n'
import { priceOfStore } from '../lib/pricing'
import { rememberedReferral } from '../lib/referral'

/** The public page at / for anyone signed out on the website (the iOS/Android
 * app goes straight to /login instead — no prices in the app). Its one action
 * is the request-access form; it also points students to /ambassadors. */
export function Landing() {
  const t = useT()
  const [params] = useSearchParams()
  // an ambassador's code, from their link or one opened here before
  const code = (params.get('ref') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || rememberedReferral() || ''
  const usd = (n: number) => `$${n}`

  return (
    <div className="min-h-dvh bg-cream">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(3rem+env(safe-area-inset-bottom))] sm:px-8">
        <header className="flex items-center gap-2.5">
          <FruitAvatar kind="apple" size={36} />
          <span className="font-heading text-lg font-extrabold text-ink">Fruit Crew</span>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSelect />
            <Link to="/login" className="font-body text-xs font-bold text-sky-dark">
              {t('landing.signIn')}
            </Link>
          </div>
        </header>

        <section className="flex flex-col items-start gap-3">
          <h1 className="text-balance font-heading text-3xl font-extrabold leading-tight text-ink sm:text-5xl">
            {t('landing.hero.title')}
          </h1>
          <p className="font-body text-base text-ink sm:text-lg">{t('landing.hero.sub')}</p>
          <StartButton code={code} />
          <p className="font-body text-xs font-semibold text-muted-ink">{t('landing.trial')}</p>
          {code && <p className="font-body text-xs text-muted-ink">{t('landing.refNote', { code })}</p>}
        </section>

        <Section title={t('landing.problem.title')}>
          <div className="flex flex-col gap-2">
            {(['pain1', 'pain2', 'pain3'] as const).map((k) => (
              <Card key={k} className="font-body text-sm text-ink">
                <b>{t(`landing.${k}.bold`)}</b> {t(`landing.${k}.text`)}
              </Card>
            ))}
          </div>
        </Section>

        <Section title={t('landing.solution.title')}>
          <div className="grid gap-3 sm:grid-cols-3">
            {(['benefit1', 'benefit2', 'benefit3'] as const).map((k, i) => (
              <Card key={k} className="flex flex-col gap-2">
                <FruitAvatar kind={(['mango', 'strawberry', 'lemon'] as const)[i]} size={32} />
                <h3 className="font-heading text-base font-bold text-ink">{t(`landing.${k}.title`)}</h3>
                <p className="font-body text-sm text-ink">{t(`landing.${k}.text`)}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section title={t('landing.how.title')}>
          <ol className="flex flex-col gap-3">
            {(['how1', 'how2', 'how3', 'how4'] as const).map((k, i) => (
              <li key={k} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[2.5px] border-ink bg-yellow font-heading text-sm font-bold text-ink">
                  {i + 1}
                </span>
                <p className="font-body text-sm text-ink">
                  <b>{t(`landing.${k}.title`)}</b> {t(`landing.${k}.text`)}
                </p>
              </li>
            ))}
          </ol>
        </Section>

        <Card className="flex flex-col gap-3 border-green">
          <h2 className="font-heading text-xl font-extrabold text-ink">{t('landing.price.title')}</h2>
          <p className="font-body text-sm text-ink">
            {t('landing.price.body', {
              first: usd(priceOfStore(1)),
              second: usd(priceOfStore(2)),
              third: usd(priceOfStore(3)),
              floor: usd(priceOfStore(4)),
            })}
          </p>
          <h3 className="font-heading text-base font-bold text-ink">{t('landing.addons.title')}</h3>
          <p className="font-body text-sm text-ink">{t('landing.addons.body', { price: usd(2) })}</p>
          <p className="font-body text-sm font-bold text-green-dark">{t('landing.worth')}</p>
          <p className="font-body text-[11px] text-muted-ink">{t('landing.compare')}</p>
        </Card>

        <Section title={t('landing.faq.title')}>
          <div className="flex flex-col gap-2">
            {(['faq1', 'faq2', 'faq3', 'faq4', 'faq5'] as const).map((k) => (
              <Card key={k} as="details" className="group">
                <summary className="cursor-pointer list-none font-heading text-sm font-bold text-ink">
                  <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
                  {t(`landing.${k}.q`)}
                </summary>
                <p className="mt-2 font-body text-sm text-ink">{t(`landing.${k}.a`)}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Card className="flex items-start gap-3 border-grape">
          <FruitAvatar kind="grape" size={36} />
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-base font-bold text-ink">{t('landing.amb.title')}</h2>
            <p className="font-body text-sm text-ink">{t('landing.amb.text')}</p>
            <Link to="/ambassadors" className="font-body text-sm font-bold text-sky-dark underline">
              {t('landing.amb.link')}
            </Link>
          </div>
        </Card>

        <section className="flex flex-col items-center gap-3 text-center">
          <h2 className="text-balance font-heading text-2xl font-extrabold text-ink">{t('landing.final.title')}</h2>
          <StartButton code={code} />
          <p className="font-body text-xs font-semibold text-muted-ink">{t('landing.trial')}</p>
        </section>

        <footer className="flex flex-col items-center gap-2 border-t-2 border-ink/10 pt-6 text-center font-body text-xs text-muted-ink">
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1 font-bold">
            <Link to="/login">{t('landing.signIn')}</Link>
            <Link to="/ambassadors">{t('landing.footer.ambassadors')}</Link>
            <Link to="/terms">{t('profile.terms')}</Link>
            <Link to="/privacy">{t('auth.privacyPolicy')}</Link>
          </nav>
          <p>{t('landing.footer.company')}</p>
        </footer>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-balance font-heading text-2xl font-extrabold text-ink">{title}</h2>
      {children}
    </section>
  )
}

function StartButton({ code }: { code: string }) {
  const t = useT()
  return (
    <Link to={code ? `/request-access?${new URLSearchParams({ ref: code })}` : '/request-access'} className="mt-1">
      <Button>{t('landing.cta')}</Button>
    </Link>
  )
}

function LanguageSelect() {
  const { lang, setLang, t } = useI18n()
  return (
    <select
      aria-label={t('landing.language')}
      value={lang}
      onChange={(e) => setLang(e.target.value as typeof lang)}
      className="rounded-full border-2 border-ink/30 bg-paper px-2 py-1 font-heading text-xs font-bold text-ink"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
