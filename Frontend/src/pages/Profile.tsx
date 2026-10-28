import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field } from '../components/Field'
import { FruitAvatar } from '../components/FruitAvatar'
import { MyFruitPicker } from '../components/FruitPicker'
import { PersonFieldsForm } from '../components/PersonFields'
import { Disclosure } from '../components/Disclosure'
import { Toggle, ToggleGroup } from '../components/Toggle'
import { TIER_LABEL_KEY } from '../components/WorkerEditors'
import {
  BellIcon,
  GlobeIcon,
  LockIcon,
  ShieldIcon,
  StarBadgeIcon,
  TrashIcon,
  UserIcon,
} from '../components/icons'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT, type Lang } from '../lib/i18n'
import type { Profile as ProfileData, PushTopic } from '../types'
import { formatPhone } from '../lib/phone'
import { fruitForPerson } from '../lib/fruit'
import { AppleSignInButton } from '../components/AppleSignInButton'
import { DeleteAccount } from '../components/DeleteAccount'
import { appleNativeAvailable } from '../lib/appleSignIn'
import { isNativeApp } from '../lib/pricing'

const ROLE_KEY: Partial<Record<string, 'admin.role.owner' | 'admin.role.manager' | 'admin.role.employee'>> = {
  OWNER: 'admin.role.owner',
  MANAGER: 'admin.role.manager',
  EMPLOYEE: 'admin.role.employee',
}

type Part = 'details' | 'lang' | 'alerts' | 'fruit' | 'apple' | 'password' | 'delete'

/** Your account: who you are and where you work up top, then each setting as
 * a row that folds open — details, language, notifications, fruit, sign-in —
 * so the whole page fits on a phone screen until you open one. */
export function Profile() {
  const t = useT()
  const { user, logout, refreshUser } = useAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Part | null>(null)
  const { lang } = useI18n()
  // your fruit, for its row's icon (undefined until read; null = the default one)
  const [myFruit, setMyFruit] = useState<string | null | undefined>(undefined)

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
  const hasEmployee = !!profile?.employee
  useEffect(() => {
    if (!hasEmployee) return
    api
      .getMyFruit()
      .then((r) => setMyFruit(r.mine))
      .catch(() => {})
  }, [hasEmployee])

  if (error && !profile) return <div className="p-6 font-body text-sm text-coral-dark">{error}</div>
  if (!profile) return <div className="p-6 font-body text-sm text-muted-ink">{t('common.loading')}</div>

  const e = profile.employee
  const displayName = profile.name ?? e?.name ?? profile.email
  const isManager = profile.role !== 'EMPLOYEE'
  const emailOn = [
    ...(isManager ? [profile.alerts.availabilityUpdates] : []),
    profile.alerts.mentions,
    profile.alerts.marketplacePosts,
    profile.alerts.chatMessages,
  ]
  const pushTopics = pushTopicsFor(isManager).map((tp) => tp.key)
  const appleAvailable = appleNativeAvailable() || (!isNativeApp() && !!import.meta.env.VITE_APPLE_CLIENT_ID)
  // one part open at a time, so the page stays a short list
  const fold = (p: Part) => ({ open: open === p, onToggle: () => setOpen(open === p ? null : p) })

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
      <h1 className="font-heading text-lg font-bold text-ink">{t('profile.title')}</h1>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-base font-extrabold text-ink">{displayName}</span>
          <span className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 font-body text-[10px] font-bold text-ink">
            {t(ROLE_KEY[profile.role] ?? 'admin.role.employee')}
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
                  {s.storeName} · {t(TIER_LABEL_KEY[s.proficiency])}
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

      <Card padded={false} className="mt-4 overflow-hidden">
        <Disclosure
          icon={<UserIcon size={20} />}
          title={t('profile.details')}
          summary={[displayName, profile.phone && formatPhone(profile.phone)].filter(Boolean).join(' · ')}
          {...fold('details')}
        >
          <EditDetails
            name={profile.name ?? e?.name ?? ''}
            phone={profile.phone ?? ''}
            onSaved={async () => {
              await load()
              await refreshUser()
            }}
            onError={setError}
          />
        </Disclosure>
        <Disclosure
          icon={<GlobeIcon size={20} />}
          title={t('lang.switch')}
          summary={LANGS.find((l) => l.code === lang)?.label}
          {...fold('lang')}
        >
          <LanguagePicker />
        </Disclosure>
        <Disclosure
          icon={<BellIcon size={20} />}
          title={t('profile.notifications')}
          summary={t('profile.notif.summary', {
            email: emailOn.filter(Boolean).length,
            emailOf: emailOn.length,
            push: pushTopics.filter((k) => !profile.pushMuted.includes(k)).length,
            pushOf: pushTopics.length,
          })}
          {...fold('alerts')}
        >
          <AlertPrefs isManager={isManager} alerts={profile.alerts} onSaved={load} onError={setError} />
          <PushPrefs isManager={isManager} muted={profile.pushMuted} onSaved={load} onError={setError} />
        </Disclosure>
        {e && (
          <Disclosure
            icon={<FruitAvatar kind={fruitForPerson({ employeeId: e.id, avatarFruit: myFruit })} size={24} />}
            title={t('fruitPicker.title')}
            summary={t('profile.fruit.summary')}
            {...fold('fruit')}
          >
            <MyFruitPicker titled={false} onPicked={setMyFruit} />
          </Disclosure>
        )}
        {appleAvailable && user && (
          <Disclosure
            icon={<StarBadgeIcon size={20} />}
            title={t('profile.apple.title')}
            summary={user.appleLinked ? t('profile.apple.connected') : t('profile.apple.hint')}
            {...fold('apple')}
          >
            <AppleSignIn onError={setError} />
          </Disclosure>
        )}
        <Disclosure
          icon={<LockIcon size={20} />}
          title={user?.hasPassword === false ? t('profile.setPassword.title') : t('profile.changePassword')}
          {...fold('password')}
        >
          <ChangePassword onError={setError} />
        </Disclosure>
      </Card>

      {error && profile && <p className="mt-3 font-body text-xs font-bold text-coral-dark">{error}</p>}

      <button
        onClick={() => void logout()}
        className="mt-4 w-full rounded-2xl border-[2.5px] border-ink bg-paper p-3 text-center font-heading text-sm font-bold text-coral-dark shadow-ink-card transition-colors duration-150 ease-out hover:bg-coral-bg"
      >
        {t('nav.logout')}
      </button>

      <Card padded={false} className="mt-4 overflow-hidden">
        <Disclosure
          danger
          icon={<TrashIcon size={20} />}
          title={t('profile.delete.title')}
          summary={t('profile.delete.warning')}
          {...fold('delete')}
        >
          <DeleteAccount bare />
        </Disclosure>
      </Card>

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

function LanguagePicker() {
  const { lang, setLang } = useI18n()
  return (
    <div className="flex flex-wrap gap-1.5">
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
    <form onSubmit={submit}>
      <div className="flex flex-col gap-2">
        <PersonFieldsForm name={n} onNameChange={setN} phone={p} onPhoneChange={setP} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || !dirty}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
        {done && !dirty && <span className="font-body text-xs font-bold text-green">{t('common.saved')}</span>}
      </div>
    </form>
  )
}

type TKey = Parameters<ReturnType<typeof useT>>[0]

function pushTopicsFor(isManager: boolean): { key: PushTopic; label: TKey; hint: TKey }[] {
  return [
    { key: 'schedule', label: 'profile.push.schedule', hint: 'profile.push.scheduleHint' },
    { key: 'reminders', label: 'profile.push.reminders', hint: 'profile.push.remindersHint' },
    { key: 'openShifts', label: 'profile.push.openShifts', hint: 'profile.push.openShiftsHint' },
    { key: 'chat', label: 'profile.push.chat', hint: 'profile.push.chatHint' },
    ...(isManager ? [{ key: 'approvals' as const, label: 'profile.push.approvals' as const, hint: 'profile.push.approvalsHint' as const }] : []),
  ]
}

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
  const topics = pushTopicsFor(isManager)

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
    <div className="mt-5">
      <h3 className="font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">{t('profile.push')}</h3>
      <p className="mt-0.5 font-body text-[11px] text-muted-ink">{t('profile.push.intro')}</p>
      <ToggleGroup className="mt-2">
        {topics.map((tp) => (
          <Toggle
            key={tp.key}
            plain
            on={!muted.includes(tp.key)}
            busy={busy}
            onClick={() => void toggle(tp.key)}
            label={t(tp.label)}
            hint={t(tp.hint)}
          />
        ))}
      </ToggleGroup>
    </div>
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
    <div>
      <h3 className="font-body text-[11px] font-bold uppercase tracking-wide text-muted-ink">
        {t('profile.notif.email')}
      </h3>
      <ToggleGroup className="mt-2">
        {isManager && (
          <Toggle
            plain
            on={alerts.availabilityUpdates}
            busy={busy}
            onClick={() => void save({ availabilityUpdates: !alerts.availabilityUpdates })}
            label={t('profile.alert.availability')}
            hint={t('profile.alert.availabilityHint')}
          />
        )}
        <Toggle
          plain
          on={alerts.mentions}
          busy={busy}
          onClick={() => void save({ mentions: !alerts.mentions })}
          label={t('profile.alert.mention')}
          hint={t('profile.alert.mentionHint')}
        />
        <Toggle
          plain
          on={alerts.marketplacePosts}
          busy={busy}
          onClick={() => void save({ marketplacePosts: !alerts.marketplacePosts })}
          label={t('profile.alert.marketplace')}
          hint={t('profile.alert.marketplaceHint')}
        />
        <Toggle
          plain
          on={alerts.chatMessages}
          busy={busy}
          onClick={() => void save({ chatMessages: !alerts.chatMessages })}
          label={t('profile.alert.chat')}
          hint={t('profile.alert.chatHint')}
        />
      </ToggleGroup>
      <div className="mt-2 flex flex-wrap items-center gap-2">
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
    </div>
  )
}

/** Connect Sign in with Apple to this login — for anyone who'd rather use
 * Face ID than a password, and the only way in for someone who picked "Hide
 * My Email" (their Apple relay address matches no account on its own). Only
 * where Apple sign-in exists: the iPhone app, and the website once it's set up. */
function AppleSignIn({ onError }: { onError: (m: string | null) => void }) {
  const t = useT()
  const { user, refreshUser } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!user) return null

  return (
    <div>
      {user.appleLinked ? (
        <p className="font-body text-xs text-green-dark">✓ {t('profile.apple.connected')}</p>
      ) : (
        <>
          <p className="font-body text-[11px] text-muted-ink">{t('profile.apple.hint')}</p>
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
    </div>
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
      <div>
        <p className="font-body text-[11px] text-muted-ink">{t('profile.setPassword.hint')}</p>
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
      </div>
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
    <form onSubmit={submit}>
      <div className="flex flex-col gap-2">
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
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t('common.saving') : t('profile.updatePassword')}
        </Button>
        {done && <span className="font-body text-xs font-bold text-green">{t('profile.passwordUpdated')}</span>}
      </div>
    </form>
  )
}
