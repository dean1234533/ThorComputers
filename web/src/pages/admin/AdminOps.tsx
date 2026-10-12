import { useState } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { Gavel, LifeBuoy } from 'lucide-react'
import { useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Select, Sheet, Textarea, useToast } from '@/components/ui'
import { Gate, poundsStr, useCan } from '@/components/admin'
import { ticketTone, Ticket } from '../shared/Support'

interface Dispute { jobId: string; reference: string; customerId: string; engineerId: string | null; complaint: string; engineerResponse: string | null; status: string; paymentStatus: string; paidPence: number; agreedTotalPence: number; resolution: { outcome: string; text: string; refund: { amount: number } | null } | null; createdAt?: { toDate(): Date } }
const rid = () => crypto.getRandomValues(new Uint32Array(3)).join('-')

export function AdminDisputes() {
  const toast = useToast(); const can = useCan(); const [st, setSt] = useState('open')
  const d = useQuery<Dispute>('disputes', () => [where('status', '==', st), orderBy('createdAt', 'desc'), limit(100)], [st])
  const [open, setOpen] = useState<(Dispute & { id: string }) | null>(null)
  const pays = useQuery<{ amountPence: number; refundedPence?: number; status: string; kind: string }>(open && can('payments.manage') ? 'payments' : null, () => [where('jobId', '==', open!.jobId), where('status', 'in', ['paid', 'partially_refunded'])], [open?.jobId])
  const [f, setF] = useState({ outcome: 'closed', resolution: '', paymentId: '', refund: '' }); const [busy, setBusy] = useState(false)
  const resolve = async () => { if (!open) return; setBusy(true); try {
    await api.resolveDispute({ jobId: open.jobId, outcome: f.outcome as 'closed', resolution: f.resolution.trim(), refund: f.paymentId && f.refund ? { paymentId: f.paymentId, amountPence: Math.round(Number(f.refund) * 100) } : undefined, requestKey: rid() })
    toast('ok', 'Dispute resolved.'); setOpen(null); setF({ outcome: 'closed', resolution: '', paymentId: '', refund: '' }) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return (
    <Gate perm="disputes.manage"><div><PageHeader title="Disputes" sub="Problems raised on repairs: complaint, engineer response, payment status and decision." action={<div className="w-36"><Select label="" aria-label="Status" value={st} onChange={e => setSt(e.target.value)}><option value="open">Open</option><option value="resolved">Resolved</option></Select></div>} />
      {d.loading ? <ListSkeleton /> : d.data.length === 0 ? <EmptyState icon={Gavel} title="No disputes" body="Nothing with this status." /> :
        <ul className="space-y-3">{d.data.map(x => <li key={x.id}><button onClick={() => setOpen(x)} className="surface w-full p-5 text-left"><div className="flex flex-wrap items-center justify-between gap-2"><b>{x.reference}</b><span className="flex gap-2"><Badge tone="info">payment {x.paymentStatus}</Badge><Badge tone={x.engineerResponse ? 'ok' : 'warn'}>{x.engineerResponse ? 'engineer responded' : 'awaiting engineer'}</Badge></span></div><p className="mt-2 line-clamp-2 text-sm text-thor-text">{x.complaint}</p></button></li>)}</ul>}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={`Dispute ${open?.reference ?? ''}`}>{open && <div className="space-y-3 text-sm">
        <p><b>Customer complaint:</b> {open.complaint}</p><p><b>Engineer response:</b> {open.engineerResponse ?? <i className="text-thor-text">none yet</i>}</p>
        <p><b>Payment:</b> {open.paymentStatus} · {poundsStr(open.paidPence)} paid of {poundsStr(open.agreedTotalPence)}</p><Link className="text-thor-blue underline" to="/admin/jobs">Open repair requests</Link>
        {open.resolution ? <p className="rounded-xl bg-ok/10 p-3"><b>Decision ({open.resolution.outcome}):</b> {open.resolution.text}{open.resolution.refund ? ` · refund ${poundsStr(open.resolution.refund.amount)}` : ''}</p> : <>
          <Select label="Outcome" value={f.outcome} onChange={e => setF({ ...f, outcome: e.target.value })}><option value="closed">Close the job (no further action)</option><option value="completed">Back to completed (customer to confirm)</option><option value="cancelled">Cancel the job</option></Select>
          <Textarea label="Decision (shared with both parties, audited)" value={f.resolution} onChange={e => setF({ ...f, resolution: e.target.value })} maxLength={2000} />
          {can('payments.manage') && pays.data.length > 0 && <div className="grid grid-cols-2 gap-2"><Select label="Refund payment" value={f.paymentId} onChange={e => setF({ ...f, paymentId: e.target.value })}><option value="">No refund</option>{pays.data.map(p => <option key={p.id} value={p.id}>{p.kind} {poundsStr(p.amountPence - (p.refundedPence ?? 0))}</option>)}</Select><Input label="Refund (£)" inputMode="decimal" value={f.refund} onChange={e => setF({ ...f, refund: e.target.value })} /></div>}
          <Button className="w-full" loading={busy} disabled={f.resolution.trim().length < 10} onClick={resolve}>Record decision</Button></>}
      </div>}</Sheet></div></Gate>)
}

export function AdminSupport() {
  const [st, setSt] = useState('open')
  const t = useQuery<Ticket>('supportTickets', () => [where('status', '==', st), orderBy('lastMessageAt', 'desc'), limit(100)], [st])
  return (
    <Gate perm="support.handle"><div><PageHeader title="Support tickets" action={<div className="w-36"><Select label="" aria-label="Status" value={st} onChange={e => setSt(e.target.value)}><option value="open">Waiting on us</option><option value="pending">Replied</option><option value="closed">Closed</option></Select></div>} />
      {t.loading ? <ListSkeleton /> : t.data.length === 0 ? <EmptyState icon={LifeBuoy} title="Queue clear" body="No tickets with this status." /> :
        <ul className="space-y-2">{t.data.map(x => <li key={x.id}><Link to={`/admin/support/${x.id}`} className="surface flex flex-wrap items-center gap-3 p-4"><span className="min-w-0 flex-1"><b className="block truncate">{x.subject}</b><span className="text-xs text-thor-text">{x.category} · {x.lastMessageAt?.toDate().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}{x.fromChatbot ? ' · from assistant' : ''}{x.assignedTo ? ' · assigned' : ''}</span></span>
          {x.priority === 'escalated' && <Badge tone="bad">escalated</Badge>}<Badge tone={ticketTone(x.status)}>{x.status}</Badge></Link></li>)}</ul>}</div></Gate>)
}
