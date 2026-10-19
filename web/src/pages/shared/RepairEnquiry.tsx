import { FormEvent, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react'
import { api, errMsg } from '@/lib/api'
import { Button, Input, Logo, Select, Textarea } from '@/components/ui'
import { DEVICE_TYPES } from '@/types/domain'

export default function RepairEnquiry() {
  const [qs] = useSearchParams(), submissionId = useRef(crypto.randomUUID())
  const [fields, setFields] = useState({ name: '', email: '', phone: '', postcode: '', device: 'laptop', problem: '', website: '' })
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [next, setNext] = useState('')
  const update = (key: keyof typeof fields, value: string) => setFields(s => ({ ...s, [key]: value }))
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy || !consent) return; setError('')
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(fields.postcode.trim())) { setError('Enter a valid UK postcode, such as E15 1AA.'); return }
    setBusy(true)
    try {
      const tracking = Object.fromEntries(['source', 'medium', 'campaign', 'content', 'term'].map(k => [k, (qs.get(`utm_${k}`) || '').slice(0, 100)]))
      const r = await api.submitWebsiteEnquiry({ ...fields, consent: true, submissionId: submissionId.current, tracking })
      const url = new URL(r.url); setNext(url.pathname + url.search)
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }
  return <div className="min-h-dvh bg-paper"><header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5"><Logo className="h-12" /><Link to="/login" className="text-sm font-semibold text-thor-blue">Sign in</Link></header>
    <main className="mx-auto grid max-w-5xl gap-8 px-5 pb-12 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:pt-10">
      <div className="min-w-0"><p className="text-sm font-semibold text-thor-blue">Thor Computer repair enquiries</p><h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">Let’s get your tech working again.</h1><p className="mt-4 text-thor-text">Tell us what needs fixing. No account needed to send an enquiry.</p>
        <ol className="mt-6 hidden space-y-4 text-sm lg:block">{['Tell us about your device and the problem.', 'Create a free account or sign in to confirm your request.', 'Compare quotations from approved engineers.'].map((s, i) => <li key={s} className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-thor-blue/10 font-bold text-thor-blue">{i + 1}</span><span className="pt-1">{s}</span></li>)}</ol>
        <p className="mt-6 hidden items-start gap-2 text-sm text-thor-text lg:flex"><ShieldCheck className="size-5 shrink-0" />Your enquiry stays private until you confirm a repair request. Submitting this form does not book or charge you.</p>
      </div>
      <section className="surface min-w-0 p-5 sm:p-7" aria-label="Repair enquiry">{next ? <div role="status" className="space-y-4"><CheckCircle2 className="size-10 text-ok" aria-hidden /><h2 className="font-display text-2xl font-bold">Your enquiry is saved</h2><p className="text-thor-text">To receive repair quotations, continue using the same email address. You’ll review your details before anything is sent to engineers.</p><Link to={next} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-thor-blue px-5 py-3 font-semibold text-white">Continue my request<ArrowRight className="size-4" aria-hidden /></Link></div> : <form onSubmit={submit} className="space-y-4">
        <h2 className="font-display text-xl font-bold">What needs fixing?</h2>
        <div className="grid gap-4 sm:grid-cols-2"><Input label="Your name" autoComplete="name" required minLength={2} maxLength={120} value={fields.name} onChange={e => update('name', e.target.value)} /><Input label="Email address" type="email" autoComplete="email" required maxLength={120} value={fields.email} onChange={e => update('email', e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2"><Input label="Phone (optional)" type="tel" autoComplete="tel" maxLength={30} value={fields.phone} onChange={e => update('phone', e.target.value)} /><Input label="UK postcode" autoComplete="postal-code" required maxLength={12} value={fields.postcode} onChange={e => update('postcode', e.target.value)} hint="To find engineers who cover your area." /></div>
        <Select label="Device" value={fields.device} onChange={e => update('device', e.target.value)}>{DEVICE_TYPES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</Select>
        <Textarea label="Describe the problem" required minLength={10} maxLength={2000} value={fields.problem} onChange={e => update('problem', e.target.value)} placeholder="For example: my laptop will not turn on." />
        <div className="hidden" aria-hidden><label>Website<input tabIndex={-1} autoComplete="off" value={fields.website} onChange={e => update('website', e.target.value)} /></label></div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I agree that Thor Computer can use these details to respond to my repair enquiry, as explained in the <Link to="/privacy" target="_blank" className="text-thor-blue underline">Privacy Policy</Link>.</span></label>
        {error && <p role="alert" className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{error}</p>}
        <Button type="submit" className="w-full" variant="cta" size="lg" loading={busy} disabled={!consent}>Send repair enquiry<ArrowRight className="size-4" aria-hidden /></Button><p className="text-xs text-thor-text">No booking or payment is taken here. You’ll review and confirm your request before it is shared with engineers.</p>
      </form>}</section>
    </main></div>
}
