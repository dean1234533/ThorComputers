import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Send, X, LifeBuoy } from 'lucide-react'
import { useDoc } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Button, cx } from '@/components/ui'

interface Msg { role: 'user' | 'assistant'; text: string }
interface Draft { device?: string; manufacturer?: string; model?: string; problem?: string; serviceMethods?: string[]; postcode?: string; urgency?: string }
interface PublicSettings { ai?: { enabled: boolean; welcome: string; escalation: string }; support?: { email: string; phone: string; hours: string } }

/** Customer assistant. It can only talk and suggest a draft: submitting always happens on the normal request form, where the customer reviews and confirms every detail. */
export default function ChatWidget() {
  const nav = useNavigate(); const ps = useDoc<PublicSettings>('platformSettings/public')
  const [open, setOpen] = useState(false), [msgs, setMsgs] = useState<Msg[]>([]), [text, setText] = useState(''), [busy, setBusy] = useState(false), [draft, setDraft] = useState<Draft | null>(null), [escalate, setEscalate] = useState(false), [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy, open])
  const ai = ps.data?.ai; if (ai && !ai.enabled) return null
  const support = ps.data?.support
  const send = async () => {
    const t = text.trim(); if (!t || busy) return
    const next: Msg[] = [...msgs, { role: 'user', text: t }]; setMsgs(next); setText(''); setBusy(true); setErr('')
    try {
      const r = await api.chatbotMessage({ messages: next.slice(-10) })
      setMsgs(m => [...m, { role: 'assistant', text: r.reply }]); setDraft(r.ready ? (r.draft as Draft) : null); if (r.escalate) setEscalate(true)
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  const review = () => { setOpen(false); nav('/customer/new-request', { state: { prefill: draft } }) }
  return (
    <>
      <button onClick={() => setOpen(o => !o)} aria-label={open ? 'Close assistant' : 'Open assistant'} aria-expanded={open}
        className="fixed bottom-24 right-4 z-40 grid size-14 place-items-center rounded-full bg-thor-blue text-white shadow-lg transition hover:scale-105 md:bottom-6">{open ? <X className="size-6" /> : <Bot className="size-6" />}</button>
      {open && <div role="dialog" aria-label="Thor Computer assistant" className="fixed inset-x-3 bottom-40 z-40 flex max-h-[70dvh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-ink/10 md:inset-x-auto md:bottom-24 md:right-6 md:w-96">
        <div className="flex items-center gap-2 bg-thor-blue px-4 py-3 text-white"><Bot className="size-5" /><p className="font-display text-lg">Thor assistant</p></div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
          <p className="rounded-2xl bg-paper p-3">{ai?.welcome ?? 'Hi, I’m the Thor Computer assistant. Tell me what’s wrong with your device.'}</p>
          {msgs.map((m, i) => <p key={i} className={cx('max-w-[85%] whitespace-pre-line rounded-2xl p-3', m.role === 'user' ? 'ml-auto bg-thor-blue text-white' : 'bg-paper')}>{m.text}</p>)}
          {busy && <p className="rounded-2xl bg-paper p-3 text-thor-text">Thinking…</p>}
          {draft && <div className="rounded-2xl border border-thor-blue/30 bg-thor-sky/10 p-3"><p className="mb-1 font-medium">Draft repair request</p>
            <p className="text-thor-text">{[draft.manufacturer, draft.model, draft.device?.replace('_', ' ')].filter(Boolean).join(' ')} · {draft.postcode}</p><p className="mb-2 line-clamp-3">{draft.problem}</p>
            <Button size="sm" onClick={review}>Review & submit</Button><p className="mt-2 text-xs text-thor-text">Nothing is sent until you check and submit the form.</p></div>}
          {(escalate || err) && <div className="rounded-2xl bg-warn/10 p-3">{err && <p className="mb-1 text-bad">{err}</p>}<p className="flex items-center gap-1.5 font-medium"><LifeBuoy className="size-4" />Talk to a person</p>
            <p>{ai?.escalation}</p>{support?.email && <p>Email <a className="text-thor-blue underline" href={`mailto:${support.email}`}>{support.email}</a></p>}{support?.phone && <p>Call {support.phone}</p>}</div>}
          <div ref={end} /></div>
        <form className="flex gap-2 border-t border-ink/10 p-3" onSubmit={e => { e.preventDefault(); void send() }}>
          <input aria-label="Message" className="min-w-0 flex-1 rounded-xl border border-ink/15 px-3 py-2" placeholder="Describe the problem…" maxLength={1000} value={text} onChange={e => setText(e.target.value)} />
          <Button type="submit" aria-label="Send" disabled={busy || !text.trim()}><Send className="size-4" /></Button></form>
        <p className="px-4 pb-3 text-[11px] text-thor-text">AI can make mistakes and can’t give a certain diagnosis or price. Don’t share passwords or card numbers.{support?.email ? '' : ' '}<button className="underline" onClick={() => setEscalate(true)}>Contact a person</button></p>
      </div>}
    </>)
}
