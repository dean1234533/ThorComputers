import ExtraWorkForm from '@/components/ExtraWorkForm'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { AlertTriangle, Clock, MapPin, Search, ShieldAlert, Zap, MessageSquare } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { geocode, miles, LatLng } from '@/lib/geo'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Select, StatusPill, Textarea, usePaged, useToast, cx } from '@/components/ui'
import { StorageImg } from '@/components/StorageImg'
import { Quote } from '@/components/QuoteCompare'
import { DEVICE_TYPES, SERVICE_METHODS, gbp, JobStatus, ENGINEER_NEXT, JOB_STATUS_LABEL } from '@/types/domain'
import ReviewSheet from '@/components/ReviewSheet'

interface Job { reference: string; status: JobStatus; device: { type: string; manufacturer: string; model: string }; summary: string; description: string; issues: string[]; urgency: 'flexible' | 'soon' | 'urgent'; serviceMethods: string[]; location: { area: string; lat: number; lng: number }; photoPaths: string[]; quoteCount: number; createdAt?: { toDate(): Date }; selectedEngineerId?: string; acceptedQuoteId?: string; customerId: string; agreedTotalPence?: number; agreedMethod?: string }
const age = (d?: Date) => { if (!d) return ''; const h = (Date.now() - d.getTime()) / 3600_000; return h < 1 ? 'Just now' : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago` }
const devLabel = (t: string) => DEVICE_TYPES.find(d => d.id === t)?.label ?? t

export function ApprovalGate({ children }: { children: React.ReactNode }) {
  const { approved } = useAuth()
  return approved ? <>{children}</> : <EmptyState icon={ShieldAlert} title="Approval needed" body="You can browse and quote for jobs once an administrator has approved your application." action={<Link to="/engineer/profile"><Button>View my application</Button></Link>} />
}

function useMyGeo() {
  const { user } = useAuth(); const app = useDoc<{ profile?: { serviceArea?: { postcode: string; radiusMiles: number } } }>(`engineerApplications/${user!.uid}`)
  const [g, setG] = useState<LatLng | null>(null); const pc = app.data?.profile?.serviceArea?.postcode
  useEffect(() => { if (pc) geocode(pc).then(setG) }, [pc]); return { geo: g, radius: app.data?.profile?.serviceArea?.radiusMiles ?? 15 }
}

export function AvailableJobs() {
  const { specs } = useAuth(); const [n, setN] = useState(20); const { geo, radius } = useMyGeo()
  const [f, setF] = useState({ device: '', urgency: '', method: '', age: '', dist: '' })
  const jobs = useQuery<Job>(specs.length ? 'repairRequests' : null, () => [where('status', '==', 'open'), where('requiredSpecs', 'array-contains-any', specs.slice(0, 30)), orderBy('createdAt', 'desc'), limit(n)], [specs.join(','), n])
  const shown = useMemo(() => jobs.data.filter(j => (!f.device || j.device.type === f.device) && (!f.urgency || j.urgency === f.urgency) && (!f.method || j.serviceMethods.includes(f.method))
    && (!f.age || (j.createdAt && Date.now() - j.createdAt.toDate().getTime() < Number(f.age) * 86400_000)) && (!f.dist || !geo || miles(geo, j.location) <= Number(f.dist))), [jobs.data, f, geo])
  const paged = usePaged(shown, f)
  return (
    <ApprovalGate><div><PageHeader title="Available Jobs" sub="Open repairs that match your specialisations." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Select label="Device" value={f.device} onChange={e => setF({ ...f, device: e.target.value })}><option value="">All</option>{DEVICE_TYPES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</Select>
        <Select label="Urgency" value={f.urgency} onChange={e => setF({ ...f, urgency: e.target.value })}><option value="">Any</option><option value="urgent">Urgent</option><option value="soon">Soon</option><option value="flexible">Flexible</option></Select>
        <Select label="Service" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}><option value="">Any</option>{SERVICE_METHODS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</Select>
        <Select label="Posted" value={f.age} onChange={e => setF({ ...f, age: e.target.value })}><option value="">Any time</option><option value="1">Last 24h</option><option value="3">Last 3 days</option><option value="7">Last week</option></Select>
        <Select label="Distance" value={f.dist} onChange={e => setF({ ...f, dist: e.target.value })} disabled={!geo}><option value="">Any ({radius} mi area)</option>{[5, 10, 20, 50].map(d => <option key={d} value={d}>Within {d} mi</option>)}</Select></div>
      {jobs.loading ? <ListSkeleton /> : shown.length === 0 ? <EmptyState icon={Search} title="No matching jobs right now" body="New jobs appear here in real time, and we’ll notify you when one matches." /> :
        <><ul className="space-y-3">{paged.items.map(j => <li key={j.id}><Link to={`/engineer/jobs/${j.id}`} className="block surface p-5 transition hover:shadow-md">
          <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{devLabel(j.device.type)} · {j.device.manufacturer}</p><p className="mt-0.5 line-clamp-2 text-sm text-thor-slate">{j.summary}</p></div>{j.urgency === 'urgent' && <Badge tone="bad"><Zap className="size-3" />Urgent</Badge>}</div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-thor-text"><span className="flex items-center gap-1"><MapPin className="size-3.5" />{j.location.area}{geo && ` · ${miles(geo, j.location).toFixed(0)} mi`}</span><span className="flex items-center gap-1"><Clock className="size-3.5" />{age(j.createdAt?.toDate())}</span><span>{j.serviceMethods.map(m => SERVICE_METHODS.find(s => s.id === m)?.label).join(' / ')}</span><span className="ml-auto font-medium text-thor-blue">{j.quoteCount} quote{j.quoteCount === 1 ? '' : 's'}</span></div></Link></li>)}</ul>{paged.pager}</>}
      {jobs.data.length >= n && paged.last && <Button variant="soft" className="mx-auto mt-5 flex" onClick={() => setN(n + 20)}>Load more</Button>}</div></ApprovalGate>)
}

const poundsToPence = (v: string) => Math.round((parseFloat(v) || 0) * 100)
export function JobDetail() {
  const { id } = useParams(); const { user } = useAuth(); const toast = useToast(); const nav = useNavigate()
  const { data: job, loading, error } = useDoc<Job>(`repairRequests/${id}`)
  const mine = useDoc<Quote>(`repairQuotes/${id}_${user!.uid}`)
  const [f, setF] = useState({ repair: '', diag: '', callout: '', hours: '1', avail: '', parts: true, partsNote: '', warranty: '', notes: '', expiry: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10), method: '' }); const [busy, setBusy] = useState('')
  const q = mine.data
  useEffect(() => { if (q && q.status === 'submitted') setF(s => ({ ...s, repair: String(q.repairPence / 100), diag: String(q.diagnosticPence / 100 || ''), callout: String(q.calloutPence / 100 || ''), hours: String(q.durationHours), avail: q.availability, parts: q.partsIncluded, partsNote: q.partsNote ?? '', warranty: q.warranty ?? '', notes: q.notes ?? '', method: q.serviceMethod, expiry: q.expiresAt.toDate().toISOString().slice(0, 10) })) }, [q?.version, q?.status]) // eslint-disable-line
  useEffect(() => { if (job && !f.method) setF(s => ({ ...s, method: job.serviceMethods[0] })) }, [job]) // eslint-disable-line
  const total = poundsToPence(f.repair) + poundsToPence(f.diag) + poundsToPence(f.callout)

  if (loading || mine.loading) return <ListSkeleton rows={2} />
  if (!job || error) return <EmptyState icon={AlertTriangle} title="Job no longer available" body="It may have been awarded or cancelled." action={<Button onClick={() => nav('/engineer/jobs')}>Back to jobs</Button>} />
  const editable = job.status === 'open' && (!q || ['submitted', 'withdrawn'].includes(q.status))
  const submit = async () => {
    setBusy('send')
    try { await api.submitQuote({ jobId: job.id, repairPence: poundsToPence(f.repair), diagnosticPence: poundsToPence(f.diag), calloutPence: poundsToPence(f.callout), durationHours: Number(f.hours), availability: f.avail, partsIncluded: f.parts, partsNote: f.partsNote, warranty: f.warranty, notes: f.notes, expiresAt: new Date(f.expiry + 'T23:59:00').toISOString(), serviceMethod: f.method }); toast('ok', q ? 'Quotation updated.' : 'Quotation sent.') }
    catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') }
  }
  return (
    <ApprovalGate><div className="max-w-2xl">
      <div className="mb-1 flex items-center gap-3"><p className="text-sm text-thor-text">{job.reference}</p><StatusPill status={job.status} /></div>
      <h1 className="font-display text-3xl">{devLabel(job.device.type)} · {job.device.manufacturer} {job.device.model}</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-thor-text"><MapPin className="size-4" />{job.location.area} · posted {age(job.createdAt?.toDate())}</p>
      <Section title="The problem"><p className="whitespace-pre-line">{job.description}</p>{job.issues.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{job.issues.map(i => <Badge key={i} tone="info">{i}</Badge>)}</div>}
        {job.photoPaths?.length > 0 && (job.selectedEngineerId === user!.uid
          ? <div className="mt-4 flex flex-wrap gap-2">{job.photoPaths.map(p => <StorageImg key={p} path={p} className="size-24 rounded-xl object-cover" />)}</div>
          : <p className="mt-4 rounded-xl bg-paper p-3 text-sm text-thor-text">The customer has attached photos. They’ll be shared with the engineer they choose after accepting a quote.</p>)}
        <p className="mt-3 text-sm text-thor-text">Wanted: {job.serviceMethods.map(m => SERVICE_METHODS.find(s => s.id === m)?.label).join(', ')} · Urgency: {job.urgency}</p></Section>

      {q && !editable && <p className="rounded-xl bg-paper p-4 text-sm">Your quote of <b>{gbp(q.totalPence)}</b> is <b>{q.status}</b>.</p>}
      {editable && <Section title={q?.status === 'submitted' ? 'Your quotation' : 'Send a quotation'}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3"><Input label="Repair (£)" inputMode="decimal" value={f.repair} onChange={e => setF({ ...f, repair: e.target.value })} /><Input label="Diagnostic (£)" inputMode="decimal" value={f.diag} onChange={e => setF({ ...f, diag: e.target.value })} /><Input label="Call-out (£)" inputMode="decimal" value={f.callout} onChange={e => setF({ ...f, callout: e.target.value })} /></div>
          <p className={cx('rounded-xl px-4 py-3 text-sm', total > 0 ? 'bg-thor-sky/20 text-thor-blue-700' : 'bg-paper text-thor-text')}>The customer will pay <b className="text-lg">{gbp(total)}</b> in total.</p>
          <div className="grid grid-cols-2 gap-3"><Input label="Estimated hours" type="number" step="0.25" min="0.25" value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} /><Select label="Service method" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{job.serviceMethods.map(m => <option key={m} value={m}>{SERVICE_METHODS.find(s => s.id === m)?.label}</option>)}</Select></div>
          <Input label="Your availability" value={f.avail} onChange={e => setF({ ...f, avail: e.target.value })} />
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-thor-blue" checked={f.parts} onChange={e => setF({ ...f, parts: e.target.checked })} />Parts are included in this price</label>
          <Input label={f.parts ? 'Parts details (optional)' : 'What parts are excluded?'} value={f.partsNote} onChange={e => setF({ ...f, partsNote: e.target.value })} />
          <Input label="Warranty on your work" value={f.warranty} onChange={e => setF({ ...f, warranty: e.target.value })} />
          <Textarea label="Notes for the customer (optional)" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className="min-h-20" maxLength={800} />
          <Input label="Quote valid until" type="date" value={f.expiry} min={new Date().toISOString().slice(0, 10)} onChange={e => setF({ ...f, expiry: e.target.value })} />
          <div className="flex gap-3"><Button variant="cta" className="flex-1" size="lg" loading={busy === 'send'} disabled={total <= 0 || f.avail.trim().length < 3 || !f.method} onClick={submit}>{q?.status === 'submitted' ? 'Update quotation' : 'Send quotation'}</Button>
            {q?.status === 'submitted' && <Button variant="ghost" className="text-bad" loading={busy === 'w'} onClick={async () => { setBusy('w'); try { await api.withdrawQuote({ quoteId: q.id }); toast('info', 'Quotation withdrawn.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }}>Withdraw</Button>}</div>
        </div></Section>}
    </div></ApprovalGate>)
}

export function MyQuotations() {
  const { user } = useAuth()
  const q = useQuery<Quote>('repairQuotes', () => [where('engineerId', '==', user!.uid), orderBy('createdAt', 'desc'), limit(50)], [user!.uid])
  const tone = { submitted: 'info', accepted: 'ok', declined: 'bad', withdrawn: 'neutral', expired: 'neutral' } as const
  return (
    <div><PageHeader title="My Quotations" />
      {q.loading ? <ListSkeleton /> : q.data.length === 0 ? <EmptyState icon={Search} title="No quotations yet" body="Find a job that suits you and send your first quote." action={<Link to="/engineer/jobs"><Button>Browse jobs</Button></Link>} /> :
        <ul className="space-y-3">{q.data.map(x => <li key={x.id}><Link to={x.status === 'accepted' ? `/engineer/my-jobs/${x.jobId}` : `/engineer/jobs/${x.jobId}`} className="flex items-center gap-4 surface p-5"><div className="flex-1"><p className="font-display text-xl text-thor-blue">{gbp(x.totalPence)}</p><p className="text-sm text-thor-text">{x.durationHours}h · {x.availability}</p></div><Badge tone={tone[x.status as keyof typeof tone] ?? 'neutral'}>{x.status}</Badge></Link></li>)}</ul>}</div>)
}

export function MyJobs() {
  const { user } = useAuth()
  const j = useQuery<Job>('repairRequests', () => [where('selectedEngineerId', '==', user!.uid), orderBy('updatedAt', 'desc'), limit(50)], [user!.uid])
  return (
    <div><PageHeader title="My Jobs" />
      {j.loading ? <ListSkeleton /> : j.data.length === 0 ? <EmptyState icon={Search} title="No jobs yet" body="Jobs appear here when a customer accepts your quote." /> :
        <ul className="space-y-3">{j.data.map(x => <li key={x.id}><Link to={`/engineer/my-jobs/${x.id}`} className="flex items-center gap-4 surface p-5"><div className="min-w-0 flex-1"><p className="font-medium">{x.device.manufacturer} {x.device.model}</p><p className="truncate text-sm text-thor-text">{x.reference} · {x.location.area}</p></div><StatusPill status={x.status} /></Link></li>)}</ul>}</div>)
}

/** Contact details are released only after the customer accepts this engineer's quote. Tap to call or email; the in-app chat stays available. */
export function ContactCard({ c, who, messageTo }: { c?: { name: string; phone: string; email: string }; who: 'customer' | 'engineer'; messageTo?: string }) {
  if (!c || (!c.phone && !c.email)) return <p className="rounded-2xl bg-white p-4 text-sm text-thor-text shadow-sm ring-1 ring-ink/5">Contact details aren’t on this job yet. {messageTo ? 'You can still use the in-app chat.' : ''}</p>
  return <div className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-ink/5"><p className="font-medium">{c.name || (who === 'customer' ? 'Customer' : 'Engineer')}</p>
    {c.phone && <p><span className="text-thor-text">Phone: </span><a className="font-medium text-thor-blue underline" href={`tel:${c.phone.replace(/\s+/g, '')}`}>{c.phone}</a></p>}
    {c.email && <p><span className="text-thor-text">Email: </span><a className="font-medium text-thor-blue underline" href={`mailto:${c.email}`}>{c.email}</a></p>}
    <p className="text-xs text-thor-text">Shared only because this job was accepted. Please use them only for this repair.</p></div>
}

export function MyJobDetail() {
  const { id } = useParams(); const toast = useToast(); const { user } = useAuth()
  const { data: job, loading } = useDoc<Job>(`repairRequests/${id}`)
  const priv = useDoc<{ addressLine?: string; postcode: string; accessNotes?: string; serialNumber?: string; customerContact?: { name: string; phone: string; email: string } }>(job && job.status !== 'open' ? `repairRequests/${id}/private/details` : null)
  const [busy, setBusy] = useState(''); const [rev, setRev] = useState(false)
  const done = useDoc(job && ['completed', 'closed'].includes(job.status) ? `reviews/${id}_engineer_to_customer` : null)
  if (loading) return <ListSkeleton rows={2} />
  if (!job) return <EmptyState icon={AlertTriangle} title="Job not found" body="You may not have access to this job." />
  const next = ENGINEER_NEXT[job.status] ?? []
  const go = async (to: string) => { setBusy(to); try { await api.changeJobStatus({ jobId: job.id, to }) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  return (
    <div className="max-w-2xl"><div className="mb-1 flex items-center gap-3"><p className="text-sm text-thor-text">{job.reference}</p><StatusPill status={job.status} /></div>
      <h1 className="font-display text-3xl">{job.device.manufacturer} {job.device.model}</h1>
      <Section title="Update progress">{next.length ? <div className="flex flex-wrap gap-2">{next.map(s => <Button key={s} variant={s === 'completed' ? 'cta' : 'primary'} loading={busy === s} onClick={() => go(s)}>{s === 'completed' ? 'Mark repair completed' : JOB_STATUS_LABEL[s]}</Button>)}</div> : <p className="text-sm text-thor-text">{job.status === 'engineer_selected' ? 'Waiting for the customer to book an appointment.' : 'No further updates available.'}</p>}</Section>
      <Section title="Customer contact"><ContactCard c={priv.data?.customerContact} who="customer" messageTo={job.acceptedQuoteId ? `/messages/${job.acceptedQuoteId}` : undefined} /></Section>
      <Section title="Payment & extra work"><p className="mb-3 flex items-center gap-2 text-sm">Customer payment: {(job as { paymentStatus?: string }).paymentStatus === 'paid' ? <span className="rounded-full bg-ok/15 px-2.5 py-0.5 font-medium text-ok">Paid</span> : <span className="rounded-full bg-warn/15 px-2.5 py-0.5 font-medium text-warn">Not paid yet</span>}</p><ExtraWorkForm jobId={job.id} status={job.status} /></Section>
      <Section title="Job details"><p className="whitespace-pre-line">{job.description}</p>
        {job.selectedEngineerId === user!.uid && job.photoPaths?.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{job.photoPaths.map(path => <StorageImg key={path} path={path} className="size-24 rounded-xl object-cover" />)}</div>}
        <dl className="mt-4 space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-ink/5"><div className="flex justify-between"><dt className="text-thor-text">Agreed price</dt><dd className="font-bold">{gbp(job.agreedTotalPence ?? 0)}</dd></div>
          {priv.data?.addressLine && <div className="flex justify-between gap-4"><dt className="text-thor-text">Address</dt><dd className="text-right">{priv.data.addressLine}, {priv.data.postcode}</dd></div>}
          {priv.data?.accessNotes && <div className="flex justify-between gap-4"><dt className="text-thor-text">Access</dt><dd className="text-right">{priv.data.accessNotes}</dd></div>}
          {priv.data?.serialNumber && <div className="flex justify-between"><dt className="text-thor-text">Serial</dt><dd>{priv.data.serialNumber}</dd></div>}</dl>
        <p className="mt-2 text-xs text-thor-text">Customer details are for this job only. Please keep communication within Thor Computer.</p></Section>
      <div className="flex flex-wrap gap-3"><Link to={`/messages/${job.acceptedQuoteId}`}><Button variant="soft"><MessageSquare className="size-4" />Message customer</Button></Link>
        {['completed', 'closed'].includes(job.status) && !done.data && <Button variant="soft" onClick={() => setRev(true)}>Leave feedback</Button>}</div>
      <ReviewSheet open={rev} onClose={() => setRev(false)} jobId={job.id} direction="engineer_to_customer" /></div>)
}
