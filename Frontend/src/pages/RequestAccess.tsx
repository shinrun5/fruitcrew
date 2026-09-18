import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout, Field } from '../components/AuthLayout'
import { Button } from '../components/Button'
import { api } from '../lib/api'

/** Public "bring Fruit Crew to my shop" form. Doesn't create an account — it
 * lands in the superadmin's approval queue (Admin → Pending Signups), which
 * is what actually creates the Org and emails an owner invite link. */
export function RequestAccess() {
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
      })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your request')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Request sent"
        subtitle="Thanks — we'll be in touch soon."
        footer={
          <Link to="/login" className="font-bold text-ink underline">
            Back to login
          </Link>
        }
      >
        <p className="font-body text-sm text-muted-ink">
          We'll email {email.trim()} once your account is ready.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Bring your shop to Fruit Crew"
      subtitle="Tell us about your business — we'll set you up."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-ink underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Business name"
          required
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />
        <Field label="Your name" required value={contactName} onChange={(e) => setContactName(e.target.value)} />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Phone (optional)"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <label className="mb-3 block">
          <span className="mb-1 block font-body text-xs font-bold text-muted-ink">
            Anything else? (optional)
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
          {busy ? 'Sending…' : 'Request access'}
        </Button>
      </form>
    </AuthLayout>
  )
}
