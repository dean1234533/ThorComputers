import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Button, Input } from '@/components/ui'
import AuthLayout from './AuthLayout'

export default function Forgot() {
  const [email, setEmail] = useState(''), [sent, setSent] = useState(false), [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true)
    try { await sendPasswordResetEmail(auth, email.trim()) } catch { /* never reveal whether an account exists */ } finally { setBusy(false); setSent(true) } }
  return (
    <AuthLayout title="Reset your password" sub="Enter your email and we’ll send a reset link.">
      {sent ? <p className="rounded-xl bg-ok/10 p-4 text-ok" role="status">If an account exists for that email, a reset link is on its way.</p> :
        <form onSubmit={submit} className="space-y-4"><Input label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /><Button type="submit" loading={busy} className="w-full" size="lg">Send reset link</Button></form>}
      <p className="mt-6 text-center text-sm"><Link to="/login" className="text-thor-blue hover:underline">Back to sign in</Link></p>
    </AuthLayout>
  )
}
