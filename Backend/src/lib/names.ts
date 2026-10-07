// Sign-up asks for first, middle (optional) and last name separately; the rest
// of the app shows one display name, so they're joined into it here.
//   "Jamie" + "" + "Chen"         → "Jamie Chen"
//   "Ana" + "María" + "López Ruiz" → "Ana María López Ruiz"
//   "杰" + "" + "陈"               → "陈杰"  (East Asian script: family name first, no space)

export const NAME_REQUIRED = 'First and last name are required';

const part = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const EAST_ASIAN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;

/** The display name from a sign-up body's firstName / middleName / lastName,
 * or null when the first or last name is missing. An iPhone app built before
 * sign-up asked for the parts sends one `name` instead — still accepted, so a
 * build already installed or in App Review keeps working. */
export function fullNameFromBody(body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.firstName === undefined && b.lastName === undefined) return part(b.name) || null;
  const first = part(b.firstName);
  const middle = part(b.middleName);
  const last = part(b.lastName);
  if (!first || !last) return null;
  if (EAST_ASIAN.test(first + middle + last)) return last + middle + first;
  return [first, middle, last].filter(Boolean).join(' ');
}
