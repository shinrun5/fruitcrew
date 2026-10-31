import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { FruitAvatar } from '../../components/FruitAvatar'
import { AmbPage } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { LANGS, translate, useT, type Lang } from '../../lib/i18n'
import { ambassadorReferralUrl } from '../../lib/links'
import { priceOfStore } from '../../lib/pricing'
import type { AmbassadorMe } from '../../types'

type TKey = Parameters<typeof translate>[1]

// letter paper, the flyer filling it; nothing else of the app on the page
const PRINT_PAGE = '@media print { @page { size: letter; margin: 0.5in } }'

/** /ambassador/flyer — a one-page leave-behind for the businesses a student
 * visits: what FruitCrew does, the price, and a QR code to their own link (so
 * a sign-up from it is credited to them). One page per language picked; print
 * two-sided for English on one side and Chinese on the other. */
export function AmbFlyer() {
  const t = useT()
  const [me, setMe] = useState<AmbassadorMe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [langs, setLangs] = useState<Lang[]>(['en', 'zh'])

  useEffect(() => {
    api.getAmbassadorMe().then(setMe).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  const link = me ? ambassadorReferralUrl(me.ambassador.code) : ''
  useEffect(() => {
    if (!link) return
    let live = true
    QRCode.toDataURL(link, { margin: 1, width: 480, color: { dark: '#3A2B4D', light: '#FFFFFF' } })
      .then((url) => live && setQr(url))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [link])

  if (!me) {
    return (
      <AmbPage title={t('ambFlyer.title')}>
        <p className={`mt-3 font-body text-sm ${error ? 'font-bold text-coral-dark' : 'text-muted-ink'}`}>{error ?? t('common.loading')}</p>
      </AmbPage>
    )
  }
  const toggle = (l: Lang) => setLangs((x) => (x.includes(l) ? x.filter((y) => y !== l) : LANGS.map((y) => y.code).filter((y) => y === l || x.includes(y))))
  const name = me.ambassador.name.split(' ')[0] ?? me.ambassador.name

  return (
    <AmbPage title={t('ambFlyer.title')} sub={t('ambFlyer.hint')}>
      <style>{PRINT_PAGE}</style>
      <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
        <span className="font-body text-xs font-bold text-ink">{t('ambFlyer.langs')}</span>
        {LANGS.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => toggle(l.code)}
            aria-pressed={langs.includes(l.code)}
            className={`rounded-full border-2 px-3 py-1 font-heading text-xs font-bold ${langs.includes(l.code) ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'}`}
          >
            {l.label}
          </button>
        ))}
        <Button size="sm" className="ml-auto" disabled={!langs.length || !qr} onClick={() => window.print()}>
          {t('ambFlyer.print')}
        </Button>
      </div>
      <p className="mt-1 font-body text-[11px] text-muted-ink print:hidden">{t('ambFlyer.langsHint')}</p>

      <div className="mt-3 flex flex-col gap-4 print:mt-0 print:gap-0">
        {langs.map((l) => (
          <Card key={l} className="print:break-after-page print:border-0 print:shadow-none">
            <Flyer lang={l} qr={qr} link={link} code={me.ambassador.code} name={name} />
          </Card>
        ))}
      </div>
    </AmbPage>
  )
}

function Flyer({ lang, qr, link, code, name }: { lang: Lang; qr: string | null; link: string; code: string; name: string }) {
  const tl = (k: TKey, v?: Record<string, string | number>) => translate(lang, k, v)
  return (
    <div lang={lang} className="flex flex-col gap-4 text-ink">
      <div className="flex items-center gap-2.5">
        <FruitAvatar kind="apple" size={40} />
        <span className="font-heading text-xl font-extrabold">Fruit Crew</span>
      </div>
      <h2 className="text-balance font-heading text-2xl font-extrabold leading-tight sm:text-3xl print:text-4xl">{tl('landing.hero.title')}</h2>
      <p className="font-body text-sm sm:text-base print:text-lg">{tl('landing.hero.sub')}</p>
      <ul className="flex flex-col gap-2 font-body text-sm sm:text-base print:text-lg">
        {(['b1', 'b2', 'b3', 'b4'] as const).map((k) => (
          <li key={k} className="flex gap-2">
            <span className="font-heading font-extrabold text-green-dark">✓</span>
            <span>{tl(`ambFlyer.${k}`)}</span>
          </li>
        ))}
      </ul>
      <p className="rounded-xl border-2 border-green bg-green/10 px-3 py-2 font-body text-sm font-bold sm:text-base print:text-lg">
        {tl('ambFlyer.price', { first: `$${priceOfStore(1)}` })}
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center print:flex-row">
        {qr ? (
          <img src={qr} alt="" className="h-40 w-40 shrink-0 rounded-lg border-2 border-ink/15 print:h-52 print:w-52" />
        ) : (
          <div className="h-40 w-40 shrink-0 rounded-lg border-2 border-dashed border-ink/20" />
        )}
        <div className="flex min-w-0 flex-col gap-1 font-body text-sm print:text-base">
          <span className="font-bold">{tl('ambFlyer.scan')}</span>
          <span className="break-all text-sky-dark">{link}</span>
          <span>{tl('ambFlyer.code', { code })}</span>
          <span>{tl('ambFlyer.contact', { name })}</span>
        </div>
      </div>
      <p className="font-body text-[11px] text-muted-ink">{tl('landing.footer.company')}</p>
    </div>
  )
}
