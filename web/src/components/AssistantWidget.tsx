import { FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, LifeBuoy, Send, Sparkles, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc } from '@/hooks/useFirestore'
import { api, errMsg, AssistantDraft } from '@/lib/api'
import { Button, Logo, Sheet, cx, useToast } from './ui'

interface Turn { role: 'user' | 'assistant'; text: string }
const KEY = 'thor.assistant.turns'

/** Thor Computer assistant. It can only suggest a draft; the customer reviews and submits it through the normal request form. */
export default function AssistantWidget() {
  const { role } = useAuth(); const nav = useNavigate(); const toast = useToast()
  const cfg = useDoc<{ assistant?: { enabled: boolean; welcome: string } }>('platformSettings/public')
  const [open, setOpen] = useState(false); const [text, setText] = useState(''); const [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') } catch { return [] } })
  const [draft, setDraft] = useState<AssistantDraft | null>(null); const [ready, setReady] = useState(false); const [escalate, setEscalate] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-30))) } catch { /* ignore */ } list.current?.scrollTo({ top: list.current.scrollHeight }) }, [turns])
  const a = cfg.data?.assistant
  if (!a?.enabled || role !== 'customer') return null

  const send = async (e?: FormEvent) => {
    e?.preventDefault(); const t = text.trim(); if (!t || busy) return
    const next = [...turns, { role: 'user' as const, text: t.slice(0, 1000) }]; setTurns(next); setText(''); setBusy(true)
    try {
      const r = await api.assistantChat({ messages: next })
      setTurns([...next, { role: 'assistant', text: r.reply }])
      if (r.draft) setDraft(d => ({ ...d, ...Object.fromEntries(Object.entries(r.draft!).filter(([, v]) => v)) }))
      setReady(r.readyToSubmit); setEscalate(x => x || r.escalate)
    } catch (x) { toast('bad', errMsg(x)); setTurns(next) } finally { setBusy(false) }
  }
  const review = () => {
    const d = draft ?? {}
    try { sessionStorage.setItem('thor.request.draft', JSON.stringify({ device: d.deviceType ?? '', manufacturer: d.manufacturer ?? '', model: d.model ?? '', description: d.problem ?? '', postcode: d.postcode ?? '', methods: d.serviceMethod ? [d.serviceMethod] : [], urgency: d.urgency ?? 'flexible', issues: [], os: '', serial: '', startedAt: '', addressLine: '', accessNotes: '', dates: [] })) } catch { /* ignore */ }
    setOpen(false); nav('/customer/new-request?from=assistant')
  }
  const human = async () => {
    setBusy(true)
    try { const r = await api.createSupportTicket({ subject: 'Help from the assistant', message: turns.filter(t => t.role === 'user').map(t => t.text).join('\n').slice(0, 3900) || 'I would like to speak to someone.', category: 'other', transcript: turns.slice(-30) }); setOpen(false); nav(`/support/${r.ticketId}`) }
    catch (x) { toast('bad', errMsg(x)) } finally { setBusy(false) }
  }
  return (<>
    <button onClick={() => setOpen(true)} aria-label="Open the Thor Computer assistant" className="fixed bottom-24 right-4 z-40 grid size-14 place-items-center rounded-full bg-thor-blue text-white shadow-xl ring-4 ring-white transition hover:bg-thor-blue-700 md:bottom-6 md:right-6"><Bot className="size-6" /></button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Thor Computer assistant">
      <div className="flex h-[60dvh] flex-col">
        <div ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-3" aria-live="polite">
          <div className="flex gap-2"><Logo className="h-8 w-14 shrink-0" /><p className="rounded-2xl rounded-tl-md bg-paper px-3.5 py-2 text-sm">{a.welcome}</p></div>
          {turns.map((t, i) => <div key={i} className={cx('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}><p className={cx('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm', t.role === 'user' ? 'rounded-br-md bg-thor-blue text-white' : 'rounded-bl-md bg-paper')}>{t.text}</p></div>)}
          {busy && <p className="text-xs text-thor-text">Thinking…</p>}
        </div>
        {(ready || draft) && <div className="mb-2 rounded-2xl bg-thor-sky/20 p-3 text-sm"><p className="flex items-center gap-1.5 font-medium text-thor-blue-700"><Sparkles className="size-4" />Draft repair request</p>
          <p className="mt-1 text-xs text-thor-slate">{[draft?.deviceType?.replace('_', ' '), draft?.manufacturer, draft?.model, draft?.postcode].filter(Boolean).join(' · ') || 'Keep chatting to fill in the details.'}</p>
          {ready && <Button size="sm" variant="cta" className="mt-2" onClick={review}>Review and submit</Button>}</div>}
        <form onSubmit={send} className="flex items-end gap-2 border-t border-ink/10 pt-3">
          <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} rows={1} maxLength={1000} aria-label="Message the assistant" placeholder="e.g. My laptop keeps switching off" className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-ink/15 bg-white px-4 py-2.5 text-sm focus:border-thor-blue focus:outline-none" />
          <Button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="size-11 !px-0"><Send className="size-5" /></Button></form>
        <div className="mt-2 flex items-center justify-between text-xs text-thor-text"><span>AI answers can be wrong. It can’t see prices or book for you.</span>
          <button onClick={human} disabled={busy} className={cx('flex items-center gap-1 font-medium', escalate ? 'text-thor-orange-600' : 'text-thor-blue')}><LifeBuoy className="size-3.5" />Talk to a person</button></div>
        <button onClick={() => { setTurns([]); setDraft(null); setReady(false) }} className="mt-1 flex items-center gap-1 self-start text-xs text-thor-text hover:underline"><X className="size-3" />Clear conversation</button>
      </div>
    </Sheet></>)
}
