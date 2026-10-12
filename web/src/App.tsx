import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { ToastProvider } from '@/components/ui'
import { RedirectHome, RequireAuth, Splash } from '@/components/Guards'
import ErrorBoundary from '@/components/ErrorBoundary'
import PushBridge from '@/components/PushBridge'
import UpdatePrompt from '@/components/UpdatePrompt'
import OfflineBanner from '@/components/OfflineBanner'
import AppShell from '@/layouts/AppShell'
import AdminMfaGuard from '@/components/AdminMfaGuard'

// Every page is code-split; the shell and auth screens load first.
const L = (f: () => Promise<{ default: React.ComponentType }>) => lazy(f)
const named = (f: () => Promise<any>, k: string) => lazy(async () => ({ default: (await f())[k] as React.ComponentType }))

const Login = L(() => import('@/pages/auth/Login')), Forgot = L(() => import('@/pages/auth/Forgot')), Verify = L(() => import('@/pages/auth/Verify'))
const Register = L(() => import('@/pages/auth/Register')), Setup = lazy(async () => { const m = await import('@/pages/auth/Register'); return { default: () => <m.default setup /> } })
const Install = named(() => import('@/pages/shared/Public'), 'InstallPage'), Continue = named(() => import('@/pages/shared/Public'), 'Continue'), Privacy = named(() => import('@/pages/shared/Public'), 'Privacy')

const CustomerHome = named(() => import('@/pages/customer/CustomerPages'), 'CustomerHome'), MyRepairs = named(() => import('@/pages/customer/CustomerPages'), 'MyRepairs'), CustomerQuotations = named(() => import('@/pages/customer/CustomerPages'), 'CustomerQuotations')
const NewRequest = L(() => import('@/pages/customer/NewRequest')), RepairDetail = L(() => import('@/pages/customer/RepairDetail'))

const EngineerDashboard = named(() => import('@/pages/engineer/EngineerExtras'), 'EngineerDashboard'), EngineerReviews = named(() => import('@/pages/engineer/EngineerExtras'), 'EngineerReviews'), EngineerAppointments = named(() => import('@/pages/engineer/EngineerExtras'), 'EngineerAppointments')
const AvailableJobs = named(() => import('@/pages/engineer/EngineerJobs'), 'AvailableJobs'), JobDetail = named(() => import('@/pages/engineer/EngineerJobs'), 'JobDetail'), MyQuotations = named(() => import('@/pages/engineer/EngineerJobs'), 'MyQuotations'), MyJobs = named(() => import('@/pages/engineer/EngineerJobs'), 'MyJobs'), MyJobDetail = named(() => import('@/pages/engineer/EngineerJobs'), 'MyJobDetail')
const Onboarding = L(() => import('@/pages/engineer/EngineerOnboarding'))

const Appointments = L(() => import('@/pages/shared/Appointments')), Messages = L(() => import('@/pages/shared/Messages')), Notifications = L(() => import('@/pages/shared/Notifications')), Settings = L(() => import('@/pages/shared/Settings')), Profile = L(() => import('@/pages/shared/Profile')), EngineerProfile = L(() => import('@/pages/shared/EngineerProfile'))

const A = (k: string) => named(() => import('@/pages/admin/AdminPages'), k)
const AdminOverview = A('AdminOverview'), Approvals = A('Approvals'), AdminCustomers = A('AdminCustomers'), AdminEngineers = A('AdminEngineers'), AdminJobs = A('AdminJobs'), AdminQuotations = A('AdminQuotations'), AdminAppointments = A('AdminAppointments'), AdminReviews = A('AdminReviews'), AdminReports = A('AdminReports')
const AdminSettings = L(() => import('@/pages/admin/AdminSettings')), AdminSecurity = L(() => import('@/pages/admin/AdminSecurity'))
const AdminMarketing = L(() => import('@/pages/admin/AdminMarketing')), AdminFinance = L(() => import('@/pages/admin/AdminFinance'))
const AdminLeads = named(() => import('@/pages/admin/AdminLeads'), 'AdminLeads'), LeadDetail = named(() => import('@/pages/admin/AdminLeads'), 'LeadDetail')
const AdminDisputes = named(() => import('@/pages/admin/AdminOps'), 'AdminDisputes'), AdminSupport = named(() => import('@/pages/admin/AdminOps'), 'AdminSupport')
const SupportPage = named(() => import('@/pages/shared/Support'), 'SupportPage'), UserTicket = named(() => import('@/pages/shared/Support'), 'UserTicket'), AdminTicket = named(() => import('@/pages/shared/Support'), 'AdminTicket')
const Payouts = L(() => import('@/pages/engineer/Payouts'))

export default function App() {
  return (
    <ErrorBoundary><BrowserRouter><ToastProvider><AuthProvider><UpdatePrompt /><OfflineBanner /><PushBridge />
      <Suspense fallback={<Splash />}><Routes>
        <Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} /><Route path="/forgot" element={<Forgot />} />
        <Route path="/install" element={<Install />} /><Route path="/privacy" element={<Privacy />} /><Route path="/continue" element={<Continue />} />
        <Route path="/setup" element={<Setup />} />
        {/* Stable entry points used by the WordPress plugin buttons */}
        <Route path="/request" element={<Navigate to="/customer/new-request" replace />} /><Route path="/track" element={<Navigate to="/customer/repairs" replace />} /><Route path="/find-engineer" element={<Navigate to="/customer/new-request" replace />} /><Route path="/engineer-signup" element={<Navigate to="/register?role=engineer" replace />} /><Route path="/verify" element={<Verify />} />
        <Route path="/" element={<RedirectHome />} />

        <Route element={<RequireAuth />}><Route element={<AppShell />}>
          <Route path="/messages/:cid?" element={<Messages />} /><Route path="/notifications" element={<Notifications />} /><Route path="/settings" element={<Settings />} /><Route path="/profile" element={<Profile />} /><Route path="/engineers/:id" element={<EngineerProfile />} /><Route path="/support" element={<SupportPage />} /><Route path="/support/:id" element={<UserTicket />} />
        </Route></Route>

        <Route element={<RequireAuth role="customer" />}><Route element={<AppShell />}>
          <Route path="/customer" element={<CustomerHome />} /><Route path="/customer/repairs" element={<MyRepairs />} /><Route path="/customer/repairs/:id" element={<RepairDetail />} /><Route path="/customer/new-request" element={<NewRequest />} />
          <Route path="/customer/quotations" element={<CustomerQuotations />} /><Route path="/customer/appointments" element={<Appointments />} />
        </Route></Route>

        <Route element={<RequireAuth role="engineer" />}><Route element={<AppShell />}>
          <Route path="/engineer" element={<EngineerDashboard />} /><Route path="/engineer/jobs" element={<AvailableJobs />} /><Route path="/engineer/jobs/:id" element={<JobDetail />} /><Route path="/engineer/quotations" element={<MyQuotations />} />
          <Route path="/engineer/my-jobs" element={<MyJobs />} /><Route path="/engineer/my-jobs/:id" element={<MyJobDetail />} /><Route path="/engineer/appointments" element={<EngineerAppointments />} /><Route path="/engineer/reviews" element={<EngineerReviews />} /><Route path="/engineer/profile" element={<Onboarding />} /><Route path="/engineer/payouts" element={<Payouts />} />
        </Route></Route>

        <Route element={<RequireAuth role="admin" />}><Route element={<AdminMfaGuard />}><Route element={<AppShell />}>
          <Route path="/admin" element={<AdminOverview />} /><Route path="/admin/approvals" element={<Approvals />} /><Route path="/admin/customers" element={<AdminCustomers />} /><Route path="/admin/engineers" element={<AdminEngineers />} />
          <Route path="/admin/jobs" element={<AdminJobs />} /><Route path="/admin/quotations" element={<AdminQuotations />} /><Route path="/admin/appointments" element={<AdminAppointments />} /><Route path="/admin/reviews" element={<AdminReviews />} /><Route path="/admin/reports" element={<AdminReports />} /><Route path="/admin/settings" element={<AdminSettings />} /><Route path="/admin/marketing" element={<AdminMarketing />} /><Route path="/admin/leads" element={<AdminLeads />} /><Route path="/admin/leads/:id" element={<LeadDetail />} /><Route path="/admin/finance" element={<AdminFinance />} /><Route path="/admin/disputes" element={<AdminDisputes />} /><Route path="/admin/support" element={<AdminSupport />} /><Route path="/admin/support/:id" element={<AdminTicket />} /><Route path="/admin/security" element={<AdminSecurity />} />
        </Route></Route></Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Suspense>
    </AuthProvider></ToastProvider></BrowserRouter></ErrorBoundary>
  )
}
