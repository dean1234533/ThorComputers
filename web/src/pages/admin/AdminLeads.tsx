import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { limit, orderBy, where, QueryConstraint } from 'firebase/firestore'
import { ArrowLeft, Inbox } from 'lucide-react'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { useEngineers } from '@/hooks/useEngineers'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Select, Sheet, Textarea, useToast } from '@/components/ui'
import { downloadCsv, ExportButton, Gate } from '@/components/admin'
import { engName } from '@/components/QuoteCompare'
import { DEVICE_TYPES, LEAD_STATUS_LABEL, SERVICE_METHODS, gbp } from '@/types/domain'

export interface Lead {
  leadId: string; platform: 'facebook' | 'instagram'; pageId: string; formId: string | null; campaignId: string | null; adsetId: string | null; adId: string | null
  createdAt: { toDate(): Date }; status: string; mapped: Record<string, string>; unmapped?: Record<string, string>; missing: string[]; consent?: { given: boolean; source: string | null; note?: string }
  duplicateOf?: string | null; jobId?: string | null; jobReference?: string; customerId?: string | null; quoteCount?: number; selectedEngineerId?: string | null; transactionStatus?: string | null; paidPence?: number
  reviewReason?: string; rejectReason?: string; history?: { status: string; at: { toDate(): Date }; by: string }[]; routingRuleId?: string | null; importedVia?: string
}
const tone = (s: string) => (['converted_to_job', 'receiving_bids', 'engineer_selected', 'converted_to_customer', 'completed'].includes(s) ? 'ok' : ['rejected', 'duplicate', 'cancelled'].includes(s) ? 'neutral' : s === 'needs_review' ? 'bad' : 'warn') as 'ok' | 'neutral' | 'bad' | 'warn'
export const LeadStatus = ({ s }: { s: string }) => <Badge tone={tone(s)}>{LEAD_STATUS_LABEL[s] ?? s}</Badge>
const device = (t?: string) => DEVICE_TYPES.find(d => d.id === t)?.label ?? t ?? '—'

export function AdminLeads() {
  const nav = useNavigate()
  const [f, setF] = useState({ status: '', platform: '', q: '' })
  const campaigns = useQuery<{ name: string }>('metaCampaigns', () => [limit(200)], [])
  const cname = useMemo(() => Object.fromEntries(campaigns.data.map(c => [c.id, c.name])), [campaigns.data])
  const leads = useQuery<Lead>('metaLeads', () => { const c: QueryConstraint[] = []; if (f.status) c.push(where('status', '==', f.status)); if (f.platform) c.push(where('platform', '==', f.platform)); c.push(orderBy('createdAt', 'desc'), limit(200)); return c }, [f.status, f.platform])
  const eng = useEngineers(leads.data.map(l => l.selectedEngineerId ?? '').filter(Boolean))
  const q = f.q.trim().toLowerCase()
  const rows = leads.data.filter(l => !q || [l.mapped.fullName, l.mapped.email, l.mapped.postcode, l.jobReference, l.leadId, cname[l.campaignId ?? '']].some(v => v?.toLowerCase().includes(q)))
  const exportCsv = () => downloadCsv('thor-leads.csv', rows.map(l => ({ received: l.createdAt.toDate().toISOString(), source: l.platform, campaign: cname[l.campaignId ?? ''] ?? l.campaignId, customer: l.mapped.fullName, device: l.mapped.deviceType, issue: l.mapped.problem, location: l.mapped.postcode, status: l.status, job: l.jobReference ?? '', quotes: l.quoteCount ?? 0, transaction: l.transactionStatus ?? '' })))
  return (
    <Gate perm="leads.manage"><div><PageHeader title="Incoming Leads" sub="Facebook and Instagram enquiries and how they convert into repair jobs." action={<ExportButton onClick={exportCsv} disabled={!rows.length} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Select label="Status" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">All</option>{Object.entries(LEAD_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select label="Source" value={f.platform} onChange={e => setF({ ...f, platform: e.target.value })}><option value="">All</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option></Select>
        <div className="col-span-2"><Input label="Search" placeholder="Name, email, postcode, campaign, THOR reference" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></div></div>
      {leads.loading ? <ListSkeleton /> : rows.length === 0 ? <EmptyState icon={Inbox} title="No leads" body="Leads from connected Meta lead forms appear here automatically." action={<Link to="/admin/marketing"><Button variant="soft">Marketing & Lead Generation</Button></Link>} /> :
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[60rem] text-sm"><thead className="text-left text-thor-text"><tr>{['Received', 'Customer', 'Source', 'Campaign', 'Device / issue', 'Location', 'Status', 'Job', 'Quotes', 'Engineer', 'Payment'].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-ink/8">{rows.map(l => <tr key={l.id} onClick={() => nav(`/admin/leads/${l.id}`)} className="cursor-pointer hover:bg-paper">
            <td className="p-3 whitespace-nowrap">{l.createdAt.toDate().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td><td className="p-3">{l.mapped.fullName ?? '—'}</td>
            <td className="p-3"><Badge tone={l.platform === 'instagram' ? 'warn' : 'info'}>{l.platform === 'instagram' ? 'Instagram' : 'Facebook'}</Badge></td><td className="max-w-40 truncate p-3">{cname[l.campaignId ?? ''] ?? l.campaignId ?? 'Organic'}</td>
            <td className="max-w-56 truncate p-3">{device(l.mapped.deviceType)} · {l.mapped.problem ?? ''}</td><td className="p-3">{l.mapped.postcode ?? '—'}</td><td className="p-3"><LeadStatus s={l.status} /></td>
            <td className="p-3">{l.jobReference ?? ''}</td><td className="p-3">{l.quoteCount ?? 0}</td><td className="p-3">{l.selectedEngineerId ? engName(eng[l.selectedEngineerId]) : ''}</td><td className="p-3">{l.transactionStatus ?? ''}</td></tr>)}</tbody></table></div>}
    </div></Gate>)
}

const EDITABLE = ['fullName', 'email', 'phone', 'postcode', 'deviceType', 'manufacturer', 'model', 'problem', 'serviceMethod', 'urgency', 'preferredDate']
export function LeadDetail() {
  const { id } = useParams(); const toast = useToast(); const nav = useNavigate()
  const l = useDoc<Lead>(`metaLeads/${id}`)
  const raw = useDoc<{ fieldData: { name: string; values?: string[] }[] }>(`metaLeadRaw/${id}`)
  const camp = useDoc<{ name: string }>(l.data?.campaignId ? `metaCampaigns/${l.data.campaignId}` : null)
  const [edit, setEdit] = useState<Record<string, string> | null>(null); const [act, setAct] = useState<null | 'approve' | 'reject' | 'request_info' | 'resend' | 'reprocess'>(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false)
  if (l.loading) return <ListSkeleton rows={2} />
  if (!l.data) return <EmptyState icon={Inbox} title="Lead not found" body="It may have been removed." />
  const x = l.data, done = ['converted_to_job', 'receiving_bids', 'engineer_selected', 'converted_to_customer', 'completed'].includes(x.status)
  const run = async (action: 'approve' | 'reject' | 'request_info' | 'update_fields' | 'resend' | 'reprocess', fields?: Record<string, string>) => {
    setBusy(true); try { await api.adminLeadAction({ leadId: x.leadId, action, note: note.trim(), fields }); toast('ok', 'Done.'); setAct(null); setEdit(null); setNote('') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return (
    <Gate perm="leads.manage"><div className="max-w-3xl">
      <button onClick={() => nav('/admin/leads')} className="mb-3 flex items-center gap-1 text-sm text-thor-blue"><ArrowLeft className="size-4" />All leads</button>
      <div className="flex flex-wrap items-center gap-3"><h1 className="font-display text-3xl">{x.mapped.fullName ?? 'Unnamed lead'}</h1><LeadStatus s={x.status} />{x.consent?.given ? <Badge tone="ok">Consent recorded</Badge> : <Badge tone="bad">No marketplace consent</Badge>}</div>
      <p className="mt-1 text-sm text-thor-text">{x.platform === 'instagram' ? 'Instagram' : 'Facebook'} lead {x.leadId} · {x.createdAt.toDate().toLocaleString('en-GB')} · campaign {camp.data?.name ?? x.campaignId ?? 'none'} · via {x.importedVia ?? 'webhook'}</p>
      {(x.reviewReason || x.rejectReason) && <p className="mt-3 rounded-xl bg-warn/10 p-3 text-sm">{x.rejectReason ? `Rejected: ${x.rejectReason}` : `Needs review: ${x.reviewReason}`}</p>}
      {x.missing.length > 0 && <p className="mt-3 rounded-xl bg-warn/10 p-3 text-sm">Missing for publication: <b>{x.missing.join(', ')}</b></p>}
      {x.duplicateOf && <p className="mt-3 rounded-xl bg-paper p-3 text-sm">Possible duplicate of <Link className="text-thor-blue underline" to={`/admin/leads/${x.duplicateOf}`}>{x.duplicateOf}</Link></p>}
      <Section title="Mapped details" action={!done && <Button size="sm" variant="soft" onClick={() => setEdit(Object.fromEntries(EDITABLE.map(k => [k, x.mapped[k] ?? ''])))}>Correct fields</Button>}>
        <dl className="grid grid-cols-[9rem_1fr] gap-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-ink/5">{EDITABLE.map(k => <Fragment key={k}><dt className="text-thor-text">{k}</dt><dd className="break-words">{k === 'deviceType' ? device(x.mapped[k]) : k === 'serviceMethod' ? SERVICE_METHODS.find(m => m.id === x.mapped[k])?.label ?? '—' : x.mapped[k] ?? '—'}</dd></Fragment>)}</dl></Section>
      <Section title="Original form answers"><ul className="rounded-2xl bg-paper p-4 text-sm">{raw.data?.fieldData.map(fd => <li key={fd.name}><span className="text-thor-text">{fd.name}:</span> {(fd.values ?? []).join(', ')}</li>) ?? <li>Loading…</li>}</ul></Section>
      {x.jobId && <Section title="Repair job"><p className="text-sm">Job <b>{x.jobReference}</b> · {x.quoteCount ?? 0} quote(s){x.transactionStatus ? ` · payment ${x.transactionStatus}` : ''}{x.paidPence ? ` · ${gbp(x.paidPence)} paid` : ''}. <Link className="text-thor-blue underline" to={`/admin/jobs`}>Repair requests</Link></p></Section>}
      <Section title="History"><ol className="space-y-1 text-sm">{(x.history ?? []).map((h, i) => <li key={i}><LeadStatus s={h.status} /> <span className="text-thor-text">{h.at.toDate().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} · {h.by === 'system' ? 'automatic' : h.by.slice(0, 8)}</span></li>)}</ol></Section>
      {!done && <div className="flex flex-wrap gap-2 border-t border-ink/10 pt-4">
        <Button onClick={() => setAct('approve')} disabled={x.missing.length > 0 || !x.mapped.email}>Approve and publish</Button>
        <Button variant="soft" onClick={() => setAct('request_info')} disabled={!x.mapped.email}>Request information</Button>
        <Button variant="soft" onClick={() => setAct('resend')} disabled={!x.mapped.email}>Resend confirmation link</Button>
        <Button variant="ghost" onClick={() => setAct('reprocess')}>Re-run automation</Button>
        <Button variant="danger" onClick={() => setAct('reject')}>Reject as spam</Button></div>}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Correct lead fields">{edit && <div className="space-y-3">{EDITABLE.map(k => k === 'problem' ? <Textarea key={k} label={k} value={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.value })} /> : <Input key={k} label={k} value={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.value })} />)}
        <Button className="w-full" loading={busy} onClick={() => run('update_fields', edit)}>Save (audited)</Button></div>}</Sheet>
      <Sheet open={!!act} onClose={() => setAct(null)} title={{ approve: 'Approve and publish', reject: 'Reject lead', request_info: 'Request more information', resend: 'Resend confirmation link', reprocess: 'Re-run automation' }[act ?? 'approve']}>
        <p className="mb-3 text-sm text-thor-text">{act === 'approve' ? 'Publishes the job to matching engineers. If the customer has no account, one is created and they are emailed a link to set a password.' + (x.consent?.given ? '' : ' This lead has no recorded consent: explain in the note how consent was obtained.') : act === 'reject' ? 'The lead will not become a job.' : 'The customer is emailed a secure link.'}</p>
        <Textarea label="Note (recorded in the audit log)" value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
        <Button className="mt-3 w-full" variant={act === 'reject' ? 'danger' : 'primary'} loading={busy} onClick={() => act && run(act)}>Confirm</Button></Sheet>
    </div></Gate>)
}
