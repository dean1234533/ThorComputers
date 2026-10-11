import { z } from 'zod'
import { db, callable, requireRole, requirePerm, requireVerified, setClaims, audit, notify, notifyAdmins, FieldValue, HttpsError } from './core'
import { p } from './email'
import { geocode } from './geo'

const SPECS = ['laptop', 'desktop', 'gaming_pc', 'phone', 'tablet', 'mac', 'virus', 'data_recovery', 'upgrades', 'software', 'networking', 'printer', 'it_support', 'other'] as const
const METHODS = ['home', 'office', 'remote', 'collection', 'workshop'] as const

const Application = z.object({
  displayName: z.string().trim().min(2).max(80),
  businessName: z.string().trim().max(80).optional().default(''),
  bio: z.string().trim().min(60, 'Write at least 60 characters about your experience').max(1500),
  yearsExperience: z.number().int().min(0).max(60),
  serviceArea: z.object({ postcode: z.string(), radiusMiles: z.number().min(1).max(100) }),
  areasCovered: z.array(z.string().max(60)).min(1).max(30),
  specialisations: z.array(z.enum(SPECS)).min(1),
  certificationsText: z.string().max(800).optional().default(''),
  workingArrangements: z.array(z.enum(METHODS)).min(1),
  typicalPricing: z.string().max(400).optional().default(''),
  photoURL: z.string().url('A profile photograph is required'),
})

export const submitEngineerApplication = callable(z.object({}), async (req) => {
  const c = requireRole(req, 'engineer'); requireVerified(c)
  const ref = db.doc(`engineerApplications/${c.uid}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('failed-precondition', 'Complete your profile first.')
  const cur = snap.data()!
  if (!['draft', 'info_requested'].includes(cur.status)) throw new HttpsError('failed-precondition', `Application is already ${cur.status}.`)
  const parsed = Application.safeParse(cur.profile)
  if (!parsed.success) throw new HttpsError('invalid-argument', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
  const quals = await db.collection('engineerQualifications').where('engineerId', '==', c.uid).limit(1).get()
  if (quals.empty) throw new HttpsError('failed-precondition', 'Upload at least one qualification or certificate.')
  const geo = await geocode(parsed.data.serviceArea.postcode)
  if (!geo) throw new HttpsError('invalid-argument', 'We could not find your service postcode.')
  await ref.update({ profile: parsed.data, geo: { lat: geo.lat, lng: geo.lng }, status: 'pending', submittedAt: FieldValue.serverTimestamp(), infoRequest: null })
  await notifyAdmins('engineers.review', { category: 'admin', dedupeKey: `app-submitted:${c.uid}:${cur.submissionCount ?? 0}`, title: 'New engineer application', body: 'An application is waiting for review.', link: '/admin/approvals' })
  return { status: 'pending' }
})

const publicProfile = (uid: string, a: z.infer<typeof Application>, prev?: FirebaseFirestore.DocumentData) => ({
  displayName: a.displayName, businessName: a.businessName, bio: a.bio, yearsExperience: a.yearsExperience,
  specialisations: a.specialisations, areasCovered: a.areasCovered, workingArrangements: a.workingArrangements,
  typicalPricing: a.typicalPricing, photoURL: a.photoURL, selfReportedCerts: a.certificationsText,   // shown as UNVERIFIED on the public profile serviceRadiusMiles: a.serviceArea.radiusMiles,
  // contact details, home postcode and documents are deliberately NOT copied to the public profile
  verifiedQualifications: prev?.verifiedQualifications ?? [], ratingAvg: prev?.ratingAvg ?? 0, reviewCount: prev?.reviewCount ?? 0,
  completedJobs: prev?.completedJobs ?? 0, provider: prev?.provider ?? 'independent', updatedAt: FieldValue.serverTimestamp(), uid,
})

export const reviewEngineerApplication = callable(z.object({
  engineerId: z.string(), decision: z.enum(['approve', 'reject', 'request_info', 'suspend', 'reinstate']), note: z.string().trim().max(1000).optional().default(''),
  provider: z.enum(['independent', 'thor']).optional(),
}), async (req, d) => {
  const c = requirePerm(req, 'engineers.review')
  if (['reject', 'request_info', 'suspend'].includes(d.decision) && d.note.length < 5) throw new HttpsError('invalid-argument', 'A note explaining the decision is required.')
  const appRef = db.doc(`engineerApplications/${d.engineerId}`)
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(appRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Application not found.')
    const a = snap.data()!
    const allowed: Record<string, string[]> = { approve: ['pending'], reject: ['pending'], request_info: ['pending'], suspend: ['approved'], reinstate: ['suspended'] }
    if (!allowed[d.decision].includes(a.status)) throw new HttpsError('failed-precondition', `Cannot ${d.decision} an application that is ${a.status}.`)
    const profileRef = db.doc(`engineerProfiles/${d.engineerId}`)
    const prevProfile = d.decision === 'approve' ? (await tx.get(profileRef)).data() : undefined   // Firestore: every read must precede the first write
    const next = { approve: 'approved', reject: 'rejected', request_info: 'info_requested', suspend: 'suspended', reinstate: 'approved' }[d.decision]!
    const upd: Record<string, unknown> = { status: next, reviewedBy: c.uid, reviewedAt: FieldValue.serverTimestamp(), decisionNote: d.note }
    if (d.decision === 'request_info') { upd.infoRequest = d.note; upd.submissionCount = (a.submissionCount ?? 0) + 1 }
    tx.update(appRef, upd)
    if (d.decision === 'approve') {
      tx.set(profileRef, { ...publicProfile(d.engineerId, Application.parse(a.profile), prevProfile), status: 'approved', ...(d.provider ? { provider: d.provider } : {}) }, { merge: true })
    } else if (['suspend', 'reject'].includes(d.decision)) tx.set(profileRef, { status: 'suspended' }, { merge: true })
    else if (d.decision === 'reinstate') tx.set(profileRef, { status: 'approved' }, { merge: true })
    tx.update(db.doc(`users/${d.engineerId}`), { engineerStatus: next })
    return { next, specs: a.profile?.specialisations ?? [] }
  })
  const approved = result.next === 'approved'
  await setClaims(d.engineerId, { engineerApproved: approved, specs: approved ? result.specs : [] })
  await audit(c.uid, `engineer.${d.decision}`, `engineerApplications/${d.engineerId}`, { note: d.note })
  const copy = {
    approve: ['Application approved', 'You can now browse jobs and submit quotations.'],
    reinstate: ['Account reinstated', 'You can quote for jobs again.'],
    reject: ['Application not approved', 'Open the app to see our feedback.'],
    request_info: ['More information needed', 'Please open the app to see what we need.'],
    suspend: ['Account suspended', 'Open the app for details.'],
  }[d.decision]
  await notify({ userId: d.engineerId, category: 'account', dedupeKey: `app-decision:${d.engineerId}:${d.decision}:${Date.now()}`, title: copy[0], body: copy[1], link: '/engineer/profile',
    email: { subject: `Thor Computer: ${copy[0]}`, heading: copy[0], html: `<p>${copy[1]}</p>${d.note ? `<p><em>${p(d.note)}</em></p>` : ''}`, cta: 'Open Thor Computer' } })
  return { status: result.next }
})

/** Verification is ALWAYS a human decision: uploading a document never marks it verified. */
export const verifyQualification = callable(z.object({ qualificationId: z.string(), decision: z.enum(['verified', 'rejected']), note: z.string().max(500).optional().default('') }), async (req, d) => {
  const c = requirePerm(req, 'engineers.review')
  const ref = db.doc(`engineerQualifications/${d.qualificationId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Qualification not found.')
  const q = snap.data()!
  await ref.update({ verification: d.decision, verifiedBy: c.uid, verifiedAt: FieldValue.serverTimestamp(), verificationNote: d.note })
  const qs = await db.collection('engineerQualifications').where('engineerId', '==', q.engineerId).where('verification', '==', 'verified').get()
  const names = qs.docs.map(x => ({ name: x.data().name as string, issuer: x.data().issuer as string })) // names only; never storagePath
  await db.doc(`engineerProfiles/${q.engineerId}`).set({ verifiedQualifications: names }, { merge: true })
  await audit(c.uid, `qualification.${d.decision}`, ref.path, { note: d.note })
  return { ok: true }
})

/** Approved engineers can update presentation details. Specialisations/credentials are NOT editable here (they need re-review). */
export const updatePublicProfile = callable(z.object({
  bio: z.string().trim().min(60).max(1500), typicalPricing: z.string().max(400).optional().default(''), areasCovered: z.array(z.string().max(60)).min(1).max(30),
  workingArrangements: z.array(z.enum(METHODS)).min(1), photoURL: z.string().url(),
}), async (req, d) => {
  const c = requireRole(req, 'engineer')
  const appRef = db.doc(`engineerApplications/${c.uid}`), app = (await appRef.get()).data()
  if (app?.status !== 'approved') throw new HttpsError('failed-precondition', 'Only approved profiles can be edited this way.')
  await appRef.update({ profile: { ...app.profile, ...d }, updatedAt: FieldValue.serverTimestamp() })
  await db.doc(`engineerProfiles/${c.uid}`).set({ ...d, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { ok: true }
})
