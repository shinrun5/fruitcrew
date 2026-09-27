import type { Role } from '../types'

/** Where a logged-in user belongs by default. A platform super admin always
 * lands in the admin console, regardless of their underlying role. */
export function homePathForRole(user: { role: Role; isSuperAdmin: boolean }): string {
  if (user.isSuperAdmin) return '/admin'
  return user.role === 'EMPLOYEE' ? '/my-shifts' : user.role === 'OWNER' ? '/overview' : '/schedule'
}
