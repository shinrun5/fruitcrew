import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field } from '../components/Field'
import { MyFruitPicker } from '../components/FruitPicker'
import { PersonFieldsForm } from '../components/PersonFields'
import { Toggle } from '../components/Toggle'
import { ShieldIcon, StarBadgeIcon } from '../components/icons'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import type { Profile as ProfileData } from '../types'

export function Profile() {
  const t = useT()
  const { user, logout, refreshUser } = useAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      api
        .getProfile()
        .then(setProfile)
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your profile')),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])

  if (error && !profile) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!profile) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  const e = profile.employee
  const displayName = profile.name ?? e?.name ?? profile.email

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-24 sm:p-6 sm:pb-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('profile.title')}</h1>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-base font-extrabold text-ink">{displayName}</span>
          <span className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 font-body text-[10px] font-bold text-ink">
            {profile.role.toLowerCase()}
          </span>
          {e?.standby && (
            <span className="rounded-full border border-ink/25 px-1.5 py-px font-body text-[9px] font-bold text-muted-ink">
              {t('profile.onCall')}
            </span>
          )}
        </div>
        <p className="mt-0.5 font-body text-xs text-muted-ink">{profile.email}</p>
        {profile.phone && <p className="font-body text-xs text-muted-ink">{profile.phone}</p>}

        {e ? (
          <>
            <p className="mt-3 font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
              {t('profile.worksAt')}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {e.stores.length === 0 && (
                <span className="font-body text-xs text-coral-dark">{t('profile.noStore')}</span>
              )}
              {e.stores.map((s) => (
                <span
                  key={s.storeId}
                  className="flex items-center gap-1 rounded-full border-2 border-ink bg-cream px-2 py-0.5 font-body text-[11px] font-bold text-ink"
                >
                  {s.storeName} · {s.proficiency}
                  {s.canOpen && <StarBadgeIcon size={11} />}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-3 font-body text-xs text-muted-ink">
            {profile.role === 'EMPLOYEE'
              ? t('profile.notLinked')
              : 'Switch to Work view to add yourself to the schedule and pick up shifts.'}
          </p>
        )}
      </Card>

      {user?.isSuperAdmin && (
        <Card
          as={Link}
          to="/admin"
          clickable
          className="mt-4 flex items-center gap-2 font-heading text-sm font-bold text-ink"
        >
          <ShieldIcon size={18} />
          Admin console
        </Card>
      )}

      <EditDetails
        name={profile.name ?? e?.name ?? ''}
        phone={profile.phone ?? ''}
        onSaved={async () => {
          await load()
          await refreshUser()
        }}
        onError={setError}
      />

      <AlertPrefs
        isManager={profile.role !== 'EMPLOYEE'}
        alerts={profile.alerts}
        onSaved={load}
        onError={setError}
      />

      {e && (
        <Card className="mt-4">
          <MyFruitPicker />
        </Card>
      )}

      <ChangePassword onError={setError} />

      <DeleteAccount />

      <button
        onClick={() => void logout()}
        className="mt-4 w-full rounded-2xl border-[2.5px] border-ink bg-paper p-3 text-center font-heading text-sm font-bold text-coral-dark shadow-ink-card transition-colors duration-150 ease-out hover:bg-coral-bg"
      >
        {t('nav.logout')}
      </button>

      <p className="mt-4 text-center font-body text-xs text-muted-ink">
        <Link to="/terms" className="underline">
          Terms
        </Link>{' '}
        ·{' '}
        <Link to="/privacy" className="underline">
          Privacy
        </Link>
      </p>
    </div>
  )
}

function EditDetails({
  name,
  phone,
  onSaved,
  onError,
}: {
  name: string
  phone: string
  onSaved: () => void | Promise<void>
  onError: (m: string | null) => void
}) {
  const t = useT()
  const [n, setN] = useState(name)
  const [p, setP] = useState(phone)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const dirty = n.trim() !== name || p.trim() !== phone

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    onError(null)
    setDone(false)
    if (!n.trim()) return onError(t('profile.nameEmpty'))
    setBusy(true)
    try {
      await api.updateProfile({ name: n.trim(), phone: p.trim() })
      setDone(true)
      await onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save your details')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card as="form" onSubmit={submit} className="mt-4">
      <h2 className="font-heading text-sm font-bold text-ink">{t('profile.details')}</h2>
      <div className="mt-2 flex flex-col gap-2">
        <PersonFieldsForm name={n} onNameChange={setN} phone={p} onPhoneChange={setP} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
        {done && !dirty && <span className="font-body text-xs font-bold text-green">{t('common.saved')}</span>}
      </div>
    </Card>
  )
}

function AlertPrefs({
  isManager,
  alerts,
  onSaved,
  onError,
}: {
  isManager: boolean
  alerts: { availabilityUpdates: boolean; chatMessages: boolean; marketplacePosts: boolean; mentions: boolean }
  onSaved: () => void | Promise<void>
  onError: (m: string | null) => void
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [testMsg, setTestMsg] = useState('')

  async function save(patch: {
    availabilityUpdates?: boolean
    chatMessages?: boolean
    marketplacePosts?: boolean
    mentions?: boolean
  }) {
    onError(null)
    setBusy(true)
    try {
      await api.setAlerts(patch)
      await onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save your alert settings')
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    setTestState('sending')
    setTestMsg('')
    try {
      const r = await api.sendTestEmail()
      if (r.ok) {
        setTestState('sent')
        setTestMsg(t('profile.testEmail.sent', { to: r.sentTo }))
      } else {
        setTestState('failed')
        setTestMsg(r.error ?? 'Resend rejected it — check RESEND_API_KEY and EMAIL_FROM.')
      }
    } catch (err) {
      setTestState('failed')
      setTestMsg(err instanceof Error ? err.message : 'Request failed')
    }
  }

  return (
    <Card className="mt-4">
      <h2 className="font-heading text-sm font-bold text-ink">{t('profile.alerts')}</h2>
      {isManager && (
        <Toggle
          on={alerts.availabilityUpdates}
          busy={busy}
          className="mt-2"
          onClick={() => void save({ availabilityUpdates: !alerts.availabilityUpdates })}
          label={
            <>
              <b>{t('profile.alert.availability')}</b> — {t('profile.alert.availabilityHint')}
            </>
          }
        />
      )}
      <Toggle
        on={alerts.mentions}
        busy={busy}
        className="mt-2"
        onClick={() => void save({ mentions: !alerts.mentions })}
        label={
          <>
            <b>{t('profile.alert.mention')}</b> — {t('profile.alert.mentionHint')}
          </>
        }
      />
      <Toggle
        on={alerts.marketplacePosts}
        busy={busy}
        className="mt-2"
        onClick={() => void save({ marketplacePosts: !alerts.marketplacePosts })}
        label={
          <>
            <b>{t('profile.alert.marketplace')}</b> — {t('profile.alert.marketplaceHint')}
          </>
        }
      />
      <Toggle
        on={alerts.chatMessages}
        busy={busy}
        className="mt-2"
        onClick={() => void save({ chatMessages: !alerts.chatMessages })}
        label={
          <>
            <b>{t('profile.alert.chat')}</b> — {t('profile.alert.chatHint')}
          </>
        }
      />
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t-2 border-ink/10 pt-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={testState === 'sending'}
          onClick={() => void sendTest()}
        >
          {testState === 'sending' ? t('profile.testEmail.sending') : t('profile.testEmail')}
        </Button>
        {testMsg && (
          <span
            className={`font-body text-[11px] font-bold ${
              testState === 'sent' ? 'text-green-dark' : 'text-coral-dark'
            }`}
          >
            {testMsg}
          </span>
        )}
      </div>
    </Card>
  )
}

function ChangePassword({ onError }: { onError: (m: string | null) => void }) {
  const t = useT()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    onError(null)
    setDone(false)
    if (next.length < 8) return onError('New password must be at least 8 characters')
    if (next !== confirm) return onError("New passwords don't match")
    setBusy(true)
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not change your password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card as="form" onSubmit={submit} className="mt-4">
      <h2 className="font-heading text-sm font-bold text-ink">{t('profile.changePassword')}</h2>
      <div className="mt-2 flex flex-col gap-2">
        <Field
          type="password"
          autoComplete="current-password"
          placeholder={t('profile.currentPassword')}
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          type="password"
          autoComplete="new-password"
          placeholder={t('profile.newPassword')}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Field
          type="password"
          autoComplete="new-password"
          placeholder={t('profile.confirmPassword')}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? t('common.saving') : t('profile.updatePassword')}
        </Button>
        {done && <span className="font-body text-xs font-bold text-green">{t('profile.passwordUpdated')}</span>}
      </div>
    </Card>
  )
}

function DeleteAccount() {
  const { deleteAccount } = useAuth()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await deleteAccount(password)
      // deleteAccount clears the session; ProtectedRoute bounces to /login on its own
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account')
      setBusy(false)
    }
  }

  return (
    <Card className="mt-4 border-coral-dark/40">
      <h2 className="font-heading text-sm font-bold text-coral-dark">Delete my account</h2>
      {!open ? (
        <>
          <p className="mt-1 font-body text-xs text-muted-ink">
            Permanently deletes your login and personal info. This can't be undone.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 rounded-full border-2 border-coral-dark px-3 py-0.5 font-heading text-[11px] font-bold text-coral-dark transition-colors duration-150 ease-out hover:bg-coral-bg"
          >
            Delete my account
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-2">
          <p className="mb-2 font-body text-xs text-muted-ink">
            Enter your password to confirm. Your login and personal details are removed immediately
            and can't be recovered.
          </p>
          <Field
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <Button type="submit" size="sm" variant="alert" disabled={busy}>
              {busy ? 'Deleting…' : 'Permanently delete'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setOpen(false)
                setPassword('')
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
