import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './components/AdminLayout'
import { EmployeeLayout } from './components/EmployeeLayout'
import { ManagerLayout } from './components/ManagerLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PushBridge } from './components/PushBridge'
import { AppLinkBridge } from './components/AppLinkBridge'
import { WidgetSync } from './components/WidgetSync'
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
import { Home } from './pages/Home'
import { More } from './pages/More'
import { MyShifts } from './pages/MyShifts'
import { NotFound } from './pages/NotFound'
import { Payroll } from './pages/Payroll'
import { Privacy } from './pages/Privacy'
import { Profile } from './pages/Profile'
import { Register } from './pages/Register'
import { RegisterManager } from './pages/RegisterManager'
import { RegisterStore } from './pages/RegisterStore'
import { RequestAccess } from './pages/RequestAccess'
import { ForgotPassword } from './pages/ForgotPassword'
import { ResetPassword } from './pages/ResetPassword'
import { Requests } from './pages/Requests'
import { Setup } from './pages/Setup'
import { Stores } from './pages/Stores'
import { Help } from './pages/Help'
import { AddonGate } from './components/AddonGate'
import { Terms } from './pages/Terms'
import { TeamMember } from './pages/TeamMember'
import { Workers } from './pages/Workers'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center font-body text-muted-ink">Loading…</div>
    )
  }
  return <Navigate to={user ? homePathForRole(user) : '/login'} replace />
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
      <PushBridge />
      <AppLinkBridge />
      <WidgetSync />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/register-manager" element={<RegisterManager />} />
        <Route path="/register-store" element={<RegisterStore />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/request-access" element={<RequestAccess />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/delete-account" element={<DeleteAccountRequest />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />

        <Route element={<ProtectedRoute role={['MANAGER', 'OWNER']} />}>
          <Route element={<ManagerLayout />}>
            <Route path="/home" element={<Home />} />
            <Route path="/overview" element={<Navigate to="/home" replace />} />
            <Route path="/schedule" element={<Dashboard />} />
            <Route path="/team" element={<Workers />} />
            <Route path="/team/:id" element={<TeamMember />} />
            <Route path="/workers" element={<Navigate to="/team" replace />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/settings" element={<Stores />} />
            <Route path="/stores" element={<Navigate to="/settings" replace />} />
            <Route path="/payroll" element={<Payroll />} />
            <Route path="/account" element={<Profile />} />
            <Route path="/help" element={<Help />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute role={['MANAGER', 'OWNER']} requireSuperAdmin />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/account" element={<Profile />} />
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
          <Route path="/chat" element={<RoleScreen><AddonGate addon="chat"><Chat /></AddonGate></RoleScreen>} />
          <Route path="/more" element={<RoleScreen><More /></RoleScreen>} />
          <Route path="/notes" element={<RoleScreen><AddonGate addon="notes"><Notes /></AddonGate></RoleScreen>} />
          <Route
            path="/closing"
            element={
              <StoreProvider>
                <RoleScreen>
                  <AddonGate addon="closing">
                    <Closing />
                  </AddonGate>
                </RoleScreen>
              </StoreProvider>
            }
          />
        </Route>

        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
