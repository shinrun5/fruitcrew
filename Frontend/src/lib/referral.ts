// A student ambassador's code, remembered from their /r/CODE link so the
// business sign-up still credits them if the owner comes back later.
export const REF_KEY = 'fruitcrew.ref'
const KEEP_MS = 60 * 86_400_000

/** The code from an ambassador link opened in this browser in the last 60 days. */
export function rememberedReferral(): string | null {
  try {
    const raw = localStorage.getItem(REF_KEY)
    if (!raw) return null
    const { code, at } = JSON.parse(raw) as { code?: string; at?: number }
    return code && at && Date.now() - at < KEEP_MS ? code : null
  } catch {
    return null
  }
}
