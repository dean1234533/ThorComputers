import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { Logo } from './ui'
import type { Role } from '@/types/domain'

export const Splash = () => (
  <div className="grid min-h-dvh place-items-center bg-thor-blue"><div className="animate-pulse"><Logo className="h-24" onDark /></div></div>
)
export const homeFor = (r: Role | null) => (r ? `/${r}` : '/login')

export function RequireAuth({ role }: { role?: Role }) {
  const { user, loading, needsSetup, role: myRole } = useAuth()
  const loc = useLocation()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />
  if (needsSetup) return <Navigate to="/setup" replace />
  const password = user.providerData.some(p => p.providerId === 'password')
  if (password && !user.emailVerified) return <Navigate to="/verify" replace />
  if (role && myRole !== role) return <Navigate to={homeFor(myRole)} replace />
  return <Outlet />
}
export function RedirectHome() {
  const { user, loading, role, needsSetup } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  let after: string | null = null
  try { after = sessionStorage.getItem('thor.after'); if (after && role === 'customer' && !needsSetup) sessionStorage.removeItem('thor.after') } catch { /* ignore */ }
  if (after && role === 'customer' && !needsSetup) return <Navigate to={after} replace />   // resume a WordPress enquiry after sign-up
  return <Navigate to={needsSetup ? '/setup' : homeFor(role)} replace />
}
