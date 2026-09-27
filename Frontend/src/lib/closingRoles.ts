import type { useT } from './i18n'

/** One badge/column tone per closing-duty role, cycling a fixed palette by
 * position — generalizes the old fixed 4-color map to however many closing
 * roles a store defines (see ResponsibilitiesEditor on the Stores page). */
const TONE_PALETTE = [
  'border-grape bg-grape/10 text-grape',
  'border-sky bg-sky/10 text-sky-dark',
  'border-orange bg-orange/10 text-ink',
  'border-green bg-green/10 text-green-dark',
  'border-coral bg-coral/10 text-coral-dark',
  'border-yellow bg-yellow/10 text-ink',
] as const
export const toneFor = (i: number) => TONE_PALETTE[i % TONE_PALETTE.length]!

/** The 4 roles migrated from the old fixed ClosingDuty columns keep their
 * translated labels (existing stores' Chinese-language users shouldn't see
 * these flip to English); anything a manager names themselves is rendered
 * verbatim since there's no way to translate free text they typed in. */
export function closingRoleLabel(t: ReturnType<typeof useT>, name: string): string {
  switch (name) {
    case 'Closing':
      return t('closing.role.closing')
    case 'Bathroom':
      return t('closing.role.bathroom')
    case 'Sweep':
      return t('closing.role.sweep')
    case 'Mop':
      return t('closing.role.mop')
    default:
      return name
  }
}
