// Display + link helpers for phone numbers. New numbers are stored as "+1…"
// (see Backend/src/lib/phone.ts), but older ones may be in any shape, so these
// accept both.

/** The 10 US/Canada digits, if this is a US/Canada number. */
function nanp(p: string): string | null {
  const digits = p.replace(/\D/g, '')
  if (digits.length === 10 && !p.trim().startsWith('+')) return digits
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return null
}

/** "(201) 683-8243" for US/Canada numbers; anything else as stored. */
export function formatPhone(p: string): string {
  const d = nanp(p)
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p.trim()
}

/** The +-form a dialer or texting app accepts everywhere. */
function dialable(p: string): string {
  const d = nanp(p)
  if (d) return `+1${d}`
  const digits = p.replace(/\D/g, '')
  return p.trim().startsWith('+') ? `+${digits}` : digits
}

export const telHref = (p: string) => `tel:${dialable(p)}`
export const smsHref = (p: string) => `sms:${dialable(p)}`
