import type { ChangeEvent } from 'react'
import { Field } from './Field'
import { useI18n, useT } from '../lib/i18n'
import type { NameParts } from '../types'

/** First, middle (optional) and last name — what every sign-up form asks for.
 * Chinese writes the family name first, so its 姓 box leads there. */
export function NameFields({ value, onChange }: { value: NameParts; onChange: (v: NameParts) => void }) {
  const t = useT()
  const { lang } = useI18n()
  const set = (key: keyof NameParts) => (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: e.target.value })

  const first = (
    <Field
      key="first"
      label={t('auth.name.first')}
      required
      autoComplete="given-name"
      value={value.firstName}
      onChange={set('firstName')}
    />
  )
  const middle = (
    <Field
      key="middle"
      label={t('auth.name.middle')}
      autoComplete="additional-name"
      value={value.middleName}
      onChange={set('middleName')}
    />
  )
  const last = (
    <Field
      key="last"
      label={t('auth.name.last')}
      required
      autoComplete="family-name"
      value={value.lastName}
      onChange={set('lastName')}
    />
  )
  return <>{lang === 'zh' ? [last, first, middle] : [first, middle, last]}</>
}
