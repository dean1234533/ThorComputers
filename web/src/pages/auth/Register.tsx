import { FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createUserWithEmailAndPassword, sendEmailVerification, signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { api, errMsg } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button, Input, cx } from '@/components/ui'
import { HardHat, User } from 'lucide-react'
import AuthLayout from './AuthLayout'

const POSTCODE = /^[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}$/
const PHONE = /^(\+44|0)[\d\s]{9,14}$/

/** Used for both new email sign-ups and Google users who still need a profile (/setup). */
export default function Register({ setup = false }: { setup?: boolean }) {
  const nav = useNavigate(); const [qs] = useSearchParams(); const { user } = useAuth()
  const [role, setRole] = useState<'customer' | 'engineer'>(qs.get('role') === 'engineer' ? 'engineer' : 'customer')
  const [f, setF] = useState({ fullName: user?.displayName ?? '', email: user?.email ?? '', password: '', phone: '', postcode: '' })
  const [consent, setConsent] = useState(false)
  const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [top, setTop] = useState('')
  const on = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(s => ({ ...s, [k]: e.target.value }))

  const validate = () => {
    const e: Record<string, string> = {}
    if (f.fullName.trim().length < 2) e.fullName = 'Enter your full name'
    if (!setup && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email'
    if (!setup && f.password.length < 8) e.password = 'Use at least 8 characters'
    if (!PHONE.test(f.phone.trim())) e.phone = 'Enter a UK phone number'
    if (!POSTCODE.test(f.postcode.trim())) e.postcode = 'Enter a valid UK postcode'
    if (!consent) e.consent = 'Please accept the privacy policy to continue'
    setErrs(e); return Object.keys(e).length === 0
  }
  const submit = async (ev: FormEvent) => {
    ev.preventDefault(); if (!validate()) return
    setBusy(true); setTop('')
    try {
      if (!setup) { const c = await createUserWithEmailAndPassword(auth, f.email.trim(), f.password); await sendEmailVerification(c.user) }
      await api.completeRegistration({ role, fullName: f.fullName.trim(), phone: f.phone.trim(), postcode: f.postcode.trim().toUpperCase(), consent: true })
      await auth.currentUser?.getIdToken(true)           // pick up the role claim set by the server
      nav(auth.currentUser?.emailVerified ? '/' : '/verify', { replace: true })
    } catch (x: any) { setTop(x?.code === 'auth/email-already-in-use' ? 'An account with this email already exists. Try signing in.' : errMsg(x)) } finally { setBusy(false) }
  }
  const google = async () => { try { await signInWithPopup(auth, new GoogleAuthProvider()); nav('/setup') } catch (x: any) { if (x?.code !== 'auth/popup-closed-by-user') setTop(errMsg(x)) } }

  return (
    <AuthLayout title={setup ? 'Finish setting up' : 'Create your account'} sub={setup ? 'Just a few details so we can get you started.' : 'It takes a minute. No payment details needed.'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-3">
          {([['customer', 'I need a repair', User], ['engineer', 'I’m an engineer', HardHat]] as const).map(([id, label, I]) => (
            <button key={id} type="button" role="radio" aria-checked={role === id} onClick={() => setRole(id)}
              className={cx('flex flex-col items-center gap-1.5 rounded-2xl border-2 p-4 text-sm font-medium transition', role === id ? 'border-thor-blue bg-thor-blue/5 text-thor-blue' : 'border-ink/10 hover:border-thor-blue/40')}><I className="size-6" />{label}</button>))}
        </div>
        <Input label="Full name" autoComplete="name" value={f.fullName} onChange={on('fullName')} error={errs.fullName} />
        {!setup && <Input label="Email" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={on('email')} error={errs.email} />}
        {!setup && <Input label="Password" type="password" autoComplete="new-password" hint="At least 8 characters" value={f.password} onChange={on('password')} error={errs.password} />}
        <Input label="Phone number" type="tel" autoComplete="tel" inputMode="tel" hint="Only shared with your selected engineer" value={f.phone} onChange={on('phone')} error={errs.phone} />
        <Input label="Postcode" autoComplete="postal-code" value={f.postcode} onChange={on('postcode')} error={errs.postcode} className="uppercase" />
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 size-5 accent-thor-blue" />
          <span>I agree to the <Link to="/privacy" target="_blank" className="text-thor-blue underline">Privacy Policy</Link> and understand my details are shared only as needed to arrange repairs.</span></label>
        {errs.consent && <p role="alert" className="text-xs text-bad">{errs.consent}</p>}
        {top && <p role="alert" className="text-sm text-bad">{top}</p>}
        <Button type="submit" loading={busy} className="w-full" size="lg">{setup ? 'Continue' : 'Create account'}</Button>
      </form>
      {!setup && <><div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-thor-text"><span className="h-px flex-1 bg-ink/10" />or<span className="h-px flex-1 bg-ink/10" /></div>
        <Button variant="soft" onClick={google} className="w-full" size="lg">Sign up with Google</Button>
        <p className="mt-6 text-center text-sm text-thor-text">Already registered? <Link to="/login" className="font-medium text-thor-blue hover:underline">Sign in</Link></p></>}
    </AuthLayout>
  )
}
