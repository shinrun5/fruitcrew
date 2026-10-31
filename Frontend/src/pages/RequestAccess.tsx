import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { Button } from '../components/Button'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { rememberedReferral } from '../lib/referral'

/** Public "bring Fruit Crew to my shop" form. Doesn't create an account — it
 * lands in the superadmin's approval queue (Admin → Pending Signups), which
 * is what actually creates the Org and emails an owner invite link. A student
 * ambassador's link (/r/CODE, which lands here as ?ref=CODE) fills in their code. */
export function RequestAccess() {
  const t = useT()
  const [params] = useSearchParams()
  const [address, setAddress] = useState('')
  const [website, setWebsite] = useState('')
  // an ambassador's code: from their link (or one opened here before), or typed in
  const [linkCode] = useState(() => (params.get('ref') ?? '').toUpperCase() || rememberedReferral() || '')
  const [referralCode, setReferralCode] = useState(linkCode)
  const fromLink = !!linkCode
  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.requestAccess({
        businessName: businessName.trim(),
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        message: message.trim() || undefined,
        address: address.trim(),
        website: website.trim() || undefined,
        referralCode: referralCode.trim() || undefined,
        // credited as a link sign-up only if the code wasn't changed by hand
        ...(fromLink && referralCode.trim().toUpperCase() === linkCode ? { referralVia: 'link' as const } : {}),
      })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestAccess.err'))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title={t('requestAccess.sentTitle')}
        subtitle={t('requestAccess.sentSubtitle')}
        footer={
          <Link to="/login" className="font-bold text-ink underline">
            {t('requestAccess.backToLogin')}
          </Link>
        }
      >
        <p className="font-body text-sm text-muted-ink">
          {t('requestAccess.sentBody', { email: email.trim() })}
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t('requestAccess.title')}
      subtitle={t('requestAccess.subtitle')}
      footer={
        <>
          {t('requestAccess.haveAccount')}{' '}
          <Link to="/login" className="font-bold text-ink underline">
            {t('requestAccess.logIn')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label={t('requestAccess.businessName')}
          required
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />
        <Field label={t('requestAccess.yourName')} required value={contactName} onChange={(e) => setContactName(e.target.value)} />
        <Field
          label={t('requestAccess.email')}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label={t('requestAccess.phone')}
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Field
          label={t('requestAccess.address')}
          placeholder={t('requestAccess.addressPlaceholder')}
          autoComplete="street-address"
          required
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <Field
          label={t('requestAccess.website')}
          placeholder={t('requestAccess.websitePlaceholder')}
          inputMode="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
        <Field
          label={fromLink ? t('requestAccess.referralFromLink') : t('requestAccess.referral')}
          autoCapitalize="characters"
          value={referralCode}
          onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
        />
        <label className="mb-3 block">
          <span className="mb-1 block font-body text-xs font-bold text-muted-ink">
            {t('requestAccess.message')}
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-xl border-[2.5px] border-ink bg-cream px-3 py-2 font-body text-sm text-ink outline-none transition-colors focus:bg-paper"
          />
        </label>
        {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? t('requestAccess.sending') : t('requestAccess.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
