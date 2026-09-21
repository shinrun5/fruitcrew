import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'
import type { Role } from '../types'

/** Guards its child routes: bounces to /login when signed out, and to the user's
 * own home when their role doesn't match `role`. */
export function ProtectedRoute({ role }: { role?: Role | Role[] }) {
  const { user, loading } = useAuth()
  const t = useT()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center font-body text-muted-ink">{t('common.loading')}</div>
    )
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  const allowed = role === undefined || (Array.isArray(role) ? role.includes(user.role) : user.role === role)
  if (!allowed) return <Navigate to={homePathForRole(user.role)} replace />
  return <Outlet />
}
