import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { PendingApproval } from './PendingApproval'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { homePathForRole } from '../lib/roles'
import type { Role } from '../types'

/** Guards its child routes: bounces to /login when signed out, to the user's own
 * home when their role doesn't match `role` or (with `requireSuperAdmin`) they
 * aren't the platform superadmin, and to a waiting screen when they're an
 * EMPLOYEE whose self-registered account hasn't been approved yet. */
export function ProtectedRoute({ role, requireSuperAdmin }: { role?: Role | Role[]; requireSuperAdmin?: boolean }) {
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
  if (requireSuperAdmin && !user.isSuperAdmin) return <Navigate to={homePathForRole(user.role)} replace />
  if (user.role === 'EMPLOYEE' && !user.approved) return <PendingApproval />
  return <Outlet />
}
