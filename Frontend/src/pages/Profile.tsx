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
import { useI18n, useT, type Lang } from '../lib/i18n'
import type { Profile as ProfileData, PushTopic } from '../types'
import { formatPhone } from '../lib/phone'
import { AppleSignInButton } from '../components/AppleSignInButton'
import { DeleteAccount } from '../components/DeleteAccount'
import { appleNativeAvailable } from '../lib/appleSignIn'
import { isNativeApp } from '../lib/pricing'

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
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
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
        {profile.phone && <p className="font-body text-xs text-muted-ink">{formatPhone(profile.phone)}</p>}

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
            {e.hireDate && (
              <p className="mt-2 font-body text-xs text-muted-ink">
                {t('profile.since', {
                  date: new Date(`${e.hireDate}T00:00:00Z`).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  }),
                })}
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 font-body text-xs text-muted-ink">
            {profile.role === 'EMPLOYEE' ? t('profile.notLinked') : t('profile.switchToWorkView')}
          </p>
        )}
      </Card>

      <LanguageSection />

      {user?.isSuperAdmin && (
        <Card
          as={Link}
          to="/admin"
          clickable
          className="mt-4 flex items-center gap-2 font-heading text-sm font-bold text-ink"
        >
          <ShieldIcon size={18} />
          {t('profile.adminConsole')}
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

      <PushPrefs isManager={profile.role !== 'EMPLOYEE'} muted={profile.pushMuted} onSaved={load} onError={setError} />

      {e && (
        <Card className="mt-4">
          <MyFruitPicker />
        </Card>
      )}

      <AppleSignInCard onError={setError} />
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
          {t('profile.terms')}
        </Link>{' '}
        ·{' '}
        <Link to="/privacy" className="underline">
          {t('profile.privacy')}
        </Link>
      </p>
    </div>
  )
}

// Each language's own name for itself, shown regardless of the current UI
// language (so "English" is always spelled "English", not translated) — add
// a row here for any future language rather than anywhere else.
const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
]

function LanguageSection() {
  const { lang, setLang, t } = useI18n()
  return (
    <Card className="mt-4">
      <p className="font-heading text-sm font-bold text-ink">{t('lang.switch')}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {LANGS.map((l) => (
          <button
            key={l.code}
            onClick={() => setLang(l.code)}
            aria-pressed={lang === l.code}
            className={`rounded-full border-2 px-3 py-1 font-heading text-xs font-bold ${
              lang === l.code ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </Card>
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
  const [p, setP] = useState(formatPhone(phone))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const dirty = n.trim() !== name || p.trim() !== formatPhone(phone)

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

type TKey = Parameters<ReturnType<typeof useT>>[0]

/** Which kinds of notification buzz the phone (Fruit Crew iPhone/Android app).
 * Off just skips the push — it still shows under the bell. */
function PushPrefs({
  isManager,
  muted,
  onSaved,
  onError,
}: {
  isManager: boolean
  muted: PushTopic[]
  onSaved: () => void | Promise<void>
  onError: (m: string | null) => void
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const topics: { key: PushTopic; label: TKey; hint: TKey }[] = [
    { key: 'schedule', label: 'profile.push.schedule', hint: 'profile.push.scheduleHint' },
    { key: 'reminders', label: 'profile.push.reminders', hint: 'profile.push.remindersHint' },
    { key: 'openShifts', label: 'profile.push.openShifts', hint: 'profile.push.openShiftsHint' },
    { key: 'chat', label: 'profile.push.chat', hint: 'profile.push.chatHint' },
    ...(isManager
      ? [{ key: 'approvals' as const, label: 'profile.push.approvals' as const, hint: 'profile.push.approvalsHint' as const }]
      : []),
  ]

  async function toggle(key: PushTopic) {
    onError(null)
    setBusy(true)
    try {
      await api.setAlerts({ pushMuted: muted.includes(key) ? muted.filter((k) => k !== key) : [...muted, key] })
      await onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : t('profile.push.err'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-4">
      <h2 className="font-heading text-sm font-bold text-ink">{t('profile.push')}</h2>
      <p className="mt-0.5 font-body text-[11px] text-muted-ink">{t('profile.push.intro')}</p>
      {topics.map((tp) => (
        <Toggle
          key={tp.key}
          on={!muted.includes(tp.key)}
          busy={busy}
          className="mt-2"
          onClick={() => void toggle(tp.key)}
          label={
            <>
              <b>{t(tp.label)}</b> — {t(tp.hint)}
            </>
          }
        />
      ))}
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

/** Connect Sign in with Apple to this login — for anyone who'd rather use
 * Face ID than a password, and the only way in for someone who picked "Hide
 * My Email" (their Apple relay address matches no account on its own). Only
 * where Apple sign-in exists: the iPhone app, and the website once it's set up. */
function AppleSignInCard({ onError }: { onError: (m: string | null) => void }) {
  const t = useT()
  const { user, refreshUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const available = appleNativeAvailable() || (!isNativeApp() && !!import.meta.env.VITE_APPLE_CLIENT_ID)
  if (!available || !user) return null

  return (
    <Card className="mt-4">
      <h2 className="font-heading text-sm font-bold text-ink">{t('profile.apple.title')}</h2>
      {user.appleLinked ? (
        <p className="mt-1 font-body text-xs text-green-dark">✓ {t('profile.apple.connected')}</p>
      ) : (
        <>
          <p className="mt-0.5 font-body text-[11px] text-muted-ink">{t('profile.apple.hint')}</p>
          <div className={`mt-2 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            <AppleSignInButton
              label={t('profile.apple.connect')}
              onToken={(r) => {
                onError(null)
                setBusy(true)
                api
                  .linkApple({ idToken: r.idToken, nonce: r.nonce, authorizationCode: r.authorizationCode })
                  .then(() => refreshUser())
                  .catch((e) => onError(e instanceof Error ? e.message : t('profile.apple.err')))
                  .finally(() => setBusy(false))
              }}
            />
          </div>
        </>
      )}
    </Card>
  )
}

function ChangePassword({ onError }: { onError: (m: string | null) => void }) {
  const t = useT()
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [linkSent, setLinkSent] = useState(false)

  // signed up with Google/Apple only: no current password to type, so set a
  // first one by email instead (also what lets them into the phone app,
  // which has no Google button)
  if (user && user.hasPassword === false) {
    return (
      <Card className="mt-4">
        <h2 className="font-heading text-sm font-bold text-ink">{t('profile.setPassword.title')}</h2>
        <p className="mt-0.5 font-body text-[11px] text-muted-ink">{t('profile.setPassword.hint')}</p>
        {linkSent ? (
          <p className="mt-2 font-body text-xs font-bold text-green-dark">{t('profile.setPassword.sent', { email: user.email })}</p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={busy}
            onClick={() => {
              onError(null)
              setBusy(true)
              api
                .forgotPassword(user.email)
                .then(() => setLinkSent(true))
                .catch((e) => onError(e instanceof Error ? e.message : t('auth.forgot.err')))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? t('auth.forgot.sending') : t('profile.setPassword.send')}
          </Button>
        )}
      </Card>
    )
  }

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
