// Customer contact list (CRM) and work-progress tracking.
// `users` stays the single source of truth for customers: summary counters are written onto the user document by triggers
// (never computed in the browser). Money totals live separately in contactFinance/{uid} so only finance.view can read them.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { z } from 'zod'
import { db, callable, requirePerm, requireApprovedEngineer, notify, audit, hasPerm, FieldValue, Timestamp, HttpsError, REGION } from './core'

const ACTIVE = ['awaiting_verification', 'open', 'engineer_selected', 'awaiting_payment', 'appointment_scheduled', 'on_the_way', 'in_progress', 'awaiting_parts', 'completed', 'disputed']
const SOURCE_LABEL = (j?: FirebaseFirestore.DocumentData) => !j ? 'app' : j.source === 'meta' ? (j.attribution?.platform === 'instagram' ? 'instagram' : 'facebook') : (j.source ?? 'app')

/** Recomputes a customer's summary from their jobs. Idempotent: safe to run from any trigger, retry or the backfill script. */
export async function refreshContactSummary(uid: string) {
  const user = await db.doc(`users/${uid}`).get()
  if (!user.exists || user.data()!.role !== 'customer') return
  const jobs = (await db.collection('repairRequests').where('customerId', '==', uid).select('status', 'source', 'attribution', 'reference', 'createdAt', 'updatedAt', 'payment').get()).docs.map(d => d.data())
  const byCreated = [...jobs].sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))
  const last = Math.max(user.data()!.createdAt?.toMillis() ?? 0, ...jobs.map(j => j.updatedAt?.toMillis() ?? j.createdAt?.toMillis() ?? 0))
  const paid = jobs.reduce((n, j) => n + (j.payment?.paidPence ?? 0) - (j.payment?.refundedPence ?? 0), 0)
  await db.doc(`users/${uid}`).set({ contact: {
    totalRepairs: jobs.length, activeRepairs: jobs.filter(j => ACTIVE.includes(j.status)).length, lastActivityAt: last ? Timestamp.fromMillis(last) : null,
    source: user.data()!.createdVia === 'meta_lead' ? SOURCE_LABEL(byCreated[0]) : byCreated.length ? SOURCE_LABEL(byCreated[0]) : 'app',
    lastJobRef: byCreated.at(-1)?.reference ?? null, updatedAt: FieldValue.serverTimestamp(),
  } }, { merge: true })
  await db.doc(`contactFinance/${uid}`).set({ userId: uid, totalPaidPence: paid, updatedAt: FieldValue.serverTimestamp() })
}

export const onRepairRequestWrittenContact = onDocumentWritten({ document: 'repairRequests/{id}', region: REGION }, async (event) => {
  const b = event.data?.before.data(), a = event.data?.after.data()
  const uid = a?.customerId ?? b?.customerId
  if (!uid) return
  // Only status, payment or creation change the summary; skip noise such as message counters.
  if (b && a && b.status === a.status && b.payment?.paidPence === a.payment?.paidPence && b.payment?.refundedPence === a.payment?.refundedPence) return
  await refreshContactSummary(uid)
})

// ---------- contact management (customers.manage) ----------
async function customer(uid: string) {
  const u = (await db.doc(`users/${uid}`).get()).data()
  if (!u || u.role !== 'customer') throw new HttpsError('not-found', 'Customer not found.')
  return u
}

export const updateContact = callable(z.object({ userId: z.string(), tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(), assignedTo: z.string().nullable().optional() }), async (req, d) => {
  const c = requirePerm(req, 'customers.manage'); await customer(d.userId)
  if (d.assignedTo) { const s = (await db.doc(`users/${d.assignedTo}`).get()).data(); if (s?.role !== 'admin' || s.status !== 'active') throw new HttpsError('invalid-argument', 'Assign the contact to an active staff member.') }
  // Staff-only metadata lives outside the user document, which the customer can read.
  const upd: Record<string, unknown> = { userId: d.userId, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid }
  if (d.tags) upd.tags = [...new Set(d.tags.map(t => t.toLowerCase()))]
  if (d.assignedTo !== undefined) upd.assignedTo = d.assignedTo
  await db.doc(`contactMeta/${d.userId}`).set(upd, { merge: true })
  await audit(c.uid, 'contact.update', `users/${d.userId}`, { tags: d.tags, assignedTo: d.assignedTo })
  return { ok: true }
})

/** Internal staff notes: never readable by customers or engineers (rules), editable only by their author. */
export const addContactNote = callable(z.object({ userId: z.string(), text: z.string().trim().min(2).max(4000), jobId: z.string().max(140).optional() }), async (req, d) => {
  const c = requirePerm(req, 'customers.manage'); await customer(d.userId)
  const ref = await db.collection(`users/${d.userId}/contactNotes`).add({ authorId: c.uid, text: d.text, jobId: d.jobId ?? null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'contact.note.add', ref.path)
  return { noteId: ref.id }
})
export const editContactNote = callable(z.object({ userId: z.string(), noteId: z.string(), text: z.string().trim().min(2).max(4000) }), async (req, d) => {
  const c = requirePerm(req, 'customers.manage')
  const ref = db.doc(`users/${d.userId}/contactNotes/${d.noteId}`), n = (await ref.get()).data()
  if (!n) throw new HttpsError('not-found', 'Note not found.')
  if (n.authorId !== c.uid) throw new HttpsError('permission-denied', 'Only the author can edit a note.')
  await ref.update({ text: d.text, updatedAt: FieldValue.serverTimestamp(), edited: true })
  await audit(c.uid, 'contact.note.edit', ref.path)
  return { ok: true }
})

export const upsertContactTask = callable(z.object({
  taskId: z.string().optional(), userId: z.string(), title: z.string().trim().min(3).max(200), dueAt: z.string().datetime(), ownerId: z.string(), status: z.enum(['open', 'done']).default('open'),
}), async (req, d) => {
  const c = requirePerm(req, 'customers.manage'); const u = await customer(d.userId)
  const owner = (await db.doc(`users/${d.ownerId}`).get()).data()
  if (owner?.role !== 'admin' || owner.status !== 'active') throw new HttpsError('invalid-argument', 'Tasks must be owned by an active staff member.')
  const ref = d.taskId ? db.doc(`contactTasks/${d.taskId}`) : db.collection('contactTasks').doc()
  if (d.taskId && !(await ref.get()).exists) throw new HttpsError('not-found', 'Task not found.')
  await ref.set({ userId: d.userId, contactName: u.fullName ?? '', title: d.title, dueAt: Timestamp.fromDate(new Date(d.dueAt)), ownerId: d.ownerId, status: d.status,
    ...(d.taskId ? {} : { createdBy: c.uid, createdAt: FieldValue.serverTimestamp(), reminded: false }), ...(d.status === 'done' ? { doneAt: FieldValue.serverTimestamp(), doneBy: c.uid } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  if (d.taskId) await ref.update({ reminded: false })   // a changed due date gets a fresh reminder
  await audit(c.uid, d.taskId ? 'contact.task.update' : 'contact.task.create', ref.path, { status: d.status, ownerId: d.ownerId })
  return { taskId: ref.id }
})

/** Hourly: tell owners about overdue follow-up tasks (once per due date). */
export const contactTaskReminders = onSchedule({ region: REGION, schedule: 'every 60 minutes' }, async () => {
  const due = await db.collection('contactTasks').where('status', '==', 'open').where('dueAt', '<=', Timestamp.now()).limit(300).get()
  for (const t of due.docs.filter(x => !x.data().reminded)) {
    await notify({ userId: t.data().ownerId, category: 'admin', dedupeKey: `task-overdue:${t.id}:${t.data().dueAt.toMillis()}`, title: 'Follow-up overdue', body: t.data().title.slice(0, 90), link: `/admin/contacts/${t.data().userId}` })
    await t.ref.update({ reminded: true })
  }
})

/** Export is server-side so it is always audited, and support staff only ever receive basic contact fields. */
export const exportContacts = callable(z.object({ status: z.string().max(20).optional(), source: z.string().max(20).optional(), tag: z.string().max(30).optional(), assignedTo: z.string().max(40).optional() }), async (req, d) => {
  const c = requirePerm(req, 'customers.manage')
  const full = c.token.adminLevel !== 'support', money = hasPerm(c, 'finance.view')
  let q: FirebaseFirestore.Query = db.collection('users').where('role', '==', 'customer')
  if (d.status) q = q.where('status', '==', d.status)
  const all = (await q.limit(10000).get()).docs
  const meta = new Map((await db.collection('contactMeta').get()).docs.map(m => [m.id, m.data()]))
  const users = all.filter(u => (!d.source || u.data().contact?.source === d.source) && (!d.tag || (meta.get(u.id)?.tags ?? []).includes(d.tag)) && (!d.assignedTo || meta.get(u.id)?.assignedTo === d.assignedTo))
  const fin = money ? new Map((await Promise.all(users.map(u => db.doc(`contactFinance/${u.id}`).get()))).map(s => [s.id, s.data()?.totalPaidPence ?? 0])) : null
  const rows = users.map(u => { const x = u.data(), base = { name: x.fullName, email: x.email, phone: x.phone, status: x.status }
    return full ? { ...base, postcode: x.postcode, source: x.contact?.source ?? 'app', joined: x.createdAt?.toDate().toISOString() ?? '', totalRepairs: x.contact?.totalRepairs ?? 0, activeRepairs: x.contact?.activeRepairs ?? 0,
      lastActivity: x.contact?.lastActivityAt?.toDate().toISOString() ?? '', marketingConsent: x.privacy?.marketingEmails === true, tags: (meta.get(u.id)?.tags ?? []).join(' '), ...(fin ? { totalPaidGBP: ((fin.get(u.id) ?? 0) / 100).toFixed(2) } : {}) } : base })
  await audit(c.uid, 'contact.export', 'users', { rows: rows.length, scope: full ? 'full' : 'basic', money: !!fin, filters: d })
  return { rows }
})

// ---------- engineer progress updates ----------
const PROGRESS_STATUSES = ['appointment_scheduled', 'on_the_way', 'in_progress', 'awaiting_parts', 'completed']
export const postProgressUpdate = callable(z.object({ jobId: z.string(), text: z.string().trim().min(3).max(1500), photoPaths: z.array(z.string()).max(4).default([]), percent: z.number().int().min(0).max(100).optional() }), async (req, d) => {
  const c = requireApprovedEngineer(req)
  const jRef = db.doc(`repairRequests/${d.jobId}`), j = (await jRef.get()).data()
  if (!j || j.selectedEngineerId !== c.uid) throw new HttpsError('permission-denied', 'Not your job.')
  if (!PROGRESS_STATUSES.includes(j.status)) throw new HttpsError('failed-precondition', 'Progress updates can be posted once the appointment is booked.')
  if (d.photoPaths.some(x => !x.startsWith(`jobs/${d.jobId}/progress/`))) throw new HttpsError('invalid-argument', 'Invalid photo reference.')
  const ref = await jRef.collection('progress').add({ authorId: c.uid, text: d.text, photoPaths: d.photoPaths, percent: d.percent ?? null, createdAt: FieldValue.serverTimestamp() })
  await jRef.update({ lastProgressAt: FieldValue.serverTimestamp(), ...(d.percent !== undefined ? { progressPercent: d.percent } : {}) })
  await notify({ userId: j.customerId, category: 'status', dedupeKey: `progress:${ref.id}`, title: 'Repair progress update', body: `Your engineer posted an update on ${j.reference}.`, link: `/customer/repairs/${d.jobId}` })
  return { updateId: ref.id }
})

export const saveSlaSettings = callable(z.object({ hours: z.record(z.enum(['awaiting_verification', 'open', 'engineer_selected', 'awaiting_payment', 'appointment_scheduled', 'on_the_way', 'in_progress', 'awaiting_parts', 'completed', 'disputed']), z.number().min(1).max(2000)) }), async (req, d) => {
  const c = requirePerm(req, 'settings.edit')
  await db.doc('platformSettings/public').set({ sla: { hours: d.hours } }, { merge: true })
  await audit(c.uid, 'settings.sla', 'platformSettings/public', d.hours)
  return { ok: true }
})
