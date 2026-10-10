import type { ChangeEvent } from 'react'
import type { AccountParts, NameParts } from '../types'
import { Button } from './Button'
import { Field } from './Field'
import { NameFields } from './NameFields'
import { useT } from '../lib/i18n'

/** What every sign-up form ends with — name, phone, email and password —
 * plus its error line and submit button. Each page puts its own fields
 * (invite code, company, team) above. */
export function SignupFields({
  name,
  onNameChange,
  account,
  onAccountChange,
  withPhone = true,
  error,
  busy,
  disabled = false,
  submitLabel,
  busyLabel,
}: {
  name: NameParts
  onNameChange: (v: NameParts) => void
  account: AccountParts
  onAccountChange: (v: AccountParts) => void
  withPhone?: boolean
  error: string | null
  busy: boolean
  disabled?: boolean
  submitLabel?: string
  busyLabel?: string
}) {
  const t = useT()
  const set = (key: keyof AccountParts) => (e: ChangeEvent<HTMLInputElement>) =>
    onAccountChange({ ...account, [key]: e.target.value })

  return (
    <>
      <NameFields value={name} onChange={onNameChange} />
      {withPhone && (
        <Field
          label={t('auth.register.phone')}
          type="tel"
          autoComplete="tel"
          value={account.phone}
          onChange={set('phone')}
        />
      )}
      <Field
        label={t('auth.email')}
        type="email"
        autoComplete="email"
        required
        value={account.email}
        onChange={set('email')}
      />
      <Field
        label={t('auth.password')}
        type="password"
        autoComplete="new-password"
        required
        value={account.password}
        onChange={set('password')}
      />
      {error && <p className="mb-3 font-body text-xs font-bold text-coral-dark">{error}</p>}
      <Button type="submit" disabled={busy || disabled} className="w-full justify-center">
        {busy ? (busyLabel ?? t('auth.register.busy')) : (submitLabel ?? t('auth.register.button'))}
      </Button>
    </>
  )
}
