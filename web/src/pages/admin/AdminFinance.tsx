import { useEffect, useState } from 'react'
import { limit, orderBy, where } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2, CreditCard } from 'lucide-react'
import { useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Select, Sheet, Textarea, useToast } from '@/components/ui'
import { BarChart, byDay, downloadCsv, ExportButton, Gate, poundsStr, RangePicker, Range, rangeToIso, Stat, useCan } from '@/components/admin'

interface Pay { reference: string; jobId: string; kind: string; amountPence: number; applicationFeePence: number; status: string; refundedPence?: number; paidAt?: { toDate(): Date }; createdAt?: { toDate(): Date } }
const rid = () => crypto.getRandomValues(new Uint32Array(3)).join('-')

export default function AdminFinance() {
  const can = useCan(); const toast = useToast(); const [range, setRange] = useState<Range>({ days: 30 })
  const [r, setR] = useState<any>(null); const [status, setStatus] = useState<Awaited<ReturnType<typeof api.paymentsStatus>> | null>(null)
  useEffect(() => { api.paymentsStatus({}).then(setStatus).catch(() => undefined) }, [])
  useEffect(() => { setR(null); api.financeReport(rangeToIso(range)).then(setR).catch(e => toast('bad', errMsg(e))) /* eslint-disable-next-line */ }, [range.days])
  const [pst, setPst] = useState('paid')
  const pays = useQuery<Pay>('payments', () => [where('status', '==', pst), orderBy('createdAt', 'desc'), limit(100)], [pst])
  const disputes = useQuery<{ reference: string | null; amountPence: number; reason: string; status: string; evidenceDueBy?: { toDate(): Date } | null }>('paymentDisputes', () => [orderBy('createdAt', 'desc'), limit(50)], [])
  const history = useQuery<{ fromBps: number; toBps: number; reason: string; effectiveFrom: { toDate(): Date } }>('commissionHistory', () => [orderBy('effectiveFrom', 'desc'), limit(20)], [])
  const [refund, setRefund] = useState<(Pay & { id: string }) | null>(null); const [amt, setAmt] = useState(''); const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false)
  const doRefund = async () => { if (!refund) return; setBusy(true); try { await api.refundPayment({ paymentId: refund.id, amountPence: amt ? Math.round(Number(amt) * 100) : undefined, reason: why, requestKey: rid() }); toast('ok', 'Refund requested. It is confirmed when Stripe reports it.'); setRefund(null); setAmt(''); setWhy('') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const chart = r ? byDay(Object.fromEntries(Object.entries<any>(r.perDay).map(([k, v]) => [k, v.commission])), range.days) : []
  return (
    <Gate perm="finance.view"><div><PageHeader title="Finance" sub="Stripe Connect marketplace payments in GBP. All figures come from verified Stripe webhooks." action={<div className="flex items-end gap-2"><RangePicker value={range} onChange={setRange} /><ExportButton onClick={() => downloadCsv(`thor-transactions-${range.days}d.csv`, r?.rows ?? [])} disabled={!r?.rows?.length} /></div>} />
      {status && <div className={`mb-5 flex flex-wrap items-center gap-3 rounded-2xl p-4 text-sm ${status.configured && status.enabled ? 'bg-ok/10' : 'bg-warn/10'}`}>{status.configured && status.enabled ? <CheckCircle2 className="size-5 text-ok" /> : <AlertTriangle className="size-5 text-warn" />}
        <span className="flex-1">Stripe {status.configured ? `configured (${status.mode} mode)` : 'NOT configured'} · payments {status.enabled ? 'ON' : 'OFF (jobs proceed without payment collection)'} · webhook secret {status.webhookSecret ? 'set' : 'missing'} · Connect webhook secret {status.connectWebhookSecret ? 'set' : 'missing'} · last event {status.lastEventAt ? new Date(status.lastEventAt).toLocaleString('en-GB') : 'never'}{status.lastError ? ` · last error: ${status.lastError}` : ''}</span></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Gross transaction value" value={r && poundsStr(r.grossPence)} /><Stat label="Platform commission" value={r && poundsStr(r.commissionPence)} tone="ok" /><Stat label="Engineer share" value={r && poundsStr(r.engineerSharePence)} /><Stat label="Stripe processing fees" value={r && poundsStr(r.stripeFeesPence)} hint={r?.feesUnknown ? `${r.feesUnknown} payment(s) without fee data yet` : undefined} />
        <Stat label="Refunds" value={r && poundsStr(r.refundsPence)} hint={r ? `of which commission ${poundsStr(r.commissionRefundedPence)}` : undefined} /><Stat label="Card disputes" value={r && `${r.disputes} · ${poundsStr(r.disputedPence)}`} tone={r?.disputes ? 'bad' : undefined} /><Stat label="Net platform revenue" value={r && poundsStr(r.netPlatformRevenuePence)} hint="Commission − refunded commission − Stripe fees − lost disputes. Not profit." tone="ok" />
        <Stat label="Outstanding payments" value={r && `${r.outstandingPayments} · ${poundsStr(r.outstandingPence)}`} /><Stat label="Engineer payouts completed" value={r && poundsStr(r.payoutsPaidPence)} /><Stat label="Engineer payouts pending" value={r && poundsStr(r.payoutsPendingPence)} /></div>
      <Section title="Commission by day"><div className="surface p-5">{r ? <BarChart data={chart} label="Platform commission per day" format={n => poundsStr(n)} color="#FF8F34" /> : <ListSkeleton rows={1} />}</div></Section>
      <Section title="Payments" action={<div className="w-44"><Select label="" aria-label="Payment status" value={pst} onChange={e => setPst(e.target.value)}>{['paid', 'partially_refunded', 'refunded', 'open', 'processing', 'failed', 'expired'].map(x => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select></div>}>
        {pays.loading ? <ListSkeleton /> : pays.data.length === 0 ? <EmptyState icon={CreditCard} title="No payments" body="Nothing with this status." /> :
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[46rem] text-sm"><thead className="text-left text-thor-text"><tr>{['Date', 'Job', 'Type', 'Amount', 'Commission', 'Refunded', 'Status', ''].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-ink/8">{pays.data.map(p => <tr key={p.id}><td className="p-3">{(p.paidAt ?? p.createdAt)?.toDate().toLocaleDateString('en-GB')}</td><td className="p-3">{p.reference}</td><td className="p-3 capitalize">{p.kind}</td><td className="p-3">{poundsStr(p.amountPence)}</td><td className="p-3">{poundsStr(p.applicationFeePence)}</td><td className="p-3">{poundsStr(p.refundedPence ?? 0)}</td><td className="p-3"><Badge tone={p.status === 'paid' ? 'ok' : 'neutral'}>{p.status.replace('_', ' ')}</Badge></td>
              <td className="p-3">{can('payments.manage') && ['paid', 'partially_refunded'].includes(p.status) && <Button size="sm" variant="ghost" onClick={() => setRefund(p)}>Refund</Button>}</td></tr>)}</tbody></table></div>}</Section>
      <Section title="Card disputes (chargebacks)">{disputes.data.length === 0 ? <p className="text-sm text-thor-text">None.</p> : <ul className="divide-y divide-ink/8 surface px-5">{disputes.data.map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span>{d.reference ?? 'Unknown job'} · {poundsStr(d.amountPence)} · {d.reason.replace(/_/g, ' ')}</span><span className="text-xs text-thor-text">{d.evidenceDueBy ? `evidence due ${d.evidenceDueBy.toDate().toLocaleDateString('en-GB')}` : ''}</span><Badge tone={d.status === 'won' ? 'ok' : d.status === 'lost' ? 'bad' : 'warn'}>{d.status.replace(/_/g, ' ')}</Badge></li>)}</ul>}
        <p className="mt-2 text-xs text-thor-text">Respond to card disputes with evidence in the Stripe Dashboard before the deadline.</p></Section>
      <Section title="Commission rate history">{history.data.length === 0 ? <p className="text-sm text-thor-text">The default 15% has not been changed.</p> : <ul className="divide-y divide-ink/8 surface px-5 text-sm">{history.data.map(h => <li key={h.id} className="py-3">{(h.fromBps / 100).toFixed(2)}% → <b>{(h.toBps / 100).toFixed(2)}%</b> from {h.effectiveFrom.toDate().toLocaleString('en-GB')} · {h.reason}</li>)}</ul>}</Section>
      <Sheet open={!!refund} onClose={() => setRefund(null)} title={`Refund ${refund?.reference ?? ''}`}>{refund && <div className="space-y-3">
        <p className="text-sm text-thor-text">Up to {poundsStr(refund.amountPence - (refund.refundedPence ?? 0))}. The engineer’s share is reversed from their Stripe balance and commission is refunded according to the payment settings.</p>
        <Input label="Amount (£), blank for the full remaining amount" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} /><Textarea label="Reason (audit log)" value={why} onChange={e => setWhy(e.target.value)} maxLength={500} />
        <Button variant="danger" className="w-full" loading={busy} disabled={why.trim().length < 5} onClick={doRefund}>Issue refund</Button></div>}</Sheet>
    </div></Gate>)
}
