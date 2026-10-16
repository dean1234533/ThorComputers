import { z } from 'zod'
import { db, callable, requireAuth, requireRole, requireApprovedEngineer, requireVerified, requirePerm, notify, FieldValue, Timestamp, HttpsError, ref as newRef } from './core'
import { canTransition, requiredSpecsFor, quoteTotalPence, JobStatus } from './domain'
import { geocode, miles, coarse } from './geo'
import { p } from './email'
import { verifyEnquiry } from './wordpress'
import { DEVICES, METHODS, METHODS_FOR } from './catalog'
import { stripPrivate } from './privacy'
import { getFinanceSettings, getMarketplaceSettings } from './external'
import { advanceLeadDoc, advanceLeadForJob } from './leads'

export const RequestInput = z.object({
  requestKey: z.string().min(8).max(64).regex(/^[\w-]+$/),     // client-generated idempotency key
  device: z.object({ type: z.enum(DEVICES), manufacturer: z.string().trim().min(1).max(60), model: z.string().trim().max(80), os: z.string().trim().max(40).optional().default('') }),
  serialNumber: z.string().trim().max(60).optional().default(''),
  issues: z.array(z.string().max(60)).max(11).default([]),
  description: z.string().trim().min(10, 'Describe the problem in at least 10 characters').max(2000),
  startedAt: z.string().max(40).optional().default(''),
  urgency: z.enum(['flexible', 'soon', 'urgent']),
  serviceMethods: z.array(z.enum(METHODS)).min(1),
  postcode: z.string().trim().toUpperCase().regex(/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/, 'Enter a valid UK postcode'),
  addressLine: z.string().trim().max(160).optional().default(''),
  accessNotes: z.string().trim().max(300).optional().default(''),
  preferredDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(5).default([]),
  photoPaths: z.array(z.string()).max(6).default([]),
  source: z.enum(['app', 'wordpress', 'meta']).default('app'),
  enquiry: z.object({ id: z.string().max(80), token: z.string().max(80) }).optional(),   // set when continuing a WordPress enquiry
})

export async function createRequestFor(customerId: string, d: z.infer<typeof RequestInput>, attribution: Record<string, unknown> | null = null) {
  if (!(await getMarketplaceSettings()).newRequestsEnabled) throw new HttpsError('failed-precondition', 'New repair requests are paused for a short while. Please try again later.')
  const bad = d.serviceMethods.find(m => !METHODS_FOR[d.device.type].includes(m))
  if (bad) throw new HttpsError('invalid-argument', `"${bad}" is not available for this device type.`)
  if (d.photoPaths.some(x => !x.startsWith(`requests/${customerId}/${d.requestKey}/`) || x.split('/').length !== 4 || !x.split('/')[3])) throw new HttpsError('invalid-argument', 'Invalid photo reference.')
  const jobId = `${customerId}_${d.requestKey}`.slice(0, 120)
  const jobRef = db.doc(`repairRequests/${jobId}`)
  if ((await jobRef.get()).exists) return { jobId, reference: (await jobRef.get()).data()!.reference as string, duplicate: true }

  const geo = await geocode(d.postcode)
  if (!geo) throw new HttpsError('invalid-argument', 'We could not find that postcode.')
  // The orderBy matters: production serves this from the (customerId ASC, createdAt DESC) index. Without it the query needs an ASC index that was never deployed and
  // every submission failed with FAILED_PRECONDITION (the emulator does not enforce indexes, so tests could not see it). Verified against the live database.
  let recentCount = 0
  try { recentCount = (await db.collection('repairRequests').where('customerId', '==', customerId).where('createdAt', '>', Timestamp.fromMillis(Date.now() - 86400_000)).orderBy('createdAt', 'desc').count().get()).data().count }
  catch (e: any) { console.error('daily request limit check unavailable; allowing the request', { code: e?.code, message: String(e?.message).slice(0, 200) }) }   // abuse guard, not a security control: never block a customer because it errored
  if (recentCount >= 10) throw new HttpsError('resource-exhausted', 'Daily request limit reached.')

  const reference = newRef()
  // The description is readable by every approved engineer before the customer has chosen anyone. Postcodes, phone numbers, emails and street addresses typed into it are removed from the
  // public text; the original is kept in the private details, which only the chosen engineer can read once the quote is accepted.
  const publicText = stripPrivate(d.description), description = publicText.text.length >= 3 ? publicText.text : 'Details are shared with the engineer you choose.'
  const requiredSpecs = requiredSpecsFor(d.device.type, d.issues)
  const batch = db.batch()
  batch.create(jobRef, {
    reference, customerId, status: 'open' as JobStatus, selectedEngineerId: null, acceptedQuoteId: null,
    device: { type: d.device.type, manufacturer: d.device.manufacturer, model: d.device.model, os: d.device.os },
    issues: d.issues, summary: description.slice(0, 140), description, startedAt: d.startedAt, urgency: d.urgency,
    serviceMethods: d.serviceMethods, requiredSpecs, photoPaths: d.photoPaths, preferredDates: d.preferredDates,
    location: { area: geo.area, outcode: geo.outcode, lat: coarse(geo.lat), lng: coarse(geo.lng) },   // approximate only
    quoteCount: 0, source: d.source, attribution, paymentStatus: 'unpaid', statusHistory: [{ status: 'open', at: Timestamp.now(), by: customerId }],
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  })
  batch.create(db.doc(`repairRequests/${jobId}/private/details`), {   // never exposed to bidders
    postcode: d.postcode, addressLine: d.addressLine, accessNotes: d.accessNotes, serialNumber: d.serialNumber, exactLat: geo.lat, exactLng: geo.lng,
    ...(publicText.removed ? { descriptionOriginal: d.description } : {}),
  })
  await batch.commit()
  await notifyMatchingEngineers(jobId, requiredSpecs, geo, d.device.type, d.urgency)
  return { jobId, reference, duplicate: false }
}

async function notifyMatchingEngineers(jobId: string, specs: string[], geo: { lat: number; lng: number }, device: string, urgency: string) {
  const profs = await db.collection('engineerProfiles').where('status', '==', 'approved').where('specialisations', 'array-contains-any', specs.slice(0, 30)).limit(300).get()
  const targets: string[] = []
  await Promise.all(profs.docs.map(async d => {
    const app = (await db.doc(`engineerApplications/${d.id}`).get()).data()
    const g = app?.geo, radius = d.data().serviceRadiusMiles ?? 15
    if (!g || miles(g, geo) <= radius) targets.push(d.id)
  }))
  await Promise.all(targets.slice(0, 150).map(uid => notify({ userId: uid, category: 'quotes', dedupeKey: `job-new:${jobId}:${uid}`,
    title: urgency === 'urgent' ? 'Urgent repair near you' : 'New repair job near you', body: 'A new job matching your skills has been posted.', link: `/engineer/jobs/${jobId}` })))
}

export const createRepairRequest = callable(RequestInput, async (req, d) => {
  const c = requireRole(req, 'customer'); requireVerified(c)
  if (!d.enquiry) return createRequestFor(c.uid, d)
  const enq = await verifyEnquiry(d.enquiry.id, d.enquiry.token, String(c.token.email).toLowerCase())
  // Deterministic key => the same WordPress enquiry can only ever produce one repair request.
  const fromMeta = enq.data.source === 'meta'
  const res = await createRequestFor(c.uid, { ...d, requestKey: `${fromMeta ? 'meta' : 'wp'}_${d.enquiry.id}`.slice(0, 64), source: fromMeta ? 'meta' : 'wordpress' }, fromMeta ? (enq.data.attribution ?? null) : null)
  await enq.ref.update({ status: 'claimed', claimedBy: c.uid, jobId: res.jobId, claimedAt: FieldValue.serverTimestamp() })
  if (fromMeta && enq.data.metaLeadId) await advanceLeadDoc(enq.data.metaLeadId, 'converted_to_job', 'job_created', { jobId: res.jobId, customerId: c.uid })   // lead -> customer -> job link
  return res
})

// ---------- quotations ----------
const QuoteInput = z.object({
  jobId: z.string(),
  repairPence: z.number().int().min(0).max(5_000_000),
  diagnosticPence: z.number().int().min(0).max(500_000).default(0),
  calloutPence: z.number().int().min(0).max(500_000).default(0),
  durationHours: z.number().min(0.25).max(240),
  availability: z.string().trim().min(3).max(200),
  partsIncluded: z.boolean(),
  partsNote: z.string().trim().max(300).optional().default(''),
  warranty: z.string().trim().max(300).optional().default(''),
  notes: z.string().trim().max(800).optional().default(''),
  expiresAt: z.string().datetime(),
  serviceMethod: z.enum(METHODS),
})

export const submitQuote = callable(QuoteInput, async (req, d) => {
  const c = requireApprovedEngineer(req); requireVerified(c)
  const quoteId = `${d.jobId}_${c.uid}`                 // one live quote per engineer per job
  const jobRef = db.doc(`repairRequests/${d.jobId}`), quoteRef = db.doc(`repairQuotes/${quoteId}`)
  const mp = await getMarketplaceSettings()
  if (!mp.biddingEnabled) throw new HttpsError('failed-precondition', 'Quoting is paused for a short while. Please try again later.')
  const exp = new Date(d.expiresAt)
  if (exp.getTime() < Date.now() + 3600_000 || exp.getTime() > Date.now() + mp.maxQuoteValidityDays * 86400_000) throw new HttpsError('invalid-argument', `Expiry must be between 1 hour and ${mp.maxQuoteValidityDays} days from now.`)
  if (quoteTotalPence(d) <= 0) throw new HttpsError('invalid-argument', 'Quote total must be above £0.')
  const prof = (await db.doc(`engineerProfiles/${c.uid}`).get()).data()
  if (prof?.status !== 'approved') throw new HttpsError('permission-denied', 'Your engineer account is not approved.')

  const out = await db.runTransaction(async tx => {
    const [job, existing] = await Promise.all([tx.get(jobRef), tx.get(quoteRef)])
    if (!job.exists) throw new HttpsError('not-found', 'Job not found.')
    const j = job.data()!
    if (j.customerId === c.uid) throw new HttpsError('permission-denied', 'You cannot quote on your own job.')
    if (j.status !== 'open') throw new HttpsError('failed-precondition', 'This job is no longer open for quotes.')
    if (!existing.exists && (j.quoteCount ?? 0) >= mp.maxQuotesPerJob) throw new HttpsError('failed-precondition', 'This job has received the maximum number of quotations.')
    if (!j.requiredSpecs.some((s: string) => (c.token.specs as string[]).includes(s))) throw new HttpsError('permission-denied', 'This job is outside your approved specialisations.')
    if (!j.serviceMethods.includes(d.serviceMethod)) throw new HttpsError('invalid-argument', 'The customer did not request that service method.')
    if (existing.exists && existing.data()!.status !== 'submitted' && existing.data()!.status !== 'withdrawn') throw new HttpsError('failed-precondition', 'This quote can no longer be changed.')
    const version = existing.exists ? (existing.data()!.version ?? 1) + 1 : 1
    const { jobId: _j, expiresAt: _e, ...money } = d
    tx.set(quoteRef, {
      ...money, jobId: d.jobId, engineerId: c.uid, customerId: j.customerId, totalPence: quoteTotalPence(d), currency: 'GBP',
      provider: prof.provider ?? 'independent', status: 'submitted', version, expiresAt: Timestamp.fromDate(exp),
      createdAt: existing.exists ? existing.data()!.createdAt : FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
    if (!existing.exists || existing.data()!.status === 'withdrawn') tx.update(jobRef, { quoteCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() })
    const convId = quoteId
    tx.set(db.doc(`conversations/${convId}`), { jobId: d.jobId, participants: [j.customerId, c.uid], customerId: j.customerId, engineerId: c.uid, closed: false, unread: { [j.customerId]: 0, [c.uid]: 0 }, lastMessage: null, lastMessageAt: FieldValue.serverTimestamp() }, { merge: true })
    return { customerId: j.customerId, version, reference: j.reference as string, updated: existing.exists }
  })
  await notify({ userId: out.customerId, category: 'quotes', dedupeKey: `quote:${quoteId}:v${out.version}`,
    title: out.updated ? 'A quotation was updated' : 'New quotation received', body: `Open ${out.reference} to compare your quotes.`, link: `/customer/repairs/${d.jobId}`,
    email: { subject: out.updated ? 'A quotation was updated' : 'You have a new quotation', heading: out.updated ? 'Quotation updated' : 'New quotation', html: `<p>An engineer has ${out.updated ? 'updated their quote' : 'sent a quote'} for repair <b>${p(out.reference)}</b>. Compare prices, qualifications and reviews before you choose.</p>`, cta: 'Compare quotes' } })
  await advanceLeadForJob(d.jobId, 'receiving_bids', 'first_bid')
  return { quoteId }
})

export const withdrawQuote = callable(z.object({ quoteId: z.string() }), async (req, d) => {
  const c = requireApprovedEngineer(req)
  await db.runTransaction(async tx => {
    const qr = db.doc(`repairQuotes/${d.quoteId}`), q = await tx.get(qr)
    if (!q.exists || q.data()!.engineerId !== c.uid) throw new HttpsError('permission-denied', 'Not your quote.')
    if (q.data()!.status !== 'submitted') throw new HttpsError('failed-precondition', 'Only live quotes can be withdrawn.')
    tx.update(qr, { status: 'withdrawn', updatedAt: FieldValue.serverTimestamp() })
    tx.update(db.doc(`repairRequests/${q.data()!.jobId}`), { quoteCount: FieldValue.increment(-1) })
  })
  return { ok: true }
})

/** Atomic: exactly one quote can be accepted per job, retries are idempotent. */
export const acceptQuote = callable(z.object({ quoteId: z.string() }), async (req, d) => {
  const c = requireRole(req, 'customer'); requireVerified(c)
  const qRef = db.doc(`repairQuotes/${d.quoteId}`)
  const commissionBps = (await getFinanceSettings()).commissionBps   // frozen onto the job at acceptance: later rate changes never alter an accepted quotation
  const res = await db.runTransaction(async tx => {
    const q = await tx.get(qRef)
    if (!q.exists) throw new HttpsError('not-found', 'Quote not found.')
    const quote = q.data()!
    const jRef = db.doc(`repairRequests/${quote.jobId}`), job = (await tx.get(jRef)).data()
    if (!job || job.customerId !== c.uid) throw new HttpsError('permission-denied', 'Not your job.')
    if (job.acceptedQuoteId === d.quoteId) return { replay: true, losers: [] as string[], engineerId: quote.engineerId, reference: job.reference, jobId: quote.jobId }
    if (job.status !== 'open') throw new HttpsError('failed-precondition', 'A quote has already been accepted for this job.')
    if (quote.status !== 'submitted') throw new HttpsError('failed-precondition', 'This quote is no longer available.')
    if (quote.expiresAt.toMillis() < Date.now()) throw new HttpsError('failed-precondition', 'This quote has expired. Ask the engineer to refresh it.')
    const prof = (await tx.get(db.doc(`engineerProfiles/${quote.engineerId}`))).data()
    if (prof?.status !== 'approved') throw new HttpsError('failed-precondition', 'This engineer is no longer available.')
    const [custUser, engUser] = await Promise.all([tx.get(db.doc(`users/${c.uid}`)), tx.get(db.doc(`users/${quote.engineerId}`))])   // reads before writes
    const others = await tx.get(db.collection('repairQuotes').where('jobId', '==', quote.jobId).where('customerId', '==', c.uid).where('status', '==', 'submitted'))
    const losers: string[] = []
    others.docs.forEach(o => { if (o.id !== d.quoteId) { tx.update(o.ref, { status: 'declined', updatedAt: FieldValue.serverTimestamp() }); losers.push(o.data().engineerId); tx.update(db.doc(`conversations/${o.id}`), { closed: true }) } })
    // Contact details are exchanged ONLY now, between the customer and the engineer they chose. Bidders and rejected engineers never get them (rules: private/details is
    // readable by the customer, the selected engineer once the job is no longer open, and job admins).
    const contact = (u?: FirebaseFirestore.DocumentData, fallback = '') => ({ name: String(u?.fullName ?? fallback), phone: String(u?.phone ?? ''), email: String(u?.email ?? '') })
    tx.set(db.doc(`repairRequests/${quote.jobId}/private/details`), { customerContact: contact(custUser.data()), engineerContact: contact(engUser.data(), prof?.displayName), contactSharedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.update(qRef, { status: 'accepted', acceptedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    tx.update(jRef, { status: 'engineer_selected', selectedEngineerId: quote.engineerId, acceptedQuoteId: d.quoteId, agreedTotalPence: quote.totalPence, commissionBps, agreedMethod: quote.serviceMethod, provider: quote.provider,
      statusHistory: FieldValue.arrayUnion({ status: 'engineer_selected', at: Timestamp.now(), by: c.uid }), updatedAt: FieldValue.serverTimestamp() })
    return { replay: false, losers, engineerId: quote.engineerId as string, reference: job.reference as string, jobId: quote.jobId as string }
  })
  if (!res.replay) {
    await advanceLeadForJob(res.jobId, 'engineer_selected', 'engineer_selected')
    await notify({ userId: res.engineerId, category: 'quotes', dedupeKey: `quote-accepted:${d.quoteId}`, title: 'Your quotation was accepted', body: 'Open the job to see next steps.', link: `/engineer/my-jobs/${res.jobId}`,
      email: { subject: 'Your quotation was accepted', heading: 'You got the job', html: `<p>The customer accepted your quote for <b>${p(res.reference)}</b>. They will now book an appointment.</p>`, cta: 'View job' } })
    await Promise.all(res.losers.map(uid => notify({ userId: uid, category: 'quotes', dedupeKey: `quote-declined:${res.jobId}:${uid}`, title: 'Quotation not selected', body: 'The customer chose another engineer for this job.', link: '/engineer/quotations' })))
  }
  return { jobId: res.jobId }
})

// ---------- status changes ----------
export const changeJobStatus = callable(z.object({ jobId: z.string(), to: z.enum(['cancelled', 'on_the_way', 'in_progress', 'awaiting_parts', 'completed', 'closed', 'disputed']), note: z.string().max(500).optional() }), async (req, d) => {
  const c = requireAuth(req)
  const jRef = db.doc(`repairRequests/${d.jobId}`)
  const out = await db.runTransaction(async tx => {
    const snap = await tx.get(jRef); if (!snap.exists) throw new HttpsError('not-found', 'Job not found.')
    const j = snap.data()!, from = j.status as JobStatus
    const actor = c.role === 'admin' ? (requirePerm(req, 'jobs.manage'), 'admin') : j.customerId === c.uid ? 'customer' : j.selectedEngineerId === c.uid ? 'engineer' : null
    if (!actor) throw new HttpsError('permission-denied', 'You are not part of this job.')
    if (from === d.to) return { noop: true as const }
    if (!canTransition(actor, from, d.to)) throw new HttpsError('failed-precondition', `${actor} cannot move a job from ${from} to ${d.to}.`)
    // Firestore requires every read before the first write.
    const cancelling = d.to === 'cancelled', finishing = cancelling || d.to === 'completed' || d.to === 'closed'
    const apps = finishing ? await tx.get(db.collection('appointments').where('jobId', '==', d.jobId).where('status', 'in', ['confirmed', 'reschedule_requested'])) : null
    const liveQuotes = cancelling && from === 'open' ? await tx.get(db.collection('repairQuotes').where('jobId', '==', d.jobId).where('status', '==', 'submitted')) : null
    tx.update(jRef, { status: d.to, statusHistory: FieldValue.arrayUnion({ status: d.to, at: Timestamp.now(), by: c.uid, ...(d.note ? { note: d.note } : {}) }), updatedAt: FieldValue.serverTimestamp(), ...(d.to === 'completed' ? { completedAt: FieldValue.serverTimestamp() } : {}) })
    if (d.to === 'completed' && j.selectedEngineerId) tx.set(db.doc(`engineerProfiles/${j.selectedEngineerId}`), { completedJobs: FieldValue.increment(1) }, { merge: true })
    // A finished repair must not keep a live appointment: cancelled repairs cancel it, completed/closed repairs mark it completed; either way its slots are released and reminders stop.
    apps?.docs.forEach(a => { tx.update(a.ref, cancelling ? { status: 'cancelled', cancelledBy: c.uid, updatedAt: FieldValue.serverTimestamp() } : { status: 'completed', completedWithJob: true, pendingReschedule: null, updatedAt: FieldValue.serverTimestamp() }); (a.data().slotKeys as string[]).forEach(k => tx.delete(db.doc(`appointmentSlots/${a.data().engineerId}_${k}`))) })
    liveQuotes?.docs.forEach(q => tx.update(q.ref, { status: 'declined' }))
    return { noop: false as const, j, actor, from }
  })
  if (out.noop) return { ok: true }
  if (d.to === 'completed' || d.to === 'closed') await advanceLeadForJob(d.jobId, 'completed', 'completed')
  const { j, actor } = out
  const label: Record<string, string> = { cancelled: 'Repair cancelled', on_the_way: 'Your engineer is on the way', in_progress: 'Repair in progress', awaiting_parts: 'Awaiting parts', completed: 'Repair completed', closed: 'Repair closed', disputed: 'Repair disputed' }
  const other = actor === 'engineer' || actor === 'admin' ? j.customerId : j.selectedEngineerId
  const targets = new Set<string>([other, ...(actor === 'admin' ? [j.selectedEngineerId] : [])].filter(Boolean))
  await Promise.all([...targets].map(uid => notify({ userId: uid, category: 'status', dedupeKey: `status:${d.jobId}:${d.to}:${uid}`, title: label[d.to], body: `Update on ${j.reference}.`, link: uid === j.customerId ? `/customer/repairs/${d.jobId}` : `/engineer/my-jobs/${d.jobId}`,
    ...(d.to === 'completed' && uid === j.customerId ? { email: { subject: 'Your repair is complete', heading: 'Repair completed', html: `<p>Your engineer has marked <b>${p(j.reference)}</b> as complete. Please check the work and leave a review.</p>`, cta: 'Review your engineer' } } : {}) })))
  return { ok: true }
})

/** Address is added/changed here (rules block direct writes to the private subdocument). */
export const updateJobPrivate = callable(z.object({ jobId: z.string(), addressLine: z.string().trim().min(5).max(160), accessNotes: z.string().trim().max(300).optional().default('') }), async (req, d) => {
  const c = requireRole(req, 'customer')
  const job = (await db.doc(`repairRequests/${d.jobId}`).get()).data()
  if (!job || job.customerId !== c.uid) throw new HttpsError('permission-denied', 'Not your job.')
  if (['closed', 'cancelled'].includes(job.status)) throw new HttpsError('failed-precondition', 'This job is finished.')
  await db.doc(`repairRequests/${d.jobId}/private/details`).set({ addressLine: d.addressLine, accessNotes: d.accessNotes }, { merge: true })
  return { ok: true }
})
