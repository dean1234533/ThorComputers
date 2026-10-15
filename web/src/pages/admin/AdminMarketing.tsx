import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { limit, orderBy } from 'firebase/firestore'
import { PlugZap, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { gbp } from '@/types/domain'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Sheet, useToast } from '@/components/ui'

const APP_FIELDS = ['name', 'email', 'phone', 'postcode', 'device', 'brand', 'model', 'problem', 'method', 'urgency', 'date', 'consent'] as const
const FIELD_LABEL: Record<string, string> = { name: 'Customer name', email: 'Email', phone: 'Telephone', postcode: 'Repair location (postcode)', device: 'Device type', brand: 'Brand', model: 'Model', problem: 'Problem description', method: 'Service method', urgency: 'Urgency', date: 'Preferred date', consent: 'Consent' }
const DEFAULT_REQUIRED = ['name', 'email', 'postcode', 'problem']
interface Assets { status?: string; statusReason?: string; metaUserName?: string; pages?: { id: string; name: string }[]; adAccounts?: { id: string; name: string; currency: string; active: boolean }[]; scopes?: string[]; subscribedPages?: string[] }
interface Camp { name: string; status: string; objective?: string; dailyBudgetPence?: number | null; currency?: string; nonGbp?: boolean; insights?: { spendPence: number; impressions: number; reach: number; clicks: number; leads: number } }
const webhookUrl = `https://europe-west2-${import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'your-project'}.cloudfunctions.net/metaWebhook`

export default function AdminMarketing() {
  const { can } = useAuth(); const toast = useToast(); const [qs, setQs] = useSearchParams()
  const enabled = can('marketing.manage')
  const assets = useDoc<Assets>(enabled ? 'metaAssets/main' : null), health = useDoc<{ ok: boolean; detail: string; at?: { toDate(): Date } }>(enabled ? 'integrationHealth/meta' : null)
  const camps = useQuery<Camp>(enabled ? 'metaCampaigns' : null, () => [limit(200)], [enabled]), routing = useQuery<{ enabled: boolean }>(enabled ? 'campaignRouting' : null, () => [limit(200)], [enabled])
  const forms = useQuery<{ name: string; status: string }>(enabled ? 'metaLeadForms' : null, () => [limit(100)], [enabled]), events = useQuery<{ leadCount: number; status: string; receivedAt?: { toDate(): Date } }>(enabled ? 'metaWebhookEvents' : null, () => [orderBy('receivedAt', 'desc'), limit(8)], [enabled])
  const [stats, setStats] = useState<any>(null), [from, setFrom] = useState(''), [to, setTo] = useState(''), [busy, setBusy] = useState(''), [campSheet, setCampSheet] = useState<string | null>(null), [mapForm, setMapForm] = useState<string | null>(null)

  useEffect(() => { const m = qs.get('meta'); if (m) { toast(m === 'connected' ? 'ok' : 'bad', m === 'connected' ? 'Meta connected. Page and ad accounts imported.' : 'Meta connection was not completed.'); qs.delete('meta'); setQs(qs, { replace: true }) } }, [])   // eslint-disable-line
  const load = () => api.adminMarketingStats({ from: from || undefined, to: to || undefined }).then(setStats).catch(e => toast('bad', errMsg(e)))
  useEffect(() => { if (enabled) load() }, [enabled, from, to])   // eslint-disable-line
  if (!enabled) return <EmptyState icon={ShieldCheck} title="No access" body="Marketing needs the marketing permission." />
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); try { await fn(); toast('ok', ok); load() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  const a = assets.data, connected = a?.status === 'connected', reauth = a?.status === 'reauth_required'
  const feeds = (id: string) => routing.data.find(r => r.id === id)?.enabled !== false
  const camp = camps.data.find(c => c.id === campSheet)

  return (
    <div><PageHeader title="Marketing & Lead Generation" sub="Connect Facebook and Instagram, watch campaign results, and see which adverts become paid repairs." />
      <Section title="Meta connection">
        <div className="surface space-y-3 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-3"><PlugZap className="size-5 text-thor-blue" />
            <Badge tone={connected ? 'ok' : reauth ? 'bad' : 'neutral'}>{connected ? 'Connected' : reauth ? 'Reconnect needed' : 'Not connected'}</Badge>
            {a?.metaUserName && <span className="text-thor-text">as {a.metaUserName}</span>}
            {health.data && <Badge tone={health.data.ok ? 'ok' : 'bad'}>Integration health: {health.data.ok ? 'OK' : 'problem'}</Badge>}</div>
          {reauth && <p className="rounded-xl bg-bad/10 p-3 text-bad">The Meta access expired or a permission was revoked: {a?.statusReason}. Reconnect to resume lead imports.</p>}
          {health.data && !health.data.ok && <p className="text-thor-text">Last problem: {health.data.detail}</p>}
          {connected && <div className="grid gap-3 sm:grid-cols-2"><div><p className="text-thor-text">Facebook Pages</p><ul>{(a?.pages ?? []).map(p => <li key={p.id}>{p.name} {a?.subscribedPages?.includes(p.id) ? <Badge tone="ok">Lead webhook on</Badge> : <Badge tone="warn">Not subscribed</Badge>}</li>)}</ul></div>
            <div><p className="text-thor-text">Ad accounts</p><ul>{(a?.adAccounts ?? []).map(p => <li key={p.id}>{p.name} · {p.currency}{p.currency !== 'GBP' && <Badge tone="warn">Not GBP</Badge>}</li>)}</ul></div></div>}
          <div className="flex flex-wrap gap-2">
            {can('integrations.manage') ? <Button loading={busy === 'connect'} onClick={() => run('connect', async () => { window.location.assign((await api.metaConnectUrl({})).url) }, 'Redirecting to Meta…')}>{connected || reauth ? 'Reconnect Meta' : 'Connect Meta account'}</Button> : <p className="text-thor-text">Only a Super Administrator can connect Meta.</p>}
            {connected && <><Button variant="soft" loading={busy === 'sync'} onClick={() => run('sync', () => api.syncMetaCampaigns({}), 'Campaigns synced.')}><RefreshCw className="size-4" />Sync campaigns</Button>
              <Button variant="soft" loading={busy === 'rec'} onClick={() => run('rec', async () => { const r = await api.reconcileMetaLeads({}); toast('info', `${r.imported} missed lead(s) imported.`) }, 'Checked for missed leads.')}>Check for missed leads</Button></>}
            {connected && can('integrations.manage') && <Button variant="ghost" onClick={() => confirm('Disconnect Meta? Lead imports stop until you reconnect.') && run('dis', () => api.metaDisconnect({}), 'Disconnected.')}>Disconnect</Button>}</div>
          <p className="text-xs text-thor-text">You sign in on Meta’s own page; Thor Computer never sees your Facebook password. Permissions requested: {(a?.scopes ?? ['ads_read', 'ads_management', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_manage_ads']).join(', ')}. Live use needs Meta App Review and business verification.</p>
          <p className="text-xs text-thor-text">Webhook callback URL for your Meta app: <code className="break-all">{webhookUrl}</code> (subscribe to <b>leadgen</b>; the verify token is the <code>META_VERIFY_TOKEN</code> secret).</p>
        </div>
      </Section>

      <Section title="Advertising performance" action={<div className="flex items-end gap-2"><Input label="From" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input label="To" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>}>
        {!stats ? <ListSkeleton rows={2} /> : <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{([['Ad spend', gbp(stats.spendPence)], ['Leads', stats.leads], ['Cost per lead', stats.costPerLeadPence ? gbp(stats.costPerLeadPence) : '—'], ['Valid leads', stats.validLeads], ['Jobs published', stats.jobs], ['Receiving bids', stats.withBids], ['Paid jobs', stats.paid], ['Completed', stats.completed],
            ['Gross value', gbp(stats.grossPence)], ['Commission (net of refunds)', gbp(stats.commissionPence)], ['Commission minus ad spend', gbp(stats.commissionMinusSpendPence)], ['Facebook / Instagram', `${stats.platform.facebook} / ${stats.platform.instagram}`]] as [string, string | number][]).map(([l, v]) =>
            <div key={l} className="surface p-4"><p className="text-xs text-thor-text">{l}</p><p className="font-display text-2xl">{v}</p></div>)}</div>
          <p className="mt-2 text-xs text-thor-text">Commission is revenue, not profit: Stripe fees, refunds beyond commission, operating costs and tax are not deducted here. Conversions count only within {stats.attributionWindowDays} days of the lead.</p>
          {stats.campaigns.length > 0 && <div className="mt-4 overflow-x-auto rounded-3xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[860px] text-left text-sm"><thead className="text-xs uppercase text-thor-text"><tr>{['Campaign', 'Status', 'Spend', 'Leads', 'CPL', 'Jobs', 'Bids', 'Paid', 'Commission', 'Marketplace', ''].map(h => <th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-ink/8">{stats.campaigns.map((c: any) => <tr key={c.campaignId}><td className="px-3 py-3 font-medium">{c.name}</td><td className="px-3 py-3">{c.status ? <Badge tone={c.status === 'ACTIVE' ? 'ok' : 'neutral'}>{c.status}</Badge> : '—'}</td>
              <td className="px-3 py-3">{gbp(c.spendPence)}</td><td className="px-3 py-3">{c.leads}</td><td className="px-3 py-3">{c.costPerLeadPence ? gbp(c.costPerLeadPence) : '—'}</td><td className="px-3 py-3">{c.jobs}</td><td className="px-3 py-3">{c.withBids}</td><td className="px-3 py-3">{c.paid}</td><td className="px-3 py-3">{gbp(c.commissionPence)}</td>
              <td className="px-3 py-3">{camps.data.some(x => x.id === c.campaignId) ? <label className="flex items-center gap-2"><input type="checkbox" checked={feeds(c.campaignId)} onChange={e => run('rt' + c.campaignId, () => api.saveCampaignRouting({ campaignId: c.campaignId, enabled: e.target.checked }), 'Routing saved.')} />Feeds jobs</label> : '—'}</td>
              <td className="px-3 py-3">{camps.data.some(x => x.id === c.campaignId) && <Button size="sm" variant="soft" onClick={() => setCampSheet(c.campaignId)}>Manage</Button>}</td></tr>)}</tbody></table></div>}</>}
      </Section>

      <Section title="Lead forms & field mapping">
        {forms.data.length === 0 ? <p className="text-sm text-thor-text">Forms appear after you connect Meta and sync campaigns. The default mapping already understands standard Instant Form fields.</p> :
          <ul className="divide-y divide-ink/8 surface px-5">{forms.data.map(f => <li key={f.id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium">{f.name}</p><p className="text-xs text-thor-text">{f.id} · {f.status}</p></div><Button size="sm" variant="soft" onClick={() => setMapForm(f.id)}>Map fields</Button></li>)}</ul>}
        <Button className="mt-3" size="sm" variant="ghost" onClick={() => setMapForm('default')}>Edit default mapping</Button>
      </Section>

      <SettingsPanel />
      <Section title="Webhook activity"><ul className="divide-y divide-ink/8 surface px-5 text-sm">{events.data.length === 0 && <li className="py-4 text-thor-text">No webhook calls yet.</li>}{events.data.map(e => <li key={e.id} className="flex justify-between py-3"><span>{e.leadCount} lead(s) · {e.status}</span><span className="text-thor-text">{e.receivedAt?.toDate().toLocaleString('en-GB')}</span></li>)}</ul></Section>

      {camp && <CampaignSheet id={campSheet!} camp={camp} onClose={() => setCampSheet(null)} onDone={load} />}
      {mapForm && <MappingSheet formId={mapForm} onClose={() => setMapForm(null)} />}
    </div>)
}

function CampaignSheet({ id, camp, onClose, onDone }: { id: string; camp: Camp; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState(''); const [pounds, setPounds] = useState(camp.dailyBudgetPence ? String(camp.dailyBudgetPence / 100) : '')
  const next = camp.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); try { await fn(); toast('ok', ok); onDone(); onClose() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  return <Sheet open onClose={onClose} title={camp.name}><div className="space-y-4 text-sm">
    <p>Status: <b>{camp.status}</b> · Budget: <b>{camp.dailyBudgetPence ? gbp(camp.dailyBudgetPence) + ' / day' : 'lifetime budget'}</b></p>
    <div className="rounded-2xl bg-warn/10 p-4"><p className="mb-2 font-medium">{next === 'PAUSED' ? 'Pause this campaign?' : 'Resume this campaign?'}</p><p className="mb-3 text-thor-text">{next === 'PAUSED' ? 'Adverts stop delivering and spending immediately.' : 'Adverts start delivering and spending again.'}</p>
      <Button variant={next === 'PAUSED' ? 'danger' : 'primary'} loading={busy === 'st'} onClick={() => run('st', () => api.setMetaCampaignStatus({ campaignId: id, status: next, confirm: true }), next === 'PAUSED' ? 'Campaign paused.' : 'Campaign resumed.')}>{next === 'PAUSED' ? 'Yes, pause' : 'Yes, resume'}</Button></div>
    {!camp.nonGbp && camp.dailyBudgetPence ? <div className="rounded-2xl bg-white p-4 ring-1 ring-ink/10"><Input label="New daily budget (£)" type="number" min="1" step="0.5" value={pounds} onChange={e => setPounds(e.target.value)} hint="Limited by your safety caps in Lead conversion settings. This changes real ad spend." />
      <Button className="mt-3" loading={busy === 'bg'} disabled={!(Number(pounds) >= 1)} onClick={() => confirm(`Change the daily budget to £${Number(pounds).toFixed(2)}? This changes real advertising spend.`) && run('bg', () => api.setMetaCampaignBudget({ campaignId: id, dailyBudgetPence: Math.round(Number(pounds) * 100), confirm: true }), 'Budget updated.')}>Update budget</Button></div> : <p className="text-thor-text">Budget changes are available for GBP campaigns with a daily budget.</p>}
  </div></Sheet>
}

function MappingSheet({ formId, onClose }: { formId: string; onClose: () => void }) {
  const toast = useToast(); const m = useDoc<{ fields: Record<string, string[]>; required: string[] }>(`leadMappings/${formId}`)
  const [fields, setFields] = useState<Record<string, string>>({}), [req, setReq] = useState<string[]>(DEFAULT_REQUIRED), [busy, setBusy] = useState(false)
  useEffect(() => { if (m.loading) return; setFields(Object.fromEntries(APP_FIELDS.map(f => [f, (m.data?.fields?.[f] ?? []).join(', ')]))); setReq(m.data?.required ?? DEFAULT_REQUIRED) }, [m.loading, m.data])   // eslint-disable-line
  const save = async () => { setBusy(true); try { await api.saveLeadMapping({ formId, fields: Object.fromEntries(APP_FIELDS.map(f => [f, fields[f].split(',').map(x => x.trim()).filter(Boolean)]).filter(([, v]) => (v as string[]).length)), required: req }); toast('ok', 'Mapping saved. It applies to new leads.'); onClose() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return <Sheet open onClose={onClose} title={formId === 'default' ? 'Default field mapping' : `Map fields: ${formId}`}><div className="space-y-3 text-sm">
    <p className="text-thor-text">Type the Meta question names (comma separated) that fill each Thor Computer field. Your own names are tried first, then the built-in ones. Tick the fields a lead must have; others go to “awaiting information”.</p>
    {APP_FIELDS.map(f => <div key={f} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"><Input label={FIELD_LABEL[f]} placeholder="e.g. what_device_needs_repairing" value={fields[f] ?? ''} onChange={e => setFields(s => ({ ...s, [f]: e.target.value }))} />
      <label className="flex items-center gap-2 pb-3"><input type="checkbox" checked={req.includes(f)} onChange={e => setReq(r => e.target.checked ? [...r, f] : r.filter(x => x !== f))} />Required</label></div>)}
    <Button loading={busy} onClick={save} className="w-full">Save mapping</Button></div></Sheet>
}

function SettingsPanel() {
  const toast = useToast(); const s = useDoc<{ requiredFields: string[]; defaultFeedsMarketplace: boolean; attributionWindowDays: number; maxDailyBudgetPence: number; maxBudgetChangePct: number; autoImport: boolean }>('platformSettings/marketing')
  const [v, setV] = useState({ requiredFields: DEFAULT_REQUIRED, defaultFeedsMarketplace: true, attributionWindowDays: 30, maxDailyBudgetPence: 5000, maxBudgetChangePct: 50, autoImport: true }), [busy, setBusy] = useState(false)
  useEffect(() => { if (s.data) setV(x => ({ ...x, ...s.data! })) }, [s.data])
  const save = async () => { setBusy(true); try { await api.saveMarketingSettings(v); toast('ok', 'Settings saved.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return <Section title="Lead conversion settings"><div className="surface space-y-4 p-5 text-sm">
    <label className="flex items-center gap-2"><input type="checkbox" checked={v.defaultFeedsMarketplace} onChange={e => setV({ ...v, defaultFeedsMarketplace: e.target.checked })} />Campaigns feed the marketplace by default</label>
    <div className="grid gap-4 sm:grid-cols-3"><Input label="Attribution window (days)" type="number" min="1" max="365" value={v.attributionWindowDays} onChange={e => setV({ ...v, attributionWindowDays: Number(e.target.value) })} />
      <Input label="Max daily budget (£)" type="number" min="1" value={v.maxDailyBudgetPence / 100} onChange={e => setV({ ...v, maxDailyBudgetPence: Math.round(Number(e.target.value) * 100) })} hint="Budget changes above this are refused." />
      <Input label="Max single budget change (%)" type="number" min="1" max="500" value={v.maxBudgetChangePct} onChange={e => setV({ ...v, maxBudgetChangePct: Number(e.target.value) })} /></div>
    <Button onClick={save} loading={busy}>Save settings</Button></div></Section>
}
