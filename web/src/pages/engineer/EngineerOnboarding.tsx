import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { AlertTriangle, BadgeCheck, Camera, Clock, FileText, Trash2, Upload, XCircle, ExternalLink } from 'lucide-react'
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
  const [errors, setErrors] = useState<Record<string, string>>({}); const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null); const [uploadError, setUploadError] = useState(''); const [uploadNotice, setUploadNotice] = useState(''); const [savedQuals, setSavedQuals] = useState<(Qual & { id: string })[]>([]); const [busy, setBusy] = useState(''); const [q, setQ] = useState({ name: '', issuer: '' }); const [file, setFile] = useState<File | null>(null); const [areas, setAreas] = useState('')
  const certificates = [...quals.data, ...savedQuals.filter(saved => !quals.data.some(q => q.id === saved.id))]
  useEffect(() => {
    setSavedQuals(saved => { const waiting = saved.filter(q => !quals.data.some(record => record.id === q.id)); return waiting.length === saved.length ? saved : waiting })
  }, [quals.data, savedQuals])
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
    const next = profileErrors(body(), { submission, hasCertificate: certificates.length > 0 })
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
    setBusy('qual'); setUploadError(''); setUploadNotice(''); setNotice(null)
    try { const isPdf = file.type === 'application/pdf'; const path = `qualifications/${user!.uid}/${rid()}.${isPdf ? 'pdf' : 'jpg'}`
      if (isPdf) await uploadBytes(ref(storage, path), file, { contentType: 'application/pdf' }); else await uploadImage(path, file)
      const metadata: Qual = { name: q.name.trim(), issuer: q.issuer.trim(), storagePath: path, verification: 'pending' }
      const record = await addDoc(collection(db, 'engineerQualifications'), { engineerId: user!.uid, ...metadata, createdAt: serverTimestamp() })
      setSavedQuals(saved => [...saved, { ...metadata, id: record.id }])
      setQ({ name: '', issuer: '' }); setFile(null); setErrors({}); setUploadNotice('Certificate uploaded. It’s now waiting for our team to check it.')
    } catch (e) { setUploadError(errMsg(e)) } finally { setBusy('') }
  }
  const removeQual = async (id: string) => {
    if (busy) return
    setBusy('remove'); setUploadError(''); setNotice(null)
    try { await deleteDoc(doc(db, 'engineerQualifications', id)); setSavedQuals(saved => saved.filter(q => q.id !== id)); setUploadNotice('Certificate removed.') } catch (e) { setUploadError(errMsg(e)) } finally { setBusy('') }
  }

  const chooseCertificate = (selected?: File) => {
    if (!selected) return
    setUploadError(''); setUploadNotice('')
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) {
      setFile(null); setUploadError('Choose a PDF, JPG, PNG or WebP file.'); return
    }
    if (selected.size >= 10 * 1024 * 1024) { setFile(null); setUploadError('Choose a file smaller than 10 MB.'); return }
    setFile(selected)
    setQ(previous => ({ ...previous, name: previous.name.trim() || selected.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Certificate' }))
  }
  const openCertificate = async (path: string) => {
    setUploadError('')
    try { const url = await getDownloadURL(ref(storage, path)); window.open(url, '_blank', 'noopener,noreferrer') }
    catch { setUploadError('We couldn’t open this certificate. Please try again.') }
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
        <p className="mb-4 text-sm text-thor-text">Your certificates are private. Our team checks them before adding a verified badge.</p>
        {quals.loading && certificates.length === 0 ? <ListSkeleton rows={1} /> : quals.error ? <p role="alert" className="mb-4 rounded-xl bg-bad/10 p-3 text-sm text-bad">We couldn’t load your certificates. Refresh the page to try again.</p> : certificates.length === 0 && busy !== 'qual' && !file ? <p className="mb-4 text-sm text-thor-text">Add a certificate to complete your application.</p> : null}
        {certificates.length > 0 && <ul className="mb-4 divide-y divide-ink/8 surface">{certificates.map(x => <li key={x.id} className="flex flex-wrap items-center gap-3 p-4"><FileText className="size-5 shrink-0 text-thor-blue" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{x.name}</p>{x.issuer && <p className="text-xs text-thor-text">{x.issuer}</p>}{x.verificationNote && <p className="text-xs text-thor-text">{x.verificationNote}</p>}</div>
          <Badge tone={x.verification === 'verified' ? 'ok' : x.verification === 'rejected' ? 'bad' : 'warn'}>{x.verification === 'pending' ? 'Waiting for review' : x.verification === 'verified' ? 'Verified' : 'Not approved'}</Badge>
          <button type="button" onClick={() => openCertificate(x.storagePath)} aria-label={`Open ${x.name}`} className="rounded-full p-2 text-thor-blue hover:bg-thor-blue/10"><ExternalLink className="size-4" /></button>
          {x.verification !== 'verified' && editable && <button type="button" aria-label={`Remove ${x.name}`} disabled={!!busy} onClick={() => removeQual(x.id)} className="rounded-full p-2 text-thor-text hover:bg-bad/10 hover:text-bad"><Trash2 className="size-4" /></button>}</li>)}</ul>}
        {errors.qualifications && <p role="alert" className="mb-3 text-sm text-bad">{errors.qualifications}</p>}
        {uploadError && <p role="alert" className="mb-3 text-sm text-bad">{uploadError}</p>}
        {uploadNotice && <p role="status" className="mb-3 rounded-xl bg-ok/10 p-3 text-sm text-ok">{uploadNotice}</p>}
        {(editable || approved) && <fieldset disabled={!!busy} className="space-y-4 rounded-2xl border border-dashed border-ink/20 p-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-thor-blue/5 p-4 text-sm font-medium text-thor-blue"><Upload className="size-5 shrink-0" /><span>{file ? 'Choose a different file' : 'Choose a certificate'}<span className="mt-1 block text-xs font-normal text-thor-text">PDF, JPG, PNG or WebP. Smaller than 10 MB.</span></span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Choose a certificate" className="sr-only" onChange={e => { chooseCertificate(e.target.files?.[0]); e.target.value = '' }} /></label>
          {file && <><div role="status" className="rounded-xl bg-paper p-3"><p className="break-words text-sm font-medium">{file.name}</p><p className="mt-1 text-xs text-thor-text">{busy === 'qual' ? 'Uploading your certificate…' : 'Ready to upload. Choose Upload certificate to save it.'}</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><Input label="Certificate name" value={q.name} onChange={e => setQ({ ...q, name: e.target.value })} /><Input label="Issued by (optional)" value={q.issuer} onChange={e => setQ({ ...q, issuer: e.target.value })} /></div>
            <Button type="button" onClick={addQual} loading={busy === 'qual'} disabled={!!busy || !q.name.trim()}>{busy === 'qual' ? 'Uploading…' : 'Upload certificate'}</Button></>}
        </fieldset>}
      </Section>

      {Object.keys(errors).length > 0 && <p role="alert" className="mb-3 text-sm text-bad">Please check the highlighted fields before continuing.</p>}
      {notice && <p role={notice.kind === 'bad' ? 'alert' : 'status'} className={`mb-4 rounded-xl p-3 text-sm ${notice.kind === 'bad' ? 'bg-bad/10 text-bad' : 'bg-ok/10 text-ok'}`}>{notice.text}</p>}
      <div className="safe-b sticky bottom-20 flex gap-3 md:bottom-4">
        {editable && <><Button variant="soft" disabled={!!busy} onClick={() => saveDraft()} loading={busy === 'save'} className="flex-1">Save draft</Button><Button variant="cta" disabled={!!busy || quals.loading} onClick={submit} loading={busy === 'submit'} className="flex-1">Submit for approval</Button></>}
        {approved && <Button disabled={!!busy} onClick={saveLive} loading={busy === 'live'} className="w-full">Save changes</Button>}
      </div>
    </div>)
}
