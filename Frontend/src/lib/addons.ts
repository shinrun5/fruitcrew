import { useAuth } from './auth'

// Twin of Backend/src/lib/addons.ts: features a business turns on separately,
// $2/month each, once it's paying. The server decides who has what; this just
// mirrors /auth/me's `addons` so the app hides what's switched off.
export const ADDONS = ['chat', 'notes', 'closing'] as const
export type AddonKey = (typeof ADDONS)[number]

/** Whether the signed-in user's business has this add-on. An older /auth/me
 * without the field means everything's on (the server still enforces it). */
export function useAddon(key: AddonKey): boolean {
  const { user } = useAuth()
  return !user?.addons || user.addons.includes(key)
}
