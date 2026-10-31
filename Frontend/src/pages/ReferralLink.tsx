import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { REF_KEY } from '../lib/referral'

/** /r/CODE — a student ambassador's link (and their flyer's QR code). Remember
 * whose it was (so the credit survives a business wandering off and coming
 * back), then load the public landing page (public/landing.html, served at /
 * by the server): its landing.js puts the code on every sign-up button. */
export function ReferralLink() {
  const { code = '' } = useParams()
  useEffect(() => {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
    if (clean) {
      try {
        localStorage.setItem(REF_KEY, JSON.stringify({ code: clean, at: Date.now() }))
      } catch {
        /* private mode — the link's ?ref still carries it */
      }
    }
    window.location.replace(clean ? `/?${new URLSearchParams({ ref: clean })}` : '/')
  }, [code])
  return null
}
