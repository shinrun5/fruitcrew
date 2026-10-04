// One stored shape for phone numbers, so call/text links work everywhere: a
// carrier rejected "12016838243" (11 digits, no +) when texted directly.
//   "+86 138 1234 5678" → "+8613812345678"  (a + means it's already international)
//   "(201) 683-8243"    → "+12016838243"    (10 digits: US/Canada)
//   "1-201-683-8243"    → "+12016838243"    (11 digits with the leading 1: US/Canada)
// Anything else is kept as typed — no guessing a country for it.
// Twin of Frontend/src/lib/phone.ts (which formats for display).

export function normalizePhone(raw: string): string {
  const s = raw.trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return s;
}
