import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Field } from '../components/Field'
import { Button } from '../components/Button'
import { api } from '../lib/api'

/** Public, no-login-required "delete my account" path. If you can log in,
 * Profile → Delete my account is instant; this is for anyone who'd rather
 * not (or can't) — it lands in the superadmin's queue (Admin → Pending
 * Deletions) instead of deleting anything itself. */
export function DeleteAccountRequest() {
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.requestAccountDeletion({ email: email.trim(), reason: reason.trim() || undefined })
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
        title="Request received"
        subtitle="We'll delete your account and its data shortly."
        footer={
          <Link to="/login" className="font-bold text-ink underline">
            Back to login
          </Link>
        }
      >
        <p className="font-body text-sm text-muted-ink">
          If {email.trim()} matches an account, it'll be deleted. No further action needed.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Delete your account"
      subtitle="Already logged in? Profile → Delete my account is instant. Otherwise, use this."
      footer={
        <Link to="/login" className="font-bold text-ink underline">
          Back to login
        </Link>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Account email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="mb-3 block">
          <span className="mb-1 block font-body text-xs font-bold text-muted-ink">Why? (optional)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-xl border-[2.5px] border-ink bg-cream px-3 py-2 font-body text-sm text-ink outline-none transition-colors focus:bg-paper"
          />
        </label>
        {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'Sending…' : 'Request deletion'}
        </Button>
      </form>
    </AuthLayout>
  )
}
