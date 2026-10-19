import { ReactNode, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { limit, orderBy } from 'firebase/firestore'
import { ArrowUpRight, CheckCircle2, Circle, Inbox, KeyRound, Megaphone, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg, MetaSelfTest } from '@/lib/api'
import { gbp } from '@/types/domain'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Sheet, useToast } from '@/components/ui'

const APP_FIELDS = ['name', 'email', 'phone', 'postcode', 'device', 'brand', 'model', 'problem', 'method', 'urgency', 'date', 'consent'] as const
const FIELD_LABEL: Record<string, string> = { name: 'Customer name', email: 'Email', phone: 'Telephone', postcode: 'Repair location (postcode)', device: 'Device type', brand: 'Brand', model: 'Model', problem: 'Problem description', method: 'Service method', urgency: 'Urgency', date: 'Preferred date', consent: 'Consent' }
const DEFAULT_REQUIRED = ['name', 'email', 'postcode', 'problem']
interface Assets { status?: string; via?: 'oauth' | 'system_user'; statusReason?: string; metaUserName?: string; pages?: { id: string; name: string }[]; adAccounts?: { id: string; name: string; currency: string; active: boolean }[]; scopes?: string[]; subscribedPages?: string[] }
interface Camp { name: string; status: string; objective?: string; dailyBudgetPence?: number | null; currency?: string; nonGbp?: boolean; insights?: { spendPence: number; impressions: number; reach: number; clicks: number; leads: number } }
const webhookUrl = `https://europe-west2-${import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'your-project'}.cloudfunctions.net/metaWebhook`

export default function AdminMarketing() {
  const { can } = useAuth(); const toast = useToast(); const [qs, setQs] = useSearchParams()
  const enabled = can('marketing.manage')
  const assets = useDoc<Assets>(enabled ? 'metaAssets/main' : null), health = useDoc<{ ok: boolean; detail: string; at?: { toDate(): Date } }>(enabled ? 'integrationHealth/meta' : null)
  const camps = useQuery<Camp>(enabled ? 'metaCampaigns' : null, () => [limit(200)], [enabled]), routing = useQuery<{ enabled: boolean }>(enabled ? 'campaignRouting' : null, () => [limit(200)], [enabled])
  const forms = useQuery<{ name: string; status: string }>(enabled ? 'metaLeadForms' : null, () => [limit(100)], [enabled]), events = useQuery<{ leadCount: number; status: string; receivedAt?: { toDate(): Date } }>(enabled ? 'metaWebhookEvents' : null, () => [orderBy('receivedAt', 'desc'), limit(8)], [enabled])
  const [selfTest, setSelfTest] = useState<MetaSelfTest | null>(null), [stats, setStats] = useState<any>(null), [from, setFrom] = useState(''), [to, setTo] = useState(''), [busy, setBusy] = useState(''), [tab, setTab] = useState<'overview' | 'connection' | 'settings'>('overview'), [statsError, setStatsError] = useState(''), [checkError, setCheckError] = useState(''), [campSheet, setCampSheet] = useState<string | null>(null), [mapForm, setMapForm] = useState<string | null>(null)

  useEffect(() => { const m = qs.get('meta'); if (m) { toast(m === 'connected' ? 'ok' : 'bad', m === 'connected' ? 'Meta connected. Page and ad accounts imported.' : 'Meta connection was not completed.'); qs.delete('meta'); setQs(qs, { replace: true }) } }, [])   // eslint-disable-line
  const load = async () => {
    setStatsError('')
    try { setStats(await api.adminMarketingStats({ from: from || undefined, to: to || undefined })) }
    catch (e) { setStatsError(errMsg(e)) }
  }
  useEffect(() => {
    if (!enabled) return
    let active = true
    setStats(null); setStatsError('')
    api.adminMarketingStats({ from: from || undefined, to: to || undefined }).then(r => { if (active) setStats(r) }).catch(e => { if (active) setStatsError(errMsg(e)) })
    return () => { active = false }
  }, [enabled, from, to])
  const check = async () => {
    setCheckError('')
    try { setSelfTest(await api.metaSelfTest({})) }
    catch (e) { setSelfTest(null); setCheckError(errMsg(e)) }
  }
  // Check the saved keys straight away so the page shows what is already set up instead of asking for everything again.
  useEffect(() => { if (enabled) check() }, [enabled])
  if (!enabled) return <EmptyState icon={ShieldCheck} title="No access" body="Marketing needs the marketing permission." />
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); try { await fn(); toast('ok', ok); await Promise.all([load(), check()]) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  const a = assets.data, connected = a?.status === 'connected', reauth = a?.status === 'reauth_required'
  const feeds = (id: string) => routing.data.find(r => r.id === id)?.enabled !== false
  const camp = camps.data.find(c => c.id === campSheet)
  const connectionProblem = assets.error || health.error
  const connectionTitle = connectionProblem ? 'Connection status unavailable' : reauth ? 'Meta needs reconnecting' : connected ? 'Meta account connected' : assets.loading ? 'Loading connection…' : 'Connect your Meta account'
  const keysSaved = !!selfTest && selfTest.checks.filter(c => KEY_CHECKS.includes(c.id)).every(c => c.ok)

  return (
    <div className="min-w-0"><PageHeader title="Marketing" sub="Track your adverts, follow up leads and see what turns into paid repairs." />
      <div className="marketing-briefing">
        <div className="min-w-0"><p className="marketing-kicker"><Megaphone className="size-4" aria-hidden />Facebook & Instagram</p><h2>From first click to paid repair.</h2><p>Your campaign results and incoming enquiries, together in one place.</p></div>
        <Link className="marketing-leads-link" to="/admin/leads"><Inbox className="size-4" aria-hidden />View incoming leads<ArrowUpRight className="size-4" aria-hidden /></Link>
      </div>
      <nav aria-label="Marketing sections" className="marketing-tabs">{([['overview', 'Overview'], ['connection', 'Connection'], ['settings', 'Lead settings']] as const).map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
      {tab === 'overview' && <div className="surface mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-3"><PlugZap className="mt-1 size-5 shrink-0 text-thor-blue" aria-hidden /><div><h2 className="font-semibold">{connectionTitle}</h2><p className="mt-1 text-sm text-thor-text">{connectionProblem ? errMsg(connectionProblem) : connected ? `${a?.pages?.length ?? 0} Facebook Page(s) · ${a?.adAccounts?.length ?? 0} ad account(s). ${selfTest?.overall === 'needs_attention' ? 'A connection check needs your attention.' : 'Review connection checks for import status.'}` : keysSaved ? 'Your app keys are saved. Connect the Page and ad account you want to use.' : checkError ? 'We could not check the saved backend settings. Open Connection to retry.' : selfTest ? 'Open Connection to see what still needs attention.' : 'Checking the settings already saved in your backend…'}</p></div></div>
        <Button size="sm" variant="soft" onClick={() => setTab('connection')}>{connected ? 'Connection details' : 'Review connection'}</Button>
      </div>}
      {tab === 'connection' && <Section title="Meta connection">
        <div className="surface space-y-4 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-3"><PlugZap className="size-5 text-thor-blue" />
            <Badge tone={connected ? 'ok' : reauth ? 'bad' : 'neutral'}>{connected ? 'Connected' : reauth ? 'Reconnect needed' : 'Not connected yet'}</Badge>
            {a?.metaUserName && <span className="text-thor-text">as {a.metaUserName}{a.via === 'system_user' ? ' (Business access token)' : ''}</span>}
            {health.data && <Badge tone={health.data.ok ? 'neutral' : 'bad'}>Last Meta API call: {health.data.ok ? 'succeeded' : 'failed'}</Badge>}</div>
          {connectionProblem && <p role="alert" className="text-bad">{errMsg(connectionProblem)}</p>}
          {!connected && !assets.loading && !connectionProblem && selfTest && <SetupSteps result={selfTest} reauth={reauth} canConnect={can('integrations.manage')} busy={busy} onConnect={() => run('connect', async () => { window.location.assign((await api.metaConnectUrl({})).url) }, 'Redirecting to Meta…')}
            onToken={token => run('token', async () => { const r = await api.metaConnectWithToken({ token }); toast('info', `${r.pages} Page(s) and ${r.adAccounts} ad account(s) imported.`) }, 'Meta connected.')} />}
          {checkError && <p role="alert" className="rounded-xl bg-bad/10 p-3 text-bad">Couldn’t check the connection: {checkError}</p>}
          <ConnectionCheck result={selfTest} busy={busy === 'check'} onRun={async () => { setBusy('check'); try { await check() } finally { setBusy('') } }} />
          {reauth && <p className="rounded-xl bg-bad/10 p-3 text-bad">The Meta access expired or a permission was revoked: {a?.statusReason}. Reconnect to resume lead imports.</p>}
          {health.data && !health.data.ok && <p className="text-thor-text">Last problem: {health.data.detail}</p>}
          {connected && <div className="grid gap-3 sm:grid-cols-2"><div><p className="text-thor-text">Facebook Pages</p><ul>{(a?.pages ?? []).map(p => <li key={p.id}>{p.name} {a?.subscribedPages?.includes(p.id) ? <Badge tone="ok">Lead webhook on</Badge> : <Badge tone="warn">Not subscribed</Badge>}</li>)}</ul></div>
            <div><p className="text-thor-text">Ad accounts</p><ul>{(a?.adAccounts ?? []).map(p => <li key={p.id}>{p.name} · {p.currency}{p.currency !== 'GBP' && <Badge tone="warn">Not GBP</Badge>}</li>)}</ul></div></div>}
          {connected && <div className="flex flex-wrap gap-2">
            <Button variant="soft" loading={busy === 'sync'} onClick={() => run('sync', () => api.syncMetaCampaigns({}), 'Campaigns synced.')}><RefreshCw className="size-4" />Sync campaigns</Button>
            <Button variant="soft" loading={busy === 'rec'} onClick={() => run('rec', async () => { const r = await api.reconcileMetaLeads({}); toast('info', `${r.imported} missed lead(s) imported.`) }, 'Checked for missed leads.')}>Check for missed leads</Button>
            {can('integrations.manage') && <><Button variant="ghost" loading={busy === 'connect'} onClick={() => run('connect', async () => { window.location.assign((await api.metaConnectUrl({})).url) }, 'Redirecting to Meta…')}>Reconnect Meta</Button>
              <Button variant="ghost" onClick={() => confirm('Disconnect Meta? Lead imports stop until you reconnect.') && run('dis', () => api.metaDisconnect({}), 'Disconnected.')}>Disconnect</Button></>}</div>}
          <details className="rounded-xl border border-ink/10 p-3"><summary className="cursor-pointer font-medium">Technical connection details</summary><p className="mt-3 text-xs text-thor-text">You sign in on Meta’s own page; Thor Computer never sees your Facebook password. Permissions requested: {(a?.scopes ?? ['ads_read', 'ads_management', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_manage_ads']).join(', ')}. Live use needs Meta App Review and business verification.</p>
          <p className="text-xs text-thor-text">Webhook callback URL for your Meta app: <code className="break-all">{webhookUrl}</code> (subscribe to <b>leadgen</b>; the verify token is the <code>META_VERIFY_TOKEN</code> secret).</p></details>
        </div>
      </Section>}

      {tab === 'overview' && connected && <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="soft" disabled={!!busy} loading={busy === 'sync'} onClick={() => run('sync', () => api.syncMetaCampaigns({}), 'Campaigns synced.')}><RefreshCw className="size-4" aria-hidden />Refresh campaigns</Button>
        <Button variant="ghost" disabled={!!busy} loading={busy === 'rec'} onClick={() => run('rec', async () => { const r = await api.reconcileMetaLeads({}); toast('info', `${r.imported} missed lead(s) imported.`) }, 'Lead check complete.')}>Check for missed leads</Button>
      </div>}
      {tab === 'overview' && <Section title="Advertising performance" action={<div className="flex flex-wrap items-end gap-2"><Input label="From" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input label="To" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>}>
        {statsError ? <div role="alert" className="surface p-5"><p className="font-medium">Couldn’t load campaign results</p><p className="my-2 text-sm text-thor-text">{statsError}</p><Button variant="soft" onClick={load}>Try again</Button></div> : !stats ? <ListSkeleton rows={2} /> : <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{([['Ad spend', gbp(stats.spendPence)], ['Leads', stats.leads], ['Cost per lead', stats.leads ? gbp(stats.costPerLeadPence) : '—'], ['Paid jobs', stats.paid]] as [string, string | number][]).map(([l, v]) =>
            <div key={l} className="marketing-metric surface p-4"><p className="text-xs text-thor-text">{l}</p><p className="font-display text-2xl">{v}</p></div>)}</div>
          <details className="surface mt-4 p-5"><summary className="cursor-pointer font-semibold">Lead journey & revenue breakdown</summary><div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">{([['Valid leads', stats.validLeads], ['Jobs published', stats.jobs], ['Receiving bids', stats.withBids], ['Completed', stats.completed],
            ['Gross value', gbp(stats.grossPence)], ['Commission (net of refunds)', gbp(stats.commissionPence)], ['Commission minus ad spend', gbp(stats.commissionMinusSpendPence)], ['Facebook / Instagram', `${stats.platform.facebook} / ${stats.platform.instagram}`]] as [string, string | number][]).map(([l, v]) =>
            <div key={l} className="min-w-0"><p className="text-xs text-thor-text">{l}</p><p className="font-display text-xl">{v}</p></div>)}</div></details>
          <p className="mt-2 text-xs text-thor-text">Commission is revenue, not profit: Stripe fees, refunds beyond commission, operating costs and tax are not deducted here. Conversions count only within {stats.attributionWindowDays} days of the lead.</p>
          {stats.campaigns.length === 0 && <div className="surface mt-4 p-6"><h3 className="font-semibold">No campaign results yet</h3><p className="mt-2 text-sm text-thor-text">{connected ? 'Sync your Meta campaigns to bring in the latest results.' : 'Connect Meta to bring your Facebook and Instagram campaign results here.'}</p><Button className="mt-4" variant="soft" onClick={() => setTab('connection')}>{connected ? 'Open campaign sync' : 'Set up connection'}</Button></div>}
          {stats.campaigns.length > 0 && <ul aria-label="Campaign results" className="mt-4 space-y-3 md:hidden">{stats.campaigns.map((c: any) => <li key={c.campaignId} className="surface space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{c.name}</h3>{c.status && <Badge tone={c.status === 'ACTIVE' ? 'ok' : 'neutral'}>{c.status}</Badge>}</div>
            <dl className="grid grid-cols-2 gap-3 text-sm">{[['Spend', gbp(c.spendPence)], ['Leads', c.leads], ['Cost per lead', c.leads ? gbp(c.costPerLeadPence) : '—'], ['Paid jobs', c.paid]].map(([label, value]) => <div key={label}><dt className="text-thor-text">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
            {camps.data.some(x => x.id === c.campaignId) && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!!busy} checked={feeds(c.campaignId)} onChange={e => run('rt' + c.campaignId, () => api.saveCampaignRouting({ campaignId: c.campaignId, enabled: e.target.checked }), 'Routing saved.')} />Feeds jobs</label><Button size="sm" variant="soft" onClick={() => setCampSheet(c.campaignId)}>Manage</Button></div>}
          </li>)}</ul>}
          {stats.campaigns.length > 0 && <div role="region" aria-label="Campaign results table" tabIndex={0} className="mt-4 hidden overflow-x-auto rounded-3xl bg-white shadow-sm ring-1 ring-ink/5 md:block"><table className="w-full min-w-[860px] text-left text-sm"><thead className="text-xs uppercase text-thor-text"><tr>{['Campaign', 'Status', 'Spend', 'Leads', 'CPL', 'Jobs', 'Bids', 'Paid', 'Commission', 'Marketplace', ''].map(h => <th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-ink/8">{stats.campaigns.map((c: any) => <tr key={c.campaignId}><td className="px-3 py-3 font-medium">{c.name}</td><td className="px-3 py-3">{c.status ? <Badge tone={c.status === 'ACTIVE' ? 'ok' : 'neutral'}>{c.status}</Badge> : '—'}</td>
              <td className="px-3 py-3">{gbp(c.spendPence)}</td><td className="px-3 py-3">{c.leads}</td><td className="px-3 py-3">{c.leads ? gbp(c.costPerLeadPence) : '—'}</td><td className="px-3 py-3">{c.jobs}</td><td className="px-3 py-3">{c.withBids}</td><td className="px-3 py-3">{c.paid}</td><td className="px-3 py-3">{gbp(c.commissionPence)}</td>
              <td className="px-3 py-3">{camps.data.some(x => x.id === c.campaignId) ? <label className="flex items-center gap-2"><input type="checkbox" checked={feeds(c.campaignId)} onChange={e => run('rt' + c.campaignId, () => api.saveCampaignRouting({ campaignId: c.campaignId, enabled: e.target.checked }), 'Routing saved.')} />Feeds jobs</label> : '—'}</td>
              <td className="px-3 py-3">{camps.data.some(x => x.id === c.campaignId) && <Button size="sm" variant="soft" onClick={() => setCampSheet(c.campaignId)}>Manage</Button>}</td></tr>)}</tbody></table></div>}</>}
      </Section>}

      {tab === 'settings' && <><Section title="Lead forms & field mapping">
        {forms.error ? <p role="alert" className="text-bad">Couldn’t load lead forms: {errMsg(forms.error)}</p> : forms.loading ? <ListSkeleton rows={1} /> : forms.data.length === 0 ? <p className="text-sm text-thor-text">Forms appear after you connect Meta and sync campaigns. The default mapping already understands standard Instant Form fields.</p> :
          <ul className="divide-y divide-ink/8 surface px-5">{forms.data.map(f => <li key={f.id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium">{f.name}</p><p className="text-xs text-thor-text">{f.id} · {f.status}</p></div><Button size="sm" variant="soft" onClick={() => setMapForm(f.id)}>Map fields</Button></li>)}</ul>}
        <Button className="mt-3" size="sm" variant="ghost" onClick={() => setMapForm('default')}>Edit default mapping</Button>
      </Section>

      <SettingsPanel /></>}
      {tab === 'connection' && <Section title="Recent lead deliveries"><ul className="divide-y divide-ink/8 surface px-5 text-sm">{events.error && <li role="alert" className="py-4 text-bad">Couldn’t load delivery history: {errMsg(events.error)}</li>}{!events.loading && !events.error && events.data.length === 0 && <li className="py-4 text-thor-text">No webhook calls yet.</li>}{events.data.map(e => <li key={e.id} className="flex justify-between py-3"><span>{e.leadCount} lead(s) · {e.status}</span><span className="text-thor-text">{e.receivedAt?.toDate().toLocaleString('en-GB')}</span></li>)}</ul></Section>}

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
    {m.error && <p role="alert" className="text-sm text-bad">Couldn’t load this mapping: {errMsg(m.error)}</p>}
    <Button loading={busy} disabled={m.loading || !!m.error} onClick={save} className="w-full">Save mapping</Button></div></Sheet>
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
    {s.error && <p role="alert" className="text-bad">Couldn’t load your saved settings: {errMsg(s.error)}</p>}
    <Button onClick={save} loading={busy} disabled={s.loading || !!s.error}>Save settings</Button></div></Section>
}

const KEY_CHECKS = ['app_id', 'app_secret', 'verify_token', 'app_url']
const Step = ({ done, n, title, children }: { done: boolean; n: number; title: string; children: ReactNode }) =>
    <li className="flex gap-3">{done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-5 shrink-0 text-thor-text" />}<div className="min-w-0 flex-1"><p className="font-medium">Step {n}: {title}</p>{children}</div></li>
/** Splits setup into what the saved keys already cover (step 1) and the one thing keys cannot do: Meta only hands over a Page and ad account when someone who manages them grants access (step 2). */
function SetupSteps({ result, reauth, canConnect, busy, onConnect, onToken }: { result: MetaSelfTest | null; reauth: boolean; canConnect: boolean; busy: string; onConnect: () => void; onToken: (t: string) => void }) {
  const [token, setToken] = useState('')
  const keys = result?.checks.filter(c => KEY_CHECKS.includes(c.id)) ?? [], keysOk = !!result && keys.every(c => c.ok), keysBad = !!result && !keysOk
  return <ol className="space-y-4 rounded-2xl bg-paper p-4">
    <Step done={keysOk} n={1} title="App keys">
      {!result ? <p className="text-thor-text">Checking your saved keys…</p> : keysOk ? <p className="text-thor-text">Done. Your Meta app ID, app secret and webhook verify token are saved. You do not need to enter them again.</p>
        : <ul className="text-thor-text">{keys.filter(c => !c.ok).map(c => <li key={c.id}>{c.label}: {c.detail}. {c.fix}</li>)}</ul>}
    </Step>
    <Step done={false} n={2} title={reauth ? 'Give access again' : 'Give access to your Facebook Page and ad account (one time)'}>
      <p className="text-thor-text">The keys identify the Thor Computer app to Meta, but they do not give it access to your Page’s leads or your ad account. Meta requires the owner of those to approve that once. Choose either way:</p>
      {!canConnect ? <p className="mt-2 text-thor-text">Only a Super Administrator can do this step.</p> : <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-4 ring-1 ring-ink/10"><p className="font-medium">Sign in with Facebook</p><p className="mb-3 text-thor-text">Quickest. You approve on Meta’s own page and come straight back. We’ll show you if Meta needs you to reconnect.</p>
          <Button loading={busy === 'connect'} disabled={!!busy || keysBad} onClick={onConnect}>{reauth ? 'Reconnect Meta' : 'Connect with Facebook'}</Button></div>
        <details className="rounded-xl bg-white p-4 ring-1 ring-ink/10"><summary className="cursor-pointer font-medium">Use a Business access token instead</summary><p className="mt-3 flex items-center gap-2 font-medium"><KeyRound className="size-4" />Business access token</p><p className="mb-3 text-thor-text">Use a token from Meta Business settings → Users → System users, add your Page and ad account to a system user, then <b>Generate token</b> for this app with the permissions listed below.</p>
          <Input label="System user access token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
          <Button className="mt-2" loading={busy === 'token'} disabled={!!busy || keysBad || token.trim().length < 20} onClick={() => { onToken(token.trim()); setToken('') }}>Connect with token</Button></details></div>}
    </Step></ol>
}

const OVERALL: Record<MetaSelfTest['overall'], { tone: 'ok' | 'warn' | 'bad' | 'neutral'; text: string }> = {
  not_configured: { tone: 'bad', text: 'Not configured: required settings are missing' }, not_connected: { tone: 'neutral', text: 'Configured, but no Meta account is connected' },
  needs_attention: { tone: 'warn', text: 'Connected, but something Meta needs is not right' }, ready: { tone: 'ok', text: 'Set up correctly' },
}
function ConnectionCheck({ result, busy, onRun }: { result: MetaSelfTest | null; busy: boolean; onRun: () => void }) {
  const o = result ? OVERALL[result.overall] : null
  return <div className="rounded-2xl bg-paper p-4"><div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="soft" loading={busy} onClick={onRun}>Run connection check</Button>
    {o && <Badge tone={o.tone}>{o.text}</Badge>}{result && <Badge tone={result.ingestionVerified ? 'ok' : 'warn'}>{result.ingestionVerified ? 'Lead import verified' : 'Lead import NOT verified yet'}</Badge>}</div>
    {!result && <p className="mt-2 text-thor-text">This asks Meta directly about your token, permissions, Page subscriptions and webhook. A page loading is not proof that anything works.</p>}
    {result && <><details className="mt-3"><summary className="cursor-pointer font-medium">View connection checks</summary><ul className="mt-3 space-y-2">{result.checks.map(c => <li key={c.id} className="flex gap-2"><span aria-hidden className={c.ok ? 'text-ok' : c.required === false ? 'text-warn' : 'text-bad'}>{c.ok ? '✓' : c.required === false ? '!' : '✗'}</span><div><p className="font-medium">{c.label}</p><p className="text-thor-text">{c.detail}</p>{!c.ok && c.fix && <p className="text-thor-blue">What to do: {c.fix}</p>}</div></li>)}</ul></details>
      <p className="mt-3 text-xs text-thor-text">{result.notes.join(' ')}{result.lastWebhookAt ? ` Last webhook: ${new Date(result.lastWebhookAt).toLocaleString('en-GB')}.` : ' No webhook received yet.'}{result.lastLeadAt ? ` Last lead: ${new Date(result.lastLeadAt).toLocaleString('en-GB')}.` : ' No lead received yet.'}</p></>}</div>
}
