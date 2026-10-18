import { useState } from 'react'
import { where, orderBy, limit } from 'firebase/firestore'
import { CalendarDays, Clock, MapPin } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, ListSkeleton, PageHeader, Sheet, useToast, Input } from '@/components/ui'
import { SERVICE_METHODS } from '@/types/domain'
import { DateFilter, ALL_TIME, dateConstraints, rangeKey, type DateRange } from '@/components/DateFilter'

interface Apt { jobId: string; reference: string; customerId: string; engineerId: string; startAt: { toDate(): Date }; durationMinutes: number; status: string; method: string; pendingReschedule?: { by: string; startAt: { toDate(): Date } } | null }
const fmt = (d: Date) => d.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

export default function Appointments() {
  const { user, role } = useAuth(); const toast = useToast()
  const f = role === 'engineer' ? 'engineerId' : 'customerId'
  const [range, setRange] = useState<DateRange>(ALL_TIME)
  const apts = useQuery<Apt>('appointments', () => [where(f, '==', user!.uid), ...dateConstraints('startAt', range), orderBy('startAt', 'desc'), limit(40)], [user?.uid, f, rangeKey(range)])
  const [busy, setBusy] = useState(''); const [resched, setResched] = useState<string | null>(null); const [when, setWhen] = useState('')
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); toast('ok', ok) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  const now = Date.now()
  const upcoming = apts.data.filter(a => ['confirmed', 'reschedule_requested'].includes(a.status) && a.startAt.toDate().getTime() > now - 3600_000).reverse(), past = apts.data.filter(a => !upcoming.includes(a))
  const Card = ({ a }: { a: Apt & { id: string } }) => {
    const mine = a.pendingReschedule?.by === user!.uid, theirs = a.status === 'reschedule_requested' && !mine
    return (
      <li className="surface p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="font-display text-lg">{fmt(a.startAt.toDate())}</p><p className="mt-1 flex flex-wrap gap-x-4 text-sm text-thor-text"><span className="flex items-center gap-1"><Clock className="size-4" />{a.durationMinutes} min</span><span className="flex items-center gap-1"><MapPin className="size-4" />{SERVICE_METHODS.find(m => m.id === a.method)?.label}</span><span>{a.reference}</span></p></div>
          <Badge tone={a.status === 'confirmed' || a.status === 'completed' ? 'ok' : a.status === 'cancelled' ? 'bad' : 'warn'}>{a.status.replace('_', ' ')}</Badge></div>
        {a.status === 'reschedule_requested' && a.pendingReschedule && <p className="mt-3 rounded-xl bg-warn/10 p-3 text-sm">{mine ? 'You proposed' : 'Proposed new time:'} <b>{fmt(a.pendingReschedule.startAt.toDate())}</b>{mine && ' (awaiting reply)'}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {theirs && <><Button size="sm" loading={busy === a.id + 'y'} onClick={() => run(a.id + 'y', () => api.respondReschedule({ appointmentId: a.id, accept: true }), 'New time confirmed.')}>Accept new time</Button><Button size="sm" variant="soft" onClick={() => run(a.id + 'n', () => api.respondReschedule({ appointmentId: a.id, accept: false }), 'Kept the original time.')}>Decline</Button></>}
          {a.status === 'confirmed' && <Button size="sm" variant="soft" onClick={() => { setResched(a.id); setWhen('') }}>Request reschedule</Button>}
          {['confirmed', 'reschedule_requested'].includes(a.status) && <Button size="sm" variant="ghost" className="text-bad hover:bg-bad/10" loading={busy === a.id + 'c'} onClick={() => confirm('Cancel this appointment?') && run(a.id + 'c', () => api.cancelAppointment({ appointmentId: a.id }), 'Appointment cancelled.')}>Cancel</Button>}
        </div></li>)
  }
  return (
    <div><PageHeader title="Appointments" /><DateFilter label="Appointment date" value={range} onChange={setRange} />
      {apts.loading ? <ListSkeleton /> : apts.data.length === 0 ? <EmptyState icon={CalendarDays} title="No appointments" body={role === 'engineer' ? 'Bookings from customers will appear here.' : 'Once you select an engineer you can book a time.'} /> : <>
        {upcoming.length > 0 && <ul className="space-y-3">{upcoming.map(a => <Card key={a.id} a={a} />)}</ul>}
        {past.length > 0 && <><h2 className="mb-3 mt-8 font-display text-lg text-thor-text">Past and cancelled</h2><ul className="space-y-3 opacity-80">{past.map(a => <Card key={a.id} a={a} />)}</ul></>}</>}
      <Sheet open={!!resched} onClose={() => setResched(null)} title="Propose a new time">
        <p className="mb-3 text-sm text-thor-text">Pick a time within the engineer’s working hours. The other person will be asked to accept.</p>
        <Input label="New date and time (UK time)" type="datetime-local" step={1800} value={when} onChange={e => setWhen(e.target.value)} />
        <Button className="mt-4 w-full" disabled={!when} loading={busy === 'r'} onClick={() => run('r', async () => { await api.requestReschedule({ appointmentId: resched!, newStartAt: new Date(when).toISOString() }); setResched(null) }, 'Reschedule requested.')}>Send request</Button></Sheet>
    </div>)
}
