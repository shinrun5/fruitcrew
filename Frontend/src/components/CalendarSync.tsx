import { useState } from 'react'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useI18n, useT } from '../lib/i18n'
import { useCopy } from '../lib/use-copy'
import { CalendarIcon } from './icons'
import { Modal } from './Modal'

const btn =
  'flex w-full items-center justify-between gap-2 rounded-xl border-2 border-ink bg-paper px-3 py-2 text-left font-heading text-sm font-bold text-ink shadow-[2px_2px_0_var(--color-ink)] transition-transform active:translate-x-px active:translate-y-px'

/** "Add my shifts to my calendar": one private link that Apple, Google or
 * Outlook Calendar subscribe to, so posted shifts appear there and keep up
 * with changes. Included in every plan. */
export function CalendarSync() {
  const t = useT()
  const { lang } = useI18n()
  const confirm = useConfirm()
  const { copiedKey, copy } = useCopy()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function show() {
    setOpen(true)
    setError(null)
    if (url) return
    try {
      setUrl((await api.getCalendarLink()).url)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('calendar.err'))
    }
  }

  async function reset() {
    if (!(await confirm(t('calendar.resetConfirm'), { tone: 'danger', confirmLabel: t('calendar.reset') }))) return
    setBusy(true)
    try {
      setUrl((await api.resetCalendarLink()).url)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('calendar.err'))
    } finally {
      setBusy(false)
    }
  }

  // the feed speaks the app's language (event titles, calendar name)
  const httpsUrl = url ? `${url}?lang=${lang}` : null
  const webcal = httpsUrl?.replace(/^https?:/, 'webcal:') ?? null
  const links = httpsUrl
    ? [
        { key: 'apple', label: t('calendar.apple'), href: webcal! },
        { key: 'google', label: t('calendar.google'), href: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal!)}` },
        {
          key: 'outlook',
          label: t('calendar.outlook'),
          href: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}&name=${encodeURIComponent(t('calendar.calName'))}`,
        },
      ]
    : []

  return (
    <>
      <button
        onClick={() => void show()}
        className="flex shrink-0 items-center gap-1.5 rounded-full border-2 border-ink bg-paper px-2.5 py-1 font-heading text-xs font-bold text-ink shadow-[2px_2px_0_var(--color-ink)]"
      >
        <CalendarIcon size={14} />
        {t('calendar.button')}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} className="max-w-sm">
        <h2 className="font-heading text-base font-extrabold text-ink">{t('calendar.title')}</h2>
        <p className="mt-1 font-body text-xs text-muted-ink">{t('calendar.body')}</p>
        {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
        {!httpsUrl && !error && <p className="mt-3 font-body text-xs text-muted-ink">{t('common.loading')}</p>}
        {httpsUrl && (
          <>
            <div className="mt-3 flex flex-col gap-2">
              {links.map((l) => (
                <a key={l.key} href={l.href} target={l.key === 'apple' ? undefined : '_blank'} rel="noreferrer" className={btn}>
                  {l.label}
                  <span aria-hidden>›</span>
                </a>
              ))}
              <button onClick={() => copy('cal', httpsUrl)} className={btn}>
                {copiedKey === 'cal' ? t('calendar.copied') : t('calendar.copy')}
                <span aria-hidden>⧉</span>
              </button>
            </div>
            <p className="mt-3 font-body text-[11px] text-muted-ink">{t('calendar.note')}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                disabled={busy}
                onClick={() => void reset()}
                className="font-body text-[11px] font-bold text-muted-ink underline disabled:opacity-50"
              >
                {t('calendar.reset')}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full border-2 border-ink bg-ink px-3 py-1 font-heading text-xs font-bold text-white"
              >
                {t('calendar.done')}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
