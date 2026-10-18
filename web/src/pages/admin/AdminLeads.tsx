import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy } from 'firebase/firestore'
import { Inbox, Copy, ExternalLink, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Select, Sheet, Textarea, usePaged, useToast } from '@/components/ui'

interface Lead {
  status: string; statusNote?: string; platform?: 'facebook' | 'instagram'; campaignId?: string | null; campaignName?: string | null; adName?: string | null; formId?: string | null
  mapped?: Record<string, string>; missing?: string[]; invalid?: string[]; raw?: { name: string; values?: string[] }[]; jobId?: string; createdAt?: { toDate(): Date }; consent?: { given: boolean; via: string }; routingExcluded?: boolean; purged?: boolean
}
export const LEAD_STATUS: Record<string, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand' }> = {
  new: { label: 'New', tone: 'info' }, imported: { label: 'Imported', tone: 'info' }, awaiting_information: { label: 'Awaiting information', tone: 'warn' }, awaiting_confirmation: { label: 'Awaiting confirmation', tone: 'warn' },
  verified: { label: 'Verified', tone: 'brand' }, converted_to_job: { label: 'Converted to job', tone: 'ok' }, receiving_bids: { label: 'Receiving bids', tone: 'ok' }, engineer_selected: { label: 'Engineer selected', tone: 'ok' },
  converted_to_customer: { label: 'Converted to customer', tone: 'ok' }, completed: { label: 'Completed', tone: 'ok' }, rejected: { label: 'Rejected', tone: 'bad' }, duplicate: { label: 'Duplicate', tone: 'neutral' },
}
const FIELDS: [string, string][] = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['postcode', 'Postcode'], ['device', 'Device type'], ['brand', 'Brand'], ['model', 'Model'], ['problem', 'Problem']]

export default function AdminLeads() {
  const { can } = useAuth()
  const { data, loading, error } = useQuery<Lead>(can('marketing.manage') ? 'metaLeads' : null, () => [orderBy('createdAt', 'desc'), limit(300)], [])
  const [status, setStatus] = useState(''), [platform, setPlatform] = useState(''), [q, setQ] = useState(''), [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => data.filter(l => (!status || l.status === status) && (!platform || l.platform === platform) &&
    (!q || [l.mapped?.name, l.mapped?.email, l.campaignName, l.mapped?.problem, l.id].some(v => v?.toLowerCase().includes(q.toLowerCase())))), [data, status, platform, q])
  const paged = usePaged(rows, [status, platform, q])
  if (!can('marketing.manage')) return <EmptyState icon={ShieldCheck} title="No access" body="Incoming leads need the marketing permission." />
  const lead = data.find(l => l.id === open)
  return (
    <div><PageHeader title="Incoming Leads" sub="Facebook and Instagram enquiries, from advert to repair job." />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Input label="Search" placeholder="Name, email, campaign…" value={q} onChange={e => setQ(e.target.value)} />
        <Select label="Status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option>{Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Select label="Source" value={platform} onChange={e => setPlatform(e.target.value)}><option value="">Facebook + Instagram</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option></Select>
        <div className="flex items-end"><p className="text-sm text-thor-text" role="status">{rows.length} of {data.length} leads</p></div>
      </div>
      {loading ? <ListSkeleton rows={4} /> : error ? <EmptyState icon={Inbox} title="Can’t load leads" body={errMsg(error)} /> : rows.length === 0 ? <EmptyState icon={Inbox} title="No leads yet" body="Leads appear here the moment someone submits your Facebook or Instagram lead form. Connect Meta under Marketing." /> :
        <div className="overflow-x-auto rounded-3xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[820px] text-left text-sm"><thead className="text-xs uppercase text-thor-text"><tr>{['Customer', 'Source', 'Campaign', 'Received', 'Device / issue', 'Area', 'Status', 'Job'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-ink/8">{paged.items.map(l => <tr key={l.id} className="cursor-pointer hover:bg-paper" onClick={() => setOpen(l.id)}>
            <td className="px-4 py-3"><button className="text-left font-medium text-thor-blue hover:underline" onClick={() => setOpen(l.id)}>{l.mapped?.name || (l.purged ? 'Removed (retention)' : 'Unknown')}</button><p className="text-xs text-thor-text">{l.mapped?.email}</p></td>
            <td className="px-4 py-3 capitalize">{l.platform ?? '—'}</td><td className="px-4 py-3">{l.campaignName ?? l.campaignId ?? '—'}</td>
            <td className="px-4 py-3 whitespace-nowrap">{l.createdAt?.toDate().toLocaleDateString('en-GB')}</td>
            <td className="max-w-56 px-4 py-3"><p className="capitalize">{l.mapped?.device?.replace('_', ' ') || '—'}</p><p className="truncate text-xs text-thor-text">{l.mapped?.problem}</p></td>
            <td className="px-4 py-3">{l.mapped?.postcode?.split(' ')[0] ?? '—'}</td>
            <td className="px-4 py-3"><Badge tone={LEAD_STATUS[l.status]?.tone ?? 'neutral'}>{LEAD_STATUS[l.status]?.label ?? l.status}</Badge></td>
            <td className="px-4 py-3">{l.jobId ? <Link to={`/admin/jobs`} onClick={e => e.stopPropagation()} className="text-thor-blue hover:underline">View</Link> : '—'}</td></tr>)}</tbody></table></div>}
      {!loading && !error && paged.pager}
      <LeadSheet lead={lead ? { ...lead } : null} onClose={() => setOpen(null)} />
    </div>)
}

function LeadSheet({ lead, onClose }: { lead: (Lead & { id: string }) | null; onClose: () => void }) {
  const toast = useToast(); const [edit, setEdit] = useState<Record<string, string>>({}), [busy, setBusy] = useState(''), [reason, setReason] = useState(''), [link, setLink] = useState('')
  if (!lead) return <Sheet open={false} onClose={onClose} title="Lead">{null}</Sheet>
  const editable = ['imported', 'awaiting_information', 'awaiting_confirmation'].includes(lead.status), closed = ['rejected', 'duplicate'].includes(lead.status)
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); try { await fn(); toast('ok', ok) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  return (
    <Sheet open onClose={() => { setLink(''); setEdit({}); setReason(''); onClose() }} title={`Lead ${lead.mapped?.name ?? ''}`}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={LEAD_STATUS[lead.status]?.tone ?? 'neutral'}>{LEAD_STATUS[lead.status]?.label ?? lead.status}</Badge>
          <Badge tone="brand">{lead.platform ?? 'meta'}</Badge>{lead.consent && <Badge tone={lead.consent.given ? 'ok' : 'bad'}>{lead.consent.given ? 'Consent: ' + lead.consent.via.replace('_', ' ') : 'Consent declined'}</Badge>}{lead.routingExcluded && <Badge tone="warn">Campaign not routed</Badge>}</div>
        {lead.statusNote && <p className="rounded-xl bg-thor-sky/20 p-3">{lead.statusNote}</p>}
        <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-thor-text">Campaign</dt><dd>{lead.campaignName ?? lead.campaignId ?? '—'}</dd></div><div><dt className="text-thor-text">Lead form</dt><dd>{lead.formId ?? '—'}</dd></div></dl>
        {(lead.missing?.length || lead.invalid?.length) ? <p className="rounded-xl bg-warn/10 p-3">Needs attention: {[...(lead.missing ?? []), ...(lead.invalid ?? [])].join(', ')}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">{FIELDS.map(([k, label]) => <Input key={k} label={label} disabled={!editable} value={edit[k] ?? lead.mapped?.[k] ?? ''} onChange={e => setEdit(s => ({ ...s, [k]: e.target.value }))} />)}</div>
        {editable && <Button variant="soft" loading={busy === 'save'} disabled={!Object.keys(edit).length} onClick={() => run('save', async () => { await api.updateMetaLead({ leadId: lead.id, fields: edit }); setEdit({}) }, 'Lead updated.')}>Save corrections</Button>}
        {lead.raw && lead.raw.length > 0 && <details><summary className="cursor-pointer text-thor-blue">Original form answers</summary><ul className="mt-2 space-y-1">{lead.raw.map(r => <li key={r.name}><span className="text-thor-text">{r.name}:</span> {(r.values ?? []).join(', ')}</li>)}</ul></details>}
        {!closed && !lead.jobId && <div className="space-y-2 border-t border-ink/10 pt-4"><p className="font-medium">Customer confirmation</p>
          <p className="text-thor-text">The request is published to engineers once the customer confirms. Email may be off, so copy the link and send it by phone or text.</p>
          <div className="flex flex-wrap gap-2"><Button loading={busy === 'link'} disabled={lead.status === 'awaiting_information' && !!(lead.missing?.length || lead.invalid?.length)} onClick={() => run('link', async () => setLink((await api.issueLeadConfirmationLink({ leadId: lead.id })).url), 'New single-use link created.')}>Create confirmation link</Button>
            <Button variant="ghost" loading={busy === 'mail'} onClick={() => run('mail', () => api.issueLeadConfirmationLink({ leadId: lead.id, sendEmail: true }), 'Email sent (if email is enabled).')}>Email it</Button></div>
          {link && <div className="flex items-center gap-2 rounded-xl bg-paper p-3"><code className="min-w-0 flex-1 break-all text-xs">{link}</code><button aria-label="Copy link" onClick={() => navigator.clipboard.writeText(link).then(() => toast('ok', 'Copied.'))}><Copy className="size-4" /></button></div>}
          <Textarea label="Reject as spam / invalid" placeholder="Reason (required)" value={reason} onChange={e => setReason(e.target.value)} />
          <Button variant="danger" disabled={reason.trim().length < 3} loading={busy === 'rej'} onClick={() => run('rej', async () => { await api.rejectMetaLead({ leadId: lead.id, reason }); onClose() }, 'Lead rejected.')}>Reject lead</Button></div>}
        {lead.jobId && <Link to="/admin/jobs" className="inline-flex items-center gap-1 text-thor-blue"><ExternalLink className="size-4" />Linked repair job</Link>}
      </div>
    </Sheet>)
}
