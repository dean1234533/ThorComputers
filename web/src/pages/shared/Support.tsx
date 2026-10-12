import { FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { ArrowLeft, LifeBuoy, Send } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Select, Textarea, useToast, cx } from '@/components/ui'

export interface Ticket { userId: string; subject: string; category: string; status: string; priority: string; assignedTo: string | null; jobId: string | null; lastMessageAt?: { toDate(): Date }; createdAt?: { toDate(): Date }; fromChatbot?: boolean }
interface TMsg { authorId: string; staff: boolean; text: string; transcript?: { role: string; text: string }[] | null; createdAt?: { toDate(): Date } }
export const ticketTone = (s: string) => (s === 'open' ? 'warn' : s === 'pending' ? 'info' : 'neutral') as 'warn' | 'info' | 'neutral'

export function SupportPage() {
  const { user } = useAuth(); const nav = useNavigate(); const toast = useToast()
  const t = useQuery<Ticket>('supportTickets', () => [where('userId', '==', user!.uid), orderBy('lastMessageAt', 'desc'), limit(30)], [user?.uid])
  const [f, setF] = useState({ subject: '', message: '', category: 'repair' }); const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); try { const r = await api.createSupportTicket(f); nav(`/support/${r.ticketId}`) } catch (x) { toast('bad', errMsg(x)) } finally { setBusy(false) } }
  return (
    <div className="max-w-2xl"><PageHeader title="Support" sub="Our team usually replies within one working day." />
      <Section title="Your enquiries">{t.loading ? <ListSkeleton rows={1} /> : t.data.length === 0 ? <p className="text-sm text-thor-text">No enquiries yet.</p> :
        <ul className="space-y-2">{t.data.map(x => <li key={x.id}><Link to={`/support/${x.id}`} className="surface flex items-center gap-3 p-4"><LifeBuoy className="size-5 text-thor-blue" /><span className="min-w-0 flex-1 truncate font-medium">{x.subject}</span><Badge tone={ticketTone(x.status)}>{x.status === 'pending' ? 'replied' : x.status}</Badge></Link></li>)}</ul>}</Section>
      <Section title="Ask for help"><form onSubmit={submit} className="space-y-3">
        <Select label="Topic" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}><option value="repair">A repair</option><option value="payment">A payment</option><option value="engineer">An engineer</option><option value="account">My account</option><option value="other">Something else</option></Select>
        <Input label="Subject" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} maxLength={120} />
        <Textarea label="How can we help?" value={f.message} onChange={e => setF({ ...f, message: e.target.value })} maxLength={4000} hint="Include your repair reference (THOR-…) if it’s about a repair. Never send card details." />
        <Button type="submit" loading={busy} disabled={f.subject.trim().length < 3 || f.message.trim().length < 10}>Send</Button></form></Section>
    </div>)
}

export function TicketThread({ staffView = false }: { staffView?: boolean }) {
  const { id } = useParams(); const { user } = useAuth(); const toast = useToast(); const nav = useNavigate()
  const t = useDoc<Ticket>(`supportTickets/${id}`)
  const m = useQuery<TMsg>(`supportTickets/${id}/messages`, () => [orderBy('createdAt', 'asc'), limit(200)], [id])
  const [text, setText] = useState(''); const [busy, setBusy] = useState('')
  const reply = async (e: FormEvent) => { e.preventDefault(); setBusy('r'); try { await api.replySupportTicket({ ticketId: id!, text: text.trim() }); setText('') } catch (x) { toast('bad', errMsg(x)) } finally { setBusy('') } }
  const upd = async (k: string, x: Parameters<typeof api.updateSupportTicket>[0]) => { setBusy(k); try { await api.updateSupportTicket(x); toast('ok', 'Ticket updated.') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  if (t.loading) return <ListSkeleton rows={2} />
  if (!t.data) return <EmptyState icon={LifeBuoy} title="Enquiry not found" body="It may have been removed, or you don’t have access." />
  return (
    <div className="max-w-2xl">
      <button onClick={() => nav(staffView ? '/admin/support' : '/support')} className="mb-3 flex items-center gap-1 text-sm text-thor-blue"><ArrowLeft className="size-4" />Back</button>
      <div className="flex flex-wrap items-center gap-2"><h1 className="font-display text-2xl">{t.data.subject}</h1><Badge tone={ticketTone(t.data.status)}>{t.data.status}</Badge>{t.data.priority === 'escalated' && <Badge tone="bad">escalated</Badge>}</div>
      {staffView && <div className="mt-3 flex flex-wrap gap-2 text-sm">{!t.data.assignedTo && <Button size="sm" variant="soft" loading={busy === 'a'} onClick={() => upd('a', { ticketId: id!, assignToMe: true })}>Assign to me</Button>}
        {t.data.priority !== 'escalated' && <Button size="sm" variant="soft" loading={busy === 'e'} onClick={() => upd('e', { ticketId: id!, escalate: true })}>Escalate to admins</Button>}
        {t.data.status !== 'closed' ? <Button size="sm" variant="ghost" loading={busy === 'c'} onClick={() => upd('c', { ticketId: id!, status: 'closed' })}>Close</Button> : <Button size="sm" variant="ghost" loading={busy === 'o'} onClick={() => upd('o', { ticketId: id!, status: 'open' })}>Reopen</Button>}
        {t.data.jobId && <Link className="self-center text-thor-blue hover:underline" to={`/admin/jobs?q=${t.data.jobId}`}>Linked repair</Link>}</div>}
      <ul className="mt-5 space-y-3">{m.data.map(x => <li key={x.id} className={cx('rounded-2xl p-4 text-sm', x.staff ? 'bg-thor-sky/20' : 'bg-white shadow-sm ring-1 ring-ink/5')}>
        <p className="mb-1 text-xs text-thor-text">{x.staff ? 'Thor Computer support' : x.authorId === user!.uid ? 'You' : 'Customer'} · {x.createdAt?.toDate().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</p><p className="whitespace-pre-wrap">{x.text}</p>
        {x.transcript && <details className="mt-2 text-xs"><summary className="cursor-pointer text-thor-blue">Assistant conversation ({x.transcript.length} messages)</summary><ul className="mt-2 space-y-1">{x.transcript.map((tr, i) => <li key={i}><b>{tr.role === 'user' ? 'Customer' : 'Assistant'}:</b> {tr.text}</li>)}</ul></details>}</li>)}</ul>
      {t.data.status !== 'closed' && <form onSubmit={reply} className="mt-4 flex items-end gap-2"><textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={4000} aria-label="Reply" className="min-h-11 flex-1 rounded-2xl border border-ink/15 bg-white px-4 py-2.5 text-sm focus:border-thor-blue focus:outline-none" />
        <Button type="submit" loading={busy === 'r'} disabled={!text.trim()} aria-label="Send reply"><Send className="size-4" /></Button></form>}
    </div>)
}
export const UserTicket = () => <TicketThread />
export const AdminTicket = () => <TicketThread staffView />
