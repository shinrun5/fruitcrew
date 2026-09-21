import { Field } from './Field'

/** Name + phone fields, shared between self-service (Profile) and
 * manager-side (Workers) editors — same markup, two different forms/
 * endpoints/permission scopes wrapping it. */
export function PersonFieldsForm({
  name,
  onNameChange,
  phone,
  onPhoneChange,
  size,
}: {
  name: string
  onNameChange: (v: string) => void
  phone: string
  onPhoneChange: (v: string) => void
  size?: 'md' | 'sm'
}) {
  return (
    <>
      <Field label="Name" required value={name} onChange={(e) => onNameChange(e.target.value)} size={size} />
      <Field
        label="Phone"
        type="tel"
        autoComplete="tel"
        value={phone}
        onChange={(e) => onPhoneChange(e.target.value)}
        size={size}
      />
    </>
  )
}

/** Max days/week + max hours/week fields, shared between self-service
 * (Availability) and manager-side (Workers) editors. */
export function ShiftLimitsFields({
  maxShifts,
  onMaxShiftsChange,
  hourLimit,
  onHourLimitChange,
  size,
}: {
  maxShifts: string | number
  onMaxShiftsChange: (v: string) => void
  hourLimit: string | number
  onHourLimitChange: (v: string) => void
  size?: 'md' | 'sm'
}) {
  return (
    <>
      <Field
        label="Max days"
        type="number"
        inputMode="numeric"
        min={1}
        max={7}
        value={maxShifts}
        onChange={(e) => onMaxShiftsChange(e.target.value)}
        size={size}
      />
      <Field
        label="Max hours/wk"
        type="number"
        inputMode="numeric"
        min={1}
        max={80}
        value={hourLimit}
        onChange={(e) => onHourLimitChange(e.target.value)}
        size={size}
      />
    </>
  )
}
