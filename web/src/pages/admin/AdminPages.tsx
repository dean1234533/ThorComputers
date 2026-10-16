import { ReactNode, useState } from 'react'
import { limit, orderBy, where, QueryConstraint } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { ExternalLink, FileText, ShieldCheck, Users, Wrench, ClipboardList, CheckCircle2, Flag } from 'lucide-react'
import { storage } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { useQuery, WithId } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, ListSkeleton, PageHeader, Select, Sheet, Stars, StatusPill, Textarea, Input, useToast } from '@/components/ui'
import { gbp, JobStatus, SPECIALISATIONS } from '@/types/domain'

// ---------- shared helpers ----------
function PermGate({ perm, children }: { perm: string; children: ReactNode }) {
  const { perms } = useAuth(); return perms.includes(perm as never) ? <>{children}</> : <EmptyState icon={ShieldCheck} title="No access" body="Your admin role doesn’t include this area. Ask a super admin." />
}
const day = (t?: { toDate(): Date }) => t?.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) ?? ''
function NoteSheet({ open, title, action, onClose, onSubmit, danger }: { open: boolean; title: string; action: string; onClose: () => void; onSubmit: (note: string) => Promise<void>; danger?: boolean }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false)
  return <Sheet open={open} onClose={onClose} title={title}><Textarea label="Note (recorded in the audit log)" value={note} onChange={e => setNote(e.target.value)} maxLength={500} /><Button variant={danger ? 'danger' : 'primary'} className="mt-4 w-full" loading={busy} disabled={note.trim().length < 5} onClick={async () => { setBusy(true); try { await onSubmit(note.trim()); setNote(''); onClose() } finally { setBusy(false) } }}>{action}</Button></Sheet>
}

export { default as AdminOverview } from './AdminOverview'

// ---------- approvals ----------
interface App { status: string; profile?: any; submittedAt?: { toDate(): Date }; infoRequest?: string }
interface Qual { engineerId: string; name: string; issuer: string; storagePath: string; verification: string }

export function Approvals() {
  const [filter, setFilter] = useState('pending')
  const apps = useQuery<App>('engineerApplications', () => [where('status', '==', filter), orderBy('submittedAt', 'asc'), limit(50)], [filter])
  const [open, setOpen] = useState<WithId<App> | null>(null)
  return (
    <PermGate perm="engineers.review"><div><PageHeader title="Approvals" sub="Review engineer applications and qualifications." action={<div className="w-44"><Select label="" aria-label="Status" value={filter} onChange={e => setFilter(e.target.value)}>{['pending', 'info_requested', 'approved', 'rejected', 'suspended'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></div>} />
      {apps.loading ? <ListSkeleton /> : apps.data.length === 0 ? <EmptyState icon={ShieldCheck} title="Nothing here" body="No applications with this status." /> : <ul className="space-y-3">{apps.data.map(a => <li key={a.id}><button onClick={() => setOpen(a)} className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-ink/5 hover:shadow-md"><div className="min-w-0 flex-1"><p className="font-medium">{a.profile?.displayName}{a.profile?.businessName && ` · ${a.profile.businessName}`}</p><p className="text-sm text-thor-text">{a.profile?.yearsExperience} yrs · {a.profile?.specialisations?.length} specialisations · submitted {day(a.submittedAt)}</p></div><Badge tone="warn">{a.status.replace('_', ' ')}</Badge></button></li>)}</ul>}
      {open && <ReviewApplication app={open} onClose={() => setOpen(null)} />}</div></PermGate>)
}

function ReviewApplication({ app, onClose }: { app: WithId<App>; onClose: () => void }) {
  const toast = useToast(); const quals = useQuery<Qual>('engineerQualifications', () => [where('engineerId', '==', app.id)], [app.id])
  const [decision, setDecision] = useState<null | 'approve' | 'reject' | 'request_info' | 'suspend' | 'reinstate'>(null); const [provider, setProvider] = useState<'independent' | 'thor'>('independent')
  const p = app.profile ?? {}
  const view = async (path: string) => { try { window.open(await getDownloadURL(ref(storage, path)), '_blank', 'noopener') } catch { toast('bad', 'Could not open document.') } }
  const verify = async (id: string, d: 'verified' | 'rejected') => { try { await api.verifyQualification({ qualificationId: id, decision: d }); toast('ok', d === 'verified' ? 'Certificate approved.' : 'Certificate rejected.') } catch (e) { toast('bad', errMsg(e)) } }
  return (
    <Sheet open onClose={onClose} title="Review application">
      <div className="space-y-4 text-sm">
        <div><p className="font-display text-xl">{p.displayName}</p><p className="text-thor-text">{p.businessName} · {p.yearsExperience} years · service area {p.serviceArea?.postcode} ({p.serviceArea?.radiusMiles} mi)</p></div>
        <p className="whitespace-pre-line break-words">{p.bio}</p>
        <div className="flex flex-wrap gap-2">{p.specialisations?.map((s: string) => <Badge key={s} tone="info">{SPECIALISATIONS.find(x => x.id === s)?.label}</Badge>)}</div>
        {p.certificationsText && <p><b>Self-reported:</b> {p.certificationsText}</p>}
        <div><p className="mb-2 font-medium">Qualification documents</p><ul className="space-y-2">{quals.data.map(q => <li key={q.id} className="space-y-3 rounded-xl bg-paper p-4"><div className="flex items-start gap-2"><FileText className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 flex-1 break-words">{q.name} <span className="text-thor-text">· {q.issuer}</span></span></div><div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="ghost" onClick={() => view(q.storagePath)}><ExternalLink className="size-4" />Open</Button>
          {q.verification === 'pending' ? <><Button size="sm" onClick={() => verify(q.id, 'verified')}>Verify</Button><Button size="sm" variant="ghost" className="text-bad" onClick={() => verify(q.id, 'rejected')}>Reject</Button></> : <Badge tone={q.verification === 'verified' ? 'ok' : 'bad'}>{q.verification}</Badge>}</div></li>)}{quals.data.length === 0 && <li className="text-thor-text">None uploaded.</li>}</ul>
          <p className="mt-2 text-xs text-thor-text">A document is only “verified” after you personally check it.</p></div>
        {decision === 'approve' && <Select label="Engineer designation" value={provider} onChange={e => setProvider(e.target.value as 'independent' | 'thor')}><option value="independent">Verified independent engineer</option><option value="thor">Official Thor Computer engineer</option></Select>}
        <div className="grid gap-3 border-t border-ink/10 pt-5 sm:grid-cols-3">{app.status === 'pending' && <><Button onClick={() => setDecision('approve')}>Approve</Button><Button variant="soft" onClick={() => setDecision('request_info')}>Request info</Button><Button variant="danger" onClick={() => setDecision('reject')}>Reject</Button></>}{app.status === 'approved' && <Button variant="danger" onClick={() => setDecision('suspend')}>Suspend</Button>}{app.status === 'suspended' && <Button onClick={() => setDecision('reinstate')}>Reinstate</Button>}</div>
      </div>
      <NoteSheet open={!!decision} title={`${decision?.replace('_', ' ')} application`} action="Confirm" danger={decision === 'reject' || decision === 'suspend'} onClose={() => setDecision(null)} onSubmit={async note => { try { await api.reviewEngineerApplication({ engineerId: app.id, decision: decision!, note, provider: decision === 'approve' ? provider : undefined }); toast('ok', 'Your decision has been saved.'); onClose() } catch (e) { toast('bad', errMsg(e)); throw e } }} />
    </Sheet>)
}

// ---------- users ----------
interface U { fullName: string; email: string; status: string; role: string; createdAt?: { toDate(): Date } }
function UserList({ role, title, perm }: { role: 'customer' | 'engineer'; title: string; perm: string }) {
  const toast = useToast(); const u = useQuery<U>('users', () => [where('role', '==', role), orderBy('createdAt', 'desc'), limit(100)], [role]); const [target, setTarget] = useState<WithId<U> | null>(null)
  return (
    <PermGate perm={perm}><div><PageHeader title={title} />{u.loading ? <ListSkeleton /> : u.data.length === 0 ? <EmptyState icon={Users} title="No accounts yet" body="They’ll appear here as people register." /> :
      <ul className="divide-y divide-ink/8 surface px-5">{u.data.map(x => <li key={x.id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate font-medium">{x.fullName}</p><p className="truncate text-xs text-thor-text">{x.email} · joined {day(x.createdAt)}</p></div><Badge tone={x.status === 'active' ? 'ok' : 'bad'}>{x.status}</Badge><Button size="sm" variant="ghost" onClick={() => setTarget(x)}>{x.status === 'suspended' ? 'Reinstate' : 'Suspend'}</Button></li>)}</ul>}
      {target && <NoteSheet open title={`${target.status === 'suspended' ? 'Reinstate' : 'Suspend'} ${target.fullName}`} action="Confirm" danger={target.status !== 'suspended'} onClose={() => setTarget(null)} onSubmit={async note => { try { await api.setAccountSuspended({ userId: target.id, suspended: target.status !== 'suspended', reason: note }); toast('ok', 'Done.') } catch (e) { toast('bad', errMsg(e)); throw e } }} />}</div></PermGate>)
}
export const AdminCustomers = () => <UserList role="customer" title="Customers" perm="customers.manage" />
export const AdminEngineers = () => <UserList role="engineer" title="Engineers" perm="customers.manage" />

// ---------- jobs, quotes, appointments ----------
export function AdminJobs() {
  const toast = useToast(); const [st, setSt] = useState('')
  const j = useQuery<{ reference: string; status: JobStatus; device: { manufacturer: string; model: string }; location: { area: string }; quoteCount: number; createdAt?: { toDate(): Date } }>('repairRequests', () => { const c: QueryConstraint[] = []; if (st) c.push(where('status', '==', st)); c.push(orderBy('createdAt', 'desc'), limit(100)); return c }, [st])
  const [target, setTarget] = useState<{ id: string; to: string } | null>(null)
  return (
    <PermGate perm="jobs.manage"><div><PageHeader title="Repair Requests" action={<div className="w-48"><Select label="" aria-label="Status filter" value={st} onChange={e => setSt(e.target.value)}><option value="">All statuses</option>{['open', 'engineer_selected', 'appointment_scheduled', 'in_progress', 'completed', 'closed', 'cancelled', 'disputed'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</Select></div>} />
      {j.loading ? <ListSkeleton /> : j.data.length === 0 ? <EmptyState icon={Wrench} title="No requests" body="Nothing matches this filter." /> : <ul className="space-y-2">{j.data.map(x => <li key={x.id} className="flex items-center gap-3 surface p-5"><div className="min-w-0 flex-1"><p className="font-medium">{x.reference} · {x.device.manufacturer} {x.device.model}</p><p className="text-xs text-thor-text">{x.location.area} · {x.quoteCount} quotes · {day(x.createdAt)}</p></div><StatusPill status={x.status} />
        {x.status === 'disputed' && <Button size="sm" variant="soft" onClick={() => setTarget({ id: x.id, to: 'closed' })}>Resolve</Button>}{['open', 'engineer_selected', 'appointment_scheduled'].includes(x.status) && <Button size="sm" variant="ghost" className="text-bad" onClick={() => setTarget({ id: x.id, to: 'cancelled' })}>Cancel</Button>}</li>)}</ul>}
      {target && <NoteSheet open title={target.to === 'closed' ? 'Resolve dispute' : 'Cancel request'} action="Confirm" onClose={() => setTarget(null)} onSubmit={async note => { try { await api.changeJobStatus({ jobId: target.id, to: target.to, note }); toast('ok', 'Updated.') } catch (e) { toast('bad', errMsg(e)); throw e } }} />}</div></PermGate>)
}
export function AdminQuotations() {
  const q = useQuery<{ jobId: string; engineerId: string; totalPence: number; status: string; createdAt?: { toDate(): Date } }>('repairQuotes', () => [orderBy('createdAt', 'desc'), limit(100)], [])
  return <PermGate perm="jobs.manage"><div><PageHeader title="Quotations" />{q.loading ? <ListSkeleton /> : <Table head={['Job', 'Engineer', 'Total', 'Status', 'Sent']} rows={q.data.map(x => [x.jobId.slice(-8), x.engineerId.slice(0, 8), gbp(x.totalPence), <Badge key="s" tone={x.status === 'accepted' ? 'ok' : x.status === 'submitted' ? 'info' : 'neutral'}>{x.status}</Badge>, day(x.createdAt)])} />}</div></PermGate>
}
export function AdminAppointments() {
  const a = useQuery<{ reference: string; status: string; method: string; startAt: { toDate(): Date } }>('appointments', () => [orderBy('startAt', 'desc'), limit(100)], [])
  return <PermGate perm="jobs.manage"><div><PageHeader title="Appointments" />{a.loading ? <ListSkeleton /> : <Table head={['Reference', 'When', 'Method', 'Status']} rows={a.data.map(x => [x.reference, x.startAt.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), x.method, <Badge key="s" tone={x.status === 'confirmed' ? 'ok' : x.status === 'cancelled' ? 'bad' : 'warn'}>{x.status}</Badge>])} />}</div></PermGate>
}
function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return rows.length === 0 ? <EmptyState icon={ClipboardList} title="Nothing to show" body="No records yet." /> : <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[32rem] text-sm"><thead className="text-left text-thor-text"><tr>{head.map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-ink/8">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>)}</tbody></table></div>
}

// ---------- reviews & reports ----------
interface Rv { reference: string; direction: string; rating: number; text: string; status: string; subjectId: string; authorId: string; createdAt?: { toDate(): Date } }
export function AdminReviews() {
  const toast = useToast(); const [st, setSt] = useState('pending'); const r = useQuery<Rv>('reviews', () => [where('status', '==', st), orderBy('createdAt', 'desc'), limit(50)], [st]); const [t, setT] = useState<{ id: string; d: 'approve' | 'remove' | 'restore' } | null>(null)
  return (
    <PermGate perm="reviews.moderate"><div><PageHeader title="Reviews" sub="Feedback about customers is held for approval before it’s visible." action={<div className="w-40"><Select label="" aria-label="Status" value={st} onChange={e => setSt(e.target.value)}><option value="pending">Pending</option><option value="published">Published</option><option value="removed">Removed</option></Select></div>} />
      {r.loading ? <ListSkeleton /> : r.data.length === 0 ? <EmptyState icon={CheckCircle2} title="Queue clear" body="No reviews with this status." /> : <ul className="space-y-3">{r.data.map(x => <li key={x.id} className="surface p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><Stars value={x.rating} /><Badge tone="info">{x.direction === 'customer_to_engineer' ? 'Customer → engineer' : 'Engineer → customer'}</Badge></div><span className="text-xs text-thor-text">{x.reference}</span></div><p className="mt-2 text-sm">{x.text || <i className="text-thor-text">No comment</i>}</p>
        <div className="mt-3 flex gap-2">{x.status !== 'published' && <Button size="sm" onClick={() => setT({ id: x.id, d: x.status === 'removed' ? 'restore' : 'approve' })}>{x.status === 'removed' ? 'Restore' : 'Approve'}</Button>}{x.status !== 'removed' && <Button size="sm" variant="danger" onClick={() => setT({ id: x.id, d: 'remove' })}>Remove</Button>}</div></li>)}</ul>}
      {t && <NoteSheet open title={`${t.d} review`} action="Confirm" danger={t.d === 'remove'} onClose={() => setT(null)} onSubmit={async note => { try { await api.moderateReview({ reviewId: t.id, decision: t.d, note }); toast('ok', 'Your decision has been saved.') } catch (e) { toast('bad', errMsg(e)); throw e } }} />}</div></PermGate>)
}

interface Rp { targetType: string; targetId: string; conversationId?: string; reason: string; status: string; createdAt?: { toDate(): Date } }
export function AdminReports() {
  const toast = useToast(); const r = useQuery<Rp>('reports', () => [where('status', '==', 'open'), orderBy('createdAt', 'desc'), limit(50)], [])
  const [res, setRes] = useState<{ id: string; o: 'dismissed' | 'actioned' } | null>(null); const [aud, setAud] = useState<WithId<Rp> | null>(null); const [why, setWhy] = useState(''); const [msgs, setMsgs] = useState<any[] | null>(null)
  const open = async () => { try { setMsgs((await api.auditConversation({ conversationId: aud!.conversationId!, reportId: aud!.id, reason: why })).messages) } catch (e) { toast('bad', errMsg(e)) } }
  return (
    <PermGate perm="reviews.moderate"><div><PageHeader title="Reports" sub="User reports of messages, reviews and accounts." />
      {r.loading ? <ListSkeleton /> : r.data.length === 0 ? <EmptyState icon={Flag} title="No open reports" body="Great. Nothing needs attention." /> : <ul className="space-y-3">{r.data.map(x => <li key={x.id} className="surface p-5"><div className="flex items-center justify-between"><Badge tone="warn">{x.targetType}</Badge><span className="text-xs text-thor-text">{day(x.createdAt)}</span></div><p className="mt-2 text-sm">{x.reason}</p>
        <div className="mt-3 flex flex-wrap gap-2">{x.conversationId && <Button size="sm" variant="soft" onClick={() => { setAud(x); setWhy(''); setMsgs(null) }}>Review conversation</Button>}<Button size="sm" onClick={() => setRes({ id: x.id, o: 'actioned' })}>Action taken</Button><Button size="sm" variant="ghost" onClick={() => setRes({ id: x.id, o: 'dismissed' })}>Dismiss</Button></div></li>)}</ul>}
      {res && <NoteSheet open title="Record decision" action="Save" onClose={() => setRes(null)} onSubmit={async note => { try { await api.resolveReport({ reportId: res.id, outcome: res.o, note }); toast('ok', 'Your decision has been saved.') } catch (e) { toast('bad', errMsg(e)); throw e } }} />}
      <Sheet open={!!aud} onClose={() => setAud(null)} title="Conversation (audited)">{!msgs ? <><p className="mb-3 text-sm text-thor-text">Access is logged with your name and reason. Only open what the report requires.</p><Input label="Reason for access" value={why} onChange={e => setWhy(e.target.value)} /><Button className="mt-4 w-full" disabled={why.trim().length < 10} onClick={open}>Open conversation</Button></> :
        <ul className="space-y-2">{msgs.map(m => <li key={m.id} className="rounded-xl bg-paper p-3 text-sm"><p className="text-xs text-thor-text">{m.senderId.slice(0, 8)} · {m.createdAt && new Date(m.createdAt).toLocaleString('en-GB')}</p>{m.text}{m.imagePath && <i className="text-thor-text"> [image]</i>}</li>)}</ul>}</Sheet></div></PermGate>)
}
