import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { sendEmailVerification } from 'firebase/auth'
import { MailCheck } from 'lucide-react'
import { auth } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { Button, useToast } from '@/components/ui'
import AuthLayout from './AuthLayout'

export default function Verify() {
  const { user, refreshClaims, signOut } = useAuth(); const toast = useToast()
  const [verified, setVerified] = useState(user?.emailVerified ?? false); const [cool, setCool] = useState(0)
  useEffect(() => {          // poll quietly so the page advances as soon as the link is clicked
    const t = setInterval(async () => { await auth.currentUser?.reload(); if (auth.currentUser?.emailVerified) { await refreshClaims(); setVerified(true) } }, 4000)
    return () => clearInterval(t)
  }, [refreshClaims])
  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool(cool - 1), 1000); return () => clearTimeout(t) }, [cool])
  if (verified) return <Navigate to="/" replace />
  const resend = async () => { try { await sendEmailVerification(auth.currentUser!); setCool(60); toast('ok', 'Verification email sent.') } catch { toast('bad', 'Please wait a moment before requesting another email.') } }
  return (
    <AuthLayout title="Check your inbox" sub={`We sent a verification link to ${user?.email}.`}>
      <div className="mb-6 grid size-16 place-items-center rounded-full bg-thor-sky/25"><MailCheck className="size-8 text-thor-blue" /></div>
      <p className="text-thor-text">Click the link in the email to verify your address. This page continues automatically.</p>
      <div className="mt-6 flex flex-col gap-3"><Button onClick={resend} disabled={cool > 0} variant="soft">{cool > 0 ? `Resend in ${cool}s` : 'Resend email'}</Button><Button variant="ghost" onClick={signOut}>Use a different account</Button></div>
    </AuthLayout>
  )
}
