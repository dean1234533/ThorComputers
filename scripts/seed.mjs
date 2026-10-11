// Seeds the LOCAL emulators with fictional users and data. Refuses to run against anything but the emulators.
//   npm run emulators      (in one terminal)
//   npm run seed           (in another)
// All accounts use the password below and *.demo.test addresses (not real mailboxes).
import { createRequire } from 'node:module'
const require = createRequire(new URL('../functions/', import.meta.url))

process.env.GCLOUD_PROJECT = 'demo-thor'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
if (!/^(127\.0\.0\.1|localhost)/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST) || !/^(127\.0\.0\.1|localhost)/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('Refusing to seed: emulator hosts must be local.'); process.exit(1)
}
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
initializeApp({ projectId: 'demo-thor' })
const auth = getAuth(), db = getFirestore()

export const PASSWORD = 'Passw0rd!demo'
const ALL = ['engineers.review', 'customers.manage', 'jobs.manage', 'reviews.moderate', 'messages.audit', 'settings.edit', 'admins.manage', 'reports.view']
const prefs = { push: { quotes: true, messages: true, bookings: true, status: true, reviews: true }, email: { quotes: true, messages: false, bookings: true, status: true, reviews: true } }

async function user(email, fullName, claims, extra = {}) {
  let u
  try { u = await auth.getUserByEmail(email); await auth.updateUser(u.uid, { password: PASSWORD, emailVerified: true }) }
  catch { u = await auth.createUser({ email, password: PASSWORD, emailVerified: true, displayName: fullName }) }
  await auth.setCustomUserClaims(u.uid, { suspended: false, engineerApproved: false, specs: [], perms: [], ...claims })
  await db.doc(`users/${u.uid}`).set({ email, fullName, phone: '07700900123', postcode: 'BR1 1AA', status: 'active', photoURL: null, notificationPrefs: prefs, privacy: { showCityOnProfile: true },
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), ...(claims.role === 'admin' ? { adminLevel: claims.adminLevel, perms: claims.perms } : { role: claims.role }), role: claims.role, ...extra }, { merge: true })
  return u
}

const sa = await user('superadmin@demo.test', 'Demo Super Admin', { role: 'admin', adminLevel: 'super_admin', perms: ALL })
await user('admin@demo.test', 'Demo Admin', { role: 'admin', adminLevel: 'admin', perms: ['engineers.review', 'customers.manage', 'jobs.manage', 'reviews.moderate', 'reports.view'] })
await user('support@demo.test', 'Demo Support', { role: 'admin', adminLevel: 'support', perms: ['customers.manage', 'reports.view'] })
const cust = await user('customer@demo.test', 'Demo Customer', { role: 'customer' })
const eng = await user('engineer@demo.test', 'Demo Engineer', { role: 'engineer', engineerApproved: true, specs: ['laptop', 'desktop', 'mac', 'software'] }, { engineerStatus: 'approved' })
await user('pending-engineer@demo.test', 'Demo Pending Engineer', { role: 'engineer' }, { engineerStatus: 'draft' })

const profile = { displayName: 'Demo Engineer', businessName: 'Demo Repairs', bio: 'Fictional engineer used for local testing. Fifteen years repairing laptops, desktops and Macs in south-east London.', yearsExperience: 15,
  serviceArea: { postcode: 'BR1 1AA', radiusMiles: 20 }, areasCovered: ['Bromley', 'Croydon'], specialisations: ['laptop', 'desktop', 'mac', 'software'], certificationsText: '', workingArrangements: ['home', 'workshop', 'remote'], typicalPricing: '£40 callout', photoURL: 'http://127.0.0.1:9199/demo.png' }
await db.doc(`engineerApplications/${eng.uid}`).set({ status: 'approved', profile, geo: { lat: 51.41, lng: 0.02 }, submissionCount: 0, submittedAt: FieldValue.serverTimestamp() }, { merge: true })
await db.doc(`engineerProfiles/${eng.uid}`).set({ ...profile, serviceRadiusMiles: 20, status: 'approved', provider: 'independent', verifiedQualifications: [], ratingAvg: 0, reviewCount: 0, completedJobs: 0, uid: eng.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
await db.doc('platformSettings/public').set({
  categories: ['laptop', 'desktop', 'gaming_pc', 'mac', 'phone', 'tablet', 'printer', 'other'].map(id => ({ id, label: id.replace('_', ' '), enabled: true })),
  support: { email: 'support@demo.test', phone: '0000 000000', hours: 'Mon-Fri 9-5' }, booking: { reminderHours: [24, 2], leadMinutes: 120, cancelNoticeHours: 24 }, updatedAt: FieldValue.serverTimestamp(), updatedBy: sa.uid }, { merge: true })

// One open job with a quote and a conversation, so list/detail screens have data to render. Written directly (admin SDK) in the shapes the functions produce.
const { Timestamp } = require('firebase-admin/firestore')
const jobId = 'demo-job-open', quoteId = `${jobId}_${eng.uid}`
await db.doc(`repairRequests/${jobId}`).set({ reference: 'THR-DEMO01', customerId: cust.uid, status: 'open', selectedEngineerId: null, acceptedQuoteId: null,
  device: { type: 'laptop', manufacturer: 'Dell', model: 'XPS 13', os: 'Windows 11' }, issues: ['wont_turn_on'], summary: 'Will not power on after a spill', description: 'Will not power on after a coffee spill.', startedAt: '', urgency: 'soon',
  serviceMethods: ['home', 'workshop'], requiredSpecs: ['laptop'], photoPaths: [], preferredDates: [], location: { area: 'Bromley · BR1', outcode: 'BR1', lat: 51.4, lng: 0 }, quoteCount: 1, source: 'app',
  statusHistory: [{ status: 'open', at: Timestamp.now(), by: cust.uid }], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
await db.doc(`repairRequests/${jobId}/private/details`).set({ postcode: 'BR1 1AA', addressLine: '1 Demo Road, Bromley', accessNotes: '', serialNumber: 'DEMO123', exactLat: 51.41, exactLng: 0.02 })
await db.doc(`repairQuotes/${quoteId}`).set({ jobId, engineerId: eng.uid, customerId: cust.uid, repairPence: 8000, diagnosticPence: 1500, calloutPence: 2000, totalPence: 11500, currency: 'GBP', durationHours: 1.5, availability: 'This week',
  partsIncluded: false, partsNote: '', warranty: '30 days', notes: '', serviceMethod: 'home', provider: 'independent', status: 'submitted', version: 1, expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
await db.doc(`conversations/${quoteId}`).set({ jobId, participants: [cust.uid, eng.uid], customerId: cust.uid, engineerId: eng.uid, closed: false, unread: { [cust.uid]: 1, [eng.uid]: 0 }, lastMessage: 'Hello from the demo engineer', lastMessageAt: FieldValue.serverTimestamp() })
await db.doc(`conversations/${quoteId}/messages/m1`).set({ senderId: eng.uid, text: 'Hello from the demo engineer', createdAt: FieldValue.serverTimestamp(), readBy: [eng.uid] })

console.log(`Seeded demo-thor emulators. Password for all accounts: ${PASSWORD}`)
for (const e of ['superadmin', 'admin', 'support', 'customer', 'engineer', 'pending-engineer']) console.log(`  ${e}@demo.test`)
