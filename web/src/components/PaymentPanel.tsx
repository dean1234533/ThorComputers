import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { where } from 'firebase/firestore'
import { CheckCircle2, CreditCard, Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { gbp } from '@/types/domain'
import { Link } from 'react-router-dom'
import { Badge, Button, useToast } from '@/components/ui'

interface Tx { status: string; totalPence: number; refundedPence?: number }
interface Extra { jobId: string; amountPence: number; description: string; status: 'proposed' | 'accepted' | 'declined' | 'paid' }

/** Customer-side payment. The amount is never sent from here: the server prices checkout from the accepted quotation, and a payment only counts once Stripe's signed webhook confirms it. */
export default function PaymentPanel({ jobId, agreedPence, paymentStatus, messageTo }: { jobId: string; agreedPence: number; paymentStatus?: string; messageTo?: string }) {
  const toast = useToast(); const { user } = useAuth(); const [qs] = useSearchParams(); const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const tx = useDoc<Tx>(`transactions/${jobId}`)
  const extras = useQuery<Extra>('additionalCharges', () => [where('jobId', '==', jobId), where('customerId', '==', user!.uid)], [jobId, user?.uid])
  const paid = paymentStatus === 'paid'
  const go = async (k: string, extraId?: string) => {
    setBusy(k); setErr('')
    try { const r = await api.createCheckout({ jobId, additionalChargeId: extraId }); if (r.alreadyPaid) toast('info', 'This is already paid.'); else if (r.url) window.location.assign(r.url) }
    catch (e) { const m = errMsg(e); setErr(m); toast('bad', m) } finally { setBusy('') }   // the inline message below stays until the next attempt
  }
  const answer = async (id: string, accept: boolean) => { setBusy(id); try { await api.respondAdditionalCharge({ id, accept }) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  return (
    <div className="space-y-3">
      {paid ? <div className="flex items-center gap-3 rounded-3xl bg-ok/10 p-5"><CheckCircle2 className="size-6 text-ok" /><div><p className="font-medium text-ok">Paid · {gbp(tx.data?.totalPence ?? agreedPence)}</p>
        <p className="text-sm text-thor-text">Your receipt was emailed by our payment provider.{tx.data?.refundedPence ? ` ${gbp(tx.data.refundedPence)} has been refunded.` : ''}</p></div></div>
        : <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-display text-xl">{gbp(agreedPence)}</p><p className="text-sm text-thor-text">Agreed price including any call-out and diagnostic fees.</p></div>
          <Button variant="cta" size="lg" loading={busy === 'main'} onClick={() => go('main')}><CreditCard className="size-5" />Pay securely</Button></div>
          {err && <div role="alert" className="mt-3 rounded-2xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad"><p className="font-medium">We couldn’t start your payment</p><p>{err}</p>{messageTo && /payment/i.test(err) && <Link to={messageTo} className="mt-2 inline-block font-medium text-thor-blue underline">Message your engineer</Link>}</div>}
          {tx.data?.status === 'payment_failed' && <p className="mt-3 text-sm text-bad">Your last payment didn’t go through. Please try again or use a different card.</p>}
          {qs.get('paid') === '1' && <p className="mt-3 text-sm text-thor-text" role="status">Thanks. We’re waiting for the payment provider to confirm. This page updates automatically.</p>}
          {qs.get('paid') === '0' && <p className="mt-3 text-sm text-thor-text">Payment was cancelled. You haven’t been charged.</p>}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-thor-text"><Lock className="size-3.5" />Card details are entered on Stripe’s secure page; Thor Computer never sees them.</p></div>}
      {extras.data.map(x => <div key={x.id} className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-ink/5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Extra work: {gbp(x.amountPence)}</p><p className="text-thor-text">{x.description}</p></div>
        {x.status === 'proposed' && <div className="flex gap-2"><Button size="sm" loading={busy === x.id} onClick={() => answer(x.id, true)}>Approve</Button><Button size="sm" variant="ghost" onClick={() => answer(x.id, false)}>Decline</Button></div>}
        {x.status === 'accepted' && <Button size="sm" variant="cta" loading={busy === x.id + 'p'} onClick={() => go(x.id + 'p', x.id)}>Pay {gbp(x.amountPence)}</Button>}
        {x.status === 'paid' && <Badge tone="ok">Paid</Badge>}{x.status === 'declined' && <Badge tone="neutral">Declined</Badge>}</div></div>)}
    </div>)
}
