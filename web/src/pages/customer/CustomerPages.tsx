import { Link } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { Plus, Wrench, FileText, ChevronRight, Sparkles } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@/hooks/useFirestore'
import { useEngineers } from '@/hooks/useEngineers'
import { Avatar, Button, EmptyState, ListSkeleton, PageHeader, StatusPill } from '@/components/ui'
import { engName, Quote } from '@/components/QuoteCompare'
import type { Job } from './RepairDetail'
import { gbp } from '@/types/domain'

const useMyJobs = (n = 50) => { const { user } = useAuth(); return useQuery<Job>('repairRequests', () => [where('customerId', '==', user!.uid), orderBy('createdAt', 'desc'), limit(n)], [user?.uid, n]) }

function JobRow({ j }: { j: Job & { id: string } }) {
  return (
    <li><Link to={`/customer/repairs/${j.id}`} className="group flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-ink/5 transition hover:shadow-md">
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-thor-blue/10 text-thor-blue"><Wrench className="size-6" /></span>
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{j.device.manufacturer} {j.device.model}</p><p className="truncate text-sm text-thor-text">{j.reference} · {j.description}</p></div>
      <div className="flex flex-col items-end gap-1"><StatusPill status={j.status} />{j.status === 'open' && j.quoteCount > 0 && <span className="text-xs font-bold text-thor-orange-600">{j.quoteCount} quote{j.quoteCount > 1 ? 's' : ''}</span>}</div>
      <ChevronRight className="size-5 text-thor-text transition group-hover:translate-x-0.5" /></Link></li>)
}

export function CustomerHome() {
  const { profile } = useAuth(); const jobs = useMyJobs(10)
  const active = jobs.data.filter(j => !['closed', 'cancelled'].includes(j.status))
  return (
    <div>
      <PageHeader title={`Hello, ${profile?.fullName.split(' ')[0] ?? ''}`} sub="Here’s what’s happening with your repairs." />
      <Link to="/customer/new-request" className="mb-8 flex items-center gap-4 rounded-3xl bg-thor-blue p-5 text-white shadow-lg transition hover:bg-thor-blue-700">
        <span className="grid size-14 place-items-center rounded-2xl bg-thor-orange text-ink"><Plus className="size-7" /></span>
        <div className="flex-1"><p className="font-display text-xl">Get a repair quote</p><p className="text-sm text-white/80">Describe the problem and compare quotes from qualified engineers.</p></div><ChevronRight className="size-6" /></Link>
      <h2 className="mb-3 font-display text-xl">Active repairs</h2>
      {jobs.loading ? <ListSkeleton /> : active.length === 0 ? <EmptyState icon={Sparkles} title="Nothing in progress" body="When you post a repair request it will appear here so you can follow it step by step." /> : <ul className="space-y-3">{active.map(j => <JobRow key={j.id} j={j} />)}</ul>}
    </div>
  )
}

export function MyRepairs() {
  const jobs = useMyJobs()
  return (
    <div><PageHeader title="My Repairs" action={<Link to="/customer/new-request"><Button size="sm"><Plus className="size-4" />New</Button></Link>} />
      {jobs.loading ? <ListSkeleton /> : jobs.data.length === 0 ? <EmptyState icon={Wrench} title="No repairs yet" body="Submit your first request and engineers near you will send quotes." action={<Link to="/customer/new-request"><Button>Start a request</Button></Link>} /> : <ul className="space-y-3">{jobs.data.map(j => <JobRow key={j.id} j={j} />)}</ul>}</div>)
}

export function CustomerQuotations() {
  const { user } = useAuth()
  const q = useQuery<Quote>('repairQuotes', () => [where('customerId', '==', user!.uid), where('status', '==', 'submitted'), orderBy('createdAt', 'desc'), limit(50)], [user?.uid])
  const eng = useEngineers(q.data.map(x => x.engineerId))
  return (
    <div><PageHeader title="Quotations" sub="Open quotes waiting for your decision." />
      {q.loading ? <ListSkeleton /> : q.data.length === 0 ? <EmptyState icon={FileText} title="No open quotations" body="Quotes from engineers will appear here." /> :
        <ul className="space-y-3">{q.data.map(x => <li key={x.id}><Link to={`/customer/repairs/${x.jobId}`} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-ink/5"><Avatar src={eng[x.engineerId]?.photoURL} name={engName(eng[x.engineerId])} /><div className="flex-1"><p className="font-medium">{engName(eng[x.engineerId])}</p><p className="text-sm text-thor-text">About {x.durationHours}h</p></div><p className="font-display text-xl text-thor-blue">{gbp(x.totalPence)}</p></Link></li>)}</ul>}</div>)
}
