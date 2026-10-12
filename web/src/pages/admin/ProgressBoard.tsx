import { useMemo, useState } from 'react'
import { limit, where } from 'firebase/firestore'
import { AlertTriangle, CalendarClock, KanbanSquare } from 'lucide-react'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { useEngineers } from '@/hooks/useEngineers'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, ListSkeleton, PageHeader, Select, Sheet, Textarea, useToast, cx } from '@/components/ui'
import { Gate, useCan } from '@/components/admin'
import JobTimeline from '@/components/JobTimeline'
import { engName } from '@/components/QuoteCompare'
import { gbp, JobStatus, jobStatusLabel } from '@/types/domain'

type TS = { toDate(): Date } | undefined
interface Card { reference: string; status: JobStatus; quoteCount: number; customerId: string; selectedEngineerId: string | null; agreedTotalPence?: number; device: { manufacturer: string; model: string }; statusHistory?: { status: string; at: TS }[]; createdAt?: TS; messageCount?: number; lastMessageAt?: TS; progressPercent?: number }
/** Board columns. "Open" is split into bidding / receiving quotations by quote count. */
const COLUMNS: { id: string; label: string; status: JobStatus; test?: (c: Card) => boolean }[] = [
  { id: 'awaiting_verification', label: 'Awaiting verification', status: 'awaiting_verification' },
  { id: 'bidding', label: 'Open for bidding', status: 'open', test: c => !c.quoteCount }, { id: 'quoting', label: 'Receiving quotations', status: 'open', test: c => c.quoteCount > 0 },
  { id: 'engineer_selected', label: 'Engineer selected', status: 'engineer_selected' }, { id: 'awaiting_payment', label: 'Awaiting payment', status: 'awaiting_payment' },
  { id: 'appointment_scheduled', label: 'Appointment confirmed', status: 'appointment_scheduled' }, { id: 'in_progress', label: 'In progress', status: 'in_progress', test: c => c.status === 'in_progress' || c.status === 'on_the_way' },
  { id: 'awaiting_parts', label: 'Awaiting parts', status: 'awaiting_parts' }, { id: 'completed', label: 'Completed (awaiting close)', status: 'completed' }, { id: 'disputed', label: 'Disputed', status: 'disputed' },
]
const BOARD_STATUSES = ['awaiting_verification', 'open', 'engineer_selected', 'awaiting_payment', 'appointment_scheduled', 'on_the_way', 'in_progress', 'awaiting_parts', 'completed', 'disputed']
/** Mirrors TRANSITIONS.admin in functions/src/domain.ts for display; the server re-checks every move. */
const ADMIN_MOVES: Partial<Record<JobStatus, JobStatus[]>> = { awaiting_verification: ['open', 'cancelled'], awaiting_payment: ['cancelled', 'open'], open: ['cancelled'], engineer_selected: ['cancelled', 'open'], appointment_scheduled: ['cancelled'], on_the_way: ['cancelled'], in_progress: ['cancelled'], awaiting_parts: ['cancelled'], completed: ['closed', 'disputed'], disputed: ['closed', 'completed', 'cancelled'] }
export const DEFAULT_SLA_HOURS: Record<string, number> = { awaiting_verification: 24, open: 72, engineer_selected: 48, awaiting_payment: 48, appointment_scheduled: 336, on_the_way: 6, in_progress: 120, awaiting_parts: 240, completed: 72, disputed: 120 }

const sinceStatus = (c: Card) => { const last = [...(c.statusHistory ?? [])].reverse().find(h => h.status === c.status || (c.status === 'engineer_selected' && h.status === 'payment_confirmed')); return Date.now() - (last?.at?.toDate().getTime() ?? c.createdAt?.toDate().getTime() ?? Date.now()) }
const fmt = (ms: number) => { const h = ms / 3600_000; return h < 24 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d` }

export default function ProgressBoard() {
  const toast = useToast(); const can = useCan()
  const jobs = useQuery<Card>('repairRequests', () => [where('status', 'in', BOARD_STATUSES), limit(500)], [])
  const settings = useDoc<{ sla?: { hours: Record<string, number> } }>('platformSettings/public')
  const sla = { ...DEFAULT_SLA_HOURS, ...settings.data?.sla?.hours }
  const eng = useEngineers(jobs.data.map(j => j.selectedEngineerId ?? '').filter(Boolean))
  const customers = useQuery<{ fullName: string }>(can('customers.manage') ? 'users' : null, () => [where('role', '==', 'customer'), limit(1000)], [])
  const cname = useMemo(() => Object.fromEntries(customers.data.map(c => [c.id, c.fullName])), [customers.data])
  const apts = useQuery<{ jobId: string; startAt: { toDate(): Date } }>('appointments', () => [where('status', 'in', ['confirmed', 'reschedule_requested']), limit(500)], [])
  const nextApt = useMemo(() => Object.fromEntries(apts.data.map(a => [a.jobId, a.startAt.toDate()])), [apts.data])
  const [open, setOpen] = useState<(Card & { id: string }) | null>(null); const [to, setTo] = useState(''); const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false); const [stuckOnly, setStuckOnly] = useState(false)
  const stuck = (c: Card) => sinceStatus(c) > (sla[c.status] ?? 72) * 3600_000
  const visible = jobs.data.filter(c => !stuckOnly || stuck(c))
  const move = async () => { if (!open || !to) return; setBusy(true); try { if (open.status === 'awaiting_verification' && to === 'open') await api.publishJob({ jobId: open.id, note: why }); else await api.changeJobStatus({ jobId: open.id, to, note: why }); toast('ok', 'Job moved.'); setOpen(null); setTo(''); setWhy('') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return (
    <Gate perm="jobs.view"><div><PageHeader title="Work in progress" sub="Every active repair by stage. Red cards have been in their stage longer than the target time." action={<label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-thor-blue" checked={stuckOnly} onChange={e => setStuckOnly(e.target.checked)} />Only overdue ({jobs.data.filter(stuck).length})</label>} />
      {jobs.loading ? <ListSkeleton /> : jobs.data.length === 0 ? <EmptyState icon={KanbanSquare} title="No active repairs" body="Active jobs appear here as they move through the marketplace." /> :
        <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-4 md:-mx-8 md:px-8">{COLUMNS.map(col => { const cards = visible.filter(c => c.status === col.status || (col.id === 'in_progress' && c.status === 'on_the_way')).filter(c => !col.test || col.test(c)); return (
          <section key={col.id} className="w-64 shrink-0" aria-label={col.label}><h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-thor-text">{col.label}<Badge tone="neutral">{cards.length}</Badge></h2>
            <ul className="space-y-2">{cards.map(c => { const late = stuck(c), apt = nextApt[c.id]; return <li key={c.id}><button onClick={() => { setOpen(c); setTo('') }} className={cx('w-full rounded-2xl bg-white p-3 text-left text-sm shadow-sm ring-1 transition hover:shadow-md', late ? 'ring-bad/50' : 'ring-ink/5')}>
              <div className="flex items-center justify-between gap-2"><b className="text-xs">{c.reference}</b>{late && <AlertTriangle className="size-4 text-bad" aria-label="Over target time" />}</div>
              <p className="mt-1 truncate">{cname[c.customerId] ?? 'Customer'}</p><p className="truncate text-xs text-thor-text">{c.device.manufacturer} {c.device.model}</p>
              <p className="mt-1 truncate text-xs">{c.selectedEngineerId ? engName(eng[c.selectedEngineerId]) : `${c.quoteCount} quote${c.quoteCount === 1 ? '' : 's'}`}{c.agreedTotalPence ? ` · ${gbp(c.agreedTotalPence)}` : ''}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-thor-text"><span className={cx(late && 'font-semibold text-bad')}>{fmt(sinceStatus(c))} in stage</span>{apt && <span className="flex items-center gap-1"><CalendarClock className="size-3" />{apt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}{c.progressPercent !== undefined && <span>{c.progressPercent}%</span>}</div>
            </button></li> })}</ul></section>) })}</div>}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? `${open.reference} · ${jobStatusLabel(open.status, open.quoteCount)}` : ''}>{open && <div className="space-y-4">
        {can('jobs.manage') && (ADMIN_MOVES[open.status] ?? []).length > 0 && <div className="space-y-2 rounded-xl bg-paper p-3"><Select label="Move to" value={to} onChange={e => setTo(e.target.value)}><option value="">Choose…</option>{(ADMIN_MOVES[open.status] ?? []).map(s => <option key={s} value={s}>{s === 'open' && open.status === 'awaiting_verification' ? 'Publish (open for bidding)' : jobStatusLabel(s)}</option>)}</Select>
          <Textarea label="Reason (audit log, shown on the timeline)" value={why} onChange={e => setWhy(e.target.value)} maxLength={500} /><Button loading={busy} disabled={!to || why.trim().length < 5} onClick={move}>Move job</Button></div>}
        <JobTimeline jobId={open.id} job={open} audience="admin" /></div>}</Sheet>
    </div></Gate>)
}
