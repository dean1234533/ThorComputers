import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { AlertTriangle, BadgeCheck, Camera, Clock, FileText, Trash2, Upload, XCircle } from 'lucide-react'
import { db, storage } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { rid, uploadImage } from '@/lib/images'
import { normaliseProfile, profileErrors, AppProfile } from '@/lib/engineer-profile'
import { Avatar, Badge, Button, Chips, Input, ListSkeleton, PageHeader, Section, Textarea } from '@/components/ui'
import { SPECIALISATIONS, SERVICE_METHODS } from '@/types/domain'

interface Application { status: string; profile?: Partial<AppProfile>; infoRequest?: string; decisionNote?: string }
interface Qual { name: string; issuer: string; verification: 'pending' | 'verified' | 'rejected'; verificationNote?: string; storagePath: string }

const STATUS = {
  draft: { tone: 'neutral', icon: FileText, title: 'Complete your application', body: 'Fill in your details and upload at least one qualification, then submit for review.' },
  pending: { tone: 'warn', icon: Clock, title: 'Pending approval', body: 'Our team is reviewing your application. You’ll be notified as soon as there’s a decision.' },
  info_requested: { tone: 'warn', icon: AlertTriangle, title: 'More information needed', body: '' },
  approved: { tone: 'ok', icon: BadgeCheck, title: 'Approved', body: 'You can browse jobs and send quotations.' },
  rejected: { tone: 'bad', icon: XCircle, title: 'Application not approved', body: '' },
  suspended: { tone: 'bad', icon: XCircle, title: 'Account suspended', body: 'Contact support if you think this is a mistake.' },
} as const

export default function EngineerOnboarding() {
  const { user, profile: u, refreshClaims } = useAuth()
  const app = useDoc<Application>(`engineerApplications/${user!.uid}`)
  const quals = useQuery<Qual>('engineerQualifications', () => [where('engineerId', '==', user!.uid)], [user!.uid])
  const [p, setP] = useState<AppProfile>(() => normaliseProfile());
  const [errors, setErrors] = useState<Record<string, string>>({}); const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null); const [uploadError, setUploadError] = useState(''); const [busy, setBusy] = useState(''); const [q, setQ] = useState({ name: '', issuer: '' }); const [file, setFile] = useState<File | null>(null); const [areas, setAreas] = useState('')
  const status = (app.data?.status ?? 'draft') as keyof typeof STATUS
  const editable = ['draft', 'info_requested'].includes(status), approved = status === 'approved'

  useEffect(() => { if (app.loading) return; const base = normaliseProfile(app.data?.profile, u ?? {}); setP(base); setAreas(base.areasCovered.join(', ')) /* eslint-disable-next-line */ }, [app.loading, app.data?.status])
  useEffect(() => { if (approved) refreshClaims().catch(e => setNotice({ kind: 'bad', text: errMsg(e) })) }, [approved, refreshClaims])
  const set = <K extends keyof AppProfile>(k: K, v: AppProfile[K]) => { setP(s => ({ ...s, [k]: v })); setNotice(null); setErrors({}) }
  const body = () => ({ ...normaliseProfile(p), areasCovered: areas.split(',').map(s => s.trim()).filter(Boolean) })

  const saveDraft = async (silent = false) => {
    if (busy) return false
    if (!silent) { setBusy('save'); setNotice(null) }
    try {
      const r = doc(db, 'engineerApplications', user!.uid)
      app.data ? await updateDoc(r, { profile: body(), updatedAt: serverTimestamp() }) : await setDoc(r, { status: 'draft', profile: body(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      if (!silent) setNotice({ kind: 'ok', text: 'Your progress has been saved. You can finish it later.' })
      return true
    } catch (e) { setNotice({ kind: 'bad', text: errMsg(e) }); return false } finally { if (!silent) setBusy('') }
  }
  const validate = (submission: boolean) => {
    const next = profileErrors(body(), { submission, hasCertificate: quals.data.length > 0 })
    setErrors(next); setNotice(null)
    return Object.keys(next).length === 0
  }
  const submit = async () => {
    if (busy) return
    if (quals.error) { setNotice({ kind: 'bad', text: errMsg(quals.error) }); return }
    if (!validate(true)) return
    setBusy('submit')
    try { if (!(await saveDraft(true))) return; await api.submitEngineerApplication({}); setNotice({ kind: 'ok', text: 'Your application has been sent. Our team will check it and let you know.' }) }
    catch (e) { setNotice({ kind: 'bad', text: errMsg(e) }) } finally { setBusy('') }
  }
  const saveLive = async () => {
    if (busy || !validate(false)) return
    setBusy('live')
    try { const b = body(); await api.updatePublicProfile({ bio: b.bio, typicalPricing: b.typicalPricing, areasCovered: b.areasCovered, workingArrangements: b.workingArrangements, photoURL: b.photoURL }); setNotice({ kind: 'ok', text: 'Your profile has been updated.' }) }
    catch (e) { setNotice({ kind: 'bad', text: errMsg(e) }) } finally { setBusy('') }
  }
  const photo = async (f?: File) => {
    if (!f || busy) return
    setBusy('photo'); setNotice(null)
    try { const path = `avatars/${user!.uid}/engineer.jpg`; await uploadImage(path, f); set('photoURL', await getDownloadURL(ref(storage, path))) }
    catch (e) { setErrors(s => ({ ...s, photoURL: errMsg(e) })) } finally { setBusy('') }
  }
  const addQual = async () => {
    if (!file || !q.name.trim() || busy) return
    if (file.size >= 10 * 1024 * 1024) { setUploadError('Choose a file smaller than 10 MB.'); return }
    setBusy('qual'); setUploadError(''); setNotice(null)
    try { const isPdf = file.type === 'application/pdf'; const path = `qualifications/${user!.uid}/${rid()}.${isPdf ? 'pdf' : 'jpg'}`
      if (isPdf) await uploadBytes(ref(storage, path), file, { contentType: 'application/pdf' }); else await uploadImage(path, file)
      await addDoc(collection(db, 'engineerQualifications'), { engineerId: user!.uid, name: q.name.trim(), issuer: q.issuer.trim(), storagePath: path, verification: 'pending', createdAt: serverTimestamp() })
      setQ({ name: '', issuer: '' }); setFile(null); setErrors({}); setNotice({ kind: 'ok', text: 'Certificate added. Our team will check it before adding a verified badge.' })
    } catch (e) { setUploadError(errMsg(e)) } finally { setBusy('') }
  }
  const removeQual = async (id: string) => {
    if (busy) return
    setBusy('remove'); setUploadError(''); setNotice(null)
    try { await deleteDoc(doc(db, 'engineerQualifications', id)) } catch (e) { setUploadError(errMsg(e)) } finally { setBusy('') }
  }

  if (app.loading) return <ListSkeleton />
  if (app.error) return <div><PageHeader title="Your profile" /><p role="alert" className="rounded-xl bg-bad/10 p-4 text-sm text-bad">{errMsg(app.error)}</p></div>
  const S = STATUS[status] ?? STATUS.draft
  return (
    <div className="max-w-2xl"><PageHeader title="Your profile" />
      <div className="mb-6 flex gap-3.5 surface p-6"><S.icon className="size-7 shrink-0 text-thor-blue" /><div><p className="font-display text-lg">{S.title}</p><p className="text-sm text-thor-text">{status === 'info_requested' || status === 'rejected' ? app.data?.infoRequest || app.data?.decisionNote : S.body}</p></div></div>

      <Section title="About you">
        <div className="mb-5 flex items-center gap-4"><div className="relative"><Avatar src={p.photoURL} name={p.displayName || 'You'} size={84} />{(editable || approved) && <label className="absolute -bottom-1 -right-1 grid size-8 cursor-pointer place-items-center rounded-full bg-thor-orange"><Camera className="size-4" /><span className="sr-only">Upload profile photo</span><input disabled={!!busy} type="file" accept="image/*" className="sr-only" onChange={e => photo(e.target.files?.[0])} /></label>}</div><p className="text-sm text-thor-text">A clear, friendly headshot builds trust. It’s shown publicly.</p></div>
        {errors.photoURL && <p role="alert" className="mb-3 text-sm text-bad">{errors.photoURL}</p>}
        <fieldset disabled={!!busy || (!editable && !approved)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2"><Input label="Display name" error={errors.displayName} value={p.displayName ?? ''} onChange={e => set('displayName', e.target.value)} disabled={approved} /><Input label="Business name (optional)" error={errors.businessName} value={p.businessName ?? ''} onChange={e => set('businessName', e.target.value)} disabled={approved} /></div>
          <Textarea label="Professional biography" error={errors.bio} value={p.bio ?? ''} onChange={e => set('bio', e.target.value)} maxLength={1500} hint="At least 60 characters. Describe your experience and approach." />
          <div className="grid gap-4 sm:grid-cols-2"><Input label="Years of experience" error={errors.yearsExperience} type="number" min={0} max={60} value={p.yearsExperience ?? 0} onChange={e => set('yearsExperience', Number(e.target.value))} disabled={approved} />
            <Input label="Service radius (miles)" error={errors.radiusMiles} type="number" min={1} max={100} value={p.serviceArea?.radiusMiles ?? 15} onChange={e => set('serviceArea', { postcode: p.serviceArea?.postcode ?? '', radiusMiles: Number(e.target.value) })} disabled={approved} /></div>
          <Input label="Service postcode" error={errors.postcode} value={p.serviceArea?.postcode ?? ''} onChange={e => set('serviceArea', { radiusMiles: p.serviceArea?.radiusMiles ?? 15, postcode: e.target.value.toUpperCase() })} hint="Used to match you with nearby jobs. Never shown publicly." className="uppercase" disabled={approved} />
          <Input label="Areas covered" error={errors.areasCovered} value={areas} onChange={e => { setAreas(e.target.value); setErrors({}); setNotice(null) }} hint="Separate each service area with a comma" />
          <Chips multi label="Repair specialisations" options={SPECIALISATIONS} value={p.specialisations ?? []} onChange={v => !approved && set('specialisations', v)} />{errors.specialisations && <p role="alert" className="text-xs text-bad">{errors.specialisations}</p>}{approved && <p className="text-xs text-thor-text">Changing specialisations requires a new review. Contact support.</p>}
          <Chips multi label="Preferred working arrangements" options={SERVICE_METHODS} value={p.workingArrangements ?? []} onChange={v => set('workingArrangements', v)} />{errors.workingArrangements && <p role="alert" className="text-xs text-bad">{errors.workingArrangements}</p>}
          <Textarea label="Certifications (self-reported)" error={errors.certificationsText} value={p.certificationsText ?? ''} onChange={e => set('certificationsText', e.target.value)} className="min-h-20" hint="Shown as unverified until our team checks your documents below." disabled={approved} />
          <Input label="Typical pricing (optional)" error={errors.typicalPricing} value={p.typicalPricing ?? ''} onChange={e => set('typicalPricing', e.target.value)} />
        </fieldset>
      </Section>

      <Section title="Qualifications">
        <p className="mb-3 text-sm text-thor-text">Upload certificates (PDF or photo). They’re private. Only authorised Thor Computer staff can open them. A “verified” badge appears only after a person has checked the document.</p>
        <ul className="mb-4 divide-y divide-ink/8 rounded-2xl bg-white shadow-sm ring-1 ring-ink/5">{quals.data.map(x => <li key={x.id} className="flex items-center gap-3 p-4"><FileText className="size-5 text-thor-blue" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{x.name}</p><p className="text-xs text-thor-text">{x.issuer}{x.verificationNote && ` · ${x.verificationNote}`}</p></div>
          <Badge tone={x.verification === 'verified' ? 'ok' : x.verification === 'rejected' ? 'bad' : 'warn'}>{x.verification === 'pending' ? 'Awaiting review' : x.verification}</Badge>
          {x.verification !== 'verified' && editable && <button aria-label="Remove" disabled={!!busy} onClick={() => removeQual(x.id)} className="rounded-full p-2 text-thor-text hover:bg-bad/10 hover:text-bad"><Trash2 className="size-4" /></button>}</li>)}
          {quals.data.length === 0 && <li className="p-4 text-sm text-thor-text">Nothing uploaded yet.</li>}</ul>
        {errors.qualifications && <p role="alert" className="mb-3 text-sm text-bad">{errors.qualifications}</p>}
        {uploadError && <p role="alert" className="mb-3 text-sm text-bad">{uploadError}</p>}
        <fieldset disabled={!!busy || (!editable && !approved)} className="space-y-3 rounded-2xl border border-dashed border-ink/20 p-4"><div className="grid gap-3 sm:grid-cols-2"><Input label="Qualification" value={q.name} onChange={e => setQ({ ...q, name: e.target.value })} /><Input label="Issued by" value={q.issuer} onChange={e => setQ({ ...q, issuer: e.target.value })} /></div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-thor-blue"><Upload className="size-4" />{file ? file.name : 'Choose file (PDF or image, max 10 MB)'}<input type="file" accept="application/pdf,image/*" className="sr-only" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
          <Button size="sm" variant="soft" onClick={addQual} loading={busy === 'qual'} disabled={!!busy || !file || !q.name.trim()}>Upload</Button></fieldset>
      </Section>

      {Object.keys(errors).length > 0 && <p role="alert" className="mb-3 text-sm text-bad">Please check the highlighted fields before continuing.</p>}
      {notice && <p role={notice.kind === 'bad' ? 'alert' : 'status'} className={`mb-4 rounded-xl p-3 text-sm ${notice.kind === 'bad' ? 'bg-bad/10 text-bad' : 'bg-ok/10 text-ok'}`}>{notice.text}</p>}
      <div className="safe-b sticky bottom-20 flex gap-3 md:bottom-4">
        {editable && <><Button variant="soft" disabled={!!busy} onClick={() => saveDraft()} loading={busy === 'save'} className="flex-1">Save draft</Button><Button variant="cta" disabled={!!busy || quals.loading} onClick={submit} loading={busy === 'submit'} className="flex-1">Submit for approval</Button></>}
        {approved && <Button disabled={!!busy} onClick={saveLive} loading={busy === 'live'} className="w-full">Save changes</Button>}
      </div>
    </div>)
}
