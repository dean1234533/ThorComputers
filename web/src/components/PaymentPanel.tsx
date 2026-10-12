import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { where, orderBy } from 'firebase/firestore'
import { CreditCard, Loader2, Lock, ReceiptText } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, useToast } from './ui'
import { gbp, JobPayment, JobStatus, PAYMENT_POLICY_LABEL } from '@/types/domain'

interface Pay { amountPence: number; kind: string; status: string; receiptUrl?: string | null; refundedPence?: number; paidAt?: { toDate(): Date }; createdAt?: { toDate(): Date } }

/** Mirrors the server's dueNow() only to label the button; the server recomputes the amount and the commission. */
export function amountDue(status: JobStatus, agreed: number, pay?: JobPayment) {
  if (!pay?.required) return 0
  const paid = pay.paidPence ?? 0
  if (['completed', 'closed', 'disputed'].includes(status)) return Math.max(0, agreed - paid)
  if (status !== 'awaiting_payment') return 0
  if (pay.policy === 'full_before') return Math.max(0, agreed - paid)
  if (pay.policy === 'deposit_before') return Math.max(0, Math.min(agreed, Math.max(30, Math.round(agreed * (pay.depositPercent ?? 20) / 100))) - paid)
  return 0
}

export default function PaymentPanel({ jobId, status, agreedPence, payment }: { jobId: string; status: JobStatus; agreedPence: number; payment?: JobPayment }) {
  const { user } = useAuth(); const toast = useToast(); const [qs] = useSearchParams(); const [busy, setBusy] = useState(false)
  const pays = useQuery<Pay>(payment?.required ? 'payments' : null, () => [where('customerId', '==', user!.uid), where('jobId', '==', jobId), orderBy('createdAt', 'desc')], [jobId, user?.uid, payment?.required])
  if (!payment?.required) return null
  const due = amountDue(status, agreedPence, payment)
  const processing = qs.get('payment') === 'processing' && due > 0
  const pay = async () => { setBusy(true); try { const r = await api.createCheckout({ jobId }); window.location.assign(r.url) } catch (e) { toast('bad', errMsg(e)); setBusy(false) } }
  const done = pays.data.filter(p => ['paid', 'refunded', 'partially_refunded'].includes(p.status))
  return (
    <div className="space-y-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 font-medium"><CreditCard className="size-5 text-thor-blue" />Payment</p><Badge tone={payment.status === 'paid' ? 'ok' : payment.status === 'unpaid' ? 'warn' : 'info'}>{payment.status.replace('_', ' ')}</Badge></div>
      <dl className="space-y-1 text-sm"><div className="flex justify-between"><dt className="text-thor-text">Agreed total</dt><dd className="font-semibold">{gbp(agreedPence)}</dd></div>
        <div className="flex justify-between"><dt className="text-thor-text">Paid so far</dt><dd>{gbp(payment.paidPence ?? 0)}</dd></div>
        {(payment.refundedPence ?? 0) > 0 && <div className="flex justify-between"><dt className="text-thor-text">Refunded</dt><dd>{gbp(payment.refundedPence)}</dd></div>}</dl>
      <p className="text-xs text-thor-text">{PAYMENT_POLICY_LABEL[payment.policy]}. You pay Thor Computer Ltd securely through Stripe; your engineer is paid through the platform.</p>
      {processing ? <p className="flex items-center gap-2 rounded-xl bg-thor-sky/20 p-3 text-sm text-thor-blue-700" role="status"><Loader2 className="size-4 animate-spin" />We’re confirming your payment with Stripe. This page updates automatically.</p>
        : due > 0 && <Button variant="cta" size="lg" className="w-full" loading={busy} onClick={pay}><Lock className="size-4" />Pay {gbp(due)} securely</Button>}
      {qs.get('payment') === 'cancelled' && due > 0 && <p className="text-xs text-thor-text">Payment was cancelled. You haven’t been charged.</p>}
      {done.length > 0 && <ul className="divide-y divide-ink/8 border-t border-ink/8 pt-2 text-sm">{done.map(p => <li key={p.id} className="flex items-center gap-2 py-2"><ReceiptText className="size-4 text-thor-blue" /><span className="flex-1 capitalize">{p.kind} · {p.paidAt?.toDate().toLocaleDateString('en-GB')}</span><span>{gbp(p.amountPence)}</span>
        {(p.refundedPence ?? 0) > 0 && <Badge tone="neutral">{gbp(p.refundedPence!)} refunded</Badge>}{p.receiptUrl && <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-thor-blue hover:underline">Receipt</a>}</li>)}</ul>}
    </div>)
}
