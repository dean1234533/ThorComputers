import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Send, X, LifeBuoy, RotateCcw } from 'lucide-react'
import { useDoc } from '@/hooks/useFirestore'
import { api, errMsg, QuickReply, ChatReply } from '@/lib/api'
import { Button, cx } from '@/components/ui'

interface Msg { role: 'user' | 'bot'; text: string; source?: ChatReply['source'] }
interface PublicSettings { ai?: { enabled: boolean; welcome: string; escalation: string }; support?: { email: string; phone: string; hours: string } }
const TOPICS: QuickReply[] = [{ label: 'Request a repair', value: 'faq:start_repair' }, { label: 'Prices', value: 'faq:prices' }, { label: 'Quotations', value: 'faq:quotations' }, { label: 'Booking', value: 'faq:booking' }, { label: 'Payments', value: 'faq:payments_how' }, { label: 'Contact support', value: 'faq:contact_support' }]

/** Guided assistant. Almost everything is answered by deterministic rules on the server; the AI is only a last resort there. Submitting a repair always happens on the normal request form, after the customer reviews it. */
export default function ChatWidget() {
  const nav = useNavigate(); const ps = useDoc<PublicSettings>('platformSettings/public')
  const [open, setOpen] = useState(false), [msgs, setMsgs] = useState<Msg[]>([]), [quick, setQuick] = useState<QuickReply[]>(TOPICS), [text, setText] = useState(''), [busy, setBusy] = useState(false), [slow, setSlow] = useState(false)
  const [draft, setDraft] = useState<ChatReply['draft']>(null), [escalate, setEscalate] = useState(false), [err, setErr] = useState(''), [last, setLast] = useState<{ text: string; label: string } | null>(null)
  const state = useRef<unknown>({}); const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy, open, quick, err])
  useEffect(() => { if (!busy) { setSlow(false); return } const t = setTimeout(() => setSlow(true), 6000); return () => clearTimeout(t) }, [busy])
  const ai = ps.data?.ai; if (ai && !ai.enabled) return null
  const support = ps.data?.support

  const send = async (value: string, label = value) => {
    const v = value.trim(); if (!v || busy) return
    setMsgs(m => [...m, { role: 'user', text: label }]); setText(''); setBusy(true); setErr(''); setLast({ text: v, label }); setQuick([])
    try {
      const r = await api.chatbotMessage({ text: v, state: state.current })
      state.current = r.state; setMsgs(m => [...m, { role: 'bot', text: r.reply, source: r.source }]); setQuick(r.quickReplies); setDraft(r.ready ? r.draft : null); if (r.escalate) setEscalate(true)
      if (r.openForm && r.draft) { setOpen(false); nav('/customer/new-request', { state: { prefill: r.draft } }) }
    } catch (e) { setErr(errMsg(e)); setQuick(TOPICS); setEscalate(true) } finally { setBusy(false) }
  }
  const restart = () => { state.current = {}; setMsgs([]); setQuick(TOPICS); setDraft(null); setEscalate(false); setErr(''); setLast(null) }
  const review = () => { if (draft) { setOpen(false); nav('/customer/new-request', { state: { prefill: draft } }) } }

  return (
    <>
      <button onClick={() => setOpen(o => !o)} aria-label={open ? 'Close assistant' : 'Open assistant'} aria-expanded={open}
        className="fixed bottom-24 right-4 z-40 grid size-14 place-items-center rounded-full bg-thor-blue text-white shadow-lg transition hover:scale-105 md:bottom-6">{open ? <X className="size-6" /> : <Bot className="size-6" />}</button>
      {open && <div role="dialog" aria-label="Thor Computer assistant" className="fixed inset-x-3 bottom-40 z-40 flex max-h-[72dvh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-ink/10 md:inset-x-auto md:bottom-24 md:right-6 md:w-[26rem]">
        <div className="flex items-center gap-2 bg-thor-blue px-4 py-3 text-white"><Bot className="size-5" /><p className="flex-1 font-display text-lg">Thor assistant</p>
          <button onClick={restart} aria-label="Start over" title="Start over" className="rounded-full p-1.5 hover:bg-white/15"><RotateCcw className="size-4" /></button></div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
          <p className="rounded-2xl bg-paper p-3">{ai?.welcome ?? 'Hi, I’m the Thor Computer assistant. What can I help with?'}</p>
          {msgs.map((m, i) => <p key={i} className={cx('max-w-[88%] whitespace-pre-line rounded-2xl p-3', m.role === 'user' ? 'ml-auto bg-thor-blue text-white' : 'bg-paper')}>{m.text}</p>)}
          {busy && <p className="flex items-center gap-2 rounded-2xl bg-paper p-3 text-thor-text" role="status"><span className="size-2 animate-pulse rounded-full bg-thor-blue" />{slow ? 'Still working on it… you can wait a few more seconds or start over.' : 'Working on it…'}</p>}
          {draft && <div className="rounded-2xl border border-thor-blue/30 bg-thor-sky/10 p-3"><p className="mb-1 font-medium">Your repair request is ready to review</p><p className="text-xs text-thor-text">Nothing is sent until you check the form and press Submit.</p><Button size="sm" className="mt-2" onClick={review}>Review & submit</Button></div>}
          {err && <div role="alert" className="rounded-2xl border border-bad/30 bg-bad/10 p-3 text-bad"><p className="font-medium">That didn’t work</p><p>{err}</p>{last && <button className="mt-2 font-medium underline" onClick={() => send(last.text, last.label)}>Try again</button>}</div>}
          {escalate && <div className="rounded-2xl bg-warn/10 p-3"><p className="flex items-center gap-1.5 font-medium"><LifeBuoy className="size-4" />Talk to a person</p>
            {support?.email && <p>Email <a className="text-thor-blue underline" href={`mailto:${support.email}`}>{support.email}</a></p>}{support?.phone && <p>Call <a className="text-thor-blue underline" href={`tel:${support.phone.replace(/\s+/g, '')}`}>{support.phone}</a></p>}{support?.hours && <p className="text-xs text-thor-text">{support.hours}</p>}
            {!support?.email && !support?.phone && <p>{ai?.escalation || 'Please contact Thor Computer using the details on thorcomputer.com.'}</p>}</div>}
          {quick.length > 0 && !busy && <div className="flex flex-wrap gap-2" aria-label="Suggested replies">{quick.map(q => <button key={q.value + q.label} onClick={() => send(q.value, q.label)} className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-thor-blue ring-1 ring-thor-blue/30 hover:bg-thor-sky/10">{q.label}</button>)}</div>}
          <div ref={end} /></div>
        <form className="flex gap-2 border-t border-ink/10 p-3" onSubmit={e => { e.preventDefault(); void send(text) }}>
          <input aria-label="Message" className="min-w-0 flex-1 rounded-xl border border-ink/15 px-3 py-2" placeholder="Type a question…" maxLength={500} value={text} onChange={e => setText(e.target.value)} />
          <Button type="submit" aria-label="Send" disabled={busy || !text.trim()}><Send className="size-4" /></Button></form>
        <p className="px-4 pb-3 text-[11px] text-thor-text">Automated assistant. Don’t share passwords or card numbers. Conversations aren’t stored.</p>
      </div>}
    </>)
}
