import { ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy, where, QueryConstraint } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { ExternalLink, FileText, ShieldCheck, Users, Wrench, ClipboardList, CalendarCheck, Flag, CheckCircle2, HardHat, Receipt } from 'lucide-react'
import { storage } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery, WithId } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, ListSkeleton, PageHeader, Section, Select, Sheet, Skeleton, Stars, StatusPill, Textarea, Input, useToast } from '@/components/ui'
import { gbp, JobStatus, SPECIALISATIONS, ENGINEER_STATUS_LABEL } from '@/types/domain'
import { BarChart, byDay, downloadCsv, ExportButton, poundsStr, RangePicker, Range, Stat } from '@/components/admin'

// ---------- shared helpers ----------
function PermGate({ perm, children }: { perm: string; children: ReactNode }) {
  if (perm === 'jobs.view') return <AnyGate perms={['jobs.view', 'jobs.manage']}>{children}</AnyGate>
  const { perms } = useAuth(); return perms.includes(perm as never) ? <>{children}</> : <EmptyState icon={ShieldCheck} title="No access" body="Your admin role doesn’t include this area. Ask a super admin." />
}
const day = (t?: { toDate(): Date }) => t?.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) ?? ''
function NoteSheet({ open, title, action, onClose, onSubmit, danger }: { open: boolean; title: string; action: string; onClose: () => void; onSubmit: (note: string) => Promise<void>; danger?: boolean }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false)
  return <Sheet open={open} onClose={onClose} title={title}><Textarea label="Note (recorded in the audit log)" value={note} onChange={e => setNote(e.target.value)} maxLength={500} /><Button variant={danger ? 'danger' : 'primary'} className="mt-4 w-full" loading={busy} disabled={note.trim().length < 5} onClick={async () => { setBusy(true); try { await onSubmit(note.trim()); setNote(''); onClose() } finally { setBusy(false) } }}>{action}</Button></Sheet>
}

function AnyGate({ perms: need, children }: { perms: string[]; children: ReactNode }) { const { perms } = useAuth(); return need.some(p => perms.includes(p as never)) ? <>{children}</> : <EmptyState icon={ShieldCheck} title="No access" body="Your admin role doesn’t include this area." /> }

// ---------- overview ----------
interface RecentActivity { id: string; action: string; target: string; createdAt: number | null }
export function AdminOverview() {
  const [range, setRange] = useState<Range>({ days: 30 })
  const [s, setS] = useState<any>(null); const [err, setErr] = useState('')
  const [activityAction, setActivityAction] = useState('')
  useEffect(() => { setS(null); api.adminStats({ days: range.days }).then(setS).catch(e => setErr(errMsg(e))) }, [range.days])
  if (err) return <EmptyState icon={ShieldCheck} title="Can’t load stats" body={err} />
  const recentActivity: RecentActivity[] = s?.recentActivity ?? []
  const activityActions = [...new Set(recentActivity.map(a => a.action))].sort()
  const filteredActivity = recentActivity.filter(a => !activityAction || a.action === activityAction)
  const t = s?.totals, f = s?.finance, m = s?.marketing
  const tiles: [string, number | undefined, typeof Users, string][] = [['Customers', t?.customers, Users, '/admin/customers'], ['Active engineers', t?.engineers, HardHat, '/admin/engineers'], ['Pending approvals', t?.pendingApprovals, ShieldCheck, '/admin/approvals'], ['Under review', t?.underReview, ShieldCheck, '/admin/approvals'],
    ['Available jobs', t?.openJobs, ClipboardList, '/admin/jobs'], ['Awaiting quotations', t?.awaitingQuotes, ClipboardList, '/admin/jobs'], ['Awaiting verification', t?.awaitingVerification, ClipboardList, '/admin/jobs'], ['Active bids', t?.activeQuotes, Receipt, '/admin/quotations'],
    ['Accepted quotations', t?.acceptedQuotes, Receipt, '/admin/quotations'], ['Scheduled appointments', t?.confirmed, CalendarCheck, '/admin/appointments'], ['Completed repairs', t?.completed, CheckCircle2, '/admin/jobs'], ['Cancelled repairs', t?.cancelled, Wrench, '/admin/jobs'],
    ['Disputed', t?.disputed, Flag, '/admin/disputes'], ['Open reports', t?.reports, Flag, '/admin/reports'], ['Open support tickets', t?.openTickets, Flag, '/admin/support'], ...(t?.overdueTasks !== undefined ? [['Overdue follow-ups', t.overdueTasks, Users, '/admin/contacts'] as [string, number, typeof Users, string]] : []), ['New requests', t?.newRequests, ClipboardList, '/admin/jobs']]
  const exportAll = () => downloadCsv(`thor-dashboard-${range.days}d.csv`, [{ periodDays: range.days, ...t, ...(f ?? {}), ...(m ?? {}) }])
  return (
    <div><PageHeader title="Overview" sub="How the marketplace is doing." action={<div className="flex items-end gap-2"><RangePicker value={range} onChange={setRange} /><ExportButton onClick={exportAll} disabled={!s} /></div>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{tiles.map(([l, v, I, to]) => <Link key={l} to={to} className="surface p-5 transition hover:shadow-md"><I className="mb-2 size-5 text-thor-blue" />{s ? <p className="font-display text-3xl">{v}</p> : <Skeleton className="h-9 w-14" />}<p className="text-sm text-thor-text">{l}</p></Link>)}</div>
      {f && <Section title="Money" action={<Link to="/admin/finance" className="text-sm text-thor-blue">Finance</Link>}><div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total transaction value" value={poundsStr(f.grossPence)} /><Stat label="Thor commission revenue" value={poundsStr(f.commissionPence)} tone="ok" /><Stat label="Engineer share (transferred)" value={poundsStr(f.engineerSharePence)} />
        <Stat label="Engineer payouts paid" value={poundsStr(f.payoutsPaidPence)} /><Stat label="Outstanding payments" value={poundsStr(f.outstandingPence)} tone={f.outstandingPence ? 'warn' : undefined} /><Stat label="Refunded" value={poundsStr(f.refundedPence)} /><Stat label="Open card disputes" value={f.openChargebacks} tone={f.openChargebacks ? 'bad' : undefined} />
      </div><p className="mt-2 text-xs text-thor-text">From confirmed Stripe events only. Commission revenue is not profit: advertising, Stripe fees, refunds, running costs and tax are not deducted here.</p></Section>}
      {m && <Section title="Advertising" action={<Link to="/admin/marketing" className="text-sm text-thor-blue">Marketing</Link>}><div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="New Facebook leads" value={m.facebookLeads} /><Stat label="New Instagram leads" value={m.instagramLeads} /><Stat label="Leads awaiting verification" value={m.leadsAwaiting} tone={m.leadsAwaiting ? 'warn' : undefined} /><Stat label="Advertising spend" value={poundsStr(m.spendPence)} />
        <Stat label="Cost per lead" value={poundsStr(m.costPerLeadPence)} /><Stat label="Advertising-generated jobs" value={m.adJobs} /><Stat label="Advertising-generated revenue" value={poundsStr(m.adRevenuePence)} hint="Gross repair value paid" /><Stat label="Commission from ads" value={poundsStr(m.adCommissionPence)} tone="ok" />
      </div></Section>}
      <Section title={`New requests, last ${range.days} days`}><div className="surface p-5">{!s ? <Skeleton className="h-40" /> : <BarChart data={byDay(s.requestsPerDay, range.days)} label="New repair requests per day" />}
        {s && <p className="mt-2 text-xs text-thor-text">By source: {Object.entries<number>(s.requestsBySource ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}</p>}</div></Section>
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
    <PermGate perm="engineers.review"><div><PageHeader title="Approvals" sub="Review engineer applications and qualifications." action={<div className="w-44"><Select label="" aria-label="Status" value={filter} onChange={e => setFilter(e.target.value)}>{['pending', 'under_review', 'info_requested', 'approved', 'rejected', 'suspended'].map(s => <option key={s} value={s}>{ENGINEER_STATUS_LABEL[s]}</option>)}</Select></div>} />
      {apps.loading ? <ListSkeleton /> : apps.data.length === 0 ? <EmptyState icon={ShieldCheck} title="Nothing here" body="No applications with this status." /> : <ul className="space-y-3">{apps.data.map(a => <li key={a.id}><button onClick={() => setOpen(a)} className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-ink/5 hover:shadow-md"><div className="min-w-0 flex-1"><p className="font-medium">{a.profile?.displayName}{a.profile?.businessName && ` · ${a.profile.businessName}`}</p><p className="text-sm text-thor-text">{a.profile?.yearsExperience} yrs · {a.profile?.specialisations?.length} specialisations · submitted {day(a.submittedAt)}</p></div><Badge tone="warn">{ENGINEER_STATUS_LABEL[a.status] ?? a.status}</Badge></button></li>)}</ul>}
      {open && <ReviewApplication app={open} onClose={() => setOpen(null)} />}</div></PermGate>)
}

function ReviewApplication({ app, onClose }: { app: WithId<App>; onClose: () => void }) {
  const toast = useToast(); const quals = useQuery<Qual>('engineerQualifications', () => [where('engineerId', '==', app.id)], [app.id])
  const [decision, setDecision] = useState<null | 'start_review' | 'approve' | 'reject' | 'request_info' | 'suspend' | 'reinstate'>(null); const [provider, setProvider] = useState<'independent' | 'thor'>('independent')
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
        <div className="grid gap-3 border-t border-ink/10 pt-5 sm:grid-cols-3">{app.status === 'pending' && <Button variant="soft" onClick={() => setDecision('start_review')}>Start review</Button>}{['pending', 'under_review'].includes(app.status) && <><Button onClick={() => setDecision('approve')}>Approve</Button><Button variant="soft" onClick={() => setDecision('request_info')}>Request info</Button><Button variant="danger" onClick={() => setDecision('reject')}>Reject</Button></>}{app.status === 'approved' && <Button variant="danger" onClick={() => setDecision('suspend')}>Suspend</Button>}{app.status === 'suspended' && <Button onClick={() => setDecision('reinstate')}>Reinstate</Button>}</div>
      </div>
      <NoteSheet open={!!decision} title={`${decision?.replace('_', ' ')} application`} action="Confirm" danger={decision === 'reject' || decision === 'suspend'} onClose={() => setDecision(null)} onSubmit={async note => { try { await api.reviewEngineerApplication({ engineerId: app.id, decision: decision!, note, provider: decision === 'approve' ? provider : undefined }); toast('ok', 'Your decision has been saved.'); onClose() } catch (e) { toast('bad', errMsg(e)); throw e } }} />
    </Sheet>)
}

// ---------- users ----------
interface U { fullName: string; email: string; status: string; role: string; createdAt?: { toDate(): Date }; phone?: string; postcode?: string; engineerStatus?: string; createdVia?: string }
function UserList({ role, title, perm }: { role: 'customer' | 'engineer'; title: string; perm: 'customers.manage' }) {
  const toast = useToast(); const [st, setSt] = useState('')
  const u = useQuery<U>('users', () => [where('role', '==', role), ...(st ? [where('status', '==', st)] : []), orderBy('createdAt', 'desc'), limit(100)], [role, st])
  const [q, setQ] = useState(''); const [found, setFound] = useState<WithId<U>[] | null>(null); const [open, setOpen] = useState<string | null>(null)
  const search = async () => { if (q.trim().length < 2) { setFound(null); return } try { const r = await api.adminSearchUsers({ q: q.trim(), role }); setFound(r.users.map(x => ({ ...x, createdAt: x.createdAt ? { toDate: () => new Date(x.createdAt!) } : undefined }) as WithId<U>)) } catch (e) { toast('bad', errMsg(e)) } }
  const rows = found ?? u.data
  return (
    <PermGate perm={perm}><div><PageHeader title={title} action={<div className="w-40"><Select label="" aria-label="Status" value={st} onChange={e => setSt(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deleted">Deleted</option></Select></div>} />
      <form onSubmit={e => { e.preventDefault(); search() }} className="mb-4 flex items-end gap-2"><div className="flex-1"><Input label="Search" placeholder="Name, email or user ID" value={q} onChange={e => { setQ(e.target.value); if (!e.target.value) setFound(null) }} /></div><Button type="submit" variant="soft">Search</Button></form>
      {u.loading && !found ? <ListSkeleton /> : rows.length === 0 ? <EmptyState icon={Users} title="No accounts found" body={found ? 'Try another search.' : 'They’ll appear here as people register.'} /> :
      <ul className="divide-y divide-ink/8 surface px-5">{rows.map(x => <li key={x.id}><button onClick={() => setOpen(x.id)} className="flex w-full items-center gap-3 py-3 text-left"><div className="min-w-0 flex-1"><p className="truncate font-medium">{x.fullName}</p><p className="truncate text-xs text-thor-text">{x.email} · joined {day(x.createdAt)}{x.createdVia === 'meta_lead' ? ' · from Meta lead' : ''}</p></div>{role === 'engineer' && x.engineerStatus && <Badge tone="info">{ENGINEER_STATUS_LABEL[x.engineerStatus] ?? x.engineerStatus}</Badge>}<Badge tone={x.status === 'active' ? 'ok' : 'bad'}>{x.status}</Badge></button></li>)}</ul>}
      {open && <UserDetail userId={open} role={role} onClose={() => setOpen(null)} />}</div></PermGate>)
}

/** Profile, history and audited actions. Passwords and card details are never available here (they are not stored by Thor Computer). */
function UserDetail({ userId, role, onClose }: { userId: string; role: 'customer' | 'engineer'; onClose: () => void }) {
  const toast = useToast(); const { perms } = useAuth(); const can = (p: string) => perms.includes(p as never)
  const u = useDoc<U>(`users/${userId}`)
  const field = role === 'engineer' ? 'selectedEngineerId' : 'customerId'
  const jobs = useQuery<{ reference: string; status: JobStatus; agreedTotalPence?: number; createdAt?: { toDate(): Date } }>(can('jobs.view') || can('jobs.manage') ? 'repairRequests' : null, () => [where(field, '==', userId), orderBy(role === 'engineer' ? 'updatedAt' : 'createdAt', 'desc'), limit(30)], [userId])
  const quotes = useQuery<{ totalPence: number; status: string; createdAt?: { toDate(): Date } }>(role === 'engineer' && (can('jobs.view') || can('jobs.manage')) ? 'repairQuotes' : null, () => [where('engineerId', '==', userId), orderBy('createdAt', 'desc'), limit(30)], [userId])
  const apts = useQuery<{ reference: string; status: string; startAt: { toDate(): Date } }>(can('jobs.view') || can('jobs.manage') ? 'appointments' : null, () => [where(role === 'engineer' ? 'engineerId' : 'customerId', '==', userId), orderBy('startAt', 'desc'), limit(20)], [userId])
  const pays = useQuery<{ reference: string; amountPence: number; status: string; kind: string }>(can('finance.view') || can('jobs.manage') ? 'payments' : null, () => [where(role === 'engineer' ? 'engineerId' : 'customerId', '==', userId), orderBy('createdAt', 'desc'), limit(30)], [userId])
  const reviews = useQuery<Rv>(can('reviews.moderate') ? 'reviews' : null, () => [where(role === 'engineer' ? 'subjectId' : 'authorId', '==', userId), orderBy('createdAt', 'desc'), limit(20)], [userId])
  const stripe = useDoc<{ transfersActive: boolean; payoutsEnabled: boolean }>(role === 'engineer' && (can('engineers.review') || can('finance.view')) ? `stripeConnectedAccounts/${userId}` : null)
  const prof = useDoc<{ specialisations: string[]; serviceRadiusMiles?: number; provider?: string; marketplaceRestricted?: boolean; ratingAvg: number; reviewCount: number; completedJobs: number }>(role === 'engineer' && can('engineers.review') ? `engineerProfiles/${userId}` : null)
  const [act, setAct] = useState<null | 'suspend' | 'delete' | 'engineer'>(null); const [specs, setSpecs] = useState<string[] | null>(null); const [radius, setRadius] = useState(''); const [restricted, setRestricted] = useState<boolean | null>(null)
  if (!u.data) return <Sheet open onClose={onClose} title="Account">{u.loading ? <ListSkeleton rows={2} /> : <p>Not found.</p>}</Sheet>
  const x = u.data
  return (
    <Sheet open onClose={onClose} title={x.fullName}>
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-2"><dt className="text-thor-text">Email</dt><dd className="break-all">{x.email}</dd><dt className="text-thor-text">Phone</dt><dd>{x.phone || '—'}</dd><dt className="text-thor-text">Postcode</dt><dd>{x.postcode || '—'}</dd><dt className="text-thor-text">Status</dt><dd><Badge tone={x.status === 'active' ? 'ok' : 'bad'}>{x.status}</Badge></dd><dt className="text-thor-text">Joined</dt><dd>{day(x.createdAt)}</dd><dt className="text-thor-text">User ID</dt><dd className="break-all text-xs">{userId}</dd></dl>
        {prof.data && <div className="rounded-xl bg-paper p-3"><p>Rating {prof.data.reviewCount ? prof.data.ratingAvg.toFixed(1) : 'none'} ({prof.data.reviewCount}) · {prof.data.completedJobs} completed · {prof.data.provider === 'thor' ? 'Thor engineer' : 'Independent'}{prof.data.marketplaceRestricted ? ' · RESTRICTED' : ''}</p>
          <p className="mt-1 text-xs text-thor-text">{prof.data.specialisations?.map(s2 => SPECIALISATIONS.find(z => z.id === s2)?.label ?? s2).join(', ')} · radius {prof.data.serviceRadiusMiles ?? '?'} mi</p>
          {stripe.data !== undefined && <p className="mt-1 text-xs">Payouts: {stripe.data ? (stripe.data.transfersActive ? 'Stripe ready' : 'Stripe setup incomplete') : 'not connected'}</p>}</div>}
        <HistoryList title="Repairs" rows={jobs.data.map(j => [j.reference, <StatusPill key="s" status={j.status} />, j.agreedTotalPence ? gbp(j.agreedTotalPence) : '', day(j.createdAt)])} />
        {role === 'engineer' && <HistoryList title="Quotations" rows={quotes.data.map(q2 => [gbp(q2.totalPence), q2.status, day(q2.createdAt)])} />}
        <HistoryList title="Bookings" rows={apts.data.map(a => [a.reference, a.status, a.startAt.toDate().toLocaleDateString('en-GB')])} />
        <HistoryList title="Payments" rows={pays.data.map(p2 => [p2.reference, p2.kind, gbp(p2.amountPence), p2.status])} />
        <HistoryList title={role === 'engineer' ? 'Reviews received' : 'Reviews written'} rows={reviews.data.map(r => [r.reference, `${r.rating}★`, r.status])} />
        <div className="flex flex-wrap gap-2 border-t border-ink/10 pt-4">
          {x.status !== 'deleted' && <Button size="sm" variant={x.status === 'suspended' ? 'primary' : 'danger'} onClick={() => setAct('suspend')}>{x.status === 'suspended' ? 'Reactivate' : 'Suspend'}</Button>}
          {role === 'engineer' && can('engineers.review') && prof.data && <Button size="sm" variant="soft" onClick={() => { setSpecs(prof.data!.specialisations); setRadius(String(prof.data!.serviceRadiusMiles ?? '')); setRestricted(!!prof.data!.marketplaceRestricted); setAct('engineer') }}>Marketplace access</Button>}
          {x.status !== 'deleted' && <Button size="sm" variant="ghost" className="text-bad" onClick={() => setAct('delete')}>Delete account</Button>}
        </div>
        {act === 'engineer' && specs && <div className="space-y-3 rounded-xl bg-paper p-3"><p className="font-medium">Approved categories and coverage</p>
          <div className="flex flex-wrap gap-2">{SPECIALISATIONS.map(c => <label key={c.id} className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs ring-1 ring-ink/10"><input type="checkbox" className="accent-thor-blue" checked={specs.includes(c.id)} onChange={e => setSpecs(e.target.checked ? [...specs, c.id] : specs.filter(z => z !== c.id))} />{c.label}</label>)}</div>
          <Input label="Service radius (miles)" type="number" value={radius} onChange={e => setRadius(e.target.value)} /><label className="flex items-center gap-2"><input type="checkbox" className="accent-thor-blue" checked={!!restricted} onChange={e => setRestricted(e.target.checked)} />Restrict marketplace access (cannot see or quote for jobs)</label></div>}
      </div>
      <NoteSheet open={act === 'suspend'} title={`${x.status === 'suspended' ? 'Reactivate' : 'Suspend'} ${x.fullName}`} action="Confirm" danger={x.status !== 'suspended'} onClose={() => setAct(null)} onSubmit={async note => { try { await api.setAccountSuspended({ userId, suspended: x.status !== 'suspended', reason: note }); toast('ok', 'Done.') } catch (e) { toast('bad', errMsg(e)); throw e } }} />
      <NoteSheet open={act === 'delete'} title={`Delete ${x.fullName}? This erases their personal data and cannot be undone.`} action="Delete permanently" danger onClose={() => setAct(null)} onSubmit={async note => { try { await api.adminDeleteAccount({ userId, confirm: 'DELETE', reason: note }); toast('ok', 'Account deleted.'); onClose() } catch (e) { toast('bad', errMsg(e)); throw e } }} />
      <NoteSheet open={act === 'engineer'} title="Save marketplace access" action="Save" onClose={() => setAct(null)} onSubmit={async note => { try { await api.adminUpdateEngineer({ engineerId: userId, specialisations: specs ?? undefined, serviceRadiusMiles: Number(radius) || undefined, marketplaceRestricted: restricted ?? undefined, note }); toast('ok', 'Engineer updated.') } catch (e) { toast('bad', errMsg(e)); throw e } }} />
    </Sheet>)
}
function HistoryList({ title, rows }: { title: string; rows: ReactNode[][] }) {
  return <div><p className="mb-1 font-medium">{title} <span className="text-xs text-thor-text">({rows.length})</span></p>{rows.length === 0 ? <p className="text-xs text-thor-text">None.</p> : <ul className="max-h-40 divide-y divide-ink/8 overflow-y-auto rounded-xl bg-paper px-3 text-xs">{rows.map((r, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5">{r.map((c, j) => <span key={j}>{c}</span>)}</li>)}</ul>}</div>
}
export const AdminCustomers = () => <UserList role="customer" title="Customers" perm="customers.manage" />
export const AdminEngineers = () => <UserList role="engineer" title="Engineers" perm="customers.manage" />

// ---------- jobs, quotes, appointments ----------
export function AdminJobs() {
  const toast = useToast(); const [st, setSt] = useState('')
  const j = useQuery<{ reference: string; status: JobStatus; device: { manufacturer: string; model: string }; location: { area: string }; quoteCount: number; source?: string; createdAt?: { toDate(): Date } }>('repairRequests', () => { const c: QueryConstraint[] = []; if (st) c.push(where('status', '==', st)); c.push(orderBy('createdAt', 'desc'), limit(100)); return c }, [st])
  const [target, setTarget] = useState<{ id: string; to: string } | null>(null)
  return (
    <PermGate perm="jobs.view"><div><PageHeader title="Repair Requests" action={<div className="w-48"><Select label="" aria-label="Status filter" value={st} onChange={e => setSt(e.target.value)}><option value="">All statuses</option>{['awaiting_verification', 'open', 'engineer_selected', 'awaiting_payment', 'appointment_scheduled', 'in_progress', 'completed', 'closed', 'cancelled', 'disputed'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</Select></div>} />
      {j.loading ? <ListSkeleton /> : j.data.length === 0 ? <EmptyState icon={Wrench} title="No requests" body="Nothing matches this filter." /> : <ul className="space-y-2">{j.data.map(x => <li key={x.id} className="flex items-center gap-3 surface p-5"><div className="min-w-0 flex-1"><p className="font-medium">{x.reference} · {x.device.manufacturer} {x.device.model}</p><p className="text-xs text-thor-text">{x.location.area} · {x.quoteCount} quotes · {day(x.createdAt)}</p></div><StatusPill status={x.status} quoteCount={x.quoteCount} />{x.source && x.source !== 'app' && <Badge tone="info">{x.source}</Badge>}
        {x.status === 'awaiting_verification' && <Button size="sm" onClick={() => setTarget({ id: x.id, to: 'publish' })}>Publish</Button>}
        {x.status === 'disputed' && <Button size="sm" variant="soft" onClick={() => setTarget({ id: x.id, to: 'closed' })}>Resolve</Button>}{['awaiting_verification', 'open', 'engineer_selected', 'awaiting_payment', 'appointment_scheduled'].includes(x.status) && <Button size="sm" variant="ghost" className="text-bad" onClick={() => setTarget({ id: x.id, to: 'cancelled' })}>Cancel</Button>}</li>)}</ul>}
      {target && <NoteSheet open title={target.to === 'closed' ? 'Resolve dispute' : target.to === 'publish' ? 'Publish to engineers' : 'Cancel request'} action="Confirm" onClose={() => setTarget(null)} onSubmit={async note => { try { if (target.to === 'publish') { const r = await api.publishJob({ jobId: target.id, note }); toast('ok', `Published. ${r.notified} engineer(s) notified.`) } else { await api.changeJobStatus({ jobId: target.id, to: target.to, note }); toast('ok', 'Updated.') } } catch (e) { toast('bad', errMsg(e)); throw e } }} />}</div></PermGate>)
}
export function AdminQuotations() {
  const q = useQuery<{ jobId: string; engineerId: string; totalPence: number; status: string; createdAt?: { toDate(): Date } }>('repairQuotes', () => [orderBy('createdAt', 'desc'), limit(100)], [])
  return <PermGate perm="jobs.view"><div><PageHeader title="Quotations" />{q.loading ? <ListSkeleton /> : <Table head={['Job', 'Engineer', 'Total', 'Status', 'Sent']} rows={q.data.map(x => [x.jobId.slice(-8), x.engineerId.slice(0, 8), gbp(x.totalPence), <Badge key="s" tone={x.status === 'accepted' ? 'ok' : x.status === 'submitted' ? 'info' : 'neutral'}>{x.status}</Badge>, day(x.createdAt)])} />}</div></PermGate>
}
export function AdminAppointments() {
  const a = useQuery<{ reference: string; status: string; method: string; startAt: { toDate(): Date } }>('appointments', () => [orderBy('startAt', 'desc'), limit(100)], [])
  return <PermGate perm="jobs.view"><div><PageHeader title="Appointments" />{a.loading ? <ListSkeleton /> : <Table head={['Reference', 'When', 'Method', 'Status']} rows={a.data.map(x => [x.reference, x.startAt.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), x.method, <Badge key="s" tone={x.status === 'confirmed' ? 'ok' : x.status === 'cancelled' ? 'bad' : 'warn'}>{x.status}</Badge>])} />}</div></PermGate>
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
