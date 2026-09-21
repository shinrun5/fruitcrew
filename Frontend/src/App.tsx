import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { EmployeeLayout } from './components/EmployeeLayout'
import { ManagerLayout } from './components/ManagerLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RequireEmployeeLink } from './components/RequireEmployeeLink'
import { useAuth } from './lib/auth'
import { homePathForRole } from './lib/roles'
import { StoreProvider } from './lib/store-context'
import { getViewMode } from './lib/viewMode'
import { Admin } from './pages/Admin'
import { Availability } from './pages/Availability'
import { Chat } from './pages/Chat'
import { Closing } from './pages/Closing'
import { DeleteAccountRequest } from './pages/DeleteAccountRequest'
import { Notes } from './pages/Notes'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Marketplace } from './pages/Marketplace'
import { Overview } from './pages/Overview'
import { MyShifts } from './pages/MyShifts'
import { Privacy } from './pages/Privacy'
import { Profile } from './pages/Profile'
import { Register } from './pages/Register'
import { RegisterManager } from './pages/RegisterManager'
import { RegisterStore } from './pages/RegisterStore'
import { RequestAccess } from './pages/RequestAccess'
import { Requests } from './pages/Requests'
import { Setup } from './pages/Setup'
import { Stores } from './pages/Stores'
import { Terms } from './pages/Terms'
import { Workers } from './pages/Workers'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center font-body text-muted-ink">Loading…</div>
    )
  }
  return <Navigate to={user ? homePathForRole(user.role) : '/login'} replace />
}

/** Pages both roles share (Chat, Notes, Closing): an employee always gets
 * EmployeeLayout; a manager/owner gets whichever chrome they last landed in
 * (see lib/viewMode) — Manage view's own nav links here too, and shouldn't
 * snap the person into Work view chrome just for following one. */
function RoleScreen({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const isEmployee = user?.role === 'EMPLOYEE'
  const Layout = isEmployee || getViewMode() === 'work' ? EmployeeLayout : ManagerLayout
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/register-manager" element={<RegisterManager />} />
        <Route path="/register-store" element={<RegisterStore />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/request-access" element={<RequestAccess />} />
        <Route path="/delete-account" element={<DeleteAccountRequest />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />

        <Route element={<ProtectedRoute role={['MANAGER', 'OWNER']} />}>
          <Route element={<ManagerLayout />}>
            <Route path="/overview" element={<Overview />} />
            <Route path="/schedule" element={<Dashboard />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/stores" element={<Stores />} />
            <Route path="/account" element={<Profile />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Route>

        {/* Work view — an employee's normal home, and a manager/owner's optional
         * "just work a shift" mode. RequireEmployeeLink prompts a manager/owner
         * to opt into an Employee record first if they don't have one yet. */}
        <Route element={<ProtectedRoute />}>
          <Route element={<EmployeeLayout />}>
            <Route
              path="/my-shifts"
              element={
                <RequireEmployeeLink>
                  <MyShifts />
                </RequireEmployeeLink>
              }
            />
            <Route
              path="/marketplace"
              element={
                <RequireEmployeeLink>
                  <Marketplace />
                </RequireEmployeeLink>
              }
            />
            <Route
              path="/availability"
              element={
                <RequireEmployeeLink>
                  <Availability />
                </RequireEmployeeLink>
              }
            />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="/chat" element={<RoleScreen><Chat /></RoleScreen>} />
          <Route path="/notes" element={<RoleScreen><Notes /></RoleScreen>} />
          <Route
            path="/closing"
            element={
              <StoreProvider>
                <RoleScreen>
                  <Closing />
                </RoleScreen>
              </StoreProvider>
            }
          />
        </Route>

        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
