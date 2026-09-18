import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { EmployeeLayout } from './components/EmployeeLayout'
import { ManagerLayout } from './components/ManagerLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './lib/auth'
import { homePathForRole } from './lib/roles'
import { StoreProvider } from './lib/store-context'
import { Admin } from './pages/Admin'
import { Availability } from './pages/Availability'
import { Chat } from './pages/Chat'
import { Closing } from './pages/Closing'
import { Notes } from './pages/Notes'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Marketplace } from './pages/Marketplace'
import { MyAvailability } from './pages/MyAvailability'
import { Overview } from './pages/Overview'
import { MyShifts } from './pages/MyShifts'
import { Privacy } from './pages/Privacy'
import { Profile } from './pages/Profile'
import { Register } from './pages/Register'
import { RegisterManager } from './pages/RegisterManager'
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

/** Pages both roles share, each wrapped in whichever chrome matches the role. */
function RoleScreen({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const Layout = user?.role === 'EMPLOYEE' ? EmployeeLayout : ManagerLayout
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/register-manager" element={<RegisterManager />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/request-access" element={<RequestAccess />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />

        <Route element={<ProtectedRoute role={['MANAGER', 'OWNER']} />}>
          <Route element={<ManagerLayout />}>
            <Route path="/overview" element={<Overview />} />
            <Route path="/schedule" element={<Dashboard />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/stores" element={<Stores />} />
            <Route path="/my-availability" element={<MyAvailability />} />
            <Route path="/account" element={<Profile />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute role="EMPLOYEE" />}>
          <Route element={<EmployeeLayout />}>
            <Route path="/my-shifts" element={<MyShifts />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/availability" element={<Availability />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute />}>
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
