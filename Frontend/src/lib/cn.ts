/** Joins class names, skipping falsy values — no dependency needed for
 * something this small. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
