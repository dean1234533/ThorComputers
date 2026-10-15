import { ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy, where, QueryConstraint } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { ExternalLink, FileText, ShieldCheck, Users, Wrench, ClipboardList, CalendarCheck, Flag, CheckCircle2, HardHat, Receipt } from 'lucide-react'
import { storage } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { useQuery, WithId } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, ListSkeleton, PageHeader, Section, Select, Sheet, Skeleton, Stars, StatusPill, Textarea, Input, useToast } from '@/components/ui'
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

// ---------- overview ----------
interface RecentActivity { id: string; action: string; target: string; createdAt: number | null }
export function AdminOverview() {
  const [s, setS] = useState<any>(null); const [err, setErr] = useState('')
  const [activityAction, setActivityAction] = useState('')
  const { can } = useAuth(); const canJobs = can('jobs.manage')
  // Live: new repair requests appear here the moment a customer, the WordPress form or a Facebook/Instagram lead creates one.
  const incoming = useQuery<{ reference: string; status: JobStatus; device: { manufacturer: string; model: string; type: string }; location: { area: string }; urgency: string; source?: string; quoteCount: number; createdAt?: { toDate(): Date } }>(canJobs ? 'repairRequests' : null, () => [orderBy('createdAt', 'desc'), limit(12)], [canJobs])
  useEffect(() => { api.adminStats({}).then(setS).catch(e => setErr(errMsg(e))) }, [])
  if (err) return <EmptyState icon={ShieldCheck} title="Can’t load stats" body={err} />
  const recentActivity: RecentActivity[] = s?.recentActivity ?? []
  const activityActions = [...new Set(recentActivity.map(a => a.action))].sort()
  const filteredActivity = recentActivity.filter(a => !activityAction || a.action === activityAction)
  const t = s?.totals; const days = s ? Object.entries<number>(s.requestsPerDay).sort() : []; const max = Math.max(1, ...days.map(d => d[1]))
  const tiles: [string, number | undefined, typeof Users, string][] = [['Customers', t?.customers, Users, '/admin/customers'], ['Engineers', t?.engineers, HardHat, '/admin/engineers'], ['Pending approvals', t?.pendingApprovals, ShieldCheck, '/admin/approvals'], ['Open requests', t?.openJobs, ClipboardList, '/admin/jobs'], ['Active quotations', t?.activeQuotes, Receipt, '/admin/quotations'], ['Confirmed bookings', t?.confirmed, CalendarCheck, '/admin/appointments'], ['Completed jobs', t?.completed, CheckCircle2, '/admin/jobs'], ['Open reports', t?.reports, Flag, '/admin/reports']]
  return (
    <div><PageHeader title="Overview" sub="How the marketplace is doing right now." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{tiles.map(([l, v, I, to]) => <Link key={l} to={to} className="surface p-5 transition hover:shadow-md"><I className="mb-2 size-5 text-thor-blue" />{s ? <p className="font-display text-3xl">{v}</p> : <Skeleton className="h-9 w-14" />}<p className="text-sm text-thor-text">{l}</p></Link>)}</div>
      {canJobs && <Section title="New repair requests" action={<Link to="/admin/jobs" className="text-sm text-thor-blue">All requests</Link>}>
        {incoming.loading ? <ListSkeleton rows={2} /> : incoming.data.length === 0 ? <p className="surface p-5 text-sm text-thor-text">No repair requests yet. New ones appear here instantly.</p> :
          <ul className="divide-y divide-ink/8 surface px-5" aria-live="polite">{incoming.data.map(j => { const t = j.createdAt?.toDate(); const mins = t ? Math.max(0, Math.round((Date.now() - t.getTime()) / 60000)) : null
            return <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="font-medium">{j.reference} · {j.device.manufacturer} {j.device.model}</p>
              <p className="text-xs text-thor-text">{j.location?.area} · {mins === null ? 'just now' : mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : t!.toLocaleDateString('en-GB')} · {j.quoteCount ?? 0} quote(s)</p></div>
              <div className="flex flex-wrap items-center gap-2">{j.urgency === 'urgent' && <Badge tone="bad">Urgent</Badge>}{j.source && j.source !== 'app' && <Badge tone="brand">{j.source === 'meta' ? 'Facebook/Instagram' : 'Website'}</Badge>}<StatusPill status={j.status} /></div></li> })}</ul>}</Section>}
      {s?.marketing && <Section title="Advertising"><div className="grid grid-cols-2 gap-3 md:grid-cols-3">{([['Facebook leads', s.marketing.facebookLeads], ['Instagram leads', s.marketing.instagramLeads], ['Leads awaiting verification', s.marketing.leadsAwaitingVerification], ['Advertising spend', gbp(s.marketing.advertisingSpendPence)], ['Cost per lead', s.marketing.costPerLeadPence ? gbp(s.marketing.costPerLeadPence) : '—'], ['Advertising-generated jobs', s.marketing.advertisingJobs]] as [string, string | number][]).map(([l, v]) => <Link key={l} to="/admin/leads" className="surface p-4"><p className="text-xs text-thor-text">{l}</p><p className="font-display text-2xl">{v}</p></Link>)}</div></Section>}
      {s?.finance && <Section title="Money"><div className="grid grid-cols-2 gap-3 md:grid-cols-3">{([['Transaction value', gbp(s.finance.transactionValuePence)], ['Thor commission', gbp(s.finance.commissionPence)], ['Engineer payouts', gbp(s.finance.engineerPayoutPence)], ['Outstanding payments', s.finance.outstandingPayments], ['Disputed transactions', s.finance.disputedTransactions], ['Advertising-generated revenue', gbp(s.finance.advertisingRevenuePence)]] as [string, string | number][]).map(([l, v]) => <Link key={l} to="/admin/finance" className="surface p-4"><p className="text-xs text-thor-text">{l}</p><p className="font-display text-2xl">{v}</p></Link>)}</div></Section>}
      {t && <p className="mt-4 text-sm text-thor-text">Also: {t.activeEngineers} active engineers · {t.awaitingBids} jobs awaiting quotations · {t.scheduled} scheduled appointments · {t.cancelled} cancelled repairs.</p>}
      <Section title="New requests, last 14 days"><div className="surface p-5">{!s ? <Skeleton className="h-40" /> : days.length === 0 ? <p className="py-8 text-center text-thor-text">No requests in this period.</p> :
        <><svg viewBox={`0 0 ${days.length * 28} 120`} className="h-40 w-full" role="img" aria-label="Bar chart of new repair requests per day">{days.map(([d, n], i) => <g key={d}><rect x={i * 28 + 4} y={100 - (n / max) * 90} width="20" height={(n / max) * 90} rx="4" fill="#225AA5" /><text x={i * 28 + 14} y={96 - (n / max) * 90} textAnchor="middle" fontSize="9" fill="#12233D">{n}</text><text x={i * 28 + 14} y="114" textAnchor="middle" fontSize="8" fill="#7A7A7A">{d.slice(8)}</text></g>)}</svg>
          <table className="sr-only"><caption>Requests per day</caption><tbody>{days.map(([d, n]) => <tr key={d}><th>{d}</th><td>{n}</td></tr>)}</tbody></table></>}</div></Section>
      <Section title="Recent activity">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="w-full sm:w-56"><Select label="Filter by action" value={activityAction} onChange={e => setActivityAction(e.target.value)} disabled={!s || recentActivity.length === 0}>
            <option value="">All actions</option>{activityActions.map(action => <option key={action} value={action}>{action}</option>)}
          </Select></div>
          {s && <p className="text-xs text-thor-text" role="status">Showing {filteredActivity.length} of {recentActivity.length} latest entries</p>}
        </div>
        {!s ? <ListSkeleton rows={2} /> : <ul className="divide-y divide-ink/8 surface px-5">
          {filteredActivity.length === 0 && <li className="py-4 text-sm text-thor-text">{recentActivity.length === 0 ? 'Nothing yet.' : 'No recent activity matches this filter.'}</li>}
          {filteredActivity.map(a => <li key={a.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span className="min-w-0 break-words"><b>{a.action}</b> <span className="text-thor-text">{a.target}</span></span><span className="text-xs text-thor-text">{a.createdAt === null ? 'Date unavailable' : new Date(a.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span></li>)}
        </ul>}
      </Section></div>)
}

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
