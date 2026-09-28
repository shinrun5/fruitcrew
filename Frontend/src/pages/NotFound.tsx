import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { FruitAvatar } from '../components/FruitAvatar'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'

/** Catch-all for any path that doesn't match a route — a themed page instead
 * of a silent redirect, with a "take me home" link that's smart about where
 * that is (the caller's own dashboard if logged in, /login otherwise). */
export function NotFound() {
  const t = useT()
  const { user, loading } = useAuth()
  const home = !loading && user ? homePathForRole(user) : '/login'

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-cream p-6 text-center">
      <FruitAvatar kind="lemon" size={72} />
      <p className="font-heading text-5xl font-extrabold text-ink">404</p>
      <h1 className="font-heading text-lg font-bold text-ink">{t('notFound.title')}</h1>
      <p className="max-w-sm font-body text-sm text-muted-ink">{t('notFound.body')}</p>
      <Link to={home} className="mt-1">
        <Button>{t('notFound.backHome')}</Button>
      </Link>
    </div>
  )
}
