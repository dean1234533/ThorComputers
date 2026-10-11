import { z } from 'zod'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { db, callable, requireAuth, requirePerm, requireVerified, notify, notifyAdmins, audit, FieldValue, Timestamp, HttpsError, REGION } from './core'
import { canEditReview, containsContactDetails } from './domain'

// ---------- messaging ----------
export const onMessageCreated = onDocumentCreated({ document: 'conversations/{cid}/messages/{mid}', region: REGION }, async (event) => {
  const m = event.data?.data(); if (!m) return
  const cRef = db.doc(`conversations/${event.params.cid}`), conv = (await cRef.get()).data(); if (!conv) return
  const others = (conv.participants as string[]).filter(u => u !== m.senderId)
  await cRef.update({ lastMessage: m.imagePath && !m.text ? 'Photo' : String(m.text).slice(0, 80), lastMessageAt: FieldValue.serverTimestamp(), ...Object.fromEntries(others.map(u => [`unread.${u}`, FieldValue.increment(1)])) })
  // Lock-screen safe: never include message text or sender details in push content.
  await Promise.all(others.map(u => notify({ userId: u, category: 'messages', dedupeKey: `msg:${event.params.mid}:${u}`, title: 'New message', body: 'You have a new message about a repair.', link: `/messages/${event.params.cid}` })))
})

// ---------- reviews (two-way) ----------
const star = z.number().int().min(1).max(5)
const ReviewInput = z.object({
  jobId: z.string(),
  ratings: z.record(star).refine(r => Object.keys(r).length >= 3, 'Rate every category'),
  text: z.string().trim().max(1000).optional().default(''),
})
const KEYS = { customer_to_engineer: ['quality', 'professionalism', 'communication', 'punctuality', 'value'], engineer_to_customer: ['communication', 'reliability', 'accuracy', 'overall'] }
const overall = (r: Record<string, number>) => Math.round(Object.values(r).reduce((a, b) => a + b, 0) / Object.values(r).length * 10) / 10

function checkReviewText(text: string) {
  if (containsContactDetails(text)) throw new HttpsError('invalid-argument', 'Please remove phone numbers and email addresses from your review.')
}

export const submitReview = callable(ReviewInput, async (req, d) => {
  const c = requireAuth(req); requireVerified(c)
  checkReviewText(d.text)
  const out = await db.runTransaction(async tx => {
    const job = (await tx.get(db.doc(`repairRequests/${d.jobId}`))).data()
    if (!job) throw new HttpsError('not-found', 'Job not found.')
    const direction = job.customerId === c.uid ? 'customer_to_engineer' : job.selectedEngineerId === c.uid ? 'engineer_to_customer' : null
    if (!direction) throw new HttpsError('permission-denied', 'Only people involved in this repair can review it.')
    if (!['completed', 'closed'].includes(job.status)) throw new HttpsError('failed-precondition', 'Reviews open once the repair is completed.')
    const keys = KEYS[direction]
    if (Object.keys(d.ratings).some(k => !keys.includes(k)) || keys.some(k => !d.ratings[k])) throw new HttpsError('invalid-argument', `Ratings required: ${keys.join(', ')}`)
    const rRef = db.doc(`reviews/${d.jobId}_${direction}`)
    if ((await tx.get(rRef)).exists) throw new HttpsError('already-exists', 'You have already reviewed this job.')
    const subjectId = direction === 'customer_to_engineer' ? job.selectedEngineerId : job.customerId
    const rating = overall(d.ratings)
    tx.create(rRef, { jobId: d.jobId, reference: job.reference, direction, authorId: c.uid, subjectId, ratings: d.ratings, rating, text: d.text, editCount: 0,
      status: direction === 'customer_to_engineer' ? 'published' : 'pending',   // feedback about customers is moderated before the customer sees it
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    if (direction === 'customer_to_engineer') tx.set(db.doc(`engineerProfiles/${subjectId}`), { ratingSum: FieldValue.increment(rating), reviewCount: FieldValue.increment(1) }, { merge: true })
    return { subjectId, direction, reference: job.reference as string, jobId: d.jobId }
  })
  if (out.direction === 'customer_to_engineer') {
    const prof = (await db.doc(`engineerProfiles/${out.subjectId}`).get()).data()!
    await db.doc(`engineerProfiles/${out.subjectId}`).update({ ratingAvg: Math.round(prof.ratingSum / prof.reviewCount * 10) / 10 })
    await notify({ userId: out.subjectId, category: 'reviews', dedupeKey: `review:${out.jobId}:${out.direction}`, title: 'You received a review', body: 'A customer reviewed your recent job.', link: '/engineer/reviews' })
  } else await notifyAdmins('reviews.moderate', { category: 'admin', dedupeKey: `review-pending:${out.jobId}`, title: 'Feedback awaiting moderation', body: 'An engineer left feedback about a customer.', link: '/admin/reviews' })
  return { ok: true }
})

/** One edit, within 48 hours. */
export const editReview = callable(z.object({ reviewId: z.string(), ratings: z.record(star), text: z.string().trim().max(1000).optional().default('') }), async (req, d) => {
  const c = requireAuth(req); checkReviewText(d.text)
  await db.runTransaction(async tx => {
    const rRef = db.doc(`reviews/${d.reviewId}`), r = (await tx.get(rRef)).data()
    if (!r || r.authorId !== c.uid) throw new HttpsError('permission-denied', 'Not your review.')
    if (r.status === 'removed') throw new HttpsError('failed-precondition', 'This review was removed.')
    if (!canEditReview(r.createdAt.toDate(), new Date(), r.editCount)) throw new HttpsError('failed-precondition', 'Reviews can be edited once, within 48 hours.')
    const keys = KEYS[r.direction as keyof typeof KEYS]
    if (keys.some(k => !d.ratings[k])) throw new HttpsError('invalid-argument', 'All ratings are required.')
    const rating = overall(d.ratings)
    const pr = db.doc(`engineerProfiles/${r.subjectId}`)
    const prof = r.direction === 'customer_to_engineer' && r.status === 'published' ? (await tx.get(pr)).data()! : null   // reads before writes
    tx.update(rRef, { ratings: d.ratings, rating, text: d.text, editCount: 1, status: r.direction === 'engineer_to_customer' ? 'pending' : r.status, updatedAt: FieldValue.serverTimestamp() })
    if (prof) {
      const sum = prof.ratingSum - r.rating + rating
      tx.update(pr, { ratingSum: sum, ratingAvg: Math.round(sum / prof.reviewCount * 10) / 10 })
    }
  })
  return { ok: true }
})

export const moderateReview = callable(z.object({ reviewId: z.string(), decision: z.enum(['approve', 'remove', 'restore']), note: z.string().trim().min(3).max(500) }), async (req, d) => {
  const c = requirePerm(req, 'reviews.moderate')
  await db.runTransaction(async tx => {
    const rRef = db.doc(`reviews/${d.reviewId}`), r = (await tx.get(rRef)).data()
    if (!r) throw new HttpsError('not-found', 'Review not found.')
    const next = d.decision === 'remove' ? 'removed' : 'published'
    if (next === r.status) return
    const pr = db.doc(`engineerProfiles/${r.subjectId}`)
    const p = r.direction === 'customer_to_engineer' ? (await tx.get(pr)).data()! : null   // reads before writes
    tx.update(rRef, { status: next, moderation: { by: c.uid, decision: d.decision, note: d.note, at: Timestamp.now() }, updatedAt: FieldValue.serverTimestamp() })
    if (p) {
      const sign = next === 'removed' ? -1 : 1, count = Math.max(0, (p.reviewCount ?? 0) + sign), sum = Math.max(0, (p.ratingSum ?? 0) + sign * r.rating)
      tx.update(pr, { reviewCount: count, ratingSum: sum, ratingAvg: count ? Math.round(sum / count * 10) / 10 : 0 })
    }
  })
  await audit(c.uid, `review.${d.decision}`, `reviews/${d.reviewId}`, { note: d.note })
  return { ok: true }
})

// ---------- reports & audited conversation access ----------
export const onReportCreated = onDocumentCreated({ document: 'reports/{id}', region: REGION }, async (event) => {
  await notifyAdmins('reviews.moderate', { category: 'admin', dedupeKey: `report:${event.params.id}`, title: 'New report', body: 'A user reported content or an account.', link: '/admin/reports' })
})

export const resolveReport = callable(z.object({ reportId: z.string(), outcome: z.enum(['dismissed', 'actioned']), note: z.string().trim().min(3).max(500) }), async (req, d) => {
  const c = requirePerm(req, 'reviews.moderate')
  await db.doc(`reports/${d.reportId}`).update({ status: d.outcome, resolution: { by: c.uid, note: d.note, at: Timestamp.now() } })
  await audit(c.uid, `report.${d.outcome}`, `reports/${d.reportId}`, { note: d.note })
  return { ok: true }
})

/** Admins can open a conversation only against an open report, with a stated reason, and every access is audit-logged. */
export const auditConversation = callable(z.object({ conversationId: z.string(), reportId: z.string(), reason: z.string().trim().min(10).max(500) }), async (req, d) => {
  const c = requirePerm(req, 'messages.audit')
  const report = (await db.doc(`reports/${d.reportId}`).get()).data()
  if (!report || report.status !== 'open' || report.conversationId !== d.conversationId) throw new HttpsError('failed-precondition', 'Conversation access requires an open report that references it.')
  await audit(c.uid, 'conversation.read', `conversations/${d.conversationId}`, { reportId: d.reportId, reason: d.reason })
  const msgs = await db.collection(`conversations/${d.conversationId}/messages`).orderBy('createdAt', 'desc').limit(200).get()
  return { messages: msgs.docs.reverse().map(m => ({ id: m.id, ...m.data(), createdAt: m.data().createdAt?.toMillis() ?? null })) }
})
