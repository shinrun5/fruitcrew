import { useI18n } from '../lib/i18n'

/** One small button that flips the language — shows the language you'd switch TO.
 * A single button (not a segmented EN | 中文 pair) so it never crowds the top bar
 * on a narrow phone. */
export function LangToggle() {
  const { lang, setLang, t } = useI18n()
  const next = lang === 'en' ? 'zh' : 'en'
  return (
    <button
      onClick={() => setLang(next)}
      aria-label={next === 'zh' ? t('lang.ariaSwitchToZh') : t('lang.ariaSwitchToEn')}
      className="shrink-0 whitespace-nowrap rounded-full border-2 border-ink bg-paper px-2.5 py-1 font-heading text-[11px] font-bold text-ink"
    >
      {/* intentionally not run through t() — this always shows the target
       * language's own name (e.g. "中文" even while the UI itself is in
       * English), not something that varies with the current language */}
      {next === 'zh' ? '中文' : 'EN'}
    </button>
  )
}
