import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2, Link2, Megaphone, Plug, RefreshCw, Trash2 } from 'lucide-react'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Select, Sheet, Textarea, useToast, cx } from '@/components/ui'
import { downloadCsv, ExportButton, Gate, poundsStr, RangePicker, Range, Stat, useCan } from '@/components/admin'
import { DEVICE_TYPES, SERVICE_METHODS } from '@/types/domain'

interface Conn { status?: string; statusMessage?: string | null; metaUserName?: string; grantedScopes?: string[]; declinedScopes?: string[]; tokenExpiresAt?: { toDate(): Date } | null; pages?: { id: string; name: string; instagramUsername: string | null; subscribed: boolean; subscribeError: string | null; forms: number }[]; adAccounts?: { id: string; name: string; currency: string }[]; assetsSyncedAt?: { toDate(): Date }; lastReconcileAt?: { toDate(): Date } }
interface Health { lastWebhookAt?: { toDate(): Date }; lastLeadImportAt?: { toDate(): Date }; lastCampaignSyncAt?: { toDate(): Date }; lastError?: string | null; lastErrorAt?: { toDate(): Date }; tokenStatus?: string }
interface Campaign { name: string; status: string; effectiveStatus: string; objective: string; dailyBudgetPence: number | null; lifetimeBudgetPence: number | null; currency: string; feedsMarketplace: boolean; adAccountId: string }
interface Daily { campaignId: string; date: string; spendPence: number; impressions: number; reach: number; clicks: number; metaLeads: number }
interface LeadRow { campaignId: string | null; status: string; jobId?: string | null; quoteCount?: number; paidPence?: number }
interface Txn { attribution?: { campaignId?: string } | null; grossPence: number; commissionPence: number; refundedPence: number; jobId: string }
const TABS = [['connection', 'Connection'], ['campaigns', 'Campaigns'], ['roi', 'Performance & ROI'], ['forms', 'Lead forms'], ['settings', 'Conversion & routing'], ['webhooks', 'Webhook activity']] as const
const when = (t?: { toDate(): Date } | null) => t ? t.toDate().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : 'never'

export default function AdminMarketing() {
  const [qs, setQs] = useSearchParams(); const tab = qs.get('tab') ?? 'connection'; const toast = useToast()
  useEffect(() => { const m = qs.get('meta'); if (m) toast(m === 'connected' ? 'ok' : 'bad', { connected: 'Meta account connected.', denied: 'Meta connection was cancelled.', invalid_state: 'That connection link expired. Try again.', error: 'Meta connection failed. See Integration health.' }[m] ?? m) /* eslint-disable-next-line */ }, [])
  return (
    <Gate perm="marketing.view"><div><PageHeader title="Marketing & Lead Generation" sub="Facebook and Instagram advertising, lead capture and conversion into repair jobs." />
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setQs({ tab: id })} className={cx('shrink-0 rounded-xl px-3.5 py-2 text-sm', tab === id ? 'bg-thor-blue text-white' : 'bg-white ring-1 ring-ink/10')}>{label}</button>)}</div>
      {tab === 'connection' && <Connection />}{tab === 'campaigns' && <Campaigns />}{tab === 'roi' && <Roi />}{tab === 'forms' && <Forms />}{tab === 'settings' && <ConversionSettings />}{tab === 'webhooks' && <Webhooks />}
    </div></Gate>)
}

function Connection() {
  const toast = useToast(); const can = useCan()
  const c = useDoc<Conn>('metaConnections/default'), h = useDoc<Health>('integrationHealth/meta')
  const [busy, setBusy] = useState(''); const [confirm, setConfirm] = useState(false)
  const run = async (k: string, f: () => Promise<unknown>, ok?: string) => { setBusy(k); try { await f(); if (ok) toast('ok', ok) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  const connected = c.data?.status === 'connected'
  const required = ['ads_read', 'ads_management', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'pages_manage_metadata']
  return (<>
    <Section title="Meta account">
      <div className="surface flex flex-wrap items-center gap-4 p-5"><Plug className={cx('size-7', connected ? 'text-ok' : 'text-thor-text')} />
        <div className="min-w-0 flex-1"><p className="font-medium">{connected ? `Connected as ${c.data?.metaUserName}` : c.data?.status === 'reauth_required' ? 'Reconnection required' : 'Not connected'}</p>
          <p className="text-sm text-thor-text">{connected ? `Token expires ${when(c.data?.tokenExpiresAt)} · assets synced ${when(c.data?.assetsSyncedAt)}` : c.data?.statusMessage ?? 'Connect Thor Computer’s Facebook account through Meta’s own login. Your Facebook password never passes through this app.'}</p></div>
        {can('marketing.manage') && <div className="flex flex-wrap gap-2">
          <Button variant={connected ? 'soft' : 'cta'} loading={busy === 'c'} onClick={() => run('c', async () => window.location.assign((await api.metaAuthStart({})).url))}><Link2 className="size-4" />{connected ? 'Reconnect' : 'Connect Meta Account'}</Button>
          {connected && <Button variant="soft" loading={busy === 's'} onClick={() => run('s', () => api.metaSyncAssets({}), 'Pages, ad accounts and lead forms refreshed.')}><RefreshCw className="size-4" />Sync assets</Button>}
          {connected && <Button variant="ghost" className="text-bad" onClick={() => setConfirm(true)}><Trash2 className="size-4" />Disconnect</Button>}</div>}
      </div>
      {connected && <div className="mt-3 flex flex-wrap gap-1.5 text-xs">{required.map(p => <Badge key={p} tone={c.data?.grantedScopes?.includes(p) ? 'ok' : 'bad'}>{p}</Badge>)}</div>}
      {connected && required.some(p => !c.data?.grantedScopes?.includes(p)) && <p className="mt-2 text-xs text-warn">Some permissions were not granted. Features that need them will explain what is missing. Advanced access requires Meta App Review and business verification.</p>}
    </Section>
    <Section title="Facebook Pages and Instagram business accounts">{!c.data?.pages?.length ? <p className="text-sm text-thor-text">None yet.</p> :
      <ul className="divide-y divide-ink/8 surface px-5">{c.data.pages.map(p => <li key={p.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1"><b>{p.name}</b>{p.instagramUsername && <span className="text-thor-text"> · Instagram @{p.instagramUsername}</span>}<span className="block text-xs text-thor-text">{p.forms} lead form(s)</span></span>
        {p.subscribed ? <Badge tone="ok">Receiving leads</Badge> : <Badge tone="bad">{p.subscribeError ?? 'Not subscribed'}</Badge>}</li>)}</ul>}</Section>
    <Section title="Ad accounts">{!c.data?.adAccounts?.length ? <p className="text-sm text-thor-text">None yet.</p> : <ul className="divide-y divide-ink/8 surface px-5">{c.data.adAccounts.map(a => <li key={a.id} className="flex justify-between py-3 text-sm"><span>{a.name}</span><span className="text-thor-text">{a.id} · {a.currency}</span></li>)}</ul>}</Section>
    <Section title="Integration health"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Last webhook" value={when(h.data?.lastWebhookAt)} /><Stat label="Last lead import" value={when(h.data?.lastLeadImportAt)} /><Stat label="Last campaign sync" value={when(h.data?.lastCampaignSyncAt)} /><Stat label="Last reconciliation" value={when(c.data?.lastReconcileAt)} /></div>
      {h.data?.lastError && <p className="mt-3 flex gap-2 rounded-xl bg-bad/10 p-3 text-sm text-bad"><AlertTriangle className="size-4 shrink-0" />{h.data.lastError} ({when(h.data.lastErrorAt)})</p>}
      <p className="mt-3 text-xs text-thor-text">Webhook callback URL: <code>https://europe-west2-&lt;project&gt;.cloudfunctions.net/metaWebhook</code> (field <code>leadgen</code>, object <code>page</code>). Missed webhooks are recovered by a reconciliation job every 30 minutes.</p></Section>
    <Sheet open={confirm} onClose={() => setConfirm(false)} title="Disconnect Meta?"><p className="mb-4 text-sm text-thor-text">Stored access tokens are deleted. New leads stop arriving until you reconnect. Imported leads and jobs are kept.</p>
      <Button variant="danger" className="w-full" loading={busy === 'd'} onClick={() => run('d', async () => { await api.metaDisconnect({ confirm: true }); setConfirm(false) }, 'Disconnected.')}>Disconnect</Button></Sheet>
  </>)
}

function useCampaignData(range: Range) {
  const from = new Date(Date.now() - range.days * 86400_000).toISOString().slice(0, 10)
  const campaigns = useQuery<Campaign>('metaCampaigns', () => [limit(300)], [])
  const daily = useQuery<Daily>('metaInsightsDaily', () => [where('date', '>=', from), orderBy('date', 'desc'), limit(5000)], [from])
  return { campaigns, daily }
}

function Campaigns() {
  const toast = useToast(); const can = useCan(); const [range, setRange] = useState<Range>({ days: 30 })
  const { campaigns, daily } = useCampaignData(range)
  const [busy, setBusy] = useState(false); const [act, setAct] = useState<{ c: Campaign & { id: string }; action: 'pause' | 'resume' | 'set_daily_budget' | 'feed_marketplace' | 'stop_feeding_marketplace' } | null>(null)
  const [reason, setReason] = useState(''); const [budget, setBudget] = useState(''); const [ok, setOk] = useState(false); const [kids, setKids] = useState<{ id: string; rows: any[] } | null>(null)
  const agg = useMemo(() => { const m: Record<string, { spend: number; impressions: number; reach: number; clicks: number; leads: number }> = {}; daily.data.forEach(d => { const x = (m[d.campaignId] ??= { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }); x.spend += d.spendPence; x.impressions += d.impressions; x.reach += d.reach; x.clicks += d.clicks; x.leads += d.metaLeads }); return m }, [daily.data])
  const sync = async () => { setBusy(true); try { const r = await api.metaSyncCampaigns({ days: Math.min(90, range.days) }); toast('ok', `${r.campaigns} campaign(s) synced.`) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const submit = async () => { if (!act) return; setBusy(true); try { await api.metaUpdateCampaign({ campaignId: act.c.id, action: act.action, dailyBudgetPence: act.action === 'set_daily_budget' ? Math.round(Number(budget) * 100) : undefined, confirm: true, reason }); toast('ok', 'Campaign updated.'); setAct(null); setReason(''); setOk(false) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const children = async (id: string) => { try { setKids({ id, rows: (await api.metaListChildren({ parentId: id, level: 'adsets' })).rows }) } catch (e) { toast('bad', errMsg(e)) } }
  return (<>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><RangePicker value={range} onChange={setRange} /><Button variant="soft" loading={busy && !act} onClick={sync}><RefreshCw className="size-4" />Sync from Meta</Button></div>
    {campaigns.loading ? <ListSkeleton /> : campaigns.data.length === 0 ? <EmptyState icon={Megaphone} title="No campaigns synced" body="Connect Meta, then sync to see campaigns and their results." /> :
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[64rem] text-sm"><thead className="text-left text-thor-text"><tr>{['Campaign', 'Status', 'Objective', 'Budget', 'Spent', 'Impr.', 'Reach', 'Clicks', 'Leads', 'CPL', 'Feeds marketplace', ''].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-ink/8">{campaigns.data.map(c => { const a = agg[c.id] ?? { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }; return <tr key={c.id}>
          <td className="max-w-56 p-3"><button className="text-left font-medium text-thor-blue hover:underline" onClick={() => children(c.id)}>{c.name}</button></td><td className="p-3"><Badge tone={c.effectiveStatus === 'ACTIVE' ? 'ok' : 'neutral'}>{c.effectiveStatus?.toLowerCase().replace(/_/g, ' ')}</Badge></td><td className="p-3 text-xs">{c.objective}</td>
          <td className="p-3">{c.dailyBudgetPence !== null ? `${poundsStr(c.dailyBudgetPence)}/day` : c.lifetimeBudgetPence !== null ? `${poundsStr(c.lifetimeBudgetPence)} total` : 'Ad set level'}</td><td className="p-3">{poundsStr(a.spend)}</td><td className="p-3">{a.impressions.toLocaleString('en-GB')}</td><td className="p-3">{a.reach.toLocaleString('en-GB')}</td><td className="p-3">{a.clicks}</td><td className="p-3">{a.leads}</td><td className="p-3">{a.leads ? poundsStr(Math.round(a.spend / a.leads)) : '—'}</td>
          <td className="p-3">{c.feedsMarketplace ? <Badge tone="ok">Yes</Badge> : <Badge tone="neutral">No</Badge>}</td>
          <td className="p-3">{can('marketing.manage') && <Select label="" aria-label={`Actions for ${c.name}`} value="" onChange={e => { if (e.target.value) { setAct({ c, action: e.target.value as 'pause' }); setBudget(c.dailyBudgetPence ? String(c.dailyBudgetPence / 100) : '') } }}>
            <option value="">Actions…</option>{c.status === 'ACTIVE' ? <option value="pause">Pause</option> : <option value="resume">Resume</option>}{c.dailyBudgetPence !== null && <option value="set_daily_budget">Change daily budget</option>}<option value={c.feedsMarketplace ? 'stop_feeding_marketplace' : 'feed_marketplace'}>{c.feedsMarketplace ? 'Stop feeding marketplace' : 'Feed marketplace'}</option></Select>}</td></tr> })}</tbody></table></div>}
    <p className="mt-2 text-xs text-thor-text">Spend and results are Meta’s reported figures in the ad account currency. Nothing is ever changed automatically: every change needs confirmation, stays within the configured safety limits and is audit-logged.</p>
    <Sheet open={!!act} onClose={() => setAct(null)} title={act ? `${act.action.replace(/_/g, ' ')}: ${act.c.name}` : ''}>
      {act?.action === 'set_daily_budget' && <Input label="New daily budget (£)" inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} hint={`Current ${poundsStr(act.c.dailyBudgetPence)}. Changes are limited by Conversion & routing settings.`} />}
      <div className="mt-3"><Textarea label="Reason (audit log)" value={reason} onChange={e => setReason(e.target.value)} maxLength={300} /></div>
      {(act?.action === 'set_daily_budget' || act?.action === 'resume') && <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-thor-blue" checked={ok} onChange={e => setOk(e.target.checked)} />I confirm this {act.action === 'resume' ? 'resumes spending on' : 'changes the spend of'} this campaign in Meta Ads Manager.</label>}
      <Button className="mt-4 w-full" loading={busy} disabled={reason.trim().length < 5 || ((act?.action === 'set_daily_budget' || act?.action === 'resume') && !ok)} onClick={submit}>Confirm</Button></Sheet>
    <Sheet open={!!kids} onClose={() => setKids(null)} title="Ad sets">{kids && (kids.rows.length === 0 ? <p className="text-sm">No ad sets.</p> : <ul className="divide-y divide-ink/8 text-sm">{kids.rows.map(r => <li key={r.id} className="flex justify-between py-2"><span>{r.name}</span><span className="text-thor-text">{r.effectiveStatus?.toLowerCase()} · {r.dailyBudgetPence ? `${poundsStr(r.dailyBudgetPence)}/day` : ''}</span></li>)}</ul>)}</Sheet>
  </>)
}

/** Lead -> job -> quote -> payment -> completed, per campaign. Commission is NOT profit: ad spend, Stripe fees, refunds, costs and tax still apply. */
function Roi() {
  const can = useCan(); const [range, setRange] = useState<Range>({ days: 30 })
  const { campaigns, daily } = useCampaignData(range)
  const since = useMemo(() => new Date(Date.now() - range.days * 86400_000), [range.days])
  const leads = useQuery<LeadRow>(can('leads.manage') ? 'metaLeads' : null, () => [where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(5000)], [since.getTime()])
  const txns = useQuery<Txn>(can('finance.view') ? 'transactions' : null, () => [where('source', '==', 'meta'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(5000)], [since.getTime()])
  const rows = useMemo(() => {
    const ids = new Set([...campaigns.data.map(c => c.id), ...leads.data.map(l => l.campaignId ?? 'organic')])
    return [...ids].map(id => {
      const c = campaigns.data.find(x => x.id === id), ls = leads.data.filter(l => (l.campaignId ?? 'organic') === id), ts = txns.data.filter(t => (t.attribution?.campaignId ?? 'organic') === id)
      const spend = daily.data.filter(d => d.campaignId === id).reduce((n, d) => n + d.spendPence, 0)
      const jobs = ls.filter(l => l.jobId), paidJobs = new Set(ts.map(t => t.jobId))
      const gross = ts.reduce((n, t) => n + t.grossPence - (t.refundedPence ?? 0), 0), commission = ts.reduce((n, t) => n + t.commissionPence, 0)
      return { id, name: c?.name ?? (id === 'organic' ? 'Organic / no campaign' : id), spend, leads: ls.length, valid: ls.filter(l => !['rejected', 'duplicate'].includes(l.status)).length, published: jobs.length,
        withBids: ls.filter(l => (l.quoteCount ?? 0) > 0).length, accepted: ls.filter(l => ['engineer_selected', 'converted_to_customer', 'completed'].includes(l.status)).length, paid: paidJobs.size,
        completed: ls.filter(l => l.status === 'completed').length, gross, commission, net: commission - spend }
    }).filter(r => r.spend || r.leads).sort((a, b) => b.spend - a.spend)
  }, [campaigns.data, leads.data, txns.data, daily.data])
  const tot = rows.reduce((t, r) => ({ spend: t.spend + r.spend, leads: t.leads + r.leads, gross: t.gross + r.gross, commission: t.commission + r.commission, paid: t.paid + r.paid }), { spend: 0, leads: 0, gross: 0, commission: 0, paid: 0 })
  return (<>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><RangePicker value={range} onChange={setRange} /><ExportButton onClick={() => downloadCsv('thor-ad-roi.csv', rows)} disabled={!rows.length} /></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5"><Stat label="Advertising spend" value={poundsStr(tot.spend)} /><Stat label="Leads" value={tot.leads} /><Stat label="Cost per lead" value={tot.leads ? poundsStr(Math.round(tot.spend / tot.leads)) : '—'} />
      <Stat label="Gross repair value" value={can('finance.view') ? poundsStr(tot.gross) : 'Finance only'} /><Stat label="Commission minus ad spend" value={can('finance.view') ? poundsStr(tot.commission - tot.spend) : 'Finance only'} tone={tot.commission - tot.spend >= 0 ? 'ok' : 'bad'} hint="Not profit: Stripe fees, running costs and tax are not deducted" /></div>
    {leads.loading ? <ListSkeleton /> : <div className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[70rem] text-sm"><thead className="text-left text-thor-text"><tr>{['Campaign', 'Spend', 'Leads', 'CPL', 'Valid', 'Jobs published', 'Receiving bids', 'Accepted', 'Paid', 'Completed', 'Gross value', '15% commission', 'Commission − spend'].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-ink/8">{rows.map(r => <tr key={r.id}><td className="max-w-56 truncate p-3 font-medium">{r.name}</td><td className="p-3">{poundsStr(r.spend)}</td><td className="p-3">{r.leads}</td><td className="p-3">{r.leads ? poundsStr(Math.round(r.spend / r.leads)) : '—'}</td><td className="p-3">{r.valid}</td><td className="p-3">{r.published}</td><td className="p-3">{r.withBids}</td><td className="p-3">{r.accepted}</td><td className="p-3">{r.paid}</td><td className="p-3">{r.completed}</td>
        <td className="p-3">{can('finance.view') ? poundsStr(r.gross) : '—'}</td><td className="p-3">{can('finance.view') ? poundsStr(r.commission) : '—'}</td><td className={cx('p-3', r.net < 0 ? 'text-bad' : 'text-ok')}>{can('finance.view') ? poundsStr(r.net) : '—'}</td></tr>)}</tbody></table></div>}
    <p className="mt-2 text-xs text-thor-text">Attribution: each lead keeps its campaign, ad set and ad; the job, quotes and Stripe transactions carry the same attribution, so revenue is counted once per payment. Gross value is net of refunds.</p>
  </>)
}

const APP_FIELDS = ['', 'fullName', 'firstName', 'lastName', 'email', 'phone', 'postcode', 'deviceType', 'manufacturer', 'model', 'problem', 'serviceMethod', 'preferredDate', 'urgency']
function Forms() {
  const toast = useToast(); const can = useCan()
  const forms = useQuery<{ name: string; status: string; pageId: string; questions: { key: string; label: string; type: string }[]; connected?: boolean }>('metaLeadForms', () => [limit(200)], [])
  const [open, setOpen] = useState<string | null>(null)
  const form = forms.data.find(f => f.id === open)
  const mapping = useDoc<{ fieldMap: Record<string, string>; required: string[]; consentField?: string; connected: boolean }>(open && can('leads.manage') ? `leadMappings/${open}` : null)
  const [m, setM] = useState<{ fieldMap: Record<string, string>; required: string[]; consentField: string; connected: boolean } | null>(null)
  useEffect(() => { if (open && !mapping.loading) setM({ fieldMap: mapping.data?.fieldMap ?? {}, required: mapping.data?.required ?? ['fullName', 'email', 'postcode', 'deviceType', 'problem'], consentField: mapping.data?.consentField ?? '', connected: mapping.data?.connected ?? form?.connected !== false }) }, [open, mapping.loading, mapping.data, form?.connected])
  const save = async () => { if (!m || !open) return; try { await api.saveLeadMapping({ formId: open, connected: m.connected, fieldMap: Object.fromEntries(Object.entries(m.fieldMap).filter(([, v]) => v)), required: m.required, consentField: m.consentField || undefined }); toast('ok', 'Mapping saved.'); setOpen(null) } catch (e) { toast('bad', errMsg(e)) } }
  return (<>
    {forms.loading ? <ListSkeleton /> : forms.data.length === 0 ? <EmptyState icon={Megaphone} title="No lead forms" body="Sync assets on the Connection tab to load your Instant Forms." /> :
      <ul className="space-y-2">{forms.data.map(f => <li key={f.id}><button onClick={() => setOpen(f.id)} className="surface flex w-full items-center gap-3 p-4 text-left"><span className="min-w-0 flex-1"><b>{f.name}</b><span className="block text-xs text-thor-text">{f.id} · {f.questions.length} questions · {f.status?.toLowerCase()}</span></span>{f.connected === false ? <Badge tone="neutral">Not connected</Badge> : <Badge tone="ok">Feeds marketplace</Badge>}</button></li>)}</ul>}
    <Sheet open={!!open} onClose={() => setOpen(null)} title={form?.name ?? 'Lead form'}>{m && form && <div className="space-y-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" className="accent-thor-blue" checked={m.connected} onChange={e => setM({ ...m, connected: e.target.checked })} />Import leads from this form into the marketplace</label>
      <table className="w-full"><thead><tr className="text-left text-thor-text"><th className="py-1 font-medium">Meta question</th><th className="font-medium">Thor field</th><th className="font-medium">Required</th></tr></thead><tbody>{form.questions.map(q => { const v = m.fieldMap[q.key] ?? ''; return <tr key={q.key}><td className="py-1.5 pr-2">{q.label}<span className="block text-xs text-thor-text">{q.key}</span></td>
        <td><select aria-label={`Map ${q.label}`} className="h-9 rounded-lg border border-ink/15 px-2" value={v} onChange={e => setM({ ...m, fieldMap: { ...m.fieldMap, [q.key]: e.target.value } })}>{APP_FIELDS.map(a => <option key={a} value={a}>{a || '(default / unmapped)'}</option>)}</select></td>
        <td className="text-center">{v && <input type="checkbox" aria-label={`${v} required`} className="accent-thor-blue" checked={m.required.includes(v)} onChange={e => setM({ ...m, required: e.target.checked ? [...m.required, v] : m.required.filter(r => r !== v) })} />}</td></tr> })}</tbody></table>
      <p className="text-xs text-thor-text">Required now: {m.required.join(', ')}. Standard keys (full_name, email, phone_number, post_code…) map automatically. Missing required fields send the lead to a clarification step; nothing is invented.</p>
      <Select label="Marketplace consent question" value={m.consentField} onChange={e => setM({ ...m, consentField: e.target.value })}><option value="">Use Meta custom disclaimer checkbox</option>{form.questions.map(q => <option key={q.key} value={q.key}>{q.label}</option>)}</Select>
      {can('leads.manage') && <Button className="w-full" onClick={save}>Save mapping</Button>}</div>}</Sheet>
  </>)
}

interface Rule { id: string; name: string; enabled: boolean; priority: number; match: { campaignIds?: string[]; formIds?: string[]; deviceTypes?: string[]; outcodePrefixes?: string[]; urgency?: string[] }; set: { deviceType?: string; urgency?: string; serviceMethods?: string[] } }
interface MS { leadPublishMode: 'confirm' | 'auto' | 'review'; duplicateWindowDays: number; autoImport: boolean; notifyAdminsOnLead: boolean; maxDailyBudgetPence: number; maxBudgetChangePercent: number; attributionWindowDays: number; routing: Rule[] }
const csv = (a?: string[]) => (a ?? []).join(', '), list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
function ConversionSettings() {
  const toast = useToast(); const can = useCan(); const doc = useDoc<Partial<MS>>('platformSettings/marketing')
  const [s, setS] = useState<MS | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!doc.loading) setS({ leadPublishMode: 'confirm', duplicateWindowDays: 14, autoImport: true, notifyAdminsOnLead: true, maxDailyBudgetPence: 10000, maxBudgetChangePercent: 50, attributionWindowDays: 90, routing: [], ...doc.data }) }, [doc.loading, doc.data])
  if (!s) return <ListSkeleton rows={2} />
  const rule = (i: number, r: Partial<Rule>) => setS({ ...s, routing: s.routing.map((x, j) => j === i ? { ...x, ...r } : x) })
  const save = async () => { setBusy(true); try { await api.saveMarketingSettings({ ...s }); toast('ok', 'Saved.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return (<div className="max-w-3xl">
    <Section title="Lead conversion"><div className="space-y-4">
      <Select label="When a complete lead arrives" value={s.leadPublishMode} onChange={e => setS({ ...s, leadPublishMode: e.target.value as MS['leadPublishMode'] })}>
        <option value="confirm">Email the customer a secure link to confirm (recommended)</option><option value="auto">Publish automatically if the form recorded marketplace consent</option><option value="review">Hold every lead for admin approval</option></Select>
      <p className="text-xs text-thor-text">Incomplete leads always go to a clarification step, and leads without consent are never published automatically.</p>
      <div className="grid gap-3 sm:grid-cols-3"><Input label="Duplicate window (days)" type="number" value={s.duplicateWindowDays} onChange={e => setS({ ...s, duplicateWindowDays: Number(e.target.value) })} /><Input label="Attribution window (days)" type="number" value={s.attributionWindowDays} onChange={e => setS({ ...s, attributionWindowDays: Number(e.target.value) })} /><div /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-thor-blue" checked={s.autoImport} onChange={e => setS({ ...s, autoImport: e.target.checked })} />Import leads automatically</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-thor-blue" checked={s.notifyAdminsOnLead} onChange={e => setS({ ...s, notifyAdminsOnLead: e.target.checked })} />Notify lead managers about new leads</label></div></Section>
    <Section title="Campaign budget safety limits"><div className="grid gap-3 sm:grid-cols-2"><Input label="Maximum daily budget (£)" type="number" value={s.maxDailyBudgetPence / 100} onChange={e => setS({ ...s, maxDailyBudgetPence: Math.round(Number(e.target.value) * 100) })} /><Input label="Maximum change per edit (%)" type="number" value={s.maxBudgetChangePercent} onChange={e => setS({ ...s, maxBudgetChangePercent: Number(e.target.value) })} /></div><p className="mt-2 text-xs text-thor-text">Only super administrators can raise these limits.</p></Section>
    <Section title="Campaign-to-job routing" action={<Button size="sm" variant="soft" onClick={() => setS({ ...s, routing: [...s.routing, { id: `r${Date.now().toString(36)}`, name: 'New rule', enabled: true, priority: s.routing.length + 1, match: {}, set: {} }] })}>Add rule</Button>}>
      <p className="mb-3 text-sm text-thor-text">The first matching rule (lowest priority number) fills in the device category, urgency or service methods a lead didn’t specify. Engineers are then matched by approved category and by service area covering the customer’s postcode.</p>
      <ul className="space-y-3">{s.routing.map((r, i) => <li key={r.id} className="surface space-y-2 p-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-[1fr_6rem_auto]"><Input label="Name" value={r.name} onChange={e => rule(i, { name: e.target.value })} /><Input label="Priority" type="number" value={r.priority} onChange={e => rule(i, { priority: Number(e.target.value) })} /><label className="flex items-center gap-2 self-end pb-3"><input type="checkbox" className="accent-thor-blue" checked={r.enabled} onChange={e => rule(i, { enabled: e.target.checked })} />Enabled</label></div>
        <p className="font-medium">Match (leave blank for any)</p>
        <div className="grid gap-2 sm:grid-cols-2"><Input label="Campaign IDs" value={csv(r.match.campaignIds)} onChange={e => rule(i, { match: { ...r.match, campaignIds: list(e.target.value) } })} /><Input label="Lead form IDs" value={csv(r.match.formIds)} onChange={e => rule(i, { match: { ...r.match, formIds: list(e.target.value) } })} />
          <Input label="Postcode area prefixes" placeholder="E, EC, BR" value={csv(r.match.outcodePrefixes)} onChange={e => rule(i, { match: { ...r.match, outcodePrefixes: list(e.target.value) } })} /><Input label="Device categories" placeholder="laptop, mac" value={csv(r.match.deviceTypes)} onChange={e => rule(i, { match: { ...r.match, deviceTypes: list(e.target.value) } })} /></div>
        <p className="font-medium">Then route to</p>
        <div className="grid gap-2 sm:grid-cols-3"><Select label="Device category" value={r.set.deviceType ?? ''} onChange={e => rule(i, { set: { ...r.set, deviceType: e.target.value || undefined } })}><option value="">Keep</option>{DEVICE_TYPES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</Select>
          <Select label="Urgency" value={r.set.urgency ?? ''} onChange={e => rule(i, { set: { ...r.set, urgency: e.target.value || undefined } })}><option value="">Keep</option><option value="flexible">Flexible</option><option value="soon">Soon</option><option value="urgent">Urgent</option></Select>
          <Input label="Service methods" placeholder={SERVICE_METHODS.map(m => m.id).join(', ')} value={csv(r.set.serviceMethods)} onChange={e => rule(i, { set: { ...r.set, serviceMethods: list(e.target.value) } })} /></div>
        <Button size="sm" variant="ghost" className="text-bad" onClick={() => setS({ ...s, routing: s.routing.filter((_, j) => j !== i) })}>Remove rule</Button></li>)}</ul></Section>
    {can('marketing.manage') && <Button size="lg" className="w-full" loading={busy} onClick={save}>Save conversion & routing</Button>}
  </div>)
}

function Webhooks() {
  const toast = useToast(); const can = useCan(); const [st, setSt] = useState('')
  const ev = useQuery<{ leadId: string; pageId: string; formId: string | null; status: string; attempts: number; source: string; error?: string; receivedAt?: { toDate(): Date } }>('metaWebhookEvents', () => [...(st ? [where('status', '==', st)] : []), orderBy('receivedAt', 'desc'), limit(100)], [st])
  const retry = async (id: string) => { try { const r = await api.retryMetaEvent({ eventId: id }); toast('ok', `Now ${r.status}.`) } catch (e) { toast('bad', errMsg(e)) } }
  return (<>
    <div className="mb-4 w-48"><Select label="Status" value={st} onChange={e => setSt(e.target.value)}><option value="">All</option>{['received', 'processing', 'processed', 'duplicate', 'skipped', 'failed', 'dead_letter'].map(x => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select></div>
    {ev.loading ? <ListSkeleton /> : ev.data.length === 0 ? <EmptyState icon={CheckCircle2} title="No webhook events" body="Lead notifications from Meta will be logged here." /> :
      <ul className="divide-y divide-ink/8 surface px-5">{ev.data.map(e => <li key={e.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1"><b>Lead {e.leadId}</b><span className="block text-xs text-thor-text">{when(e.receivedAt)} · via {e.source} · form {e.formId ?? '?'} · attempts {e.attempts}{e.error ? ` · ${e.error}` : ''}</span></span>
        <Badge tone={e.status === 'processed' ? 'ok' : ['failed', 'dead_letter'].includes(e.status) ? 'bad' : 'neutral'}>{e.status.replace('_', ' ')}</Badge>{can('leads.manage') && ['failed', 'dead_letter', 'skipped'].includes(e.status) && <Button size="sm" variant="soft" onClick={() => retry(e.id)}>Retry</Button>}</li>)}</ul>}
  </>)
}
