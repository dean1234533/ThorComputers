import { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from 'react'
import { onAuthStateChanged, onIdTokenChanged, User, signOut as fbSignOut } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { auth, db, resetDatabaseAfterSignOut } from './firebase'
import type { AdminPermission, Role } from '@/types/domain'

export interface Profile {
  role: Role; email: string; fullName: string; phone: string; postcode: string; photoURL: string | null; status: string
  notificationPrefs?: { push: Record<string, boolean>; email: Record<string, boolean> }; privacy?: { showCityOnProfile?: boolean; marketingEmails?: boolean }; engineerStatus?: string; createdAt?: { toDate(): Date }
}
interface Ctx {
  user: User | null; profile: Profile | null; role: Role | null; perms: AdminPermission[]; approved: boolean; specs: string[]
  loading: boolean; needsSetup: boolean; refreshClaims: () => Promise<void>; signOut: () => Promise<void>
}
const AuthCtx = createContext<Ctx>(null!)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [claims, setClaims] = useState<Record<string, any>>({})
  const [profile, setProfile] = useState<Profile | null>(null)
  const [authReady, setAuthReady] = useState(false)
  // uid whose profile snapshot has arrived (null = signed out). Tying readiness to the uid, not a boolean, stops a stale "ready" from the signed-out phase
  // making a freshly restored session look like "signed in without a profile" (which used to bounce every page refresh to /setup).
  const [profileFor, setProfileFor] = useState<string | null | undefined>(undefined)
  const [profileError, setProfileError] = useState(false)

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); if (!u) { setProfile(null); setClaims({}) } setAuthReady(true) }), [])
  useEffect(() => onIdTokenChanged(auth, async u => {
    if (u) { const token = await u.getIdTokenResult(); if (auth.currentUser === u) setClaims(token.claims as any) }
  }), [])
  useEffect(() => {
    if (!user || signingOut) { setProfileFor(null); setProfileError(false); return }
    setProfileError(false)
    return onSnapshot(doc(db, 'users', user.uid), s => { setProfile(s.exists() ? (s.data() as Profile) : null); setProfileFor(user.uid) },
      () => { setProfileError(true); setProfileFor(user.uid) })   // a failed read must not be mistaken for "no profile yet"
  }, [user, signingOut])
  const profileReady = !user ? profileFor === null : profileFor === user.uid

  const refreshClaims = useCallback(async () => { if (auth.currentUser) setClaims((await auth.currentUser.getIdTokenResult(true)).claims as any) }, [])
  const signOut = useCallback(async () => {
    setSigningOut(true)
    try {
      await fbSignOut(auth)
      try { await resetDatabaseAfterSignOut() } catch { /* The replacement uses memory if persistent cache clearing fails. */ }
      navigate('/login', { replace: true, state: null })
    } finally { setSigningOut(false) }
  }, [navigate])

  const value = useMemo<Ctx>(() => ({
    user, profile, role: (claims.role as Role) ?? profile?.role ?? null, perms: (claims.perms as AdminPermission[]) ?? [], approved: claims.engineerApproved === true, specs: (claims.specs as string[]) ?? [],
    loading: !authReady || !profileReady, needsSetup: !!user && authReady && profileReady && !profile && !profileError, refreshClaims, signOut,
  }), [user, profile, claims, authReady, profileReady, profileError, refreshClaims, signOut])
  return <AuthCtx.Provider value={value}>{signingOut ? <div role="status" className="grid min-h-dvh place-items-center text-thor-blue">Signing out…</div> : children}</AuthCtx.Provider>
}
