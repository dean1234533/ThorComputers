import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { api, AdminMfaStatus } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Splash } from './Guards'

/** Wraps the admin area. When the server enforces admin MFA and this session has no second factor, every admin page would fail,
 *  so send the admin to /admin/security (enrol, or sign in again after enrolling) instead of a wall of errors. That page needs no
 *  second factor, so an admin who has not enrolled yet can always get in and fix it: enforcement cannot strand anyone.
 *  If the status check itself fails we fail OPEN in the UI only; the server remains the enforcement point. */
export default function AdminMfaGuard() {
  const { user } = useAuth(); const loc = useLocation()
  const [st, setSt] = useState<AdminMfaStatus | null | 'error'>(null)
  useEffect(() => { let live = true; api.adminMfaStatus({}).then(s => live && setSt(s)).catch(() => live && setSt('error')); return () => { live = false } }, [user?.uid])
  if (st === null) return <Splash />
  const onSecurity = loc.pathname === '/admin/security'
  if (st !== 'error' && st.mode === 'enforce' && !st.sessionHasSecondFactor && !onSecurity) return <Navigate to="/admin/security" replace />
  const nag = st !== 'error' && st.mode !== 'off' && !st.sessionHasSecondFactor && !onSecurity
  return (<>
    {nag && <div role="status" className="sticky top-0 z-50 bg-warn/20 px-4 py-2 text-center text-sm text-ink">
      Two-step verification will soon be required for admin accounts. <Link to="/admin/security" className="font-medium text-thor-blue underline">Set it up now</Link></div>}
    <Outlet />
  </>)
}
