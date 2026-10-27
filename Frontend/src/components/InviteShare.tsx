import { type FormEvent, useState } from 'react'
import { CopyButton } from './CopyButton'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { smsHref, workerInviteUrl } from '../lib/links'
import { useCopy } from '../lib/use-copy'

/** Getting a worker their sign-up link once they have a code: text it (their
 * messages app opens with it filled in), email it from here, or copy it to
 * send some other way. */
export function InviteShare({
  worker,
  storeName,
  showCopy = true,
  defaultEmail = '',
}: {
  worker: { id: number; name: string; phone: string | null; inviteCode: string }
  storeName: string
  /** off where the page already shows its own copy buttons */
  showCopy?: boolean
  defaultEmail?: string
}) {
  const t = useT()
  const { copiedKey, copy } = useCopy()
  const [email, setEmail] = useState(defaultEmail)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const link = workerInviteUrl(worker.inviteCode)
  const message = t('invite.message', { name: worker.name.split(' ')[0] ?? worker.name, store: storeName, link })

  async function sendEmail(e: FormEvent) {
    e.preventDefault()
    const to = email.trim()
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      await api.inviteWorker(worker.id, to)
      setSentTo(to)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workers.err.createInvite'))
    } finally {
      setBusy(false)
    }
  }

  const pill = 'rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold'
  return (
    <div className="flex flex-col gap-2 font-body text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {worker.phone && (
          <a href={smsHref(worker.phone, message)} className={`${pill} bg-green text-white`}>
            {t('invite.text')}
          </a>
        )}
        {showCopy && (
          <CopyButton
            copied={copiedKey === 'link'}
            onClick={() => copy('link', link)}
            label={t('workers.copySignupLink')}
            copiedLabel={t('workers.linkCopied')}
            tone="sky"
          />
        )}
      </div>
      <form onSubmit={sendEmail} className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('invite.emailPlaceholder')}
          aria-label={t('invite.emailPlaceholder')}
          className="min-w-0 flex-1 rounded-lg border-2 border-ink bg-cream px-2 py-1 text-xs text-ink outline-none sm:max-w-[16rem]"
        />
        <button type="submit" disabled={busy || !email.trim()} className={`${pill} bg-paper text-ink disabled:opacity-40`}>
          {busy ? t('invite.emailing') : t('invite.email')}
        </button>
      </form>
      {sentTo && <span className="font-bold text-green-dark">{t('invite.emailed', { email: sentTo })}</span>}
      {error && <span className="font-bold text-coral-dark">{error}</span>}
    </div>
  )
}
