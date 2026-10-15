import { useEffect, useState } from 'react'
import { limit, orderBy, where } from 'firebase/firestore'
import { Plug, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg, AiSettingsInput, LegalInput } from '@/lib/api'
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
      {superAdmin && <LegalPanel />}
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
  const toast = useToast(); const d = useDoc<Partial<AiSettingsInput> & { enabled?: boolean }>('platformSettings/ai'); const gh = useDoc<{ ok: boolean; detail: string; at?: { toDate(): Date } }>('integrationHealth/gemini')
  const [v, setV] = useState<AiSettingsInput>({ enabled: true, aiFallbackEnabled: true, welcome: 'Hi, I’m the Thor Computer assistant. I can help you request a repair, understand quotes, booking and payments, or find support.', escalation: '', knowledge: '', model: '', dailyLimit: 150, aiDailyLimit: 10, globalAiDailyLimit: 300, aiTimeoutMs: 8000, costInMicrosPer1k: 80, costOutMicrosPer1k: 320, faqOverrides: {}, customFaqs: [] })
  const [busy, setBusy] = useState(false), [usage, setUsage] = useState<Awaited<ReturnType<typeof api.aiUsage>> | null>(null), [cat, setCat] = useState<Awaited<ReturnType<typeof api.chatFaqCatalog>>['intents']>([]), [open, setOpen] = useState(false)
  useEffect(() => { if (d.data) setV(x => ({ ...x, ...(d.data as AiSettingsInput), faqOverrides: d.data!.faqOverrides ?? {}, customFaqs: d.data!.customFaqs ?? [], knowledge: d.data!.knowledge ?? '', model: d.data!.model ?? '' })) }, [d.data])
  useEffect(() => { api.aiUsage({}).then(setUsage).catch(() => {}); api.chatFaqCatalog({}).then(r => setCat(r.intents)).catch(() => {}) }, [])
  const save = async () => { setBusy(true); try { await api.saveAiSettings(v); toast('ok', 'Assistant settings saved.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  const ov = (id: string) => v.faqOverrides?.[id] ?? {}
  const setOv = (id: string, patch: { answer?: string; enabled?: boolean }) => setV(x => { const next = { ...(x.faqOverrides ?? {}), [id]: { ...(x.faqOverrides?.[id] ?? {}), ...patch } }; if (!next[id].answer && next[id].enabled !== false) delete next[id]; return { ...x, faqOverrides: next } })
  const days = Object.entries(usage?.metrics ?? {}).sort().slice(-7)
  const num = (k: keyof AiSettingsInput, label: string, min = 0, max = 100000, hint?: string) => <Input label={label} hint={hint} type="number" min={min} max={max} value={(v[k] as number) ?? 0} onChange={e => setV({ ...v, [k]: Number(e.target.value) })} />
  return <Section title="Assistant (guided answers + AI fallback)"><div className="surface space-y-4 p-5 text-sm">
    <p className="text-thor-text">Common questions and the repair intake are answered by built-in rules at no cost. The AI is only asked when the rules can’t help, within the limits below. If it is off or unavailable the guided assistant keeps working.</p>
    <label className="flex items-center gap-2"><input type="checkbox" checked={v.enabled} onChange={e => setV({ ...v, enabled: e.target.checked })} />Show the assistant to customers</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={v.aiFallbackEnabled} onChange={e => setV({ ...v, aiFallbackEnabled: e.target.checked })} />Allow the AI fallback (costs money; off = rules only)</label>
    <div className="rounded-xl bg-paper p-3" role="status">Connection to Gemini: {gh.data ? <b className={gh.data.ok ? 'text-ok' : 'text-bad'}>{gh.data.ok ? 'working' : 'problem'}</b> : 'not tested yet'}{gh.data && <span className="text-thor-text"> · {gh.data.detail}{gh.data.at ? ` · ${gh.data.at.toDate().toLocaleString('en-GB')}` : ''}</span>}</div>
    <div className="grid gap-4 sm:grid-cols-3">{num('dailyLimit', 'Messages per customer per day', 1, 1000)}{num('aiDailyLimit', 'AI answers per customer per day', 0, 200)}{num('globalAiDailyLimit', 'AI answers per day, all customers (spending cap)', 0, 20000)}</div>
    <div className="grid gap-4 sm:grid-cols-3"><Input label="AI model (optional)" hint="Empty = the default low-cost model. If the connection says a model was not found, enter a current name from Google AI Studio." value={v.model ?? ''} onChange={e => setV({ ...v, model: e.target.value.trim() })} />{num('aiTimeoutMs', 'AI timeout (ms)', 2000, 15000)}
      <div className="grid grid-cols-2 gap-2">{num('costInMicrosPer1k', 'Est. cost in (µ£/1k tokens)', 0, 100000)}{num('costOutMicrosPer1k', 'Est. cost out (µ£/1k tokens)', 0, 100000)}</div></div>
    <Textarea label="Welcome message" value={v.welcome} onChange={e => setV({ ...v, welcome: e.target.value })} />
    <Textarea label="Extra wording when sending a customer to a person" hint="Support email, phone and hours come from Platform Settings → Customer support; this text is added after them." value={v.escalation} onChange={e => setV({ ...v, escalation: e.target.value })} />
    <Textarea label="Approved knowledge for the AI (the only facts it may use)" hint="Plain text. The AI can restate this and your support/policy settings, and nothing else. Answers with prices, times or contact details not written here are discarded." value={v.knowledge ?? ''} onChange={e => setV({ ...v, knowledge: e.target.value })} />
    <button type="button" className="font-medium text-thor-blue underline" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Edit'} FAQ answers ({cat.length} built in, {v.customFaqs?.length ?? 0} custom)</button>
    {open && <div className="space-y-4"><p className="text-xs text-thor-text">Leave an answer empty to keep the built-in text. You can use {'{{support}}'}, {'{{supportEmail}}'}, {'{{supportPhone}}'}, {'{{cancelNoticeHours}}'}, {'{{refundPolicy}}'}, {'{{coverage}}'}, {'{{directWarranty}}'}; they are filled from your settings, and text inside [[if:key]]…[[/if]] only shows when that setting has a value.</p>
      {cat.filter(c => !c.account).map(c => <div key={c.id} className="rounded-2xl bg-white p-3 ring-1 ring-ink/10"><label className="flex items-center justify-between gap-3 font-medium"><span>{c.label}</span><span className="flex items-center gap-2 text-xs font-normal"><input type="checkbox" checked={ov(c.id).enabled !== false} onChange={e => setOv(c.id, { enabled: e.target.checked })} />On</span></label>
        <Textarea label="" aria-label={`${c.label} answer`} placeholder={c.answer} value={ov(c.id).answer ?? ''} onChange={e => setOv(c.id, { answer: e.target.value })} /></div>)}
      <div className="space-y-3"><p className="font-medium">Your own questions and answers</p>{(v.customFaqs ?? []).map((f, i) => <div key={f.id} className="rounded-2xl bg-white p-3 ring-1 ring-ink/10"><Textarea label="Questions people ask (one per line)" value={f.questions.join('\n')} onChange={e => setV(x => ({ ...x, customFaqs: x.customFaqs!.map((y, j) => j === i ? { ...y, questions: e.target.value.split('\n').slice(0, 8) } : y) }))} />
        <Textarea label="Answer" value={f.answer} onChange={e => setV(x => ({ ...x, customFaqs: x.customFaqs!.map((y, j) => j === i ? { ...y, answer: e.target.value } : y) }))} /><Button size="sm" variant="ghost" onClick={() => setV(x => ({ ...x, customFaqs: x.customFaqs!.filter((_, j) => j !== i) }))}>Remove</Button></div>)}
        <Button size="sm" variant="soft" onClick={() => setV(x => ({ ...x, customFaqs: [...(x.customFaqs ?? []), { id: `custom_${Date.now().toString(36)}`, questions: [''], answer: '' }] }))}>Add a question and answer</Button></div></div>}
    <p className="text-xs text-thor-text">Privacy: conversations are not stored. Only per-day counters are kept (messages, how many were answered by rules vs AI, failures, latency, estimated AI cost), plus a short-lived cache of generic AI answers that contain no personal data.</p>
    {days.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="text-thor-text"><tr>{['Day', 'Messages', 'By rules', 'AI', 'Cached', 'Fallback', 'AI failures', 'Avg ms', 'Est. AI cost'].map(h => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
      <tbody>{days.map(([day, m]) => <tr key={day} className="border-t border-ink/8"><td className="py-1 pr-3">{day.slice(6)}/{day.slice(4, 6)}</td><td className="pr-3">{m.messages ?? 0}</td><td className="pr-3">{m.rules ?? 0}</td><td className="pr-3">{m.ai ?? 0}</td><td className="pr-3">{m.cacheHits ?? 0}</td><td className="pr-3">{m.fallback ?? 0}</td><td className="pr-3">{m.aiFailures ?? 0}</td><td className="pr-3">{m.messages ? Math.round((m.latencyMsTotal ?? 0) / m.messages) : 0}</td><td>£{((m.costMicros ?? 0) / 1_000_000).toFixed(4)}</td></tr>)}</tbody></table></div>}
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

function LegalPanel() {
  const toast = useToast(); const d = useDoc<{ legal?: LegalInput & { approved?: boolean } }>('platformSettings/public'); const l = d.data?.legal
  const [v, setV] = useState<LegalInput>({ businessName: '', registeredAddress: '', companyNumber: '', contactEmail: '', icoNumber: '', icoExempt: false, privacyText: '', approved: false }), [busy, setBusy] = useState(false)
  useEffect(() => { if (l) setV(x => ({ ...x, ...l })) }, [l])
  const save = async (approved: boolean) => { setBusy(true); try { await api.saveLegalSettings({ ...v, approved }); toast('ok', approved ? 'Published. The draft notice is gone from the privacy page.' : 'Saved as a draft. The privacy page still shows its draft notice.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return <Section title="Legal: privacy policy and business details"><div className="surface space-y-4 p-5 text-sm">
    <p className="rounded-xl bg-warn/10 p-3">The public privacy page shows “Draft for legal review” until you publish your approved policy here. Nothing is filled in for you: enter the details your adviser has approved. {l?.approved ? <b className="text-ok">Currently published.</b> : <b>Currently showing the draft notice.</b>}</p>
    <div className="grid gap-4 sm:grid-cols-2"><Input label="Registered business name" value={v.businessName} onChange={e => setV({ ...v, businessName: e.target.value })} /><Input label="Company number (optional)" value={v.companyNumber ?? ''} onChange={e => setV({ ...v, companyNumber: e.target.value })} />
      <Input label="Contact email for privacy requests" value={v.contactEmail} onChange={e => setV({ ...v, contactEmail: e.target.value })} /><Input label="ICO registration number" value={v.icoNumber ?? ''} onChange={e => setV({ ...v, icoNumber: e.target.value })} /></div>
    <label className="flex items-center gap-2"><input type="checkbox" checked={!!v.icoExempt} onChange={e => setV({ ...v, icoExempt: e.target.checked })} />We are exempt from ICO registration (confirmed with our adviser)</label>
    <Textarea label="Registered address" value={v.registeredAddress} onChange={e => setV({ ...v, registeredAddress: e.target.value })} />
    <Textarea label="Approved privacy policy text" hint="Plain text. Start a line with “## ” for a heading, “- ” for bullet points; separate paragraphs with a blank line. Must include retention periods and lawful bases." rows={14} value={v.privacyText} onChange={e => setV({ ...v, privacyText: e.target.value })} />
    <div className="flex flex-wrap gap-2"><Button variant="soft" loading={busy} onClick={() => save(false)}>Save draft</Button><Button loading={busy} onClick={() => confirm('Publish this as the official privacy policy and remove the draft notice?') && save(true)}>Publish approved policy</Button></div></div></Section>
}
