import { z } from 'zod'
import { db, auth, callable, requireAuth, requirePerm, setClaims, audit, FieldValue, HttpsError, notify, notifyAdmins, APP_URL } from './core'
import { sendEmail, p } from './email'
import { getStorage } from 'firebase-admin/storage'

const postcode = z.string().trim().toUpperCase().regex(/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/, 'Enter a valid UK postcode')
const phone = z.string().trim().regex(/^(\+44|0)\d{9,10}$|^(\+44|0)[\d\s]{9,14}$/, 'Enter a valid UK phone number')

export const completeRegistration = callable(z.object({
  role: z.enum(['customer', 'engineer']),            // 'admin' can never be self-assigned
  fullName: z.string().trim().min(2).max(80),
  phone, postcode,
  consent: z.literal(true),                           // privacy policy + terms accepted
}), async (req, d) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.')
  const uid = req.auth.uid
  const ref = db.collection('users').doc(uid)
  const existing = await ref.get()
  if (existing.exists) { if (existing.data()!.role === d.role) return { ok: true, existing: true }; throw new HttpsError('already-exists', 'Account already set up.') }
  const email = req.auth.token.email as string
  await ref.create({
    role: d.role, email, fullName: d.fullName, phone: d.phone, postcode: d.postcode, status: 'active',
    photoURL: null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    consent: { privacyAcceptedAt: FieldValue.serverTimestamp(), version: '2026-10' },
    notificationPrefs: { push: { quotes: true, messages: true, bookings: true, status: true, reviews: true }, email: { quotes: true, messages: false, bookings: true, status: true, reviews: true } },
    privacy: { showCityOnProfile: true },
  })
  await setClaims(uid, { role: d.role, perms: [], suspended: false, engineerApproved: false, specs: [] })
  await sendEmail({ to: email, subject: 'Welcome to Thor Computer', heading: `Welcome, ${d.fullName.split(' ')[0]}`,
    html: d.role === 'customer' ? '<p>Post a repair request and compare quotes from qualified engineers.</p>' : '<p>Complete your engineer profile and upload your qualifications. Once an administrator approves your application you can start quoting for jobs.</p>',
    cta: { label: 'Open Thor Computer', url: APP_URL } }).catch(e => console.error(e.message))
  return { ok: true }
})

export const exportMyData = callable(z.object({}), async (req) => {
  const c = requireAuth(req)
  const own = async (col: string, field: string) => (await db.collection(col).where(field, '==', c.uid).limit(1000).get()).docs.map(x => ({ id: x.id, ...x.data() }))
  const jobs = await own('repairRequests', 'customerId')
  const convs = (await db.collection('conversations').where('participants', 'array-contains', c.uid).limit(200).get()).docs
  const conversations = await Promise.all(convs.map(async cv => ({ id: cv.id, ...cv.data(), messages: (await cv.ref.collection('messages').orderBy('createdAt').limit(2000).get()).docs.map(m => m.data()) })))
  const [profile, privateDetails] = await Promise.all([
    db.collection('users').doc(c.uid).get(),
    Promise.all(jobs.map(async j => (await db.doc(`repairRequests/${j.id}/private/details`).get()).data())),
  ])
  await audit(c.uid, 'data.export', `users/${c.uid}`)
  return { generatedAt: new Date().toISOString(), profile: profile.data(), repairRequests: jobs, privateDetails, quotesReceived: await own('repairQuotes', 'customerId'), quotesSubmitted: await own('repairQuotes', 'engineerId'),
    appointments: [...await own('appointments', 'customerId'), ...await own('appointments', 'engineerId')], reviewsWritten: await own('reviews', 'authorId'), reviewsAboutMe: await own('reviews', 'subjectId'),
    notifications: await own('notifications', 'userId'), conversations }
})

const ACTIVE = ['engineer_selected', 'appointment_scheduled', 'on_the_way', 'in_progress', 'awaiting_parts', 'disputed']
/** Erases personal data; keeps anonymised job/review records needed for the other party and for legal/dispute retention. */
export const deleteMyAccount = callable(z.object({ confirm: z.literal('DELETE') }), async (req) => {
  const c = requireAuth(req)
  const field = c.role === 'engineer' ? 'selectedEngineerId' : 'customerId'
  const active = await db.collection('repairRequests').where(field, '==', c.uid).where('status', 'in', ACTIVE).limit(1).get()
  if (!active.empty) throw new HttpsError('failed-precondition', 'You have repairs in progress. Complete or cancel them before deleting your account.')
  const batch = db.batch()
  if (c.role === 'customer') {
    const mine = await db.collection('repairRequests').where('customerId', '==', c.uid).get()
    mine.docs.forEach(j => { batch.delete(db.doc(`repairRequests/${j.id}/private/details`)); if (j.data().status === 'open') batch.update(j.ref, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() }) })
  } else {
    batch.delete(db.doc(`engineerProfiles/${c.uid}`)); batch.delete(db.doc(`engineerApplications/${c.uid}`))
    const q = await db.collection('engineerQualifications').where('engineerId', '==', c.uid).get(); q.docs.forEach(x => batch.delete(x.ref))
  }
  const tokens = await db.collection('deviceTokens').where('userId', '==', c.uid).get(); tokens.docs.forEach(t => batch.delete(t.ref))
  batch.set(db.doc(`users/${c.uid}`), { status: 'deleted', fullName: 'Deleted user', email: null, phone: null, postcode: null, photoURL: null, deletedAt: FieldValue.serverTimestamp() })
  await batch.commit()
  const bucket = getStorage().bucket()
  await Promise.all([`avatars/${c.uid}/`, `qualifications/${c.uid}/`, `requests/${c.uid}/`].map(prefix => bucket.deleteFiles({ prefix }).catch(() => undefined)))
  await audit(c.uid, 'account.delete', `users/${c.uid}`)
  await auth.deleteUser(c.uid)
  return { ok: true }
})

export const setAccountSuspended = callable(z.object({ userId: z.string(), suspended: z.boolean(), reason: z.string().max(500) }), async (req, d) => {
  const c = requirePerm(req, 'customers.manage')
  const target = await db.doc(`users/${d.userId}`).get()
  if (!target.exists) throw new HttpsError('not-found', 'User not found.')
  if (target.data()!.role === 'admin') requirePerm(req, 'admins.manage')   // only super admins touch admin accounts
  await setClaims(d.userId, { suspended: d.suspended })
  await db.doc(`users/${d.userId}`).update({ status: d.suspended ? 'suspended' : 'active', updatedAt: FieldValue.serverTimestamp() })
  if (d.suspended) await auth.revokeRefreshTokens(d.userId)
  await audit(c.uid, d.suspended ? 'account.suspend' : 'account.reinstate', `users/${d.userId}`, { reason: d.reason })
  return { ok: true }
})

export const setAdminRole = callable(z.object({
  userId: z.string(), level: z.enum(['super_admin', 'admin', 'support', 'none']),
  perms: z.array(z.enum(['engineers.review', 'customers.manage', 'jobs.manage', 'reviews.moderate', 'messages.audit', 'settings.edit', 'admins.manage', 'reports.view', 'marketing.manage', 'finance.view', 'payments.manage', 'integrations.manage', 'ai.manage'])).optional(),
}), async (req, d) => {
  const c = requirePerm(req, 'admins.manage')
  if (d.userId === c.uid) throw new HttpsError('failed-precondition', 'You cannot change your own admin level.')
  const DEF = { super_admin: ['engineers.review', 'customers.manage', 'jobs.manage', 'reviews.moderate', 'messages.audit', 'settings.edit', 'admins.manage', 'reports.view', 'marketing.manage', 'finance.view', 'payments.manage', 'integrations.manage', 'ai.manage'], admin: ['engineers.review', 'customers.manage', 'jobs.manage', 'reviews.moderate', 'reports.view', 'marketing.manage', 'ai.manage'], support: ['customers.manage', 'reports.view'] } as const
  if (d.level === 'none') {
    await setClaims(d.userId, { role: 'customer', adminLevel: null, perms: [] }); await db.doc(`users/${d.userId}`).update({ role: 'customer', adminLevel: null, perms: [] })
  } else {
    const perms = d.perms ?? [...DEF[d.level]]
    await setClaims(d.userId, { role: 'admin', adminLevel: d.level, perms }); await db.doc(`users/${d.userId}`).update({ role: 'admin', adminLevel: d.level, perms })
  }
  await auth.revokeRefreshTokens(d.userId)
  await audit(c.uid, 'admin.role', `users/${d.userId}`, { level: d.level, perms: d.perms ?? null })
  return { ok: true }
})

export { notify, notifyAdmins, p }
