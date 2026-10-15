import { useEffect, useState } from 'react'
import { limit, orderBy } from 'firebase/firestore'
import { Download, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { gbp } from '@/types/domain'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Sheet, Textarea, useToast } from '@/components/ui'

interface Row { id: string; reference: string; paidAt: number | null; totalPence: number; commissionPence: number; commissionBps: number; engineerSharePence: number; stripeFeePence: number | null; refundedPence: number; status: string; payoutStatus: string; source: string | null }
interface Dispute { amountPence: number; reason?: string; status: string; reference?: string; resolution?: string | null; dueBy?: number | null }
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = { paid: 'ok', partially_refunded: 'warn', refunded: 'neutral', disputed: 'bad' }

export default function AdminFinance() {
  const { can, isSuperAdmin } = useAuth()
  const enabled = can('finance.view')
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [s, setS] = useState<any>(null), [err, setErr] = useState(''), [refund, setRefund] = useState<Row | null>(null), [resolve, setResolve] = useState<string | null>(null)
  const disputes = useQuery<Dispute>(enabled ? 'paymentDisputes' : null, () => [orderBy('updatedAt', 'desc'), limit(20)], [enabled])
  const load = () => { setErr(''); api.adminFinanceStats({ from: from || undefined, to: to || undefined }).then(setS).catch(e => setErr(errMsg(e))) }
  useEffect(() => { if (enabled) load() }, [enabled, from, to])   // eslint-disable-line
  if (!enabled) return <EmptyState icon={ShieldCheck} title="No access" body="Financial reporting needs the finance permission (Super Administrator)." />
  if (err) return <EmptyState icon={ShieldCheck} title="Can’t load finance" body={err} />
  const csv = () => {
    const head = ['Reference', 'Paid at', 'Total GBP', 'Commission GBP', 'Commission %', 'Engineer share GBP', 'Stripe fee GBP', 'Refunded GBP', 'Status', 'Payout', 'Source']
    const lines = (s?.rows as Row[]).map(r => [r.reference, r.paidAt ? new Date(r.paidAt).toISOString() : '', r.totalPence / 100, r.commissionPence / 100, r.commissionBps / 100, r.engineerSharePence / 100, r.stripeFeePence == null ? '' : r.stripeFeePence / 100, r.refundedPence / 100, r.status, r.payoutStatus, r.source ?? ''].join(','))
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })); a.download = `thor-finance-${from || 'all'}-${to || 'now'}.csv`; a.click()
  }
  const tiles: [string, string][] = s ? [['Gross transaction value', gbp(s.gross)], ['Platform commission', gbp(s.commission)], ['Engineer share', gbp(s.engineerShare)], ['Stripe processing fees', gbp(s.stripeFees)], ['Refunds', gbp(s.refunds)], ['Commission refunded', gbp(s.commissionRefunded)],
    ['Net platform revenue', gbp(s.netPlatformRevenue)], ['Pending payouts', `${gbp(s.pendingPayoutPence)} (${s.pendingPayoutCount})`], ['Completed payouts', gbp(s.completedPayoutPence)], ['Awaiting payment', String(s.outstandingPaymentCount)], ['Open disputes', String(s.openDisputes)], ['Paid transactions', String(s.count)]] : []
  return (
    <div><PageHeader title="Finance" sub="Built only from payments Stripe has confirmed to us." action={<Button variant="soft" disabled={!s?.rows?.length} onClick={csv}><Download className="size-4" />Export CSV</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3"><Input label="From" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input label="To" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      {!s ? <ListSkeleton rows={3} /> : <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{tiles.map(([l, v]) => <div key={l} className="surface p-4"><p className="text-xs text-thor-text">{l}</p><p className="font-display text-2xl">{v}</p></div>)}</div>
        <p className="mt-2 text-xs text-thor-text">Net platform revenue = commission − commission refunded − Stripe fees (Thor Computer pays Stripe’s fee on these destination charges). It is revenue, not profit: advertising, operating costs and tax are not deducted.</p>
        <Section title="Transactions">{s.rows.length === 0 ? <p className="text-sm text-thor-text">No paid transactions in this period.</p> :
          <div className="overflow-x-auto rounded-3xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[820px] text-left text-sm"><thead className="text-xs uppercase text-thor-text"><tr>{['Job', 'Paid', 'Total', 'Commission', 'Engineer', 'Fee', 'Refunded', 'Status', 'Payout', ''].map(h => <th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-ink/8">{(s.rows as Row[]).map(r => <tr key={r.id}><td className="px-3 py-3 font-medium">{r.reference}{r.source && <Badge tone="brand">{r.source}</Badge>}</td><td className="px-3 py-3">{r.paidAt ? new Date(r.paidAt).toLocaleDateString('en-GB') : '—'}</td>
              <td className="px-3 py-3">{gbp(r.totalPence)}</td><td className="px-3 py-3">{gbp(r.commissionPence)} <span className="text-xs text-thor-text">({r.commissionBps / 100}%)</span></td><td className="px-3 py-3">{gbp(r.engineerSharePence)}</td><td className="px-3 py-3">{r.stripeFeePence == null ? '—' : gbp(r.stripeFeePence)}</td>
              <td className="px-3 py-3">{r.refundedPence ? gbp(r.refundedPence) : '—'}</td><td className="px-3 py-3"><Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge></td><td className="px-3 py-3">{r.payoutStatus}</td>
              <td className="px-3 py-3">{can('payments.manage') && ['paid', 'partially_refunded'].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setRefund(r)}>Refund</Button>}</td></tr>)}</tbody></table></div>}</Section></>}
      <Section title="Payment disputes (chargebacks)"><ul className="divide-y divide-ink/8 surface px-5 text-sm">{disputes.data.length === 0 && <li className="py-4 text-thor-text">None.</li>}
        {disputes.data.map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{d.reference ?? d.id} · {gbp(d.amountPence)}</p><p className="text-xs text-thor-text">{d.reason} · Stripe status: {d.status}{d.dueBy ? ` · respond by ${new Date(d.dueBy * 1000).toLocaleDateString('en-GB')}` : ''}</p></div>
          {d.resolution ? <Badge tone="ok">Recorded: {d.resolution}</Badge> : can('payments.manage') && <Button size="sm" variant="soft" onClick={() => setResolve(d.id)}>Record outcome</Button>}</li>)}</ul>
        <p className="mt-2 text-xs text-thor-text">Submit evidence in the Stripe Dashboard before the deadline; record the decision here for the audit trail.</p></Section>
      {isSuperAdmin ? <FinanceSettings /> : <p className="mt-6 text-xs text-thor-text">Only a Super Administrator can change the commission rate or payment rules.</p>}
      {refund && <RefundSheet row={refund} onClose={() => setRefund(null)} onDone={load} />}
      {resolve && <ResolveSheet id={resolve} onClose={() => setResolve(null)} />}
    </div>)
}

function RefundSheet({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const left = row.totalPence - row.refundedPence; const [pounds, setPounds] = useState((left / 100).toFixed(2)), [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  const pence = Math.round(Number(pounds) * 100)
  return <Sheet open onClose={onClose} title={`Refund ${row.reference}`}><div className="space-y-4 text-sm">
    <p>Up to <b>{gbp(left)}</b> can be refunded. The engineer’s share and Thor’s commission are returned in proportion. The record changes only when Stripe confirms.</p>
    <Input label="Refund amount (£)" type="number" min="0.01" step="0.01" value={pounds} onChange={e => setPounds(e.target.value)} /><Textarea label="Reason (kept in the audit log)" value={reason} onChange={e => setReason(e.target.value)} />
    <Button variant="danger" loading={busy} disabled={!(pence > 0 && pence <= left) || reason.trim().length < 5} onClick={async () => { setBusy(true); try { await api.refundTransaction({ transactionId: row.id, amountPence: pence, reason }); toast('ok', 'Refund requested.'); onDone(); onClose() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }}>Refund {Number.isFinite(pence) ? gbp(pence) : ''}</Button></div></Sheet>
}
function ResolveSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast(); const [v, setV] = useState({ resolution: 'won', note: '', customerComplaint: '', engineerResponse: '' }), [busy, setBusy] = useState(false)
  return <Sheet open onClose={onClose} title="Record dispute outcome"><div className="space-y-3 text-sm">
    <label className="block"><span className="text-thor-text">Outcome</span><select className="mt-1 w-full rounded-xl border border-ink/15 bg-white p-3" value={v.resolution} onChange={e => setV({ ...v, resolution: e.target.value })}><option value="won">Won</option><option value="lost">Lost</option><option value="refunded">Refunded</option><option value="withdrawn">Withdrawn</option></select></label>
    <Textarea label="Customer complaint" value={v.customerComplaint} onChange={e => setV({ ...v, customerComplaint: e.target.value })} /><Textarea label="Engineer response" value={v.engineerResponse} onChange={e => setV({ ...v, engineerResponse: e.target.value })} /><Textarea label="Decision and notes" value={v.note} onChange={e => setV({ ...v, note: e.target.value })} />
    <Button loading={busy} disabled={v.note.trim().length < 5} onClick={async () => { setBusy(true); try { await api.resolvePaymentDispute({ disputeId: id, ...v, resolution: v.resolution as 'won' }); toast('ok', 'Recorded.'); onClose() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }}>Save outcome</Button></div></Sheet>
}
function FinanceSettings() {
  const toast = useToast(); const d = useDoc<{ commissionBps: number; requirePaymentBeforeBooking: boolean; refundPolicy?: string; cancellationPolicy?: string }>('platformSettings/finance')
  const [pct, setPct] = useState('15'), [pay, setPay] = useState(false), [refundPolicy, setRefundPolicy] = useState(''), [cancel, setCancel] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { if (d.data) { setPct(String(d.data.commissionBps / 100)); setPay(!!d.data.requirePaymentBeforeBooking); setRefundPolicy(d.data.refundPolicy ?? ''); setCancel(d.data.cancellationPolicy ?? '') } }, [d.data])
  const bps = Math.round(Number(pct) * 100)
  return <Section title="Commission & payment rules (Super Administrator)"><div className="surface space-y-4 p-5 text-sm">
    <Input label="Commission (%)" type="number" min="0" max="30" step="0.5" value={pct} onChange={e => setPct(e.target.value)} hint="Default 15%. Applies to quotations accepted from now on; already-accepted quotations keep the rate they were accepted at." />
    <label className="flex items-center gap-2"><input type="checkbox" checked={pay} onChange={e => setPay(e.target.checked)} />Customers must pay in full before they can book an appointment</label>
    <Textarea label="Refund policy (shown to the AI assistant)" value={refundPolicy} onChange={e => setRefundPolicy(e.target.value)} /><Textarea label="Cancellation charges" value={cancel} onChange={e => setCancel(e.target.value)} />
    <Button loading={busy} disabled={!(bps >= 0 && bps <= 3000)} onClick={async () => { if (!confirm(`Set the commission to ${bps / 100}% for new quotations?`)) return; setBusy(true); try { await api.saveFinanceSettings({ commissionBps: bps, requirePaymentBeforeBooking: pay, refundPolicy, cancellationPolicy: cancel }); toast('ok', 'Saved and recorded in the audit log.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }}>Save</Button></div></Section>
}
