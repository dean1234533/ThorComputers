import { useEffect, useState } from 'react'
import { limit, orderBy } from 'firebase/firestore'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, Input, Section, Select, Textarea, useToast } from '@/components/ui'
import { DEFAULT_SLA_HOURS } from './ProgressBoard'
import { DEVICE_TYPES, PAYMENT_POLICY_LABEL, PaymentPolicy, gbp, commissionPence } from '@/types/domain'

interface Pub {
  marketplace?: { requestsEnabled: boolean; biddingEnabled: boolean; maxBidsPerJob: number; quoteExpiryMaxDays: number; publishMode: 'auto' | 'review'; maxRequestsPerDay: number; enabledDevices: string[] }
  payments?: { enabled: boolean; commissionBps: number; policy: PaymentPolicy; depositPercent: number; refundApplicationFee: boolean; cancellationFeePence: number; refundPolicyText: string; methods: string[] }
}
const Toggle = ({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-thor-blue" checked={on} onChange={e => set(e.target.checked)} />{label}</label>

export function SlaSection() {
  const toast = useToast(); const d = useDoc<{ sla?: { hours: Record<string, number> } }>('platformSettings/public')
  const [h, setH] = useState<Record<string, number> | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!d.loading) setH({ ...DEFAULT_SLA_HOURS, ...d.data?.sla?.hours }) }, [d.loading, d.data])
  if (!h) return null
  const save = async () => { setBusy(true); try { await api.saveSlaSettings({ hours: h }); toast('ok', 'Target times saved.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return <Section title="Work-in-progress target times (hours per stage)"><p className="mb-3 text-sm text-thor-text">Jobs that stay in a stage longer than this are flagged red on the Work in progress board.</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{Object.keys(DEFAULT_SLA_HOURS).map(k => <Input key={k} label={k.replace(/_/g, ' ')} type="number" min={1} value={h[k]} onChange={e => setH({ ...h, [k]: Number(e.target.value) })} />)}</div>
    <Button className="mt-3" onClick={save} loading={busy}>Save target times</Button></Section>
}

export function MarketplaceSection() {
  const toast = useToast(); const d = useDoc<Pub>('platformSettings/public')
  const [m, setM] = useState<NonNullable<Pub['marketplace']> | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!d.loading) setM({ requestsEnabled: true, biddingEnabled: true, maxBidsPerJob: 10, quoteExpiryMaxDays: 30, publishMode: 'auto', maxRequestsPerDay: 10, enabledDevices: DEVICE_TYPES.map(x => x.id), ...d.data?.marketplace }) }, [d.loading, d.data])
  if (!m) return null
  const save = async () => { setBusy(true); try { await api.saveMarketplaceSettings(m); toast('ok', 'Marketplace settings saved.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return (
    <Section title="Marketplace rules"><div className="space-y-3">
      <Toggle label="Accept new repair requests" on={m.requestsEnabled} set={v => setM({ ...m, requestsEnabled: v })} /><Toggle label="Allow engineers to send quotations" on={m.biddingEnabled} set={v => setM({ ...m, biddingEnabled: v })} />
      <Select label="New requests" value={m.publishMode} onChange={e => setM({ ...m, publishMode: e.target.value as 'auto' })}><option value="auto">Publish to engineers immediately</option><option value="review">Hold for admin verification before publishing</option></Select>
      <div className="grid gap-3 sm:grid-cols-3"><Input label="Maximum quotes per job" type="number" value={m.maxBidsPerJob} onChange={e => setM({ ...m, maxBidsPerJob: Number(e.target.value) })} /><Input label="Maximum quote validity (days)" type="number" value={m.quoteExpiryMaxDays} onChange={e => setM({ ...m, quoteExpiryMaxDays: Number(e.target.value) })} /><Input label="Requests per customer per day" type="number" value={m.maxRequestsPerDay} onChange={e => setM({ ...m, maxRequestsPerDay: Number(e.target.value) })} /></div>
      <fieldset><legend className="mb-2 text-sm font-medium">Device categories accepted</legend><div className="flex flex-wrap gap-2">{DEVICE_TYPES.map(t => <label key={t.id} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-ink/10"><input type="checkbox" className="accent-thor-blue" checked={m.enabledDevices.includes(t.id)} onChange={e => setM({ ...m, enabledDevices: e.target.checked ? [...m.enabledDevices, t.id] : m.enabledDevices.filter(x => x !== t.id) })} />{t.label}</label>)}</div></fieldset>
      <p className="text-xs text-thor-text">Email verification is always required before customers post requests or accept quotes, and engineers must be approved before they can bid. These are security controls and cannot be switched off.</p>
      <Button onClick={save} loading={busy}>Save marketplace rules</Button></div></Section>)
}

/** Commission and payment policy: super administrators only (enforced by savePaymentSettings on the server). */
export function PaymentsSection() {
  const toast = useToast(); const { perms } = useAuth(); const d = useDoc<Pub>('platformSettings/public')
  const [p, setP] = useState<(Omit<NonNullable<Pub['payments']>, 'commissionBps'> & { commissionPercent: number }) | null>(null); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!d.loading) { const x = { enabled: false, commissionBps: 1500, policy: 'full_before' as PaymentPolicy, depositPercent: 20, refundApplicationFee: true, cancellationFeePence: 0, refundPolicyText: '', methods: ['card'], ...d.data?.payments }; const { commissionBps, ...rest } = x; setP({ ...rest, commissionPercent: commissionBps / 100 }) } }, [d.loading, d.data])
  if (!perms.includes('payments.configure') || !p) return null
  const save = async () => { setBusy(true); try { await api.savePaymentSettings({ ...p, reason }); toast('ok', 'Payment settings saved.'); setReason('') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const ex = Math.round(p.commissionPercent * 100)
  return (
    <Section title="Payments & commission (super admin)"><div className="space-y-3">
      <Toggle label="Collect payments through Stripe Connect" on={p.enabled} set={v => setP({ ...p, enabled: v })} />
      {!p.enabled && <p className="rounded-xl bg-warn/10 p-3 text-xs">While off, accepted quotes go straight to booking and no payment is collected. Turn on only after Stripe keys and webhooks are configured (see Finance for status).</p>}
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Thor Computer commission (%)" type="number" step="0.01" value={p.commissionPercent} onChange={e => setP({ ...p, commissionPercent: Number(e.target.value) })} hint={`£100 → Thor ${gbp(commissionPence(10000, ex))}, engineer ${gbp(10000 - commissionPence(10000, ex))}`} />
        <Select label="When customers pay" value={p.policy} onChange={e => setP({ ...p, policy: e.target.value as PaymentPolicy })}>{Object.entries(PAYMENT_POLICY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
      {p.policy === 'deposit_before' && <Input label="Deposit (% of the agreed price)" type="number" value={p.depositPercent} onChange={e => setP({ ...p, depositPercent: Number(e.target.value) })} hint="Commission is charged once on the combined total: each payment carries its share, so deposit + balance never exceed the rate on the total." />}
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Cancellation charge (£) kept when a paid job is cancelled" type="number" step="0.01" value={p.cancellationFeePence / 100} onChange={e => setP({ ...p, cancellationFeePence: Math.round(Number(e.target.value) * 100) })} /><div className="self-end"><Toggle label="Refund the commission proportionally on refunds" on={p.refundApplicationFee} set={v => setP({ ...p, refundApplicationFee: v })} /></div></div>
      <Textarea label="Refund and cancellation policy (shown to customers)" value={p.refundPolicyText} onChange={e => setP({ ...p, refundPolicyText: e.target.value })} maxLength={2000} />
      <fieldset><legend className="mb-2 text-sm font-medium">Payment methods offered in Checkout</legend><div className="flex flex-wrap gap-2">{['card', 'link', 'paypal', 'klarna', 'revolut_pay'].map(m => <label key={m} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-ink/10"><input type="checkbox" className="accent-thor-blue" checked={p.methods.includes(m)} onChange={e => setP({ ...p, methods: e.target.checked ? [...p.methods, m] : p.methods.filter(x => x !== m) })} />{m.replace('_', ' ')}</label>)}</div><p className="mt-1 text-xs text-thor-text">Each method must also be enabled in your Stripe Dashboard.</p></fieldset>
      <p className="text-xs text-thor-text">Commission policy: the rate is fixed on each quotation when the engineer sends it. A change applies only to quotations sent afterwards; accepted quotations never change.</p>
      <Input label="Reason for this change (audit log)" value={reason} onChange={e => setReason(e.target.value)} />
      <Button onClick={save} loading={busy} disabled={reason.trim().length < 5}>Save payment settings</Button></div></Section>)
}

interface Bot { enabled: boolean; welcome: string; dailyLimitPerUser: number; maxTurns: number; model: string; useCases: string[]; knowledge: { id: string; title: string; body: string; enabled: boolean }[]; escalationNote: string }
const USE_CASES = [['repair_request', 'Creating repair requests'], ['job_status', 'Checking job progress'], ['quotes', 'Understanding quotations'], ['payments', 'Payment procedures'], ['appointments', 'Appointment information'], ['support', 'Contacting support']]
export function AssistantSection() {
  const toast = useToast(); const { perms } = useAuth(); const ok = perms.includes('chatbot.manage')
  const d = useDoc<Partial<Bot>>(ok ? 'platformSettings/chatbot' : null)
  const stats = useQuery<{ day: string; requests: number; escalations: number; drafts: number }>(ok ? 'chatbotStats' : null, () => [orderBy('day', 'desc'), limit(14)], [ok])
  const [b, setB] = useState<Bot | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { if (ok && !d.loading) setB({ enabled: false, welcome: 'Hi, I’m the Thor Computer assistant. Tell me what’s wrong with your device and I’ll help you request repair quotes.', dailyLimitPerUser: 30, maxTurns: 12, model: 'gemini-2.5-flash', useCases: USE_CASES.map(u => u[0]), knowledge: [], escalationNote: '', ...d.data }) }, [ok, d.loading, d.data])
  if (!ok || !b) return null
  const save = async () => { setBusy(true); try { await api.saveChatbotSettings({ ...b }); toast('ok', 'Assistant settings saved.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const tot = stats.data.reduce((t, s) => ({ r: t.r + (s.requests ?? 0), e: t.e + (s.escalations ?? 0), dr: t.dr + (s.drafts ?? 0) }), { r: 0, e: 0, dr: 0 })
  return (
    <Section title="AI assistant"><div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs"><Badge tone="info">Last 14 days: {tot.r} messages</Badge><Badge tone="info">{tot.dr} draft requests</Badge><Badge tone="warn">{tot.e} escalations</Badge></div>
      <Toggle label="Show the assistant to customers" on={b.enabled} set={v => setB({ ...b, enabled: v })} />
      <Textarea label="Welcome message" value={b.welcome} onChange={e => setB({ ...b, welcome: e.target.value })} maxLength={400} />
      <div className="grid gap-3 sm:grid-cols-3"><Input label="Messages per user per day" type="number" value={b.dailyLimitPerUser} onChange={e => setB({ ...b, dailyLimitPerUser: Number(e.target.value) })} /><Input label="Context turns kept" type="number" value={b.maxTurns} onChange={e => setB({ ...b, maxTurns: Number(e.target.value) })} /><Input label="Gemini model" value={b.model} onChange={e => setB({ ...b, model: e.target.value })} /></div>
      <fieldset><legend className="mb-2 text-sm font-medium">Supported use cases</legend><div className="flex flex-wrap gap-2">{USE_CASES.map(([id, l]) => <label key={id} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-ink/10"><input type="checkbox" className="accent-thor-blue" checked={b.useCases.includes(id)} onChange={e => setB({ ...b, useCases: e.target.checked ? [...b.useCases, id] : b.useCases.filter(x => x !== id) })} />{l}</label>)}</div></fieldset>
      <div><p className="mb-2 text-sm font-medium">Approved knowledge sources</p><p className="mb-2 text-xs text-thor-text">The assistant may only rely on these texts for Thor-specific facts (opening hours, policies, FAQs). Never include prices.</p>
        {b.knowledge.map((k, i) => <div key={k.id} className="mb-3 space-y-2 rounded-xl bg-paper p-3"><div className="flex items-end gap-2"><div className="flex-1"><Input label="Title" value={k.title} onChange={e => setB({ ...b, knowledge: b.knowledge.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} /></div><Toggle label="On" on={k.enabled} set={v => setB({ ...b, knowledge: b.knowledge.map((x, j) => j === i ? { ...x, enabled: v } : x) })} /><Button size="sm" variant="ghost" className="text-bad" onClick={() => setB({ ...b, knowledge: b.knowledge.filter((_, j) => j !== i) })}>Remove</Button></div>
          <Textarea label="Content" value={k.body} onChange={e => setB({ ...b, knowledge: b.knowledge.map((x, j) => j === i ? { ...x, body: e.target.value } : x) })} maxLength={4000} /></div>)}
        <Button size="sm" variant="soft" onClick={() => setB({ ...b, knowledge: [...b.knowledge, { id: Date.now().toString(36), title: '', body: '', enabled: true }] })}>Add knowledge source</Button></div>
      <Input label="Escalation note" hint="Shown to support staff on tickets created from the assistant" value={b.escalationNote} onChange={e => setB({ ...b, escalationNote: e.target.value })} />
      <p className="text-xs text-thor-text">Conversations are not stored by Thor Computer; only daily counts are kept. The assistant cannot take actions: customers always review and submit requests themselves. Requires the GEMINI_API_KEY secret.</p>
      <Button onClick={save} loading={busy}>Save assistant settings</Button></div></Section>)
}
