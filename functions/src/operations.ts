import { z } from 'zod'
import { db, callable, requireAuth, requirePerm, notify, notifyAdmins, audit, FieldValue, Timestamp, HttpsError, hasPerm } from './core'
import { canTransition, JobStatus } from './domain'
import { issueRefund, STRIPE_SECRETS } from './payments'

// ---------- marketplace disputes (customer complaint -> engineer response -> admin decision) ----------
export const respondToDispute = callable(z.object({ jobId: z.string(), response: z.string().trim().min(10).max(2000) }), async (req, d) => {
  const c = requireAuth(req)
  const ref = db.doc(`disputes/${d.jobId}`), dp = (await ref.get()).data()
  if (!dp || dp.engineerId !== c.uid) throw new HttpsError('permission-denied', 'Not your dispute.')
  if (dp.status !== 'open') throw new HttpsError('failed-precondition', 'This dispute is already resolved.')
  await ref.update({ engineerResponse: d.response, engineerRespondedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  await notifyAdmins('disputes.manage', { category: 'admin', dedupeKey: `dispute-resp:${d.jobId}:${Date.now()}`, title: 'Engineer responded to a dispute', body: `${dp.reference} has a new response.`, link: '/admin/disputes' })
  return { ok: true }
})

export const resolveDispute = callable(z.object({
  jobId: z.string(), outcome: z.enum(['completed', 'closed', 'cancelled']), resolution: z.string().trim().min(10).max(2000),
  refund: z.object({ paymentId: z.string(), amountPence: z.number().int().min(1) }).optional(), requestKey: z.string().min(8).max(64),
}), async (req, d) => {
  const c = requirePerm(req, 'disputes.manage')
  const dRef = db.doc(`disputes/${d.jobId}`), jRef = db.doc(`repairRequests/${d.jobId}`)
  const [dp, j] = await Promise.all([dRef.get().then(s => s.data()), jRef.get().then(s => s.data())])
  if (!dp || !j) throw new HttpsError('not-found', 'Dispute not found.')
  if (dp.status !== 'open') throw new HttpsError('failed-precondition', 'Already resolved.')
  if (j.status === 'disputed' && !canTransition('admin', 'disputed', d.outcome as JobStatus)) throw new HttpsError('failed-precondition', 'Invalid outcome.')
  let refund: { id: string; amount: number } | null = null
  if (d.refund) {
    if (!hasPerm(c, 'payments.manage')) throw new HttpsError('permission-denied', 'Refunds need the payments permission. Ask a super administrator.')
    const pay = (await db.doc(`payments/${d.refund.paymentId}`).get()).data()
    if (pay?.jobId !== d.jobId) throw new HttpsError('invalid-argument', 'That payment does not belong to this job.')
    const r = await issueRefund(d.refund.paymentId, d.refund.amountPence, c.uid, `Dispute: ${d.resolution}`, d.requestKey); refund = { id: r.id, amount: r.amount }
  }
  await db.runTransaction(async tx => {
    const cur = (await tx.get(jRef)).data()!
    if (cur.status === 'disputed') tx.update(jRef, { status: d.outcome, statusHistory: FieldValue.arrayUnion({ status: d.outcome, at: Timestamp.now(), by: c.uid, note: 'dispute resolved' }), updatedAt: FieldValue.serverTimestamp() })
    tx.update(dRef, { status: 'resolved', resolution: { outcome: d.outcome, text: d.resolution, by: c.uid, at: Timestamp.now(), refund }, updatedAt: FieldValue.serverTimestamp() })
  })
  await audit(c.uid, 'dispute.resolve', `disputes/${d.jobId}`, { outcome: d.outcome, refund })
  await Promise.all([dp.customerId, dp.engineerId].filter(Boolean).map((u: string) => notify({ userId: u, category: 'status', dedupeKey: `dispute-resolved:${d.jobId}:${u}`, title: 'Dispute resolved', body: `Our decision on ${dp.reference} is ready.`, link: u === dp.customerId ? `/customer/repairs/${d.jobId}` : `/engineer/my-jobs/${d.jobId}` })))
  return { ok: true, refund }
}, { secrets: STRIPE_SECRETS })

// ---------- support tickets ----------
export const createSupportTicket = callable(z.object({
  subject: z.string().trim().min(3).max(120), message: z.string().trim().min(10).max(4000), jobId: z.string().max(140).optional(),
  category: z.enum(['repair', 'payment', 'account', 'engineer', 'other']).default('other'), transcript: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).max(30).optional(),
}), async (req, d) => {
  const c = requireAuth(req)
  const open = await db.collection('supportTickets').where('userId', '==', c.uid).where('status', 'in', ['open', 'pending']).count().get()
  if (open.data().count >= 5) throw new HttpsError('resource-exhausted', 'You already have several open tickets. We’ll reply to those first.')
  if (d.jobId) { const j = (await db.doc(`repairRequests/${d.jobId}`).get()).data(); if (!j || (j.customerId !== c.uid && j.selectedEngineerId !== c.uid)) throw new HttpsError('permission-denied', 'Not your job.') }
  const ref = await db.collection('supportTickets').add({ userId: c.uid, role: c.role, subject: d.subject, category: d.category, jobId: d.jobId ?? null, status: 'open', priority: 'normal', assignedTo: null,
    lastMessageAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), fromChatbot: !!d.transcript })
  await ref.collection('messages').add({ authorId: c.uid, staff: false, text: d.message, transcript: d.transcript ?? null, createdAt: FieldValue.serverTimestamp() })
  await notifyAdmins('support.handle', { category: 'admin', dedupeKey: `ticket:${ref.id}`, title: 'New support ticket', body: d.subject.slice(0, 80), link: `/admin/support/${ref.id}` })
  return { ticketId: ref.id }
})

export const replySupportTicket = callable(z.object({ ticketId: z.string(), text: z.string().trim().min(1).max(4000) }), async (req, d) => {
  const c = requireAuth(req)
  const ref = db.doc(`supportTickets/${d.ticketId}`), t = (await ref.get()).data()
  if (!t) throw new HttpsError('not-found', 'Ticket not found.')
  const staff = hasPerm(c, 'support.handle')
  if (!staff && t.userId !== c.uid) throw new HttpsError('permission-denied', 'Not your ticket.')
  if (t.status === 'closed') throw new HttpsError('failed-precondition', 'This ticket is closed. Open a new one if you still need help.')
  await ref.collection('messages').add({ authorId: c.uid, staff, text: d.text, createdAt: FieldValue.serverTimestamp() })
  await ref.update({ status: staff ? 'pending' : 'open', lastMessageAt: FieldValue.serverTimestamp(), ...(staff && !t.assignedTo ? { assignedTo: c.uid } : {}) })
  if (staff) await notify({ userId: t.userId, category: 'support', dedupeKey: `ticket-reply:${d.ticketId}:${Date.now()}`, title: 'Support replied', body: 'Thor Computer support replied to your enquiry.', link: `/support/${d.ticketId}`,
    email: { subject: `Re: ${t.subject}`, heading: 'We replied to your enquiry', html: '<p>Our support team has replied. Open the app to read it.</p>', cta: 'Read reply' } })
  else if (t.assignedTo) await notify({ userId: t.assignedTo, category: 'admin', dedupeKey: `ticket-user:${d.ticketId}:${Date.now()}`, title: 'Customer replied', body: t.subject.slice(0, 80), link: `/admin/support/${d.ticketId}` })
  return { ok: true }
})

export const updateSupportTicket = callable(z.object({ ticketId: z.string(), status: z.enum(['open', 'pending', 'closed']).optional(), assignToMe: z.boolean().optional(), escalate: z.boolean().optional(), note: z.string().max(500).optional() }), async (req, d) => {
  const c = requirePerm(req, 'support.handle')
  const ref = db.doc(`supportTickets/${d.ticketId}`), t = (await ref.get()).data()
  if (!t) throw new HttpsError('not-found', 'Ticket not found.')
  await ref.update({ ...(d.status ? { status: d.status } : {}), ...(d.assignToMe ? { assignedTo: c.uid } : {}), ...(d.escalate ? { priority: 'escalated', escalatedBy: c.uid, escalatedAt: FieldValue.serverTimestamp() } : {}), updatedAt: FieldValue.serverTimestamp() })
  if (d.escalate) await notifyAdmins('disputes.manage', { category: 'admin', dedupeKey: `ticket-esc:${d.ticketId}`, title: 'Support ticket escalated', body: `${t.subject.slice(0, 60)}${d.note ? `: ${d.note.slice(0, 60)}` : ''}`, link: `/admin/support/${d.ticketId}` })
  await audit(c.uid, 'support.update', `supportTickets/${d.ticketId}`, { status: d.status, escalate: d.escalate ?? false })
  return { ok: true }
})

// ---------- admin user search ----------
export const adminSearchUsers = callable(z.object({ q: z.string().trim().min(2).max(120), role: z.enum(['customer', 'engineer', 'admin']).optional() }), async (req, d) => {
  requirePerm(req, 'customers.manage')
  const out = new Map<string, FirebaseFirestore.DocumentData>()
  const add = (s: FirebaseFirestore.QuerySnapshot) => s.docs.forEach(x => out.set(x.id, x.data()))
  const base = d.role ? db.collection('users').where('role', '==', d.role) : db.collection('users')
  if (d.q.includes('@')) add(await base.where('email', '==', d.q.toLowerCase()).limit(10).get())
  const byId = /^[A-Za-z0-9]{20,40}$/.test(d.q) ? await db.doc(`users/${d.q}`).get() : null
  if (byId?.exists) out.set(byId.id, byId.data()!)
  const cap = d.q[0].toUpperCase() + d.q.slice(1)
  for (const prefix of new Set([d.q, cap])) add(await base.where('fullName', '>=', prefix).where('fullName', '<=', prefix + '').limit(20).get())
  if (d.q.includes('@') && out.size === 0) add(await base.where('email', '==', d.q).limit(10).get())
  // Phone numbers, addresses and payment data are not returned in search results.
  return { users: [...out].filter(([, u]) => !d.role || u.role === d.role).slice(0, 40).map(([id, u]) => ({ id, fullName: u.fullName, email: u.email, role: u.role, status: u.status, engineerStatus: u.engineerStatus ?? null, createdAt: u.createdAt?.toMillis() ?? null })) }
})
