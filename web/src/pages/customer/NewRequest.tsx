import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Camera, Check, CheckCircle2, Laptop, Monitor, Gamepad2, Apple, Smartphone, Tablet, Printer, Cpu, X, LucideIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api, errMsg, RequestInput } from '@/lib/api'
import { rid, uploadImage } from '@/lib/images'
import { Button, Chips, Input, Textarea, useToast, cx } from '@/components/ui'
import { COMMON_ISSUES, DEVICE_TYPES, DeviceType, METHODS_FOR_DEVICE, SERVICE_METHODS, ServiceMethod } from '@/types/domain'

const ICON: Record<DeviceType, LucideIcon> = { laptop: Laptop, desktop: Monitor, gaming_pc: Gamepad2, mac: Apple, phone: Smartphone, tablet: Tablet, printer: Printer, other: Cpu }
const STEPS = ['Device', 'Details', 'Problem', 'Service', 'Location', 'Review']
const POSTCODE = /^[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}$/

interface Draft {
  device: DeviceType | ''; manufacturer: string; model: string; os: string; serial: string
  issues: string[]; description: string; startedAt: string; urgency: 'flexible' | 'soon' | 'urgent'
  methods: ServiceMethod[]; postcode: string; addressLine: string; accessNotes: string; dates: string[]
}
const EMPTY: Draft = { device: '', manufacturer: '', model: '', os: '', serial: '', issues: [], description: '', startedAt: '', urgency: 'flexible', methods: [], postcode: '', addressLine: '', accessNotes: '', dates: [] }
const DRAFT_KEY = 'thor.request.draft'

export default function NewRequest() {
  const { user, profile } = useAuth(); const nav = useNavigate(); const toast = useToast(); const [qs] = useSearchParams()
  const [step, setStep] = useState(0)
  const [d, setD] = useState<Draft>(() => { try { return { ...EMPTY, ...JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') } } catch { return EMPTY } })
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([])
  const [busy, setBusy] = useState(false); const [submitErr, setSubmitErr] = useState(''); const [done, setDone] = useState<{ reference: string; jobId: string } | null>(null)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const key = useRef(rid() + rid())            // idempotency key: a double-tap or retry can never create two jobs
  const enquiry = qs.get('e') && qs.get('t') ? { id: qs.get('e')!, token: qs.get('t')! } : undefined

  useEffect(() => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* ignore */ } }, [d])
  useEffect(() => { if (!d.postcode && profile?.postcode) setD(s => ({ ...s, postcode: profile.postcode })) }, [profile, d.postcode])
  useEffect(() => {          // prefill from a WordPress enquiry (the server validates the signed link + email match)
    if (!enquiry) return
    api.getEnquiry(enquiry).then(({ fields: f }) => setD(s => ({ ...s, device: s.device || (DEVICE_TYPES.some(x => x.id === f.device) ? (f.device as DeviceType) : ''), methods: s.methods.length ? s.methods : (SERVICE_METHODS.some(x => x.id === f.method) ? [f.method as ServiceMethod] : []), urgency: ['flexible', 'soon', 'urgent'].includes(f.urgency) ? (f.urgency as Draft['urgency']) : s.urgency, manufacturer: s.manufacturer || f.brand || '', model: s.model || f.model || '', serial: s.serial || f.serial_n || '', description: s.description || f.problem || '', postcode: f.postal_code || s.postcode })))
      .catch(e => toast('bad', errMsg(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loc = useLocation()
  useEffect(() => {          // prefill from the AI assistant's draft; the customer still reviews every step and submits themselves
    const p = (loc.state as { prefill?: Record<string, any> } | null)?.prefill; if (!p) return
    setD(s => ({ ...s, device: DEVICE_TYPES.some(x => x.id === p.device) ? p.device : s.device, manufacturer: p.manufacturer || s.manufacturer, model: p.model || s.model, description: p.problem || s.description, postcode: p.postcode || s.postcode,
      urgency: ['flexible', 'soon', 'urgent'].includes(p.urgency) ? p.urgency : s.urgency, methods: Array.isArray(p.serviceMethods) && p.serviceMethods.length ? p.serviceMethods.filter((m: string) => SERVICE_METHODS.some(x => x.id === m)) : s.methods }))
    nav('.', { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allowed = useMemo(() => (d.device ? SERVICE_METHODS.filter(m => METHODS_FOR_DEVICE[d.device as DeviceType].includes(m.id)) : []), [d.device])
  useEffect(() => { if (d.device) setD(s => ({ ...s, methods: s.methods.filter(m => METHODS_FOR_DEVICE[d.device as DeviceType].includes(m)) })) }, [d.device])
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(s => ({ ...s, [k]: v }))

  const check = (s: number) => {
    const e: Record<string, string> = {}
    if (s === 0 && !d.device) e.device = 'Choose a device'
    if (s === 1) { if (!d.manufacturer.trim()) e.manufacturer = 'Enter the manufacturer'; if (!d.model.trim()) e.model = 'Enter the model, or “Unknown”' }
    if (s === 2 && d.description.trim().length < 10) e.description = 'Tell us a little more (at least 10 characters)'
    if (s === 3 && d.methods.length === 0) e.methods = 'Choose at least one option'
    if (s === 4) { if (!POSTCODE.test(d.postcode.trim())) e.postcode = 'Enter a valid UK postcode' }
    setErrs(e); return !Object.keys(e).length
  }
  const next = () => check(step) && setStep(s => s + 1)

  const addPhotos = (files: FileList | null) => { if (!files) return; const add = [...files].filter(f => f.type.startsWith('image/')).slice(0, 6 - photos.length).map(file => ({ file, url: URL.createObjectURL(file) })); setPhotos(p => [...p, ...add]) }

  const submit = async () => {
    setBusy(true); setSubmitErr('')
    try {
      const paths = await Promise.all(photos.map((p, i) => uploadImage(`requests/${user!.uid}/${key.current}/${i}-${rid()}.jpg`, p.file)))
      const input: RequestInput = { requestKey: key.current, device: { type: d.device, manufacturer: d.manufacturer.trim(), model: d.model.trim(), os: d.os.trim() }, serialNumber: d.serial.trim(), issues: d.issues, description: d.description.trim(),
        startedAt: d.startedAt, urgency: d.urgency, serviceMethods: d.methods, postcode: d.postcode.trim().toUpperCase(), addressLine: d.addressLine.trim(), accessNotes: d.accessNotes.trim(), preferredDates: d.dates, photoPaths: paths, enquiry }
      const r = await api.createRepairRequest(input)
      sessionStorage.removeItem(DRAFT_KEY); setDone({ reference: r.reference, jobId: r.jobId })
    } catch (e) { const m = errMsg(e); setSubmitErr(m); toast('bad', m) } finally { setBusy(false) }   // the banner below stays until the next attempt; a toast alone disappears
  }

  if (done) return (
    <motion.div initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto max-w-md py-10 text-center">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: .1 }} className="mx-auto mb-5 grid size-20 place-items-center rounded-full bg-ok/15"><CheckCircle2 className="size-11 text-ok" /></motion.div>
      <h1 className="font-display text-3xl">Request submitted</h1>
      <p className="mt-2 text-thor-text">Reference <b className="text-ink">{done.reference}</b>. Approved engineers near you have been notified. We’ll alert you as soon as quotes arrive.</p>
      <div className="mt-7 flex flex-col gap-3"><Button onClick={() => nav(`/customer/repairs/${done.jobId}`)} size="lg">Track this request</Button><Link to="/customer" className="text-sm text-thor-blue hover:underline">Back to home</Link></div>
    </motion.div>)

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        {step > 0 ? <button onClick={() => setStep(s => s - 1)} aria-label="Back" className="rounded-full p-2 hover:bg-ink/5"><ArrowLeft className="size-5" /></button> : <Link to="/customer" aria-label="Cancel" className="rounded-full p-2 hover:bg-ink/5"><X className="size-5" /></Link>}
        <div className="flex-1"><p className="text-xs font-medium uppercase tracking-wide text-thor-text">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={step + 1} aria-valuemax={STEPS.length}><motion.div className="h-full bg-thor-orange" animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div></div>
      </div>

      <AnimatePresence mode="wait"><motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: .16 }} className="space-y-5">
        {step === 0 && <>
          <h1 className="font-display text-2xl">What needs repairing?</h1>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Device">
            {DEVICE_TYPES.map(t => { const I = ICON[t.id]; const on = d.device === t.id; return (
              <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => set('device', t.id)} className={cx('flex flex-col items-center gap-2 rounded-2xl border-2 p-4 text-sm font-medium transition active:scale-95', on ? 'border-thor-blue bg-thor-blue/5 text-thor-blue' : 'border-ink/10 bg-white hover:border-thor-blue/40')}><I className="size-8" />{t.label}</button>) })}
          </div>{errs.device && <p role="alert" className="text-sm text-bad">{errs.device}</p>}</>}

        {step === 1 && <><h1 className="font-display text-2xl">Tell us about the device</h1>
          <Input label="Manufacturer" value={d.manufacturer} onChange={e => set('manufacturer', e.target.value)} error={errs.manufacturer} />
          <Input label="Model" value={d.model} onChange={e => set('model', e.target.value)} error={errs.model} />
          <Input label="Operating system (optional)" value={d.os} onChange={e => set('os', e.target.value)} />
          <Input label="Serial number (optional)" hint="Private. Only shared with your selected engineer." value={d.serial} onChange={e => set('serial', e.target.value)} /></>}

        {step === 2 && <><h1 className="font-display text-2xl">What’s the problem?</h1>
          <Chips multi label="Common issues" options={COMMON_ISSUES.map(i => ({ id: i, label: i }))} value={d.issues as never[]} onChange={v => set('issues', v)} />
          <Textarea label="Describe what’s happening" value={d.description} onChange={e => set('description', e.target.value)} error={errs.description} maxLength={2000} hint="Don’t include phone numbers or your address here. Listings are visible to engineers." />
          <Input label="When did it start?" value={d.startedAt} onChange={e => set('startedAt', e.target.value)} />
          <Chips label="How urgent is it?" options={[{ id: 'flexible', label: 'Flexible' }, { id: 'soon', label: 'Within a few days' }, { id: 'urgent', label: 'Urgent' }]} value={[d.urgency]} onChange={v => set('urgency', v[0])} />
          <div><p className="mb-2 text-sm font-medium">Photos (optional, up to 6)</p>
            <div className="flex flex-wrap gap-3">{photos.map((p, i) => <div key={p.url} className="relative"><img src={p.url} alt={`Device photo ${i + 1}`} className="size-20 rounded-xl object-cover" /><button type="button" aria-label="Remove photo" onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))} className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-ink text-white"><X className="size-3.5" /></button></div>)}
              {photos.length < 6 && <label className="grid size-20 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-ink/20 text-thor-text hover:border-thor-blue"><Camera className="size-6" /><span className="sr-only">Add photos</span><input type="file" accept="image/*" multiple className="sr-only" onChange={e => addPhotos(e.target.files)} /></label>}</div>
            <p className="mt-1.5 text-xs text-thor-text">Photos are resized and location data is removed before upload.</p></div></>}

        {step === 3 && <><h1 className="font-display text-2xl">How would you like it repaired?</h1>
          <Chips multi label="Choose all that suit you" options={allowed} value={d.methods} onChange={v => set('methods', v)} />{errs.methods && <p role="alert" className="text-sm text-bad">{errs.methods}</p>}
          <p className="text-sm text-thor-text">Engineers will quote for the options you pick. Only methods that suit this device are shown.</p></>}

        {step === 4 && <><h1 className="font-display text-2xl">Where are you?</h1>
          <Input label="Postcode" autoComplete="postal-code" value={d.postcode} onChange={e => set('postcode', e.target.value)} error={errs.postcode} className="uppercase" hint="Engineers only see your general area, such as “Bromley · BR1”." />
          {d.methods.some(m => m === 'home' || m === 'office') && <Input label="Address (optional now)" autoComplete="street-address" value={d.addressLine} onChange={e => set('addressLine', e.target.value)} hint="Private. Released only to the engineer you select, once you’ve booked." />}
          <Textarea label="Access notes (optional)" value={d.accessNotes} onChange={e => set('accessNotes', e.target.value)} className="min-h-20" hint="Parking, entry codes etc. Shared only with your selected engineer." />
          <div><p className="mb-2 text-sm font-medium">Preferred dates (optional)</p><div className="flex flex-wrap items-center gap-2">
            {d.dates.map(x => <button key={x} type="button" onClick={() => set('dates', d.dates.filter(y => y !== x))} className="inline-flex items-center gap-1 rounded-full bg-thor-blue/10 px-3 py-1.5 text-sm text-thor-blue">{x}<X className="size-3.5" /></button>)}
            {d.dates.length < 5 && <input type="date" aria-label="Add preferred date" min={new Date().toISOString().slice(0, 10)} onChange={e => { const v = e.target.value; if (v && !d.dates.includes(v)) set('dates', [...d.dates, v].sort()); e.target.value = '' }} className="h-10 rounded-xl border border-ink/15 bg-white px-3" />}</div></div></>}

        {step === 5 && <><h1 className="font-display text-2xl">Check and submit</h1>
          <dl className="divide-y divide-ink/8 rounded-2xl bg-white px-4 shadow-sm">{[
            ['Device', `${DEVICE_TYPES.find(t => t.id === d.device)?.label} · ${d.manufacturer} ${d.model}`], ['Problem', [...d.issues, d.description].filter(Boolean).join(' · ')],
            ['Urgency', d.urgency], ['Service', d.methods.map(m => SERVICE_METHODS.find(s => s.id === m)?.label).join(', ')], ['Postcode', d.postcode.toUpperCase()],
            ...(d.dates.length ? [['Preferred dates', d.dates.join(', ')]] : []), ...(photos.length ? [['Photos', `${photos.length} attached`]] : [])].map(([k, v]) => <div key={k} className="flex gap-4 py-3"><dt className="w-28 shrink-0 text-sm text-thor-text">{k}</dt><dd className="text-sm capitalize-first">{v}</dd></div>)}</dl>
          <p className="flex items-start gap-2 text-xs text-thor-text"><Check className="mt-0.5 size-4 shrink-0 text-ok" />Engineers see your device, problem and approximate area only. Your name, phone, address and serial number stay private.</p></>}
      </motion.div></AnimatePresence>

      {submitErr && step === 5 && <div role="alert" className="mt-6 rounded-2xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad"><p className="font-medium">Your request wasn’t sent</p><p>{submitErr}</p><p className="mt-1 text-thor-text">Your details are saved on this device, so you can press Submit again.</p></div>}
      <div className="safe-b sticky bottom-20 mt-8 md:bottom-4">
        {step < 5 ? <Button onClick={next} size="lg" className="w-full">Continue</Button> : <Button variant="cta" loading={busy} onClick={submit} size="lg" className="w-full">Submit request</Button>}
      </div>
    </div>
  )
}
