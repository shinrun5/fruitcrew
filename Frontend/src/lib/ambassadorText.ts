import { useT } from './i18n'
import { shortDate } from './time'
import type { AmbassadorStatus, AmbassadorWarning, AmbLesson, BusinessStage, CommissionState, ContactMethod, ContactOutcome, LeadStatus } from '../types'

type TKey = Parameters<ReturnType<typeof useT>>[0]

/** "$8", "$2.10", "−$2" — whole dollars without the ".00". */
export function money(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(cents)
  const s = abs % 100 === 0 ? `$${(abs / 100).toLocaleString('en-US')}` : `$${(abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return neg ? `−${s}` : s
}

/** Twin of Backend/src/lib/ambassadors.ts TRAINING_LESSONS — the Learn tab, in order. */
export const AMB_LESSONS: readonly AmbLesson[] = ['pitch', 'start', 'weekly', 'pricing', 'questions', 'dosDonts', 'pay']

/** 2500 basis points → "25%". */
export const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`

/** What a warning means, in a sentence. */
export function useWarningText() {
  const t = useT()
  return (w: AmbassadorWarning) =>
    w.code === 'duplicate'
      ? t('ambAdmin.warn.duplicate', { name: w.name, date: shortDate(w.since) })
      : w.code === 'otherClaim'
        ? t('ambAdmin.warn.otherClaim', { name: w.name })
        : t(`ambAdmin.warn.${w.code}` as TKey)
}

/** The words for statuses, outcomes and the like, in the reader's language. */
export function useAmbLabels() {
  const t = useT()
  return {
    lead: (s: LeadStatus) => t(`ambPortal.lead.${s}` as TKey),
    stage: (s: BusinessStage) => t(`ambPortal.stage.${s}` as TKey),
    state: (s: CommissionState) => t(`ambPortal.state.${s}` as TKey),
    method: (m: ContactMethod) => t(`ambPortal.method.${m}` as TKey),
    outcome: (o: ContactOutcome) => t(`ambPortal.outcome.${o}` as TKey),
  }
}

export const LEAD_TONE: Record<LeadStatus, string> = {
  available: 'border-green bg-green/10 text-green-dark',
  claimedByYou: 'border-sky-dark bg-sky/10 text-sky-dark',
  claimed: 'border-ink/25 bg-cream text-muted-ink',
  contacted: 'border-ink/25 bg-cream text-muted-ink',
  interested: 'border-yellow bg-yellow/10 text-ink',
  followUp: 'border-orange bg-orange/10 text-ink',
  trial: 'border-grape bg-grape/10 text-grape',
  customer: 'border-grape bg-grape/10 text-grape',
  declined: 'border-ink/25 bg-cream text-muted-ink',
  doNotContact: 'border-coral bg-coral-bg text-coral-dark',
}

export const STAGE_TONE: Record<BusinessStage, string> = {
  requested: 'border-ink/25 bg-cream text-muted-ink',
  declined: 'border-coral bg-coral-bg text-coral-dark',
  notCredited: 'border-coral bg-coral-bg text-coral-dark',
  closed: 'border-ink/25 bg-cream text-muted-ink',
  trial: 'border-sky-dark bg-sky/10 text-sky-dark',
  paying: 'border-green bg-green/10 text-green-dark',
  canceled: 'border-ink/25 bg-cream text-muted-ink',
}

export const AMB_STATUS_TONE: Record<AmbassadorStatus, string> = {
  ACTIVE: 'border-green bg-green/10 text-green-dark',
  SUSPENDED: 'border-yellow bg-yellow/10 text-ink',
  DEACTIVATED: 'border-ink/25 bg-cream text-muted-ink',
}

export const STATE_TONE: Record<CommissionState, string> = {
  pending: 'border-yellow bg-yellow/10 text-ink',
  held: 'border-sky-dark bg-sky/10 text-sky-dark',
  payable: 'border-green bg-green/10 text-green-dark',
  sending: 'border-green bg-green/10 text-green-dark',
  paid: 'border-green bg-green text-white',
  rejected: 'border-coral bg-coral-bg text-coral-dark',
  reversed: 'border-coral bg-coral-bg text-coral-dark',
}
