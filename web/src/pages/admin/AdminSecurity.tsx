import { useEffect, useState } from 'react'
import { EmailAuthProvider, GoogleAuthProvider, TotpMultiFactorGenerator, TotpSecret, multiFactor, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth'
import QRCode from 'qrcode'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import { auth } from '@/lib/firebase'
import { api, errMsg, AdminMfaStatus } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge, Button, Input, PageHeader, Section, useToast } from '@/components/ui'

const MODE_TEXT = {
  off: 'Two-step verification is optional for admins right now.',
  warn: 'Two-step verification is encouraged. It becomes mandatory once a super admin switches enforcement on.',
  enforce: 'Two-step verification is REQUIRED. Admin actions are refused from sessions that did not use a second factor.',
}

export default function AdminSecurity() {
  const { user, perms, signOut } = useAuth(); const toast = useToast()
  const [st, setSt] = useState<AdminMfaStatus | null>(null); const [loadErr, setLoadErr] = useState('')
  const [factors, setFactors] = useState(() => (auth.currentUser ? multiFactor(auth.currentUser).enrolledFactors : []))
  const [step, setStep] = useState<'idle' | 'password' | 'scan' | 'done'>('idle')
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [secret, setSecret] = useState<TotpSecret | null>(null), [qr, setQr] = useState('')
  const usesPassword = !!user?.providerData.some(p => p.providerId === 'password')
  const refresh = () => { api.adminMfaStatus({}).then(setSt).catch(e => setLoadErr(errMsg(e))); if (auth.currentUser) setFactors([...multiFactor(auth.currentUser).enrolledFactors]) }
  useEffect(refresh, [])

  // Enrolment and removal both need a recent sign-in.
  const reauth = async () => {
    const u = auth.currentUser!
    if (usesPassword) await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email!, password))
    else await reauthenticateWithPopup(u, new GoogleAuthProvider())
  }
  const begin = async () => {
    setBusy(true); setErr('')
    try {
      await reauth()
      const u = auth.currentUser!, session = await multiFactor(u).getSession()
      const s = await TotpMultiFactorGenerator.generateSecret(session)
      setSecret(s); setQr(await QRCode.toDataURL(s.generateQrCodeUrl(u.email ?? 'admin', 'Thor Computer'), { margin: 1, width: 220 })); setStep('scan'); setPassword('')
    } catch (e: any) { setErr(/wrong-password|invalid-credential/.test(e?.code ?? '') ? 'That password is not correct.' : /unverified-email/.test(e?.code ?? '') ? 'Verify your email address before enrolling.' : errMsg(e)) }
    finally { setBusy(false) }
  }
  const finish = async () => {
    setBusy(true); setErr('')
    try {
      await multiFactor(auth.currentUser!).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret!, code.trim()), 'Authenticator app')
      setStep('done'); setSecret(null); setCode(''); refresh()
    } catch (e: any) { setErr(/invalid-verification-code/.test(e?.code ?? '') ? 'That code is not right. Check your authenticator app and try the newest code.' : errMsg(e)) }
    finally { setBusy(false) }
  }
  const remove = async (uid: string) => {
    if (st?.mode === 'enforce' && factors.length <= 1) return
    setBusy(true)
    try { await reauth(); await multiFactor(auth.currentUser!).unenroll(uid); toast('ok', 'Second factor removed.'); refresh() }
    catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false); setPassword('') }
  }

  const notEnrolled = st?.admins?.filter(a => a.enrolledFactors === 0) ?? []
  return (
    <div className="max-w-2xl"><PageHeader title="Security" sub="Two-step verification for your admin account." />
      {loadErr && <p role="alert" className="mb-4 rounded-xl bg-bad/10 p-3 text-sm text-bad">{loadErr}</p>}
      {st && <div className="mb-4 flex items-start gap-3 surface p-5">
        {st.sessionHasSecondFactor ? <ShieldCheck className="size-6 shrink-0 text-ok" /> : <ShieldAlert className="size-6 shrink-0 text-warn" />}
        <div className="text-sm"><p className="font-medium">{st.sessionHasSecondFactor ? 'This session is protected by a second factor.' : 'This session did not use a second factor.'}</p><p className="mt-1 text-thor-text">{MODE_TEXT[st.mode]}</p>
          {st.mode === 'enforce' && !st.sessionHasSecondFactor && <p className="mt-2 font-medium text-bad">{factors.length ? 'You are enrolled. Sign out and sign in again, entering your authenticator code, to continue.' : 'Enrol below to regain access to the admin tools.'}</p>}</div>
      </div>}

      <Section title="Authenticator app">
        {factors.length > 0 && <ul className="mb-4 divide-y divide-ink/8 surface px-5">
          {factors.map(f => <li key={f.uid} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium">{f.displayName ?? 'Authenticator app'}</p><p className="text-xs text-thor-text">Enrolled {new Date(f.enrollmentTime).toLocaleDateString('en-GB')}</p></div>
            <Button variant="ghost" size="sm" loading={busy} disabled={st?.mode === 'enforce' && factors.length <= 1} title={st?.mode === 'enforce' && factors.length <= 1 ? 'You cannot remove your only factor while enforcement is on' : undefined} onClick={() => remove(f.uid)}>Remove</Button></li>)}
        </ul>}
        {usesPassword && (step === 'idle' || step === 'password') && factors.length > 0 && <Input label="Password (needed to remove a factor)" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />}
        {step === 'idle' && <Button onClick={() => (usesPassword ? setStep('password') : begin())} size="lg">{factors.length ? 'Add another authenticator' : 'Set up authenticator app'}</Button>}
        {step === 'password' && <div className="space-y-4"><Input label="Confirm your password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} error={err} />
          <Button onClick={begin} loading={busy} disabled={!password}>Continue</Button></div>}
        {step === 'scan' && secret && <div className="space-y-4">
          <p className="text-sm">1. Scan this QR code with an authenticator app (Google Authenticator, 1Password, Authy…).</p>
          <img src={qr} alt="QR code to add Thor Computer to your authenticator app" width={220} height={220} className="rounded-xl bg-white p-2 ring-1 ring-ink/10" />
          <p className="text-sm text-thor-text">Can’t scan? Enter this key manually: <code className="select-all break-all rounded bg-ink/5 px-1.5 py-0.5">{secret.secretKey}</code></p>
          <p className="text-sm">2. Enter the 6-digit code it shows.</p>
          <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} error={err} />
          <Button onClick={finish} loading={busy} disabled={code.length !== 6}>Turn on two-step verification</Button></div>}
        {step === 'done' && <div className="rounded-2xl bg-ok/10 p-4 text-sm"><p className="font-medium text-ok">Two-step verification is on for your account.</p>
          <p className="mt-1">Sign out and sign in again to use it. You will be asked for a code each time you sign in.</p><Button className="mt-3" onClick={() => signOut()}>Sign out now</Button></div>}
        {err && step === 'idle' && <p role="alert" className="mt-2 text-sm text-bad">{err}</p>}
      </Section>

      {perms.includes('admins.manage') && st?.admins && <Section title="Admin team readiness">
        <p className="mb-3 text-sm text-thor-text">Before a super admin sets <code>REQUIRE_ADMIN_MFA=true</code> on the server, every active admin should be enrolled, or they will be locked out of admin actions until they enrol.</p>
        <ul className="divide-y divide-ink/8 surface px-5">
          {st.admins.map(a => <li key={a.uid} className="flex items-center justify-between py-3 text-sm"><span>{a.email || a.uid}</span>{a.enrolledFactors ? <Badge tone="ok">Enrolled</Badge> : <Badge tone="warn">Not enrolled</Badge>}</li>)}
        </ul>
        <p className={`mt-3 text-sm font-medium ${notEnrolled.length ? 'text-warn' : 'text-ok'}`}>{notEnrolled.length ? `${notEnrolled.length} admin${notEnrolled.length === 1 ? '' : 's'} not yet enrolled: do not enforce yet.` : 'All admins are enrolled: safe to enforce.'}</p>
      </Section>}
    </div>)
}
