import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { ArrowLeft, CheckCircle2, Contact, NotebookPen, Plus, Tag } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, Input, ListSkeleton, PageHeader, Section, Select, StatusPill, Textarea, useToast, cx } from '@/components/ui'
import { downloadCsv, ExportButton, Gate, poundsStr, useCan } from '@/components/admin'
import JobTimeline from '@/components/JobTimeline'
import { LeadStatus } from './AdminLeads'
import { gbp, JobStatus } from '@/types/domain'

type TS = { toDate(): Date } | undefined
export interface ContactUser { fullName: string; email: string; phone?: string; postcode?: string; status: string; createdAt?: TS; createdVia?: string; privacy?: { marketingEmails?: boolean }
  contact?: { totalRepairs: number; activeRepairs: number; lastActivityAt?: TS; source: string; lastJobRef: string | null } }
interface Meta { tags?: string[]; assignedTo?: string | null }
const SOURCES = ['app', 'wordpress', 'facebook', 'instagram', 'chatbot']
const d = (t?: TS) => t?.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) ?? '—'

function useStaff() {
  return useQuery<{ fullName: string; email: string; status: string }>('users', () => [where('role', '==', 'admin'), where('status', '==', 'active'), limit(100)], [])
}

/** Customer contact list. Filters run on the latest 1,000 customers; search reaches any customer through the server. */
export function AdminContacts() {
  const toast = useToast(); const nav = useNavigate(); const can = useCan(); const { user } = useAuth()
  const [f, setF] = useState({ q: '', status: '', source: '', active: '', tag: '', assigned: '', postcode: '', from: '', to: '' })
  const users = useQuery<ContactUser>('users', () => [where('role', '==', 'customer'), ...(f.status ? [where('status', '==', f.status)] : []), orderBy('createdAt', 'desc'), limit(1000)], [f.status])
  const meta = useQuery<Meta>('contactMeta', () => [limit(5000)], [])
  const fin = useQuery<{ totalPaidPence: number }>(can('finance.view') ? 'contactFinance' : null, () => [limit(5000)], [])
  const staff = useStaff()
  const [found, setFound] = useState<string[] | null>(null)
  const metaBy = useMemo(() => Object.fromEntries(meta.data.map(m => [m.id, m])), [meta.data])
  const paidBy = useMemo(() => Object.fromEntries(fin.data.map(m => [m.id, m.totalPaidPence])), [fin.data])
  const staffName = (id?: string | null) => staff.data.find(s => s.id === id)?.fullName ?? ''
  const tags = [...new Set(meta.data.flatMap(m => m.tags ?? []))].sort()
  const search = async () => {
    const q = f.q.trim(); if (q.length < 2) { setFound(null); return }
    if (/^THOR-|^THR-/i.test(q)) { const j = await getDocs(query(collection(db, 'repairRequests'), where('reference', '==', q.toUpperCase()), limit(1))); setFound(j.docs.map(x => x.data().customerId)); return }
    try { setFound((await api.adminSearchUsers({ q, role: 'customer' })).users.map(u => u.id)) } catch (e) { toast('bad', errMsg(e)) }
  }
  const rows = users.data.filter(u => {
    const m = metaBy[u.id], c = u.contact
    if (found && !found.includes(u.id)) return false
    if (f.source && (c?.source ?? 'app') !== f.source) return false
    if (f.active === 'yes' && !(c?.activeRepairs)) return false
    if (f.active === 'no' && c?.activeRepairs) return false
    if (f.tag && !(m?.tags ?? []).includes(f.tag)) return false
    if (f.assigned && (f.assigned === 'me' ? m?.assignedTo !== user!.uid : f.assigned === 'none' ? m?.assignedTo : m?.assignedTo !== f.assigned)) return false
    if (f.postcode && !(u.postcode ?? '').toUpperCase().startsWith(f.postcode.toUpperCase())) return false
    const joined = u.createdAt?.toDate().getTime() ?? 0
    if (f.from && joined < new Date(f.from).getTime()) return false
    if (f.to && joined > new Date(f.to + 'T23:59:59').getTime()) return false
    return true
  })
  const exportCsv = async () => { try { const r = await api.exportContacts({ status: f.status || undefined, source: f.source || undefined, tag: f.tag || undefined, assignedTo: f.assigned && !['me', 'none'].includes(f.assigned) ? f.assigned : undefined }); downloadCsv('thor-contacts.csv', r.rows); toast('ok', `${r.rows.length} contacts exported (recorded in the audit log).`) } catch (e) { toast('bad', errMsg(e)) } }
  return (
    <Gate perm="customers.manage"><div><PageHeader title="Contacts" sub="Every customer, where they came from and how their repairs are going." action={<ExportButton onClick={exportCsv} />} />
      <form onSubmit={e => { e.preventDefault(); search() }} className="mb-3 flex items-end gap-2"><div className="flex-1"><Input label="Search" placeholder="Name, email, phone or THOR reference" value={f.q} onChange={e => { setF({ ...f, q: e.target.value }); if (!e.target.value) setFound(null) }} /></div><Button type="submit" variant="soft">Search</Button></form>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Select label="Status" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deleted">Deleted</option></Select>
        <Select label="Source" value={f.source} onChange={e => setF({ ...f, source: e.target.value })}><option value="">All</option>{SOURCES.map(s => <option key={s} value={s}>{s}</option>)}</Select>
        <Select label="Active repair" value={f.active} onChange={e => setF({ ...f, active: e.target.value })}><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option></Select>
        <Select label="Tag" value={f.tag} onChange={e => setF({ ...f, tag: e.target.value })}><option value="">Any</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</Select>
        <Select label="Assigned to" value={f.assigned} onChange={e => setF({ ...f, assigned: e.target.value })}><option value="">Anyone</option><option value="me">Me</option><option value="none">Unassigned</option>{staff.data.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select>
        <Input label="Postcode starts" value={f.postcode} onChange={e => setF({ ...f, postcode: e.target.value })} />
        <Input label="Joined from" type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /><Input label="Joined to" type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></div>
      {users.loading ? <ListSkeleton /> : rows.length === 0 ? <EmptyState icon={Contact} title="No contacts found" body="Try different filters." /> :
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[72rem] text-sm"><thead className="text-left text-thor-text"><tr>{['Name', 'Email', 'Phone', 'Postcode', 'Source', 'Joined', 'Repairs', 'Active', 'Last activity', ...(can('finance.view') ? ['Total paid'] : []), 'Marketing', 'Status', 'Tags', 'Assigned'].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-ink/8">{rows.map(u => { const m = metaBy[u.id]; return <tr key={u.id} onClick={() => nav(`/admin/contacts/${u.id}`)} className="cursor-pointer hover:bg-paper">
            <td className="p-3 font-medium">{u.fullName}</td><td className="max-w-48 truncate p-3">{u.email}</td><td className="p-3 whitespace-nowrap">{u.phone || '—'}</td><td className="p-3">{u.postcode || '—'}</td>
            <td className="p-3"><Badge tone="info">{u.contact?.source ?? 'app'}</Badge></td><td className="p-3 whitespace-nowrap">{d(u.createdAt)}</td><td className="p-3">{u.contact?.totalRepairs ?? 0}</td>
            <td className="p-3">{u.contact?.activeRepairs ? <Badge tone="warn">{u.contact.activeRepairs}</Badge> : 0}</td><td className="p-3 whitespace-nowrap">{d(u.contact?.lastActivityAt)}</td>
            {can('finance.view') && <td className="p-3">{poundsStr(paidBy[u.id] ?? 0)}</td>}<td className="p-3">{u.privacy?.marketingEmails ? 'Yes' : 'No'}</td>
            <td className="p-3"><Badge tone={u.status === 'active' ? 'ok' : 'bad'}>{u.status}</Badge></td><td className="p-3">{(m?.tags ?? []).map(t => <Badge key={t} tone="neutral">{t}</Badge>)}</td><td className="p-3 whitespace-nowrap">{staffName(m?.assignedTo)}</td></tr> })}</tbody></table></div>}
      {users.data.length === 1000 && <p className="mt-2 text-xs text-thor-text">Filters apply to the 1,000 most recent customers. Use search to find older ones; the CSV export includes everyone.</p>}
    </div></Gate>)
}

interface Task { userId: string; title: string; dueAt: { toDate(): Date }; ownerId: string; status: 'open' | 'done' }
interface Note { authorId: string; text: string; jobId: string | null; createdAt?: TS; edited?: boolean }
export function ContactDetail() {
  const { id } = useParams(); const toast = useToast(); const nav = useNavigate(); const can = useCan(); const { user } = useAuth()
  const u = useDoc<ContactUser>(`users/${id}`), meta = useDoc<Meta>(`contactMeta/${id}`), fin = useDoc<{ totalPaidPence: number }>(can('finance.view') ? `contactFinance/${id}` : null)
  const jobs = useQuery<{ reference: string; status: JobStatus; quoteCount: number; agreedTotalPence?: number; device: { manufacturer: string; model: string }; createdAt?: TS; customerId: string; statusHistory?: { status: string; at: TS }[]; messageCount?: number; lastMessageAt?: TS }>(can('jobs.view') || can('jobs.manage') ? 'repairRequests' : null, () => [where('customerId', '==', id), orderBy('createdAt', 'desc'), limit(50)], [id])
  const apts = useQuery<{ reference: string; status: string; startAt: { toDate(): Date } }>(can('jobs.view') || can('jobs.manage') ? 'appointments' : null, () => [where('customerId', '==', id), orderBy('startAt', 'desc'), limit(20)], [id])
  const pays = useQuery<{ reference: string; amountPence: number; status: string; kind: string; createdAt?: TS }>(can('finance.view') || can('jobs.manage') ? 'payments' : null, () => [where('customerId', '==', id), orderBy('createdAt', 'desc'), limit(30)], [id])
  const disputes = useQuery<{ reference: string; status: string }>(can('disputes.manage') ? 'disputes' : null, () => [where('customerId', '==', id), limit(20)], [id])
  const tickets = useQuery<{ subject: string; status: string }>(can('support.handle') ? 'supportTickets' : null, () => [where('userId', '==', id), orderBy('lastMessageAt', 'desc'), limit(20)], [id])
  const reviews = useQuery<{ reference: string; rating: number; status: string }>(can('reviews.moderate') ? 'reviews' : null, () => [where('authorId', '==', id), orderBy('createdAt', 'desc'), limit(20)], [id])
  const leads = useQuery<{ status: string; platform: string; campaignId: string | null }>(can('leads.manage') ? 'metaLeads' : null, () => [where('customerId', '==', id), limit(5)], [id])
  const notes = useQuery<Note>(`users/${id}/contactNotes`, () => [orderBy('createdAt', 'desc'), limit(100)], [id])
  const tasks = useQuery<Task>('contactTasks', () => [where('userId', '==', id), orderBy('dueAt', 'asc'), limit(50)], [id])
  const staff = useStaff()
  const [note, setNote] = useState(''); const [noteJob, setNoteJob] = useState(''); const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [tagText, setTagText] = useState<string | null>(null); const [task, setTask] = useState({ title: '', due: '', owner: '' }); const [busy, setBusy] = useState(''); const [open, setOpen] = useState<string | null>(null)
  const run = async (k: string, f: () => Promise<unknown>, ok: string) => { setBusy(k); try { await f(); toast('ok', ok); return true } catch (e) { toast('bad', errMsg(e)); return false } finally { setBusy('') } }
  if (u.loading) return <ListSkeleton rows={2} />
  if (!u.data) return <EmptyState icon={Contact} title="Contact not found" body="It may have been deleted." />
  const x = u.data, staffName = (sid?: string | null) => staff.data.find(s => s.id === sid)?.fullName ?? (sid === user!.uid ? 'You' : 'Staff')
  const now = Date.now()
  return (
    <Gate perm="customers.manage"><div className="max-w-5xl">
      <button onClick={() => nav('/admin/contacts')} className="mb-3 flex items-center gap-1 text-sm text-thor-blue"><ArrowLeft className="size-4" />All contacts</button>
      <div className="flex flex-wrap items-center gap-3"><h1 className="font-display text-3xl">{x.fullName}</h1><Badge tone={x.status === 'active' ? 'ok' : 'bad'}>{x.status}</Badge><Badge tone="info">{x.contact?.source ?? 'app'}</Badge>{x.privacy?.marketingEmails && <Badge tone="ok">Marketing consent</Badge>}</div>
      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          <Section title="Repairs">{jobs.data.length === 0 ? <p className="text-sm text-thor-text">{can('jobs.view') || can('jobs.manage') ? 'No repairs yet.' : 'Your role cannot view repairs.'}</p> :
            <ul className="space-y-2">{jobs.data.map(j => <li key={j.id} className="surface p-4"><button onClick={() => setOpen(open === j.id ? null : j.id)} className="flex w-full flex-wrap items-center gap-3 text-left"><span className="min-w-0 flex-1"><b>{j.reference}</b> <span className="text-sm text-thor-text">{j.device.manufacturer} {j.device.model} · {d(j.createdAt)}</span></span>{j.agreedTotalPence ? <span className="text-sm">{gbp(j.agreedTotalPence)}</span> : null}<StatusPill status={j.status} quoteCount={j.quoteCount} /></button>
              {open === j.id && <div className="mt-4 border-t border-ink/8 pt-4"><JobTimeline jobId={j.id} job={j} audience="admin" /></div>}</li>)}</ul>}</Section>
          <Section title="Staff notes" action={<span className="text-xs text-thor-text">Never visible to the customer or engineers</span>}>
            <div className="space-y-2"><Textarea label="Add a note" value={note} onChange={e => setNote(e.target.value)} maxLength={4000} className="min-h-20" />
              <div className="flex flex-wrap items-end gap-2"><div className="w-56"><Select label="About repair (optional)" value={noteJob} onChange={e => setNoteJob(e.target.value)}><option value="">General</option>{jobs.data.map(j => <option key={j.id} value={j.id}>{j.reference}</option>)}</Select></div>
                <Button loading={busy === 'note'} disabled={note.trim().length < 2} onClick={async () => { if (await run('note', () => api.addContactNote({ userId: id!, text: note.trim(), jobId: noteJob || undefined }), 'Note added.')) { setNote(''); setNoteJob('') } }}><NotebookPen className="size-4" />Add note</Button></div></div>
            <ul className="mt-4 space-y-2">{notes.data.map(n => <li key={n.id} className="rounded-xl bg-warn/5 p-3 text-sm ring-1 ring-warn/20"><p className="mb-1 text-xs text-thor-text">{staffName(n.authorId)} · {n.createdAt?.toDate().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}{n.edited ? ' · edited' : ''}{n.jobId ? ` · ${jobs.data.find(j => j.id === n.jobId)?.reference ?? 'repair'}` : ''}</p>
              {editing?.id === n.id ? <><Textarea label="Edit note" value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} /><div className="mt-2 flex gap-2"><Button size="sm" loading={busy === 'edit'} onClick={async () => { if (await run('edit', () => api.editContactNote({ userId: id!, noteId: n.id, text: editing.text.trim() }), 'Note updated.')) setEditing(null) }}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div></>
                : <><p className="whitespace-pre-wrap">{n.text}</p>{n.authorId === user!.uid && <button className="mt-1 text-xs text-thor-blue hover:underline" onClick={() => setEditing({ id: n.id, text: n.text })}>Edit</button>}</>}</li>)}</ul></Section>
        </div>
        <aside className="space-y-5">
          <div className="surface space-y-2 p-4 text-sm"><p><span className="text-thor-text">Email</span><br /><span className="break-all">{x.email}</span></p><p><span className="text-thor-text">Phone</span><br />{x.phone || '—'}</p><p><span className="text-thor-text">Postcode</span><br />{x.postcode || '—'}</p>
            <p><span className="text-thor-text">Joined</span> {d(x.createdAt)} · <span className="text-thor-text">Last activity</span> {d(x.contact?.lastActivityAt)}</p>
            <p>{x.contact?.totalRepairs ?? 0} repairs · {x.contact?.activeRepairs ?? 0} active{fin.data ? ` · ${poundsStr(fin.data.totalPaidPence)} paid` : ''}</p></div>
          <div className="surface space-y-3 p-4 text-sm">
            <Select label="Assigned staff member" value={meta.data?.assignedTo ?? ''} onChange={e => run('assign', () => api.updateContact({ userId: id!, assignedTo: e.target.value || null }), 'Assignment saved.')}><option value="">Unassigned</option>{staff.data.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select>
            <div><p className="mb-1 flex items-center gap-1.5 font-medium"><Tag className="size-4" />Tags</p><div className="flex flex-wrap gap-1.5">{(meta.data?.tags ?? []).map(t => <Badge key={t} tone="neutral">{t}</Badge>)}</div>
              {tagText === null ? <button className="mt-2 text-xs text-thor-blue hover:underline" onClick={() => setTagText((meta.data?.tags ?? []).join(', '))}>Edit tags</button> :
                <div className="mt-2 flex gap-2"><Input label="" aria-label="Tags" placeholder="vip, business" value={tagText} onChange={e => setTagText(e.target.value)} /><Button size="sm" className="self-start" onClick={async () => { if (await run('tags', () => api.updateContact({ userId: id!, tags: tagText.split(',').map(t => t.trim()).filter(Boolean) }), 'Tags saved.')) setTagText(null) }}>Save</Button></div>}</div></div>
          <div className="surface p-4 text-sm"><p className="mb-2 font-medium">Follow-up tasks</p>
            <ul className="space-y-2">{tasks.data.map(t => { const overdue = t.status === 'open' && t.dueAt.toDate().getTime() < now; return <li key={t.id} className={cx('flex items-start gap-2 rounded-lg p-2', overdue ? 'bg-bad/10' : 'bg-paper')}>
              <button aria-label={t.status === 'done' ? 'Reopen task' : 'Mark done'} onClick={() => run(`t${t.id}`, () => api.upsertContactTask({ taskId: t.id, userId: id!, title: t.title, dueAt: t.dueAt.toDate().toISOString(), ownerId: t.ownerId, status: t.status === 'done' ? 'open' : 'done' }), 'Task updated.')}><CheckCircle2 className={cx('size-5', t.status === 'done' ? 'text-ok' : 'text-ink/25')} /></button>
              <span className={cx('flex-1', t.status === 'done' && 'line-through text-thor-text')}>{t.title}<span className="block text-xs text-thor-text">{staffName(t.ownerId)} · due {t.dueAt.toDate().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}{overdue ? ' · OVERDUE' : ''}</span></span></li> })}</ul>
            <div className="mt-3 space-y-2"><Input label="New task" value={task.title} onChange={e => setTask({ ...task, title: e.target.value })} /><Input label="Due" type="datetime-local" value={task.due} onChange={e => setTask({ ...task, due: e.target.value })} />
              <Select label="Owner" value={task.owner || user!.uid} onChange={e => setTask({ ...task, owner: e.target.value })}>{staff.data.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select>
              <Button size="sm" loading={busy === 'task'} disabled={task.title.trim().length < 3 || !task.due} onClick={async () => { if (await run('task', () => api.upsertContactTask({ userId: id!, title: task.title.trim(), dueAt: new Date(task.due).toISOString(), ownerId: task.owner || user!.uid }), 'Task added.')) setTask({ title: '', due: '', owner: '' }) }}><Plus className="size-4" />Add task</Button></div></div>
          <Mini title="Appointments" rows={apts.data.map(a => `${a.reference} · ${a.startAt.toDate().toLocaleDateString('en-GB')} · ${a.status}`)} />
          {(can('finance.view') || can('jobs.manage')) && <Mini title="Payments" rows={pays.data.map(p => `${p.reference} · ${p.kind} ${gbp(p.amountPence)} · ${p.status.replace('_', ' ')}`)} />}
          {can('disputes.manage') && <Mini title="Disputes" rows={disputes.data.map(x2 => `${x2.reference} · ${x2.status}`)} link="/admin/disputes" />}
          {can('support.handle') && <Mini title="Support tickets" rows={tickets.data.map(t => `${t.subject} · ${t.status}`)} link="/admin/support" />}
          {can('reviews.moderate') && <Mini title="Reviews written" rows={reviews.data.map(r => `${r.reference} · ${r.rating}★ · ${r.status}`)} />}
          {leads.data.length > 0 && <div className="surface p-4 text-sm"><p className="mb-2 font-medium">Originating Meta lead</p>{leads.data.map(l => <Link key={l.id} to={`/admin/leads/${l.id}`} className="flex items-center justify-between gap-2 text-thor-blue hover:underline">{l.platform} lead<LeadStatus s={l.status} /></Link>)}</div>}
        </aside>
      </div>
    </div></Gate>)
}
function Mini({ title, rows, link }: { title: string; rows: string[]; link?: string }) {
  return <div className="surface p-4 text-sm"><p className="mb-2 flex justify-between font-medium">{title} <span className="text-xs text-thor-text">{rows.length}</span></p>{rows.length === 0 ? <p className="text-xs text-thor-text">None.</p> : <ul className="space-y-1 text-xs">{rows.slice(0, 8).map((r, i) => <li key={i}>{r}</li>)}</ul>}{link && rows.length > 0 && <Link to={link} className="mt-2 block text-xs text-thor-blue">Open</Link>}</div>
}
