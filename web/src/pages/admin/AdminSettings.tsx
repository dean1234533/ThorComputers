import { useEffect, useState } from 'react'
import { limit, orderBy, where } from 'firebase/firestore'
import { Plug, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, Input, PageHeader, Section, Select, Textarea, useToast, EmptyState } from '@/components/ui'
import { SPECIALISATIONS, ADMIN_DEFAULT_PERMISSIONS } from '@/types/domain'

interface PS { support?: { email: string; phone: string; hours: string }; booking?: { reminderHours: number[]; leadMinutes: number; cancelNoticeHours: number }; coverage?: { areas: string[]; note: string }; directServicePolicy?: { warranty: string; terms: string }; marketplaceDisclaimer?: string; categories?: { id: string; label: string; enabled: boolean }[] }

export default function AdminSettings() {
  const { perms, can: can2 } = useAuth(); const toast = useToast(); const { data, loading } = useDoc<PS>('platformSettings/public')
  const can = perms.includes('settings.edit'); const superAdmin = perms.includes('admins.manage')
  const [s, setS] = useState({ email: '', phone: '', hours: '', reminders: '24, 2', lead: 120, notice: 24, areas: '', coverageNote: '', warranty: '', terms: '', disclaimer: '' }); const [cats, setCats] = useState<Record<string, boolean>>({}); const [busy, setBusy] = useState(false)
  useEffect(() => { if (loading) return; setS({ email: data?.support?.email ?? '', phone: data?.support?.phone ?? '', hours: data?.support?.hours ?? '', reminders: (data?.booking?.reminderHours ?? [24, 2]).join(', '), lead: data?.booking?.leadMinutes ?? 120, notice: data?.booking?.cancelNoticeHours ?? 24, areas: (data?.coverage?.areas ?? []).join(', '), coverageNote: data?.coverage?.note ?? '', warranty: data?.directServicePolicy?.warranty ?? '', terms: data?.directServicePolicy?.terms ?? '', disclaimer: data?.marketplaceDisclaimer ?? '' }); setCats(Object.fromEntries(SPECIALISATIONS.map(c => [c.id, data?.categories?.find(x => x.id === c.id)?.enabled ?? true]))) }, [loading, data])
  const events = useQuery<{ type: string; createdAt?: { toDate(): Date } }>(can ? 'integrationEvents' : null, () => [orderBy('createdAt', 'desc'), limit(5)], [can])
  const admins = useQuery<{ fullName: string; email: string; adminLevel?: string }>(superAdmin ? 'users' : null, () => [where('role', '==', 'admin'), orderBy('createdAt', 'desc'), limit(50)], [superAdmin])

  if (!can) return <EmptyState icon={ShieldCheck} title="No access" body="Platform settings need the settings permission." />
  const save = async () => { setBusy(true); try { await api.savePlatformSettings({ support: { email: s.email, phone: s.phone, hours: s.hours }, booking: { reminderHours: s.reminders.split(',').map(x => Number(x.trim())).filter(x => x > 0), leadMinutes: s.lead, cancelNoticeHours: s.notice }, coverage: { areas: s.areas.split(',').map(x => x.trim()).filter(Boolean), note: s.coverageNote }, directServicePolicy: { warranty: s.warranty, terms: s.terms }, marketplaceDisclaimer: s.disclaimer, categories: SPECIALISATIONS.map(c => ({ id: c.id, label: c.label, enabled: cats[c.id] !== false })) }); toast('ok', 'Settings saved.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const last = events.data[0]?.createdAt?.toDate()
  return (
    <div className="max-w-2xl"><PageHeader title="Platform Settings" />
      <Section title="Customer support"><div className="grid gap-4 sm:grid-cols-2"><Input label="Support email" value={s.email} onChange={e => setS({ ...s, email: e.target.value })} /><Input label="Support phone" value={s.phone} onChange={e => setS({ ...s, phone: e.target.value })} /></div><div className="mt-4"><Input label="Opening hours" value={s.hours} onChange={e => setS({ ...s, hours: e.target.value })} /></div></Section>
      <Section title="Booking rules"><div className="grid gap-4 sm:grid-cols-3"><Input label="Reminders (hours before)" hint="Comma-separated hours before the appointment" value={s.reminders} onChange={e => setS({ ...s, reminders: e.target.value })} /><Input label="Minimum lead time (min)" type="number" value={s.lead} onChange={e => setS({ ...s, lead: Number(e.target.value) })} /><Input label="Cancellation notice (h)" type="number" value={s.notice} onChange={e => setS({ ...s, notice: Number(e.target.value) })} /></div></Section>
      <Section title="Repair categories"><div className="flex flex-wrap gap-2">{SPECIALISATIONS.map(c => <label key={c.id} className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-ink/10"><input type="checkbox" className="accent-thor-blue" checked={cats[c.id] !== false} onChange={e => setCats({ ...cats, [c.id]: e.target.checked })} />{c.label}</label>)}</div></Section>
      <Section title="Geographic coverage"><Input label="Areas served" hint="Comma separated" value={s.areas} onChange={e => setS({ ...s, areas: e.target.value })} /><div className="mt-4"><Input label="Coverage note" value={s.coverageNote} onChange={e => setS({ ...s, coverageNote: e.target.value })} /></div></Section>
      <Section title="Policies"><p className="mb-3 text-sm text-thor-text">Thor Computer’s own warranty applies only to work done by Thor Computer engineers. Independent engineers set their own warranty in each quotation.</p>
        <Textarea label="Warranty for Thor Computer’s direct services" value={s.warranty} onChange={e => setS({ ...s, warranty: e.target.value })} /><div className="mt-4"><Textarea label="Direct service terms" value={s.terms} onChange={e => setS({ ...s, terms: e.target.value })} /></div><div className="mt-4"><Textarea label="Marketplace disclaimer (shown with independent quotes)" value={s.disclaimer} onChange={e => setS({ ...s, disclaimer: e.target.value })} /></div></Section>
      <Button onClick={save} loading={busy} size="lg" className="w-full">Save settings</Button>
      <MarketplacePanel />
      {can2('ai.manage') && <AiSettingsPanel />}
      <Section title="WordPress integration"><div className="flex items-center gap-3 surface p-5"><Plug className="size-6 text-thor-blue" /><div className="flex-1"><p className="font-medium">Enquiry intake</p><p className="text-sm text-thor-text">{last ? `Last enquiry received ${last.toLocaleString('en-GB')}` : 'No enquiries received from thorcomputer.com yet.'}</p></div><Badge tone={last ? 'ok' : 'neutral'}>{last ? 'Receiving' : 'Waiting'}</Badge></div></Section>
      {superAdmin && <Section title="Admin team"><ul className="divide-y divide-ink/8 surface px-5">{admins.data.map(a => <AdminRow key={a.id} id={a.id} name={a.fullName} email={a.email} level={a.adminLevel ?? 'admin'} />)}</ul>
        <PromoteForm /></Section>}
    </div>)
}

function AdminRow({ id, name, email, level }: { id: string; name: string; email: string; level: string }) {
  const toast = useToast(); const { user } = useAuth()
  const change = async (l: string) => { try { await api.setAdminRole({ userId: id, level: l as 'admin' }); toast('ok', 'Account access updated. Ask them to sign in again.') } catch (e) { toast('bad', errMsg(e)) } }
  return <li className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate font-medium">{name}</p><p className="truncate text-xs text-thor-text">{email}</p></div>
    {id === user!.uid ? <Badge tone="brand">You</Badge> : <div className="w-36"><Select label="" aria-label="Role" value={level} onChange={e => change(e.target.value)}><option value="super_admin">Super admin</option><option value="admin">Admin</option><option value="support">Support staff</option><option value="none">Remove admin</option></Select></div>}</li>
}
function PromoteForm() {
  const toast = useToast(); const [uid, setUid] = useState(''); const [level, setLevel] = useState<'admin' | 'support' | 'super_admin'>('support')
  return <div className="mt-4 rounded-2xl border border-dashed border-ink/20 p-4"><p className="mb-3 text-sm text-thor-text">Add an admin by their user ID (copy it from the Customers list or Firebase console). Permissions follow the role: {Object.entries(ADMIN_DEFAULT_PERMISSIONS).map(([k, v]) => `${k.replace('_', ' ')} (${v.length})`).join(', ')}.</p>
    <div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><Input label="User ID" value={uid} onChange={e => setUid(e.target.value.trim())} /></div><Select label="Role" value={level} onChange={e => setLevel(e.target.value as 'admin')}><option value="support">Support staff</option><option value="admin">Admin</option><option value="super_admin">Super admin</option></Select>
      <Button disabled={uid.length < 10} onClick={async () => { try { await api.setAdminRole({ userId: uid, level }); toast('ok', 'Administrator added.'); setUid('') } catch (e) { toast('bad', errMsg(e)) } }}>Add</Button></div></div>
}

function AiSettingsPanel() {
  const toast = useToast(); const d = useDoc<{ enabled: boolean; welcome: string; dailyLimit: number; escalation: string; knowledge?: string }>('platformSettings/ai')
  const [v, setV] = useState({ enabled: true, welcome: 'Hi, I’m the Thor Computer assistant. I can help you describe a repair, understand quotes, or find support.', dailyLimit: 40, escalation: 'Please contact our support team.', knowledge: '' }), [busy, setBusy] = useState(false), [usage, setUsage] = useState<Record<string, { messages: number; users: number }>>({})
  useEffect(() => { if (d.data) setV(x => ({ ...x, ...d.data!, knowledge: d.data!.knowledge ?? '' })) }, [d.data])
  useEffect(() => { api.aiUsage({}).then(r => setUsage(r.perDay)).catch(() => {}) }, [])
  const save = async () => { setBusy(true); try { await api.saveAiSettings(v); toast('ok', 'Assistant settings saved.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return <Section title="AI assistant"><div className="surface space-y-4 p-5 text-sm">
    <label className="flex items-center gap-2"><input type="checkbox" checked={v.enabled} onChange={e => setV({ ...v, enabled: e.target.checked })} />Show the assistant to customers</label>
    <Textarea label="Welcome message" value={v.welcome} onChange={e => setV({ ...v, welcome: e.target.value })} />
    <div className="grid gap-4 sm:grid-cols-2"><Input label="Messages per customer per day" type="number" min="1" max="500" value={v.dailyLimit} onChange={e => setV({ ...v, dailyLimit: Number(e.target.value) })} /></div>
    <Textarea label="Human support / escalation wording" value={v.escalation} onChange={e => setV({ ...v, escalation: e.target.value })} />
    <Textarea label="Approved knowledge (FAQs, policies the assistant may rely on)" hint="Plain text. It will not invent anything outside this and your public settings." value={v.knowledge} onChange={e => setV({ ...v, knowledge: e.target.value })} />
    <p className="text-xs text-thor-text">Conversations are not stored; only message counts per day. The assistant cannot create jobs, take payments or change accounts, and it never sees other customers’ data.</p>
    {Object.keys(usage).length > 0 && <p className="text-thor-text">Last 7 days: {Object.entries(usage).sort().map(([day, u]) => `${day.slice(6)}/${day.slice(4, 6)}: ${u.messages} msgs / ${u.users} users`).join(' · ')}</p>}
    <Button loading={busy} onClick={save}>Save assistant settings</Button></div></Section>
}

function MarketplacePanel() {
  const toast = useToast(); const d = useDoc<{ newRequestsEnabled: boolean; biddingEnabled: boolean; maxQuotesPerJob: number; maxQuoteValidityDays: number }>('platformSettings/marketplace')
  const [v, setV] = useState({ newRequestsEnabled: true, biddingEnabled: true, maxQuotesPerJob: 10, maxQuoteValidityDays: 30 }), [busy, setBusy] = useState(false)
  useEffect(() => { if (d.data) setV(x => ({ ...x, ...d.data! })) }, [d.data])
  const save = async () => { setBusy(true); try { await api.saveMarketplaceSettings(v); toast('ok', 'Marketplace rules saved.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return <Section title="Marketplace rules"><div className="surface space-y-4 p-5 text-sm">
    <label className="flex items-center gap-2"><input type="checkbox" checked={v.newRequestsEnabled} onChange={e => setV({ ...v, newRequestsEnabled: e.target.checked })} />Customers can submit new repair requests</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={v.biddingEnabled} onChange={e => setV({ ...v, biddingEnabled: e.target.checked })} />Engineers can submit quotations</label>
    <div className="grid gap-4 sm:grid-cols-2"><Input label="Maximum quotations per job" type="number" min="1" max="50" value={v.maxQuotesPerJob} onChange={e => setV({ ...v, maxQuotesPerJob: Number(e.target.value) })} />
      <Input label="Longest quotation validity (days)" type="number" min="1" max="90" value={v.maxQuoteValidityDays} onChange={e => setV({ ...v, maxQuoteValidityDays: Number(e.target.value) })} /></div>
    <Button loading={busy} onClick={save}>Save marketplace rules</Button></div></Section>
}
