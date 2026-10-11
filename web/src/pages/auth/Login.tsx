import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, getMultiFactorResolver, TotpMultiFactorGenerator, MultiFactorResolver } from 'firebase/auth'
import { auth, isConfigured } from '@/lib/firebase'
import { errMsg } from '@/lib/api'
import { Button, Input } from '@/components/ui'
import AuthLayout from './AuthLayout'

/** Admin accounts with two-step verification: sign-in throws until a TOTP code is supplied to the resolver. */
const mfaResolver = (e: any): MultiFactorResolver | null => (e?.code === 'auth/multi-factor-auth-required' ? getMultiFactorResolver(auth, e) : null)
const friendly = (e: any) => /invalid-credential|wrong-password|user-not-found/.test(e?.code ?? '') ? 'Incorrect email or password.' : /too-many-requests/.test(e?.code ?? '') ? 'Too many attempts. Try again in a few minutes or reset your password.' : errMsg(e)

export default function Login() {
  const nav = useNavigate(); const loc = useLocation()
  const to = (loc.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const [mfa, setMfa] = useState<MultiFactorResolver | null>(null), [otp, setOtp] = useState('')
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr('')
    try { await signInWithEmailAndPassword(auth, email.trim(), password); nav(to, { replace: true }) } catch (x) { const r = mfaResolver(x); if (r) setMfa(r); else setErr(friendly(x)) } finally { setBusy(false) } }
  const verifyOtp = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr('')
    try { const hint = mfa!.hints.find(h => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) ?? mfa!.hints[0]
      await mfa!.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, otp.trim())); nav(to, { replace: true })
    } catch (x: any) { setErr(/invalid-verification-code/.test(x?.code ?? '') ? 'That code is not right. Try the newest code from your authenticator app.' : friendly(x)) } finally { setBusy(false) } }
  if (mfa) return (
    <AuthLayout title="Two-step verification" sub="Enter the 6-digit code from your authenticator app.">
      <form onSubmit={verifyOtp} className="space-y-4" noValidate>
        <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus required />
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <Button type="submit" loading={busy} className="w-full" size="lg" disabled={otp.length !== 6}>Verify</Button>
        <button type="button" onClick={() => { setMfa(null); setOtp(''); setErr('') }} className="w-full text-sm text-thor-blue hover:underline">Use a different account</button>
      </form>
    </AuthLayout>)
  return (
    <AuthLayout title="Welcome back" sub="Sign in to manage your repairs.">
      {!isConfigured && <p className="mb-4 rounded-xl bg-warn/15 p-3 text-sm text-warn">Firebase isn’t configured yet. Copy <code>.env.example</code> to <code>.env</code> and add your project keys.</p>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
        <Input label="Password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} required />
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <Button type="submit" loading={busy} className="w-full" size="lg">Sign in</Button>
        <div className="text-right"><Link to="/forgot" className="text-sm text-thor-blue hover:underline">Forgot password?</Link></div>
      </form>
      <p className="mt-6 text-center text-sm text-thor-text">New to Thor Computer? <Link to="/register" className="font-medium text-thor-blue hover:underline">Create an account</Link></p>
    </AuthLayout>
  )
}
