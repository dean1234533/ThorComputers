import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { addDoc, arrayUnion, collection, doc, limit, orderBy, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { ArrowLeft, Check, CheckCheck, Flag, ImagePlus, Send, MessageSquare } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { useEngineers } from '@/hooks/useEngineers'
import { rid, uploadImage } from '@/lib/images'
import { Avatar, Button, EmptyState, ListSkeleton, PageHeader, Sheet, Textarea, useToast, cx } from '@/components/ui'
import { StorageImg } from '@/components/StorageImg'
import { engName } from '@/components/QuoteCompare'

interface Conv { jobId: string; participants: string[]; customerId: string; engineerId: string; lastMessage: string | null; lastMessageAt?: { toDate(): Date }; unread?: Record<string, number>; closed?: boolean }
interface Msg { senderId: string; text: string; imagePath?: string; createdAt?: { toDate(): Date }; readBy: string[] }
const when = (d?: Date) => d ? (Date.now() - d.getTime() < 86400_000 ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : ''

function useCounterpart(c?: Conv | null) {
  const { user } = useAuth()
  const eng = useEngineers(c && user?.uid === c.customerId ? [c.engineerId] : [])
  const job = useDoc<{ reference: string; device: { manufacturer: string; model: string } }>(c ? `repairRequests/${c.jobId}` : null)
  const isCust = c && user?.uid === c.customerId
  return { name: isCust ? engName(eng[c!.engineerId]) : `Customer · ${job.data?.reference ?? ''}`, photo: isCust ? eng[c!.engineerId]?.photoURL : null, sub: job.data ? `${job.data.reference} · ${job.data.device.manufacturer} ${job.data.device.model}` : '' }
}

function Row({ c }: { c: Conv & { id: string } }) {
  const { user } = useAuth(); const p = useCounterpart(c); const unread = c.unread?.[user!.uid] ?? 0
  return (
    <li><Link to={`/messages/${c.id}`} className="flex items-center gap-3.5 surface p-5">
      <Avatar src={p.photo} name={p.name} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className={cx('truncate', unread ? 'font-bold' : 'font-medium')}>{p.name}</p><span className="shrink-0 text-xs text-thor-text">{when(c.lastMessageAt?.toDate())}</span></div>
        <p className={cx('truncate text-sm', unread ? 'font-medium text-ink' : 'text-thor-text')}>{c.lastMessage ?? p.sub}</p></div>
      {unread > 0 && <span className="grid min-w-6 place-items-center rounded-full bg-thor-orange px-1.5 text-xs font-bold leading-6">{unread}</span>}</Link></li>)
}

export default function Messages() {
  const { cid } = useParams(); const { user } = useAuth()
  const convs = useQuery<Conv>('conversations', () => [where('participants', 'array-contains', user!.uid), orderBy('lastMessageAt', 'desc'), limit(50)], [user?.uid])
  return (
    <div className="md:grid md:grid-cols-[20rem_1fr] md:gap-6">
      <div className={cx(cid && 'hidden md:block')}><PageHeader title="Messages" />
        {convs.loading ? <ListSkeleton /> : convs.data.length === 0 ? <EmptyState icon={MessageSquare} title="No conversations yet" body="Messages about your repairs appear here once a quote has been sent." /> : <ul className="space-y-2">{convs.data.map(c => <Row key={c.id} c={c} />)}</ul>}</div>
      <div className={cx(!cid && 'hidden md:block')}>{cid ? <Thread cid={cid} /> : <EmptyState icon={MessageSquare} title="Select a conversation" body="Pick a chat on the left." />}</div>
    </div>)
}

function Thread({ cid }: { cid: string }) {
  const { user } = useAuth(); const nav = useNavigate(); const toast = useToast()
  const { data: conv, loading } = useDoc<Conv>(`conversations/${cid}`)
  const msgs = useQuery<Msg>(`conversations/${cid}/messages`, () => [orderBy('createdAt', 'desc'), limit(60)], [cid])
  const p = useCounterpart(conv)
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [report, setReport] = useState<string | null>(null); const [why, setWhy] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const list = [...msgs.data].reverse()

  // Mark as read: only touch the docs that actually need it, to avoid needless writes.
  useEffect(() => {
    if (!user || !conv) return
    const unread = msgs.data.filter(m => m.senderId !== user.uid && !m.readBy.includes(user.uid))
    if (unread.length === 0 && !(conv.unread?.[user.uid])) return
    const b = writeBatch(db); unread.forEach(m => b.update(doc(db, `conversations/${cid}/messages/${m.id}`), { readBy: arrayUnion(user.uid) })); b.update(doc(db, 'conversations', cid), { [`unread.${user.uid}`]: 0 }); b.commit().catch(() => {})
  }, [msgs.data, conv, user, cid])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [list.length])

  const send = async (e?: FormEvent, imagePath?: string) => {
    e?.preventDefault(); const t = text.trim(); if (!t && !imagePath) return
    setBusy(true)
    try { await addDoc(collection(db, `conversations/${cid}/messages`), { senderId: user!.uid, text: t, ...(imagePath ? { imagePath } : {}), createdAt: serverTimestamp(), readBy: [user!.uid] }); setText('') }
    catch { toast('bad', 'Message not sent. Check your connection.') } finally { setBusy(false) }
  }
  const attach = async (f?: File) => { if (!f) return; setBusy(true); try { await send(undefined, await uploadImage(`chat/${cid}/${rid()}.jpg`, f)) } catch { toast('bad', 'Could not upload image.') } finally { setBusy(false) } }
  const sendReport = async () => { try { await addDoc(collection(db, 'reports'), { reporterId: user!.uid, targetType: 'message', targetId: report, conversationId: cid, reason: why.trim(), status: 'open', createdAt: serverTimestamp() }); toast('ok', 'Reported. Our team will review it.'); setReport(null); setWhy('') } catch { toast('bad', 'Could not send report.') } }

  if (loading) return <ListSkeleton rows={2} />
  if (!conv) return <EmptyState icon={MessageSquare} title="Conversation unavailable" body="You may not have access to this chat." />
  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col md:h-[calc(100dvh-7rem)]">
      <header className="flex items-center gap-3 border-b border-ink/10 pb-3"><button onClick={() => nav('/messages')} aria-label="Back" className="rounded-full p-2 hover:bg-ink/5 md:hidden"><ArrowLeft className="size-5" /></button><Avatar src={p.photo} name={p.name} size={40} /><div className="min-w-0"><p className="truncate font-medium">{p.name}</p><p className="truncate text-xs text-thor-text">{p.sub}</p></div></header>
      <div className="flex-1 space-y-2 overflow-y-auto py-4" aria-live="polite">
        {list.map(m => { const mine = m.senderId === user!.uid; return (
          <div key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
            <div className={cx('group max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px]', mine ? 'rounded-br-md bg-thor-blue text-white' : 'rounded-bl-md bg-white ring-1 ring-ink/10')}>
              {m.imagePath && <StorageImg path={m.imagePath} className="mb-1.5 max-h-60 rounded-xl" />}{m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
              <p className={cx('mt-0.5 flex items-center justify-end gap-1 text-[11px]', mine ? 'text-white/70' : 'text-thor-text')}>{when(m.createdAt?.toDate())}
                {mine && (m.readBy.length > 1 ? <CheckCheck className="size-3.5 text-thor-cyan" aria-label="Read" /> : <Check className="size-3.5" aria-label="Sent" />)}
                {!mine && <button onClick={() => setReport(m.id)} aria-label="Report message" className="ml-1 opacity-0 transition group-hover:opacity-100 focus:opacity-100"><Flag className="size-3" /></button>}</p></div></div>) })}
        <div ref={end} />
      </div>
      {conv.closed ? <p className="rounded-xl bg-paper p-3 text-center text-sm text-thor-text">This conversation is closed because another engineer was selected.</p> :
        <form onSubmit={send} className="flex items-end gap-2 border-t border-ink/10 pt-3">
          <label className="cursor-pointer rounded-full p-2.5 text-thor-blue hover:bg-thor-blue/10"><ImagePlus className="size-5" /><span className="sr-only">Attach image</span><input type="file" accept="image/*" className="sr-only" onChange={e => attach(e.target.files?.[0])} /></label>
          <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} rows={1} maxLength={2000} placeholder="Write a message…" aria-label="Message" className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-ink/15 bg-white px-4 py-2.5 focus:border-thor-blue focus:outline-none focus:ring-4 focus:ring-thor-sky/30" />
          <Button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="size-11 !px-0"><Send className="size-5" /></Button></form>}
      <Sheet open={!!report} onClose={() => setReport(null)} title="Report this message"><Textarea label="What’s wrong?" value={why} onChange={e => setWhy(e.target.value)} maxLength={1000} /><Button variant="danger" className="mt-4 w-full" disabled={why.trim().length < 5} onClick={sendReport}>Send report</Button></Sheet>
    </div>)
}
