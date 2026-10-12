import { useState } from 'react'
import { orderBy, where } from 'firebase/firestore'
import { Camera, CalendarClock, CreditCard, FileText, MessageSquare, NotebookPen, Activity } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { rid, uploadImage } from '@/lib/images'
import { StorageImg } from './StorageImg'
import { Button, Input, Textarea, useToast, cx } from './ui'
import { gbp, JOB_STATUS_LABEL, JobStatus } from '@/types/domain'

type TS = { toDate(): Date } | undefined
export interface ProgressUpdate { authorId: string; text: string; photoPaths: string[]; percent: number | null; createdAt?: TS }
interface Item { at: number; icon: typeof Activity; title: string; body?: string; photos?: string[]; tone?: 'staff' }
const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })
const ms = (t: TS | unknown) => (t as { toDate?: () => Date })?.toDate?.().getTime() ?? 0

/** One chronological feed per job. Message CONTENT is never shown here (only a count); staff notes appear only for staff. */
export default function JobTimeline({ jobId, job, audience }: { jobId: string; job: { customerId: string; statusHistory?: { status: string; at: TS; note?: string }[]; messageCount?: number; lastMessageAt?: TS }; audience: 'customer' | 'engineer' | 'admin' }) {
  const { user, perms } = useAuth(); const staff = audience === 'admin'
  const progress = useQuery<ProgressUpdate>(`repairRequests/${jobId}/progress`, () => [orderBy('createdAt', 'desc')], [jobId])
  const appt = useDoc<{ startAt: TS; status: string; updatedAt?: TS }>(`appointments/apt_${jobId}`)
  const quotes = useQuery<{ totalPence: number; status: string; createdAt?: TS }>('repairQuotes', () => audience === 'customer' ? [where('jobId', '==', jobId), where('customerId', '==', user!.uid)] : audience === 'engineer' ? [where('jobId', '==', jobId), where('engineerId', '==', user!.uid)] : [where('jobId', '==', jobId)], [jobId, audience])
  const canPay = audience === 'customer' || perms.includes('finance.view') || perms.includes('jobs.manage')
  const pays = useQuery<{ amountPence: number; status: string; kind: string; paidAt?: TS }>(canPay && audience !== 'engineer' ? 'payments' : null, () => audience === 'customer' ? [where('customerId', '==', user!.uid), where('jobId', '==', jobId)] : [where('jobId', '==', jobId)], [jobId, audience])
  const notes = useQuery<{ text: string; authorId: string; createdAt?: TS }>(staff && perms.includes('customers.manage') ? `users/${job.customerId}/contactNotes` : null, () => [where('jobId', '==', jobId)], [jobId, job.customerId])

  const items: Item[] = [
    ...(job.statusHistory ?? []).map(h => ({ at: ms(h.at), icon: Activity, title: h.status === 'payment_confirmed' ? 'Payment confirmed' : JOB_STATUS_LABEL[h.status as JobStatus] ?? h.status, body: staff ? h.note : undefined })),
    ...progress.data.map(p => ({ at: ms(p.createdAt), icon: Camera, title: `Engineer update${p.percent !== null && p.percent !== undefined ? ` · ${p.percent}%` : ''}`, body: p.text, photos: p.photoPaths })),
    ...(audience !== 'customer' ? quotes.data : quotes.data.filter(q => q.status !== 'withdrawn')).map(q => ({ at: ms(q.createdAt), icon: FileText, title: `Quotation ${gbp(q.totalPence)} (${q.status})` })),
    ...pays.data.filter(p => p.paidAt).map(p => ({ at: ms(p.paidAt), icon: CreditCard, title: `Payment ${gbp(p.amountPence)} (${p.kind}, ${p.status.replace('_', ' ')})` })),
    ...(appt.data ? [{ at: ms(appt.data.updatedAt ?? appt.data.startAt), icon: CalendarClock, title: `Appointment ${appt.data.status.replace('_', ' ')}`, body: appt.data.startAt ? `For ${when(ms(appt.data.startAt))} (UK time)` : undefined }] : []),
    ...(job.messageCount ? [{ at: ms(job.lastMessageAt), icon: MessageSquare, title: `${job.messageCount} message${job.messageCount === 1 ? '' : 's'} exchanged`, body: staff ? 'Message content stays private between customer and engineer.' : undefined }] : []),
    ...notes.data.map(n => ({ at: ms(n.createdAt), icon: NotebookPen, title: 'Staff note', body: n.text, tone: 'staff' as const })),
  ].filter(i => i.at).sort((a, b) => b.at - a.at)

  if (!items.length) return <p className="text-sm text-thor-text">No activity yet.</p>
  return (
    <ol className="relative space-y-4 border-l-2 border-ink/10 pl-5">
      {items.map((i, n) => <li key={n} className="relative">
        <span className={cx('absolute -left-[31px] grid size-6 place-items-center rounded-full ring-4 ring-paper', i.tone === 'staff' ? 'bg-warn/20 text-warn' : 'bg-thor-blue/10 text-thor-blue')}><i.icon className="size-3.5" /></span>
        <p className="text-sm font-medium">{i.title}</p><p className="text-xs text-thor-text">{when(i.at)}</p>
        {i.body && <p className="mt-1 whitespace-pre-line text-sm text-thor-slate">{i.body}</p>}
        {i.photos && i.photos.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{i.photos.map(p => <StorageImg key={p} path={p} className="size-20 rounded-xl object-cover" />)}</div>}
      </li>)}
    </ol>)
}

/** Selected engineer posts progress with optional photos; the customer is notified (lock-screen safe). */
export function ProgressForm({ jobId }: { jobId: string }) {
  const toast = useToast(); const [text, setText] = useState(''); const [pct, setPct] = useState(''); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      const photoPaths = await Promise.all(files.slice(0, 4).map(f => uploadImage(`jobs/${jobId}/progress/${rid()}.jpg`, f)))
      await api.postProgressUpdate({ jobId, text: text.trim(), photoPaths, percent: pct === '' ? undefined : Math.max(0, Math.min(100, Number(pct))) })
      setText(''); setPct(''); setFiles([]); toast('ok', 'Update sent to the customer.')
    } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      <Textarea label="What have you done or found?" value={text} onChange={e => setText(e.target.value)} maxLength={1500} className="min-h-20" hint="The customer sees this. Keep it clear and factual." />
      <div className="flex flex-wrap items-end gap-3"><div className="w-36"><Input label="Progress % (optional)" type="number" min={0} max={100} value={pct} onChange={e => setPct(e.target.value)} /></div>
        <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-medium text-thor-blue ring-1 ring-ink/15"><Camera className="size-4" />{files.length ? `${files.length} photo(s)` : 'Add photos'}<input type="file" accept="image/*" multiple className="sr-only" onChange={e => setFiles([...(e.target.files ?? [])].slice(0, 4))} /></label>
        <Button loading={busy} disabled={text.trim().length < 3} onClick={send}>Post update</Button></div>
    </div>)
}
