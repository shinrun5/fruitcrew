import { useState } from 'react'

/** Tracks which of possibly several copy targets on a page was last copied,
 * clearing itself after a beat — the "copied!" flash next to invite
 * links/codes. `key` distinguishes multiple copy buttons sharing one hook
 * instance (e.g. one row per pending invite). */
export function useCopy(resetMs = 1500) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  function copy(key: string, text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopiedKey(key)
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), resetMs)
      },
      () => {},
    )
  }

  return { copiedKey, copy }
}
