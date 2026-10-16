import { Link } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { Plus, Wrench, FileText, ChevronRight, ArrowUpRight, ArrowRight, ShieldCheck, Clock3, CheckCircle2, CalendarDays } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@/hooks/useFirestore'
import { useEngineers } from '@/hooks/useEngineers'
import { Avatar, Button, EmptyState, ListSkeleton, PageHeader, StatusPill, Spinner } from '@/components/ui'
import { engName, Quote } from '@/components/QuoteCompare'
import type { Job } from './RepairDetail'
import { gbp } from '@/types/domain'
import DeviceCareVisual from '@/components/DeviceCareVisual'

const useMyJobs = (n = 50) => { const { user } = useAuth(); return useQuery<Job>('repairRequests', () => [where('customerId', '==', user!.uid), orderBy('createdAt', 'desc'), limit(n)], [user?.uid, n]) }

function JobRow({ j }: { j: Job & { id: string } }) {
  return (
    <li><Link to={`/customer/repairs/${j.id}`} className="surface repair-row group flex items-center gap-3 p-4 transition hover:border-thor-blue/25 hover:shadow-md sm:gap-4 sm:p-5">
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-paper text-thor-blue"><Wrench className="size-6" /></span>
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{j.device.manufacturer} {j.device.model}</p><p className="truncate text-sm text-thor-text">{j.reference} · {j.description}</p></div>
      <div className="flex flex-col items-end gap-1"><StatusPill status={j.status} />{j.status === 'open' && j.quoteCount > 0 && <span className="text-xs font-bold text-thor-sky-600">{j.quoteCount} quote{j.quoteCount > 1 ? 's' : ''}</span>}</div>
      <ChevronRight className="size-5 text-thor-text transition group-hover:translate-x-0.5" /></Link></li>)
}

export function CustomerHome() {
  const { profile } = useAuth(); const jobs = useMyJobs()
  const active = jobs.data.filter(j => !['closed', 'cancelled', 'completed'].includes(j.status))
  const quotes = jobs.data.filter(j => j.status === 'open').reduce((sum, j) => sum + (j.quoteCount ?? 0), 0)
  const completed = jobs.data.filter(j => ['completed', 'closed'].includes(j.status)).length
  const stats = [
    { label: 'Active repairs', value: active.length, icon: Wrench, to: '/customer/repairs', hint: 'Currently in progress' },
    { label: 'Quotes to compare', value: quotes, icon: FileText, to: '/customer/quotations', hint: 'On your open requests' },
    { label: 'Completed repairs', value: completed, icon: CheckCircle2, to: '/customer/repairs', hint: 'Devices back in action' },
  ]
  return (
    <div>
      <div className="workspace-eyebrow mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.18em] text-thor-blue"><span className="size-1.5 rounded-full bg-thor-blue" />Your personal repair hub</div>
      <PageHeader title={`Hello, ${profile?.fullName.split(' ')[0] ?? 'there'}`} sub="A little care goes a long way. Let’s keep your tech running." />
      <section className="repair-hero mb-7 rounded-3xl px-6 py-7 text-white sm:px-8 sm:py-9">
        <div className="hero-orbits" aria-hidden="true" />
        <div className="repair-hero-layout relative">
          <div className="repair-hero-copy min-w-0"><p className="hero-kicker mb-4 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.18em] text-thor-sky"><ShieldCheck className="size-3.5" />Local expertise. Personal service.</p><h2 className="font-display text-[30px] font-semibold leading-[1.12] sm:text-[40px]">Your tech deserves<br /><span className="hero-highlight">a second life.</span></h2><p className="mt-4 max-w-sm text-sm leading-6 text-white/75">From the first quote to the final fix. Find your engineer and get back to what matters.</p><div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-4"><Link to="/customer/new-request" className="hero-cta inline-flex h-12 items-center gap-4 rounded-xl bg-thor-orange px-5 text-sm font-semibold text-ink transition">Get a repair quote <ArrowRight className="size-4" /></Link><Link to="/customer/repairs" className="hero-secondary inline-flex items-center gap-2 text-xs font-medium text-white/80">My repairs <ArrowUpRight className="size-3.5" /></Link></div></div>
          <DeviceCareVisual />
        </div>
        <div className="hero-service-strip mt-7 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/15 pt-4 text-[11px] text-white/75"><span><CheckCircle2 className="size-3.5" />Clear quotes</span><span><ShieldCheck className="size-3.5" />Qualified engineers</span><span><CalendarDays className="size-3.5" />Flexible bookings</span></div>
      </section>
      <div className="mb-8 grid grid-cols-3 gap-2 sm:gap-3">{stats.map(({ label, value, icon: Icon, to, hint }) => <Link key={label} to={to} className="surface stat-card min-w-0 p-3 sm:p-5"><div className="mb-3 flex items-center justify-between sm:mb-4"><span className="grid size-9 place-items-center rounded-xl bg-paper"><Icon className="size-[18px] text-thor-blue" strokeWidth={1.7} /></span><ArrowUpRight className="hidden size-4 text-thor-text/50 sm:block" /></div><div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3"><p className="font-display text-3xl font-semibold">{jobs.loading ? <Spinner /> : value}</p><p className="text-[10px] font-medium leading-4 text-ink sm:text-xs">{label}</p></div><p className="mt-2 hidden text-[11px] text-thor-text sm:block">{hint}</p></Link>)}</div>
      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section><div className="mb-3 flex items-center justify-between sm:mb-4"><h2 className="font-display text-lg font-bold">Active repairs <span className="ml-1.5 rounded-md bg-ink/5 px-2 py-1 align-middle font-sans text-[10px] font-medium text-thor-text">{jobs.loading ? 'Loading' : active.length}</span></h2><Link to="/customer/repairs" className="flex items-center gap-1 text-xs font-medium text-thor-blue">View all <ArrowUpRight className="size-3.5" /></Link></div>
          {jobs.loading ? <ListSkeleton /> : active.length === 0 ? <EmptyState icon={Wrench} title="All clear for now" body="Your next repair starts here. Submit a request and follow every step in one place." action={<Link to="/customer/new-request" className="inline-flex items-center gap-2 text-sm font-semibold text-thor-blue">Start a repair <Plus className="size-4" /></Link>} /> : <ul className="space-y-3">{active.map(j => <JobRow key={j.id} j={j} />)}</ul>}
        </section>
        <aside className="surface care-guide p-5"><span className="mb-4 inline-flex items-center gap-2 rounded-full bg-thor-blue/8 px-2.5 py-1 text-[10px] font-medium text-thor-blue"><ShieldCheck className="size-3" />With you at every step</span><h2 className="font-display text-lg font-bold">Good care, made simple.</h2><div className="mt-5 space-y-5">{[[FileText, 'Compare with confidence', 'Clear quotes before you commit.'], [CalendarDays, 'On your schedule', 'Choose a time that works for you.'], [Clock3, 'Stay in the loop', 'Messages and updates in one place.']].map(([I, title, body]) => { const Icon = I as typeof FileText; return <div key={title as string} className="flex items-start gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-thor-blue" strokeWidth={1.7} /><div><p className="text-xs font-semibold">{title as string}</p><p className="mt-1 text-[11px] leading-5 text-thor-text">{body as string}</p></div></div> })}</div><Link to="/customer/appointments" className="mt-5 flex items-center justify-between border-t border-ink/8 pt-4 text-xs font-medium text-thor-blue">Your appointments <ArrowRight className="size-3.5" /></Link></aside>
      </div>
      {jobs.data.length === 50 && <p className="mt-4 text-xs text-thor-text">Overview based on your 50 most recent requests.</p>}
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
        <ul className="space-y-3">{q.data.map(x => <li key={x.id}><Link to={`/customer/repairs/${x.jobId}`} className="flex items-center gap-4 surface p-5"><Avatar src={eng[x.engineerId]?.photoURL} name={engName(eng[x.engineerId])} /><div className="flex-1"><p className="font-medium">{engName(eng[x.engineerId])}</p><p className="text-sm text-thor-text">About {x.durationHours}h</p></div><p className="font-display text-xl text-thor-blue">{gbp(x.totalPence)}</p></Link></li>)}</ul>}</div>)
}
