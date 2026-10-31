import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { REF_KEY } from '../lib/referral'

/** /r/CODE — a student ambassador's link. Remember whose it was (so the
 * credit survives a business wandering off and coming back), then open the
 * business sign-up with the code filled in. */
export function ReferralLink() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  useEffect(() => {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
    if (clean) {
      try {
        localStorage.setItem(REF_KEY, JSON.stringify({ code: clean, at: Date.now() }))
      } catch {
        /* private mode — the link's ?ref still carries it */
      }
    }
    navigate(`/request-access?${new URLSearchParams({ ref: clean })}`, { replace: true })
  }, [code, navigate])
  return null
}
