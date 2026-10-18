import '@/styles/admin-overview.css'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy } from 'firebase/firestore'
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Banknote, CalendarCheck, CheckCircle2, ClipboardList, Flag, HardHat, Inbox, Megaphone, Receipt, ShieldCheck, Users, Wrench, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, EmptyState, ListSkeleton, Select, Skeleton, StatusPill, usePaged } from '@/components/ui'
import { gbp, type JobStatus } from '@/types/domain'

interface RecentActivity { id: string; action: string; target: string; createdAt: number | null }
interface Stats {
  totals: Record<'customers' | 'engineers' | 'pendingApprovals' | 'openJobs' | 'activeQuotes' | 'confirmed' | 'completed' | 'reports' | 'cancelled' | 'activeEngineers' | 'scheduled' | 'awaitingBids', number>
  requestsPerDay: Record<string, number>
  recentActivity: RecentActivity[]
  marketing: null | Record<'facebookLeads' | 'instagramLeads' | 'leadsAwaitingVerification' | 'advertisingSpendPence' | 'costPerLeadPence' | 'advertisingJobs', number>
  finance: null | Record<'transactionValuePence' | 'commissionPence' | 'engineerPayoutPence' | 'outstandingPayments' | 'disputedTransactions' | 'advertisingRevenuePence', number>
}
interface Incoming { reference: string; status: JobStatus; device: { manufacturer: string; model: string }; location: { area: string }; urgency: string; source?: string; quoteCount: number; createdAt?: { toDate(): Date } }

const human = (s: string) => s.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const since = (d?: Date) => {
  if (!d) return 'Just now'
  const minutes = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000))
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function PanelHeading({ icon: Icon, eyebrow, title, action }: { icon: LucideIcon; eyebrow: string; title: string; action?: ReactNode }) {
  return <div className="admin-panel-heading"><div className="flex min-w-0 items-center gap-3"><span className="admin-panel-icon"><Icon className="size-4" /></span><div><p className="admin-overline">{eyebrow}</p><h2>{title}</h2></div></div>{action}</div>
}
function Metric({ icon: Icon, label, value, hint, to, tone }: { icon: LucideIcon; label: string; value?: number; hint: string; to: string; tone: string }) {
  return <Link to={to} className={`admin-metric admin-metric--${tone}`}><div className="flex items-center justify-between gap-2"><span className="admin-metric-icon"><Icon className="size-[19px]" strokeWidth={1.7} /></span><ArrowUpRight className="size-4 text-thor-text/60" /></div><p className="admin-metric-value">{value === undefined ? <Skeleton className="h-10 w-14" /> : value.toLocaleString('en-GB')}</p><h2>{label}</h2><p className="admin-metric-hint">{hint}</p></Link>
}

function RequestsChart({ data }: { data: Record<string, number> | undefined }) {
  const entries = Object.entries(data ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const today = new Date(), start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 13)
  if (entries[0] && entries[0][0] < start.toISOString().slice(0, 10)) start.setTime(new Date(`${entries[0][0]}T12:00:00Z`).getTime())
  const days: [string, number][] = []
  if (entries.length) for (const day = new Date(start); day.toISOString().slice(0, 10) <= today.toISOString().slice(0, 10); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    days.push([date, data?.[date] ?? 0])
  }
  const total = days.reduce((n, [, v]) => n + v, 0), peak = Math.max(3, Math.ceil(Math.max(0, ...days.map(([, v]) => v)) / 3) * 3)
  const step = 560 / Math.max(1, days.length), bar = Math.min(28, step * .6)
  return <section className="admin-panel admin-chart-panel">
    <PanelHeading icon={Activity} eyebrow="Demand at a glance" title="New requests, last 14 days" />
    <div className="admin-chart-summary"><div>{data ? <strong>{total.toLocaleString('en-GB')}</strong> : <Skeleton className="h-10 w-14" />}<span>requests in this period</span></div><span className="admin-chart-legend"><i />Repair requests</span></div>
    {!data ? <Skeleton className="h-44 w-full" /> : days.length === 0 ? <div className="admin-chart-empty"><Activity className="size-7" /><p>No requests in this period.</p><span>New requests will build your activity picture here.</span></div> : <>
      <svg viewBox="0 0 608 184" className="admin-demand-chart" role="img" aria-label={`New repair requests per day, ${total} in the last 14 days`}>
        {[0, 1, 2, 3].map(i => <g key={i}><line x1="32" x2="600" y1={20 + i * 42} y2={20 + i * 42} className="admin-chart-gridline" /><text x="22" y={24 + i * 42} textAnchor="end" className="admin-chart-label">{Number((peak * (1 - i / 3)).toFixed(1))}</text></g>)}
        {days.map(([date, n], i) => { const x = 40 + i * step + (step - bar) / 2, height = n / peak * 126; return <g key={date}><rect x={x} y={146 - height} width={bar} height={height} rx="5" className={i === days.length - 1 ? 'admin-chart-bar-last' : 'admin-chart-bar'}><title>{date}: {n} request{n === 1 ? '' : 's'}</title></rect>{(days.length <= 7 || (i % 4 === 0 && i < days.length - 2) || i === days.length - 1) && <text x={x + bar / 2} y="172" textAnchor="middle" className="admin-chart-label">{new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</text>}</g> })}
      </svg>
      <table className="sr-only"><caption>Requests per day</caption><thead><tr><th>Date</th><th>Requests</th></tr></thead><tbody>{days.map(([date, count]) => <tr key={date}><th>{date}</th><td>{count}</td></tr>)}</tbody></table>
    </>}
  </section>
}

// Kept in memory only (never on disk), so coming back to the overview shows the last figures at once while fresh ones load.
let lastStats: { uid?: string; stats: Stats } | null = null

export default function AdminOverview() {
  const { can, profile, user } = useAuth(), canJobs = can('jobs.manage')
  const [stats, setStats] = useState<Stats | null>(() => lastStats?.uid === user?.uid ? lastStats!.stats : null), [error, setError] = useState(''), [activityAction, setActivityAction] = useState('')
  const incoming = useQuery<Incoming>(canJobs ? 'repairRequests' : null, () => [orderBy('createdAt', 'desc'), limit(12)], [canJobs])
  useEffect(() => { let live = true; api.adminStats({}).then(v => { lastStats = { uid: user?.uid, stats: v as Stats }; if (live) setStats(v as Stats) }).catch(e => { if (live && lastStats?.uid !== user?.uid) setError(errMsg(e)) }); return () => { live = false } }, []) // eslint-disable-line
  if (error) return <EmptyState icon={ShieldCheck} title="Can’t load stats" body={error} />
  const t = stats?.totals, finance = stats?.finance, marketing = stats?.marketing
  const actions = [
    { title: 'Engineer approvals', hint: 'Review applications and credentials', count: t?.pendingApprovals, to: '/admin/approvals', icon: ShieldCheck, allowed: can('engineers.review'), tone: 'orange' },
    { title: 'Awaiting quotations', hint: 'Open jobs with no quotes yet', count: t?.awaitingBids, to: '/admin/jobs', icon: Receipt, allowed: canJobs, tone: 'blue' },
    { title: 'Open reports', hint: 'Review issues raised by your community', count: t?.reports, to: '/admin/reports', icon: Flag, allowed: can('reports.view'), tone: 'rose' },
  ].filter(a => a.allowed)
  const primary = [
    { icon: ClipboardList, label: 'Open requests', value: t?.openJobs, hint: 'Ready for an engineer', to: '/admin/jobs', tone: 'blue', allowed: canJobs },
    { icon: CalendarCheck, label: 'Confirmed bookings', value: t?.confirmed, hint: 'Appointments in the diary', to: '/admin/appointments', tone: 'teal', allowed: canJobs },
    { icon: HardHat, label: 'Active engineers', value: t?.activeEngineers, hint: 'Approved repair professionals', to: '/admin/engineers', tone: 'violet', allowed: can('engineers.review') },
    { icon: CheckCircle2, label: 'Completed jobs', value: t?.completed, hint: 'Repairs marked completed', to: '/admin/jobs', tone: 'orange', allowed: canJobs },
  ].filter(a => a.allowed)
  const activity = stats?.recentActivity ?? [], activityActions = [...new Set(activity.map(a => a.action))].sort(), filtered = activity.filter(a => !activityAction || a.action === activityAction)
  const paged = usePaged(filtered, activityAction)
  return <div className="admin-overview">
    <header className="admin-page-intro"><div><p className="admin-overline">THOR / OPERATIONS</p><h1>Overview<span>.</span></h1><p>Welcome back{profile?.fullName ? `, ${profile.fullName.split(' ')[0]}` : ''}. Here’s your business at a glance.</p></div><span className="admin-date-chip"><CalendarCheck className="size-4" />{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' })}</span></header>

    <section className="admin-briefing" aria-labelledby="admin-brief-title"><div className="admin-brief-copy"><span className="admin-brief-label"><span />YOUR DAILY BRIEFING</span><h2 id="admin-brief-title">Keep every repair<br /><span>moving forward.</span></h2><p>Your requests, people and priorities. One clear view.</p>{canJobs && <Link to="/admin/jobs" className="admin-brief-cta">Manage repair requests <ArrowUpRight className="size-4" /></Link>}</div><div className="admin-brief-queues"><div className="admin-brief-queues-title"><span>On your radar</span><Activity className="size-4" /></div>{actions.length ? actions.map(a => <Link to={a.to} key={a.title}><span className={`admin-queue-icon admin-tone-${a.tone}`}><a.icon className="size-4" /></span><span className="min-w-0 flex-1"><strong>{a.title}</strong><small>{a.hint}</small></span><b>{a.count === undefined ? '—' : a.count}</b><ArrowUpRight className="size-3.5" /></Link>) : <p className="text-sm text-white/75">Use the navigation to open the areas available to your role.</p>}</div></section>

    {primary.length > 0 && <div className="admin-metrics">{primary.map(m => <Metric key={m.label} {...m} />)}</div>}
    <div className={`admin-analytics-grid${!finance ? ' admin-analytics-grid--single' : ''}`}>
      <RequestsChart data={stats?.requestsPerDay} />
      {finance && <section className="admin-finance-card"><div className="flex items-center justify-between"><span className="admin-finance-icon"><Banknote className="size-5" /></span><Link to="/admin/finance" aria-label="Open Finance" className="admin-finance-open"><ArrowUpRight className="size-5" /></Link></div><p className="admin-overline">MONEY OVERVIEW</p><h2>Thor commission</h2><p className="admin-finance-total">{gbp(finance.commissionPence)}</p><span className="admin-finance-caption">After commission refunds · not profit</span><div className="admin-finance-lines"><div><span><ArrowDownLeft className="size-3.5" />Transaction value</span><b>{gbp(finance.transactionValuePence)}</b></div><div><span>Engineer payouts</span><b>{gbp(finance.engineerPayoutPence)}</b></div><div><span>Outstanding payments</span><b>{finance.outstandingPayments}</b></div><div><span>Disputed transactions</span><b>{finance.disputedTransactions}</b></div><div><span>Advertising-generated revenue</span><b>{gbp(finance.advertisingRevenuePence)}</b></div></div><Link to="/admin/finance" className="admin-finance-link">Open finance <ArrowRight className="size-4" /></Link></section>}
    </div>

    <div className={`admin-work-grid${!canJobs ? ' admin-work-grid--single' : ''}`}>
      {canJobs && <section className="admin-panel admin-incoming"><PanelHeading icon={Inbox} eyebrow="The repair desk" title="New repair requests" action={<Link to="/admin/jobs" className="admin-text-link">All requests <ArrowUpRight className="size-3.5" /></Link>} />
        <div className="admin-table-labels"><span>DEVICE / REFERENCE</span><span>STATUS</span></div>
        {incoming.loading ? <div className="p-5"><ListSkeleton rows={2} /></div> : incoming.error ? <p role="alert" className="p-5 text-sm text-bad">{errMsg(incoming.error)}</p> : incoming.data.length === 0 ? <div className="admin-panel-empty"><Wrench className="size-7" /><h3>No repair requests yet</h3><p>New ones appear here as they arrive.</p></div> : <ul className="admin-request-list" aria-live="polite">{incoming.data.map(j => <li key={j.id}><span className="admin-device-icon"><Wrench className="size-[18px]" /></span><div className="min-w-0 flex-1"><p className="admin-request-title">{j.device.manufacturer} {j.device.model}</p><p className="admin-request-meta"><span>{j.reference}</span><span>{j.location?.area}</span></p><p className="admin-request-time">{since(j.createdAt?.toDate())} · {j.quoteCount ?? 0} quote{j.quoteCount === 1 ? '' : 's'}{j.source && j.source !== 'app' ? ` · ${j.source === 'meta' ? 'Facebook/Instagram' : 'Website'}` : ''}</p></div><div className="admin-request-status">{j.urgency === 'urgent' && <Badge tone="bad">Urgent</Badge>}<StatusPill status={j.status} /></div></li>)}</ul>}
      </section>}
      <section className="admin-panel admin-activity"><PanelHeading icon={Activity} eyebrow="Your audit trail" title="Recent activity" /><div className="admin-activity-filter"><Select label="Filter by action" value={activityAction} onChange={e => setActivityAction(e.target.value)} disabled={!stats || activity.length === 0}><option value="">All actions</option>{activityActions.map(a => <option key={a} value={a}>{human(a)}</option>)}</Select>{stats && <p role="status">Showing {filtered.length} of {activity.length} latest entries</p>}</div>{!stats ? <div className="p-5"><ListSkeleton rows={2} /></div> : filtered.length === 0 ? <div className="admin-panel-empty"><CheckCircle2 className="size-7" /><h3>{activity.length ? 'No matching activity' : 'A clean slate'}</h3><p>{activity.length ? 'Choose another action to see more entries.' : 'Platform activity will appear here.'}</p></div> : <><ol className="admin-timeline">{paged.items.map(a => <li key={a.id}><span className="admin-timeline-dot" /><div><strong>{human(a.action)}</strong><p title={a.target}>{a.target}</p><time dateTime={a.createdAt === null ? undefined : new Date(a.createdAt).toISOString()}>{a.createdAt === null ? 'Date unavailable' : new Date(a.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}</time></div></li>)}</ol><div className="admin-activity-pager">{paged.pager}</div></>}</section>
    </div>

    {marketing && <section className="admin-panel admin-acquisition"><PanelHeading icon={Megaphone} eyebrow="Reach & acquisition" title="Advertising" action={<Link to="/admin/marketing" className="admin-text-link">Marketing <ArrowUpRight className="size-3.5" /></Link>} /><div className="admin-acquisition-grid">{[['Facebook leads', marketing.facebookLeads, '/admin/leads'], ['Instagram leads', marketing.instagramLeads, '/admin/leads'], ['Leads awaiting verification', marketing.leadsAwaitingVerification, '/admin/leads'], ['Advertising spend', gbp(marketing.advertisingSpendPence), '/admin/marketing'], ['Cost per lead', marketing.costPerLeadPence ? gbp(marketing.costPerLeadPence) : '—', '/admin/marketing'], ['Advertising-generated jobs', marketing.advertisingJobs, '/admin/jobs']].map(([label, value, to]) => <Link to={String(to)} key={label}><span>{label}</span><strong>{value}</strong></Link>)}</div></section>}

    <footer className="admin-directory">{[{ icon: Users, label: 'Customers', value: t?.customers, to: '/admin/customers', allowed: can('customers.manage') }, { icon: HardHat, label: 'Engineers', value: t?.engineers, to: '/admin/engineers', allowed: can('engineers.review') }, { icon: Receipt, label: 'Active quotations', value: t?.activeQuotes, to: '/admin/quotations', allowed: canJobs }].filter(d => d.allowed).map(d => <Link key={d.label} to={d.to}><d.icon className="size-4" /><span>{d.label}</span><b>{d.value ?? '—'}</b><ArrowUpRight className="size-3.5" /></Link>)}{t && <p>{t.scheduled} scheduled appointments · {t.cancelled} cancelled repairs</p>}</footer>
  </div>
}
