import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, limit, orderBy, setDoc, where } from 'firebase/firestore'
import { Star, Briefcase, FileText, Search, Plus, X } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Stars, useToast, cx } from '@/components/ui'
import Appointments from '../shared/Appointments'

export function EngineerDashboard() {
  const { user, profile, approved } = useAuth()
  const app = useDoc<{ status: string }>(`engineerApplications/${user!.uid}`)
  const prof = useDoc<{ ratingAvg: number; reviewCount: number; completedJobs: number }>(approved ? `engineerProfiles/${user!.uid}` : null)
  const live = useQuery<{ totalPence: number }>(approved ? 'repairQuotes' : null, () => [where('engineerId', '==', user!.uid), where('status', '==', 'submitted'), limit(50)], [user!.uid, approved])
  const jobs = useQuery<{ status: string }>(approved ? 'repairRequests' : null, () => [where('selectedEngineerId', '==', user!.uid), limit(50)], [user!.uid, approved])
  const active = jobs.data.filter(j => !['closed', 'cancelled', 'completed'].includes(j.status)).length
  const Tile = ({ icon: I, label, value, to }: { icon: typeof Star; label: string; value: React.ReactNode; to: string }) => <Link to={to} className="surface p-5 transition hover:shadow-md"><I className="mb-2 size-5 text-thor-blue" /><p className="font-display text-3xl">{value}</p><p className="text-sm text-thor-text">{label}</p></Link>
  return (
    <div><PageHeader title={`Hello, ${profile?.fullName.split(' ')[0] ?? ''}`} sub="Your engineer dashboard." />
      {!approved ? <div className="rounded-3xl bg-thor-blue p-6 text-white"><h2 className="font-display text-xl">{app.data?.status === 'pending' ? 'Your application is being reviewed' : 'Finish your application'}</h2><p className="mt-1.5 text-white/80">{app.data?.status === 'pending' ? 'We’ll notify you as soon as there’s a decision.' : 'Complete your profile and upload qualifications to start receiving jobs.'}</p><Link to="/engineer/profile"><Button variant="cta" className="mt-4">{app.data?.status === 'pending' ? 'View application' : 'Continue'}</Button></Link></div> :
        <><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Tile icon={Search} label="Browse jobs" value="Open" to="/engineer/jobs" /><Tile icon={FileText} label="Live quotations" value={live.data.length} to="/engineer/quotations" /><Tile icon={Briefcase} label="Active jobs" value={active} to="/engineer/my-jobs" /><Tile icon={Star} label="Rating" value={prof.data?.reviewCount ? prof.data.ratingAvg.toFixed(1) : '—'} to="/engineer/reviews" /></div>
          <p className="mt-6 text-sm text-thor-text">Completed jobs: <b className="text-ink">{prof.data?.completedJobs ?? 0}</b></p></>}</div>)
}

interface Review { rating: number; ratings: Record<string, number>; text: string; reference: string; createdAt?: { toDate(): Date } }
export function EngineerReviews() {
  const { user } = useAuth()
  const prof = useDoc<{ ratingAvg: number; reviewCount: number }>(`engineerProfiles/${user!.uid}`)
  const r = useQuery<Review>('reviews', () => [where('subjectId', '==', user!.uid), where('direction', '==', 'customer_to_engineer'), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(30)], [user!.uid])
  return (
    <div><PageHeader title="Reviews" sub="Your reputation on Thor Computer." />
      <div className="mb-6 flex items-center gap-4 surface p-6"><p className="font-display text-5xl text-thor-blue">{prof.data?.reviewCount ? prof.data.ratingAvg.toFixed(1) : '—'}</p><div><Stars value={prof.data?.ratingAvg ?? 0} count={prof.data?.reviewCount ?? 0} /><p className="text-sm text-thor-text">{prof.data?.reviewCount ?? 0} review(s)</p></div></div>
      {r.loading ? <ListSkeleton rows={2} /> : r.data.length === 0 ? <EmptyState icon={Star} title="No reviews yet" body="Customers can review you after a completed repair." /> :
        <ul className="divide-y divide-ink/8 surface px-5">{r.data.map((x, i) => <li key={i} className="py-4"><div className="flex items-center justify-between"><Stars value={x.rating} /><span className="text-xs text-thor-text">{x.reference}</span></div>{x.text && <p className="mt-1.5 text-sm">{x.text}</p>}</li>)}</ul>}</div>)
}

// ---------- availability ----------
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
interface Rule { enabled: boolean; start: string; end: string; breaks: { start: string; end: string }[] }
interface Avail { weekly: Record<string, Rule>; unavailableDates: string[]; slotMinutes: number }
const DEFAULT: Avail = { slotMinutes: 30, unavailableDates: [], weekly: Object.fromEntries(DAYS.map((_, i) => [String(i), { enabled: i > 0 && i < 6, start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] }])) }

function AvailabilityEditor() {
  const { user } = useAuth(); const toast = useToast(); const saved = useDoc<Avail>(`engineerProfiles/${user!.uid}/private/availability`)
  const [a, setA] = useState<Avail>(DEFAULT); const [busy, setBusy] = useState(false); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  useEffect(() => { if (saved.data) setA({ ...DEFAULT, ...saved.data }) }, [saved.data])
  const rule = (d: string, patch: Partial<Rule>) => setA(s => ({ ...s, weekly: { ...s.weekly, [d]: { ...s.weekly[d], ...patch } } }))
  const addRange = () => { if (!from) return; const out: string[] = [], end = new Date((to || from) + 'T12:00:00'); for (let d = new Date(from + 'T12:00:00'); d <= end && out.length < 62; d.setDate(d.getDate() + 1)) out.push(d.toLocaleDateString('en-CA')); setA(s => ({ ...s, unavailableDates: [...new Set([...s.unavailableDates, ...out])].sort() })); setFrom(''); setTo('') }
  const bad = Object.values(a.weekly).some(r => r.enabled && r.start >= r.end)
  const save = async () => { setBusy(true); try { await setDoc(doc(db, `engineerProfiles/${user!.uid}/private/availability`), { ...a, slotMinutes: 30 }); toast('ok', 'Availability saved.') } catch { toast('bad', 'Could not save availability.') } finally { setBusy(false) } }
  return (
    <Section title="My availability">
      <p className="mb-3 text-sm text-thor-text">Customers can only book inside these hours. Existing appointments are blocked automatically.</p>
      <ul className="divide-y divide-ink/8 rounded-2xl bg-white shadow-sm ring-1 ring-ink/5">{[1, 2, 3, 4, 5, 6, 0].map(i => { const r = a.weekly[String(i)]; const br = r.breaks[0]; return (
        <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4"><label className="flex w-32 items-center gap-2.5"><input type="checkbox" className="size-5 accent-thor-blue" checked={r.enabled} onChange={e => rule(String(i), { enabled: e.target.checked })} /><span className="font-medium">{DAYS[i]}</span></label>
          {r.enabled ? <div className="flex flex-wrap items-center gap-2 text-sm"><input aria-label={`${DAYS[i]} start`} type="time" step={1800} value={r.start} onChange={e => rule(String(i), { start: e.target.value })} className="h-10 rounded-lg border border-ink/15 px-2" />to<input aria-label={`${DAYS[i]} finish`} type="time" step={1800} value={r.end} onChange={e => rule(String(i), { end: e.target.value })} className="h-10 rounded-lg border border-ink/15 px-2" />
            <span className="ml-2 text-thor-text">Break</span><input aria-label={`${DAYS[i]} break start`} type="time" step={1800} value={br?.start ?? ''} onChange={e => rule(String(i), { breaks: e.target.value ? [{ start: e.target.value, end: br?.end ?? '13:00' }] : [] })} className="h-10 rounded-lg border border-ink/15 px-2" />–<input aria-label={`${DAYS[i]} break end`} type="time" step={1800} value={br?.end ?? ''} onChange={e => br && rule(String(i), { breaks: [{ start: br.start, end: e.target.value }] })} className="h-10 rounded-lg border border-ink/15 px-2" /></div> : <span className="text-sm text-thor-text">Unavailable</span>}</li>) })}</ul>
      <h3 className="mb-2 mt-6 font-medium">Holidays and unavailable dates</h3>
      <div className="flex flex-wrap items-end gap-3"><Input label="From" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input label="To (optional)" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /><Button variant="soft" onClick={addRange} disabled={!from}><Plus className="size-4" />Add</Button></div>
      {a.unavailableDates.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{a.unavailableDates.map(d => <button key={d} onClick={() => setA(s => ({ ...s, unavailableDates: s.unavailableDates.filter(x => x !== d) }))} className={cx('inline-flex items-center gap-1 rounded-full bg-ink/8 px-3 py-1 text-sm hover:bg-bad/10')}>{new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}<X className="size-3.5" /></button>)}</div>}
      {bad && <p role="alert" className="mt-3 text-sm text-bad">A finish time must be after its start time.</p>}
      <Button className="mt-5" onClick={save} loading={busy} disabled={bad}>Save availability</Button> {!saved.data && <Badge tone="warn">Using default hours until you save</Badge>}
    </Section>)
}

export function EngineerAppointments() { return <><Appointments /><AvailabilityEditor /></> }
