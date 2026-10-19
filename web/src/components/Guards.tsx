import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { Spinner } from './ui'
import type { Role } from '@/types/domain'

export function Splash() {
  const [slow, setSlow] = useState(false)
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(timer) }, [])
  return <div className="boot" role="status">
    <img src="/icons/icon-192.png" alt="" width={112} height={112} />
    <h1>Thor Computer</h1><p>{slow ? 'Still connecting. Check your internet connection.' : 'Opening your workspace…'}</p>
    <div className="mt-4 flex justify-center"><Spinner /></div>
    {slow && <button className="mt-5 rounded-xl bg-thor-blue px-5 py-3 text-sm font-semibold text-white" onClick={() => window.location.reload()}>Try again</button>}
  </div>
}
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
  try { after = sessionStorage.getItem('thor.after'); if (after && !after.startsWith('/customer/new-request?')) after = null } catch { /* ignore */ }
  if (after && role === 'customer' && !needsSetup) return <Navigate to={after} replace />   // resume a WordPress enquiry after sign-up
  return <Navigate to={needsSetup ? '/setup' : homeFor(role)} replace />
}
