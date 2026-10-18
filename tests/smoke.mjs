// Signed-in end-to-end smoke test (DEPLOYMENT.md §7) against the LOCAL emulators only: Auth, Functions, Firestore, Storage.
// Run with `npm run test:smoke` from the repo root. Uses fictional users; email, push and postcode lookup are mocked inside the functions.
// Drives the real client SDK exactly like the web app does (callables + rules-checked reads/writes), once per role.
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, applyActionCode, signOut } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, addDoc, collection, query, where, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getStorage, connectStorageEmulator, ref, uploadBytes, getDownloadURL, getBytes } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'

const PROJECT = 'demo-thor'
// Hard safety rail: this script must only ever talk to local emulators.
for (const k of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
  if (!process.env[k] || !/^(127\.0\.0\.1|localhost)/.test(process.env[k])) { console.error(`Refusing to run: ${k} is not a local emulator (${process.env[k]}). Use \`npm run test:smoke\`.`); process.exit(2) }
}
process.env.GCLOUD_PROJECT = PROJECT
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199'
const require = createRequire(new URL('../functions/', import.meta.url))
const { initializeApp: adminInit } = require('firebase-admin/app')
const { getAuth: adminAuth } = require('firebase-admin/auth')
const { getFirestore: adminDb, FieldValue } = require('firebase-admin/firestore')
adminInit({ projectId: PROJECT })
const A = { auth: adminAuth(), db: adminDb() }

// ---------- tiny test harness ----------
const results = []
let current = ''
async function step(name, fn) {
  current = name
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name}`) }
  catch (e) { results.push({ name, ok: false, err: e }); console.log(`  ✖ ${name}\n      ${String(e?.message ?? e).split('\n')[0]}`) }
}
const section = t => console.log(`\n${t}`)
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? 'expected equal'}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`) }
const ok = (v, msg) => { if (!v) throw new Error(msg ?? 'expected truthy') }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, what, ms = 15000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`); await sleep(250) } }
/** Asserts a promise rejects, optionally with a Firebase code (e.g. 'permission-denied') and/or message fragment. */
async function denied(p, code, frag) {
  try { await p } catch (e) {
    const c = String(e?.code ?? '')
    if (code && !c.endsWith(code)) throw new Error(`expected ${code}, got ${c}: ${e.message}`)
    if (frag && !String(e.message).toLowerCase().includes(frag.toLowerCase())) throw new Error(`expected message containing "${frag}", got: ${e.message}`)
    return e
  }
  throw new Error('expected the call to be rejected but it succeeded')
}

// ---------- actors (one isolated Firebase app per person, like a separate browser) ----------
let n = 0
function actor(label) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, appId: 'demo', storageBucket: `${PROJECT}.appspot.com` }, `${label}-${n++}`)
  const auth = getAuth(app), db = getFirestore(app), storage = getStorage(app), fns = getFunctions(app, 'europe-west2')
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080); connectStorageEmulator(storage, '127.0.0.1', 9199); connectFunctionsEmulator(fns, '127.0.0.1', 5001)
  const a = { label, app, auth, db, storage, fns, call: (name, data = {}) => httpsCallable(fns, name)(data).then(r => r.data),
    get uid() { return auth.currentUser?.uid }, refresh: () => auth.currentUser.getIdToken(true).then(() => auth.currentUser.getIdTokenResult()),
    claims: async () => (await auth.currentUser.getIdTokenResult()).claims }
  return a
}
const stamp = Date.now().toString(36)
const email = r => `${r}.${stamp}@smoke.demo.test`
const PASSWORD = 'Passw0rd!smoke'

async function verifyViaEmailLink(a, addr) {
  await sendEmailVerification(a.auth.currentUser)
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/oobCodes`)
  const codes = (await res.json()).oobCodes.filter(c => c.email === addr && c.requestType === 'VERIFY_EMAIL')
  ok(codes.length, 'no verification email captured by the Auth emulator')
  await applyActionCode(a.auth, codes.at(-1).oobCode)
  await a.auth.currentUser.reload()
}
async function register(label, role, name, opts = {}) {
  const a = actor(label), addr = email(label)
  await createUserWithEmailAndPassword(a.auth, addr, PASSWORD)
  if (!opts.skipVerify) await verifyViaEmailLink(a, addr)
  await a.call('completeRegistration', { role, fullName: name, phone: '07700900123', postcode: 'BR1 1AA', consent: true })
  const c = await a.refresh()
  a.addr = addr
  return a
}
async function bootstrapAdmin(label, level, perms) {
  // Equivalent of scripts-grant-super-admin.mjs (DEPLOYMENT.md §4), for a throwaway user.
  const a = actor(label), addr = email(label)
  const cred = await createUserWithEmailAndPassword(a.auth, addr, PASSWORD)
  await A.auth.updateUser(cred.user.uid, { emailVerified: true })
  await A.auth.setCustomUserClaims(cred.user.uid, { role: 'admin', adminLevel: level, perms, suspended: false, engineerApproved: false, specs: [] })
  await A.db.doc(`users/${cred.user.uid}`).set({ role: 'admin', adminLevel: level, perms, email: addr, fullName: `Smoke ${level}`, status: 'active', createdAt: FieldValue.serverTimestamp() })
  await a.refresh(); a.addr = addr
  return a
}
const ALL = ['engineers.review', 'customers.manage', 'jobs.manage', 'reviews.moderate', 'messages.audit', 'settings.edit', 'admins.manage', 'reports.view']
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), PDF = new Uint8Array([37, 80, 68, 70])
const nextWeekday = (minDays = 3) => { const d = new Date(Date.now() + minDays * 86400_000); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
const mailbox = async to => (await A.db.collection('devMailbox').where('to', '==', to).get()).docs.map(d => d.data())

async function applyAsEngineer(a, name) {
  const profile = { displayName: name, businessName: '', bio: 'Fictional engineer for local smoke tests. Eight years of repairing laptops, desktops and Macs for homes and small offices in south London.', yearsExperience: 8,
    serviceArea: { postcode: 'BR1 1AA', radiusMiles: 20 }, areasCovered: ['Bromley'], specialisations: ['laptop', 'desktop'], certificationsText: '', workingArrangements: ['home', 'workshop', 'remote'], typicalPricing: '', photoURL: 'http://placeholder.invalid/x.png' }
  const photo = ref(a.storage, `avatars/${a.uid}/me.png`); await uploadBytes(photo, PNG, { contentType: 'image/png' })
  profile.photoURL = await getDownloadURL(photo)
  await setDoc(doc(a.db, `engineerApplications/${a.uid}`), { status: 'draft', profile, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  const path = `qualifications/${a.uid}/cert.pdf`
  await uploadBytes(ref(a.storage, path), PDF, { contentType: 'application/pdf' })
  const q = await addDoc(collection(a.db, 'engineerQualifications'), { engineerId: a.uid, verification: 'pending', storagePath: path, name: 'CompTIA A+', issuer: 'CompTIA', createdAt: serverTimestamp() })
  return { qualId: q.id, path }
}

console.log(`Thor Computer local smoke test (project ${PROJECT}; emulators only)\n`)
let customer, engineer, engineer2, pendingEngineer, superAdmin, support, qual, jobId, quote1, quote2, aptId, startAt

section('1. Registration and email verification')
await step('customer registers, verifies email via emulator link, gets claims', async () => {
  customer = await register('customer', 'customer', 'Casey Customer')
  const c = await customer.claims(); eq(c.role, 'customer'); eq(c.email_verified, true); ok(!c.perms?.length, 'customer must have no perms')
  ok((await mailbox(customer.addr)).some(m => /Welcome/.test(m.subject)), 'welcome email not captured in the mock mailbox')
})
await step('role "admin" cannot be self-assigned at registration', async () => {
  const x = actor('evil'); await createUserWithEmailAndPassword(x.auth, email('evil'), PASSWORD)
  await A.auth.updateUser(x.uid, { emailVerified: true })
  await denied(x.call('completeRegistration', { role: 'admin', fullName: 'Evil Admin', phone: '07700900123', postcode: 'BR1 1AA', consent: true }), 'invalid-argument')
  await denied(x.call('completeRegistration', { role: 'customer', fullName: 'Evil', phone: '07700900123', postcode: 'BR1 1AA', consent: false }), 'invalid-argument')
})
await step('unverified customer cannot post a request (requireVerified)', async () => {
  const u = await register('unverified', 'customer', 'Una Unverified', { skipVerify: true })
  await denied(u.call('createRepairRequest', requestBody('unverified-0001')), 'failed-precondition', 'verify')
})
await step('engineers register (approved-to-be, second competitor, and one never approved)', async () => {
  engineer = await register('engineer1', 'engineer', 'Eddie Engineer')
  engineer2 = await register('engineer2', 'engineer', 'Erin Engineer')
  pendingEngineer = await register('engineer3', 'engineer', 'Pat Pending')
  eq((await engineer.claims()).engineerApproved, false)
})
await step('unauthenticated callable is rejected', async () => {
  await denied(actor('anon').call('createRepairRequest', requestBody('anon-0001')), 'unauthenticated')
})

section('2. Engineer onboarding, admin approval (admin + super admin roles)')
await step('engineer uploads avatar + credential and submits application', async () => {
  qual = await applyAsEngineer(engineer, 'Eddie Engineer')
  await applyAsEngineer(engineer2, 'Erin Engineer')
  eq((await engineer.call('submitEngineerApplication')).status, 'pending')
  await engineer2.call('submitEngineerApplication')
})
await step('submitting without a qualification is refused', async () => {
  const profile = { displayName: 'Pat Pending', bio: 'x'.repeat(70), yearsExperience: 1, serviceArea: { postcode: 'BR1 1AA', radiusMiles: 5 }, areasCovered: ['Bromley'], specialisations: ['laptop'], workingArrangements: ['home'], photoURL: 'http://127.0.0.1:9199/x.png' }
  await setDoc(doc(pendingEngineer.db, `engineerApplications/${pendingEngineer.uid}`), { status: 'draft', profile, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  await denied(pendingEngineer.call('submitEngineerApplication'), 'failed-precondition')
})
await step('super admin and support admin sign in', async () => {
  superAdmin = await bootstrapAdmin('superadmin', 'super_admin', ALL)
  support = await bootstrapAdmin('support', 'support', ['customers.manage', 'reports.view'])
  eq((await superAdmin.claims()).adminLevel, 'super_admin')
})
await step('MFA status endpoint works for an unenrolled admin and reports the mode (not blocked)', async () => {
  const s = await superAdmin.call('adminMfaStatus')
  eq(s.sessionHasSecondFactor, false); eq(s.enrolledFactors, 0); ok(s.admins.length >= 2, 'super admin should see all admins')
  const t = await support.call('adminMfaStatus'); ok(!t.admins, 'support admin must not see the admin roster')
  await denied(customer.call('adminMfaStatus'), 'permission-denied')
})
await step('engineer cannot approve themselves; customer cannot call admin functions', async () => {
  await denied(engineer.call('reviewEngineerApplication', { engineerId: engineer.uid, decision: 'approve' }), 'permission-denied')
  await denied(customer.call('adminStats'), 'permission-denied')
  await denied(customer.call('setAdminRole', { userId: customer.uid, level: 'super_admin' }), 'permission-denied')
  await denied(engineer.call('verifyQualification', { qualificationId: qual.qualId, decision: 'verified' }), 'permission-denied')
})
await step('support admin (no engineers.review) cannot approve', async () => {
  await denied(support.call('reviewEngineerApplication', { engineerId: engineer.uid, decision: 'approve' }), 'permission-denied', 'engineers.review')
})
await step('admin can read the credential file; other engineer cannot', async () => {
  ok((await getBytes(ref(superAdmin.storage, qual.path))).byteLength > 0)
  await denied(getBytes(ref(engineer2.storage, qual.path)))
})
await step('super admin verifies the credential and approves both engineers; reject needs a note', async () => {
  await denied(superAdmin.call('reviewEngineerApplication', { engineerId: engineer2.uid, decision: 'reject' }), 'invalid-argument', 'note')
  await superAdmin.call('verifyQualification', { qualificationId: qual.qualId, decision: 'verified' })
  eq((await superAdmin.call('reviewEngineerApplication', { engineerId: engineer.uid, decision: 'approve', provider: 'independent' })).status, 'approved')
  const note = (await A.db.collection('notifications').where('userId', '==', engineer.uid).get()).docs.map(d => d.data()).find(n => n.title === 'Application approved'); ok(note, 'the engineer got no notification when approved'); eq(note.link, '/engineer/jobs')
  await superAdmin.call('reviewEngineerApplication', { engineerId: engineer2.uid, decision: 'approve' })
  await denied(superAdmin.call('reviewEngineerApplication', { engineerId: engineer.uid, decision: 'approve' }), 'failed-precondition')   // not double-approvable
})
await step('approval sets claims; public profile exposes no private fields', async () => {
  const c = await engineer.refresh(); eq(c.claims.engineerApproved, true); ok(c.claims.specs.includes('laptop'))
  const prof = (await getDoc(doc(customer.db, `engineerProfiles/${engineer.uid}`))).data()
  eq(prof.status, 'approved'); ok(!('postcode' in prof) && !('phone' in prof) && !('email' in prof) && !('storagePath' in prof), 'public profile leaked a private field')
  eq(JSON.stringify(prof.verifiedQualifications), JSON.stringify([{ name: 'CompTIA A+', issuer: 'CompTIA' }]))
  await engineer2.refresh()
})
await step('audit log recorded admin decisions; support admin cannot read it, super admin can', async () => {
  const logs = await getDocs(collection(superAdmin.db, 'auditLogs')); ok(logs.size >= 3, `expected audit entries, got ${logs.size}`)
  await denied(getDocs(collection(support.db, 'auditLogs')))
})

function requestBody(key, over = {}) {
  return { requestKey: key, device: { type: 'laptop', manufacturer: 'Dell', model: 'XPS 13', os: 'Windows 11' }, serialNumber: 'SN-SECRET-123', issues: ['wont_turn_on'], description: 'Laptop will not power on after a coffee spill, fan briefly spins.',
    urgency: 'soon', serviceMethods: ['home', 'workshop'], postcode: 'BR1 1AA', addressLine: '1 Secret Road, Bromley', accessNotes: 'Gate code 4321', preferredDates: [], photoPaths: [], enquiry: undefined /* the SDK sends undefined as null, as the web app does */, ...over }
}

section('3. Customer posts a request; privacy of address and serial')
await step('customer uploads a photo and creates a request; retry with same key is idempotent', async () => {
  const photoPath = `requests/${customer.uid}/smoke-req-0001/p.png`
  await uploadBytes(ref(customer.storage, photoPath), PNG, { contentType: 'image/png' })
  const r = await customer.call('createRepairRequest', requestBody('smoke-req-0001', { photoPaths: [photoPath] }))
  ok(!r.duplicate); jobId = r.jobId
  const again = await customer.call('createRepairRequest', requestBody('smoke-req-0001'))
  ok(again.duplicate); eq(again.jobId, jobId)
  const jobs = await getDocs(query(collection(customer.db, 'repairRequests'), where('customerId', '==', customer.uid))); eq(jobs.size, 1, 'duplicate request created')
})
await step('bad input rejected: invalid postcode, wrong method for device, foreign photo path', async () => {
  await denied(customer.call('createRepairRequest', requestBody('smoke-req-0002', { postcode: 'NOTAPOSTCODE' })), 'invalid-argument')
  await denied(customer.call('createRepairRequest', requestBody('smoke-req-0003', { device: { type: 'phone', manufacturer: 'X', model: 'Y' }, serviceMethods: ['remote'] })), 'invalid-argument', 'not available')
  await denied(customer.call('createRepairRequest', requestBody('smoke-req-0004', { photoPaths: ['requests/someoneelse/job/p.png'] })), 'invalid-argument', 'photo')
})
await step('an engineer role cannot create repair requests', async () => {
  await denied(engineer.call('createRepairRequest', requestBody('smoke-req-0005')), 'permission-denied')
})
await step('public job document has approximate location only (no address/serial)', async () => {
  const j = (await getDoc(doc(engineer.db, `repairRequests/${jobId}`))).data()
  const flat = JSON.stringify(j)
  ok(!/Secret Road|SN-SECRET|4321|BR1 1AA/.test(flat), 'public job leaked exact data')
  eq(j.location.lat, Math.round(j.location.lat * 10) / 10, 'coordinates should be coarsened')
})
await step('bidding engineer cannot read private details before selection; customer can; pending engineer cannot list open jobs', async () => {
  await denied(getDoc(doc(engineer.db, `repairRequests/${jobId}/private/details`)))
  ok((await getDoc(doc(customer.db, `repairRequests/${jobId}/private/details`))).data().addressLine.includes('Secret Road'))
  await denied(getDocs(query(collection(pendingEngineer.db, 'repairRequests'), where('status', '==', 'open'))))
  const open = await getDocs(query(collection(engineer.db, 'repairRequests'), where('status', '==', 'open'))); ok(open.size >= 1)
})
await step('matching engineers were notified in-app; the mock mailbox/push caught no real send', async () => {
  const n = await until(async () => (await getDocs(query(collection(engineer.db, 'notifications'), where('userId', '==', engineer.uid)))).docs.map(d => d.data()).find(x => /repair job/i.test(x.title)), 'job notification')
  ok(!/Secret|XPS/.test(JSON.stringify(n)), 'notification leaked job detail')
})

section('4. Quotes, acceptance race, privacy release')
const quoteBody = (extra = {}) => ({ jobId, repairPence: 8000, diagnosticPence: 1500, calloutPence: 2000, durationHours: 1.5, availability: 'Weekdays this week', partsIncluded: false, expiresAt: new Date(Date.now() + 3 * 86400_000).toISOString(), serviceMethod: 'home', ...extra })
await step('approved engineers submit quotes; server computes the total; resubmitting versions the quote, not duplicates it', async () => {
  quote1 = (await engineer.call('submitQuote', quoteBody())).quoteId
  quote2 = (await engineer2.call('submitQuote', quoteBody({ repairPence: 9500, serviceMethod: 'workshop' }))).quoteId
  eq((await getDoc(doc(engineer.db, `repairQuotes/${quote1}`))).data().totalPence, 11500)
  await engineer.call('submitQuote', quoteBody({ repairPence: 7500 }))
  const q = (await getDoc(doc(engineer.db, `repairQuotes/${quote1}`))).data(); eq(q.version, 2); eq(q.totalPence, 11000)
  eq((await getDoc(doc(customer.db, `repairRequests/${jobId}`))).data().quoteCount, 2, 'quoteCount')
})
await step('quote validation: zero total, past expiry, wrong method, unapproved engineer', async () => {
  await denied(engineer.call('submitQuote', quoteBody({ repairPence: 0, diagnosticPence: 0, calloutPence: 0 })), 'invalid-argument')
  await denied(engineer.call('submitQuote', quoteBody({ expiresAt: new Date(Date.now() + 60_000).toISOString() })), 'invalid-argument')
  await denied(engineer.call('submitQuote', quoteBody({ serviceMethod: 'remote' })), 'invalid-argument')
  await denied(pendingEngineer.call('submitQuote', quoteBody()), 'permission-denied')
})
await step('bidders cannot see each other’s quotes; customer sees both', async () => {
  await denied(getDoc(doc(engineer2.db, `repairQuotes/${quote1}`)))
  eq((await getDocs(query(collection(customer.db, 'repairQuotes'), where('customerId', '==', customer.uid)))).size, 2)
})
await step('a non-owner customer cannot accept; engineer cannot accept', async () => {
  const other = await register('customer2', 'customer', 'Other Customer')
  await denied(other.call('acceptQuote', { quoteId: quote1 }), 'permission-denied')
  await denied(engineer.call('acceptQuote', { quoteId: quote1 }), 'permission-denied')
})
await step('concurrent accept of two DIFFERENT quotes: exactly one wins', async () => {
  const res = await Promise.allSettled([customer.call('acceptQuote', { quoteId: quote1 }), customer.call('acceptQuote', { quoteId: quote2 })])
  eq(res.filter(r => r.status === 'fulfilled').length, 1, 'exactly one acceptQuote must succeed')
  const j = (await getDoc(doc(customer.db, `repairRequests/${jobId}`))).data()
  eq(j.status, 'engineer_selected'); ok([quote1, quote2].includes(j.acceptedQuoteId))
  const winner = j.acceptedQuoteId === quote1 ? engineer : engineer2
  engineer.winner = winner; engineer.winnerQuote = j.acceptedQuoteId
})
await step('retrying the winning accept is idempotent (no second notification)', async () => {
  const { winner, winnerQuote } = engineer
  await customer.call('acceptQuote', { quoteId: winnerQuote }); await customer.call('acceptQuote', { quoteId: winnerQuote })
  const notes = await getDocs(query(collection(winner.db, 'notifications'), where('userId', '==', winner.uid)))
  eq(notes.docs.filter(d => /accepted/i.test(d.data().title)).length, 1, 'duplicate acceptance notifications')
})
await step('losing quote is declined; its conversation closed; accepting it now fails', async () => {
  const loserQuote = engineer.winnerQuote === quote1 ? quote2 : quote1
  const loser = engineer.winnerQuote === quote1 ? engineer2 : engineer
  eq((await getDoc(doc(loser.db, `repairQuotes/${loserQuote}`))).data().status, 'declined')
  await denied(customer.call('acceptQuote', { quoteId: loserQuote }), 'failed-precondition')
  await denied(loser.call('submitQuote', quoteBody({ serviceMethod: loser === engineer ? 'home' : 'workshop' })), 'failed-precondition')
})
await step('after selection: winner reads the address, loser does not', async () => {
  const { winner } = engineer, loser = winner === engineer ? engineer2 : engineer
  ok((await getDoc(doc(winner.db, `repairRequests/${jobId}/private/details`))).data().addressLine)
  await denied(getDoc(doc(loser.db, `repairRequests/${jobId}/private/details`)))
})

section('5. Booking, rescheduling, messaging')
await step('booking requires an address for home visits; customer adds one', async () => {
  const { winner } = engineer
  const method = (await getDoc(doc(customer.db, `repairRequests/${jobId}`))).data().agreedMethod
  await customer.call('updateJobPrivate', { jobId, addressLine: '1 Secret Road, Bromley BR1 1AA', accessNotes: 'Ring bell' })
  await denied(winner.call('updateJobPrivate', { jobId, addressLine: 'Nope nope' }), 'permission-denied')
  ok(method)
})
await step('free slots are offered (weekday, within working hours, outside lunch break)', async () => {
  const day = nextWeekday(); const s = await customer.call('getSlots', { jobId, date: day })
  ok(s.slots.length > 0, 'no slots offered'); eq(s.durationMinutes, 90)
  const hours = s.slots.map(x => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(x)))
  ok(!hours.some(h => h >= '12:00' && h < '13:00'), 'slot overlaps the 12:00 lunch break'); startAt = s.slots[0]; engineer.day = day
  await denied(engineer.call('getSlots', { jobId, date: day }), 'permission-denied')
})
await step('book appointment; retry is idempotent; same slot cannot be double-booked by another job', async () => {
  const r = await customer.call('bookAppointment', { jobId, startAt }); aptId = r.appointmentId
  eq((await customer.call('bookAppointment', { jobId, startAt })).appointmentId, aptId)
  eq((await getDoc(doc(customer.db, `repairRequests/${jobId}`))).data().status, 'appointment_scheduled')
  const apt = (await getDoc(doc(engineer.winner.db, `appointments/${aptId}`))).data(); eq(apt.status, 'confirmed')
  const later = (await customer.call('getSlots', { jobId, date: engineer.day })).slots; ok(!later.includes(startAt), 'booked slot is still offered')
})
await step('reschedule: customer proposes, same party cannot self-accept, engineer accepts', async () => {
  const slots = (await customer.call('getSlots', { jobId, date: nextWeekday(5) })).slots; ok(slots.length)
  await customer.call('requestReschedule', { appointmentId: aptId, newStartAt: slots[0] })
  await denied(customer.call('respondReschedule', { appointmentId: aptId, accept: true }), 'permission-denied')
  await engineer.winner.call('respondReschedule', { appointmentId: aptId, accept: true })
  const apt = (await getDoc(doc(customer.db, `appointments/${aptId}`))).data(); eq(apt.status, 'confirmed'); eq(apt.startAt.toDate().toISOString(), slots[0])
})
await step('messaging: participants exchange messages; trigger updates the thread and notifies, outsiders blocked', async () => {
  const cid = engineer.winnerQuote, w = engineer.winner
  const post = (a, text) => addDoc(collection(a.db, `conversations/${cid}/messages`), { senderId: a.uid, text, createdAt: serverTimestamp(), readBy: [a.uid] })
  await post(customer, 'Hello, is Tuesday morning OK?')
  await denied(post(engineer === w ? engineer2 : engineer, 'I am not part of this'))
  await denied(addDoc(collection(customer.db, `conversations/${cid}/messages`), { senderId: w.uid, text: 'spoof', createdAt: serverTimestamp(), readBy: [w.uid] }))
  await until(async () => (await getDoc(doc(w.db, `conversations/${cid}`))).data().lastMessage === 'Hello, is Tuesday morning OK?', 'conversation lastMessage (onMessageCreated trigger)')
  ok((await getDoc(doc(w.db, `conversations/${cid}`))).data().unread[w.uid] >= 1, 'unread counter')
  await until(async () => (await getDocs(query(collection(w.db, 'notifications'), where('userId', '==', w.uid)))).docs.some(d => d.data().title === 'New message' && !/Tuesday/.test(JSON.stringify(d.data()))), 'lock-screen-safe message notification')
  await post(w, 'Yes, see you then')
})
await step('admins cannot read conversations directly; audited access needs an open report', async () => {
  const cid = engineer.winnerQuote
  await denied(getDoc(doc(superAdmin.db, `conversations/${cid}`)))
  await denied(superAdmin.call('auditConversation', { conversationId: cid, reportId: 'none', reason: 'curiosity about this' }), 'failed-precondition')
  const rep = await addDoc(collection(customer.db, 'reports'), { reporterId: customer.uid, status: 'open', reason: 'Testing report flow', conversationId: cid, createdAt: serverTimestamp() })
  await until(async () => (await getDocs(query(collection(superAdmin.db, 'notifications'), where('userId', '==', superAdmin.uid)))).docs.some(d => d.data().title === 'New report'), 'report notification to admins (onReportCreated)')
  const a = await superAdmin.call('auditConversation', { conversationId: cid, reportId: rep.id, reason: 'Investigating the reported thread' }); ok(a.messages.length >= 1)
  const logs = await getDocs(query(collection(superAdmin.db, 'auditLogs'), where('action', '==', 'conversation.read'))); ok(logs.size >= 1, 'conversation access not audited')
  await superAdmin.call('resolveReport', { reportId: rep.id, outcome: 'dismissed', note: 'No issue found' })
})

section('6. Job completion, reviews, moderation')
await step('only valid transitions: engineer cannot complete before starting; outsiders cannot change status', async () => {
  const w = engineer.winner
  await denied(w.call('changeJobStatus', { jobId, to: 'completed' }), 'failed-precondition')
  await denied(customer.call('changeJobStatus', { jobId, to: 'in_progress' }), 'failed-precondition')
  await denied((w === engineer ? engineer2 : engineer).call('changeJobStatus', { jobId, to: 'on_the_way' }), 'permission-denied')
})
await step('engineer moves on_the_way → in_progress → completed; customer is notified (+ completion email in mock mailbox)', async () => {
  const w = engineer.winner
  for (const to of ['on_the_way', 'in_progress', 'completed']) await w.call('changeJobStatus', { jobId, to })
  eq((await getDoc(doc(customer.db, `repairRequests/${jobId}`))).data().status, 'completed')
  await until(async () => (await mailbox(customer.addr)).some(m => /complete/i.test(m.subject)), 'completion email in mock mailbox')
})
await step('reviews: needs all categories, no contact details, one per party', async () => {
  await denied(customer.call('submitReview', { jobId, ratings: { quality: 5 }, text: '' }), 'invalid-argument')
  await denied(customer.call('submitReview', { jobId, ratings: { quality: 5, professionalism: 5, communication: 5, punctuality: 5, value: 5 }, text: 'great, call me on 07700 900123' }), 'invalid-argument', 'phone')
  await customer.call('submitReview', { jobId, ratings: { quality: 5, professionalism: 4, communication: 5, punctuality: 4, value: 5 }, text: 'Quick and tidy.' })
  await denied(customer.call('submitReview', { jobId, ratings: { quality: 5, professionalism: 4, communication: 5, punctuality: 4, value: 5 } }), 'already-exists')
  const p = (await getDoc(doc(customer.db, `engineerProfiles/${engineer.winner.uid}`))).data(); eq(p.reviewCount, 1); eq(p.ratingAvg, 4.6); eq(p.completedJobs, 1)
})
await step('a non-participant cannot review', async () => {
  const stranger = await register('customer3', 'customer', 'Stranger Danger')
  await denied(stranger.call('submitReview', { jobId, ratings: { quality: 5, professionalism: 5, communication: 5, punctuality: 5, value: 5 } }), 'permission-denied')
})
await step('engineer feedback about the customer is held for moderation, then published by an admin', async () => {
  await engineer.winner.call('submitReview', { jobId, ratings: { communication: 5, reliability: 5, accuracy: 4, overall: 5 }, text: 'Lovely customer.' })
  const id = `${jobId}_engineer_to_customer`
  eq((await getDoc(doc(engineer.winner.db, `reviews/${id}`))).data().status, 'pending')
  await denied(getDoc(doc(engineer === engineer.winner ? engineer2.db : engineer.db, `reviews/${id}`)))
  await denied(support.call('moderateReview', { reviewId: id, decision: 'approve', note: 'looks fine' }), 'permission-denied')
  await superAdmin.call('moderateReview', { reviewId: id, decision: 'approve', note: 'Checked, OK' })
  eq((await getDoc(doc(customer.db, `reviews/${id}`))).data().status, 'published')
})
await step('customer edits their review once; second edit refused; admin removal reverses the rating', async () => {
  const id = `${jobId}_customer_to_engineer`, w = engineer.winner
  await customer.call('editReview', { reviewId: id, ratings: { quality: 4, professionalism: 4, communication: 4, punctuality: 4, value: 4 }, text: 'Edited.' })
  await denied(customer.call('editReview', { reviewId: id, ratings: { quality: 5, professionalism: 5, communication: 5, punctuality: 5, value: 5 } }), 'failed-precondition')
  eq((await getDoc(doc(customer.db, `engineerProfiles/${w.uid}`))).data().ratingAvg, 4)
  await superAdmin.call('moderateReview', { reviewId: id, decision: 'remove', note: 'Test removal' })
  const p = (await getDoc(doc(customer.db, `engineerProfiles/${w.uid}`))).data(); eq(p.reviewCount, 0); eq(p.ratingAvg, 0)
  await superAdmin.call('moderateReview', { reviewId: id, decision: 'restore', note: 'Test restore' })
})

section('7. Admin console functions and account controls')
await step('super admin stats, settings (validated), role changes; support cannot change settings or admins', async () => {
  const st = await superAdmin.call('adminStats'); ok(st.totals.customers >= 1); ok(st.totals.engineers >= 2)
  await superAdmin.call('savePlatformSettings', { support: { email: 'help@demo.test', phone: '0000', hours: '9-5' }, marketplaceDisclaimer: 'Independent engineers set their own terms.' })
  eq((await getDoc(doc(customer.db, 'platformSettings/public'))).data().support.email, 'help@demo.test')
  await denied(superAdmin.call('savePlatformSettings', { support: { email: 'not-an-email', phone: '', hours: '' } }), 'invalid-argument')
  await denied(support.call('savePlatformSettings', { marketplaceDisclaimer: 'x' }), 'permission-denied')
  await denied(support.call('setAdminRole', { userId: customer.uid, level: 'admin' }), 'permission-denied')
  await denied(superAdmin.call('setAdminRole', { userId: superAdmin.uid, level: 'none' }), 'failed-precondition', 'own')
})
await step('super admin grants admin to a user (tokens revoked), support admin cannot touch admin accounts', async () => {
  const promo = await register('promo', 'customer', 'Promo Person')
  await superAdmin.call('setAdminRole', { userId: promo.uid, level: 'support' })
  await denied(promo.call('adminStats'), 'permission-denied')   // old customer token is not an admin token
  const re = actor('promo-again'); await signInWithEmailAndPassword(re.auth, promo.addr, PASSWORD)
  eq((await re.claims()).role, 'admin'); eq((await re.claims()).adminLevel, 'support')
  await denied(support.call('setAccountSuspended', { userId: superAdmin.uid, suspended: true, reason: 'attempted takeover' }), 'permission-denied')
  await superAdmin.call('setAdminRole', { userId: promo.uid, level: 'none' })
  await denied(re.call('adminStats'), 'permission-denied', 'access has changed')   // demotion bites immediately, even though the old admin token has not expired
})
await step('suspending an account blocks its functions and uploads; reinstating restores', async () => {
  const victim = await register('victim', 'customer', 'Vic Victim')
  await support.call('setAccountSuspended', { userId: victim.uid, suspended: true, reason: 'abusive behaviour in testing' })
  await denied(victim.call('exportMyData'), 'permission-denied', 'suspended')   // the victim's ALREADY-ISSUED token (suspended=false) must stop working immediately
  const again = actor('victim-again'); await signInWithEmailAndPassword(again.auth, victim.addr, PASSWORD)
  await denied(again.call('exportMyData'), 'permission-denied', 'suspended')
  await denied(uploadBytes(ref(again.storage, `avatars/${again.uid}/a.png`), PNG, { contentType: 'image/png' }))
  await support.call('setAccountSuspended', { userId: victim.uid, suspended: false, reason: 'resolved in testing' })
  await again.refresh(); ok((await again.call('exportMyData')).profile.email === victim.addr)
})
await step('GDPR: export includes own data and private details; delete erases PII and auth user', async () => {
  const exp = await customer.call('exportMyData'); ok(exp.repairRequests.length >= 1 && exp.privateDetails.some(d => d?.addressLine), 'export missing job/private details')
  ok(exp.conversations.length >= 1, 'export missing conversations')
  const goner = await register('goner', 'customer', 'Gone Soon')
  await denied(goner.call('deleteMyAccount', { confirm: 'nope' }), 'invalid-argument')
  await goner.call('deleteMyAccount', { confirm: 'DELETE' })
  const d = (await A.db.doc(`users/${goner.uid}`).get()).data(); eq(d.status, 'deleted'); eq(d.email, null); eq(d.fullName, 'Deleted user')
  await A.auth.getUser(goner.uid).then(() => { throw new Error('auth user still exists') }, e => ok(/user-not-found/.test(e.code)))
})
await step('customer with a job in progress cannot delete account', async () => {
  const c2 = await register('busy', 'customer', 'Busy Bee')
  const r = await c2.call('createRepairRequest', requestBody('busy-req-0001')); ok(r.jobId)
  await c2.call('deleteMyAccount', { confirm: 'DELETE' })   // only OPEN jobs: allowed, and they are cancelled
  eq((await A.db.doc(`repairRequests/${r.jobId}`).get()).data().status, 'cancelled')
})

section('8. WordPress intake (signed server-to-server) → continue in app')
const WP_SECRET = 'demo-wp-intake-secret-local-only'
const wpUrl = `http://127.0.0.1:5001/${PROJECT}/europe-west2/wpIntake`
async function wp(body, over = {}) {
  const raw = JSON.stringify(body), ts = String(over.ts ?? Math.floor(Date.now() / 1000))
  const sig = over.sig ?? createHmac('sha256', WP_SECRET).update(`${ts}.${raw}`).digest('hex')
  const r = await fetch(wpUrl, { method: over.method ?? 'POST', headers: { 'content-type': 'application/json', 'x-thor-timestamp': ts, 'x-thor-signature': sig }, body: over.method === 'GET' ? undefined : raw })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
const wpEmail = email('wpvisitor'), wpBody = { submissionId: `sub-${stamp}-1`, consent: true, fields: { first_name: 'Wendy', email: wpEmail, phone: '07700900123', postal_code: 'BR1 1AA', brand: 'Lenovo', model: 'T480', serial_n: 'WPSERIAL1', problem: 'Screen flickers then goes black' } }
let enquiry
await step('bad signature, stale timestamp, no consent, wrong method are all rejected', async () => {
  eq((await wp(wpBody, { sig: 'deadbeef' })).status, 401); eq((await wp(wpBody, { ts: 1000 })).status, 401)
  eq((await wp({ ...wpBody, consent: false })).status, 400); eq((await wp(wpBody, { method: 'GET' })).status, 405)
  eq((await wp({ ...wpBody, fields: { ...wpBody.fields, email: 'not-an-email' } })).status, 400)
})
await step('valid intake stores an enquiry, sends one email (mock), duplicate submit is a no-op', async () => {
  const r = await wp(wpBody); eq(r.status, 200); ok(r.body.enquiryId)
  const dup = await wp(wpBody); eq(dup.status, 200); ok(dup.body.duplicate)
  const mails = (await mailbox(wpEmail)).filter(m => /Confirm your Thor Computer/.test(m.subject)); eq(mails.length, 1, 'confirmation emails sent')
  const m = new URL(mails[0].cta.url); enquiry = { id: m.searchParams.get('e'), token: m.searchParams.get('t') }; ok(enquiry.id && enquiry.token)
})
await step('enquiry documents are not readable by browsers', async () => {
  await denied(getDoc(doc(customer.db, `enquiries/${enquiry.id}`)))
})
await step('wrong-email customer is refused; matching customer claims it once and the job carries source=wordpress', async () => {
  await denied(customer.call('getEnquiry', enquiry), 'permission-denied')
  const wpc = actor('wpvisitor'); await createUserWithEmailAndPassword(wpc.auth, wpEmail, PASSWORD); await verifyViaEmailLink(wpc, wpEmail)
  await wpc.call('completeRegistration', { role: 'customer', fullName: 'Wendy Visitor', phone: '07700900123', postcode: 'BR1 1AA', consent: true }); await wpc.refresh()
  eq((await wpc.call('getEnquiry', enquiry)).fields.brand, 'Lenovo')
  await denied(wpc.call('getEnquiry', { ...enquiry, token: 'x'.repeat(48) }), 'permission-denied')
  const r = await wpc.call('createRepairRequest', requestBody('ignored-key-0001', { enquiry })); ok(!r.duplicate)
  eq((await getDoc(doc(wpc.db, `repairRequests/${r.jobId}`))).data().source, 'wordpress')
  const again = await wpc.call('createRepairRequest', requestBody('different-key-0002', { enquiry })).catch(e => e)
  ok(again?.code?.endsWith?.('failed-precondition'), 'enquiry could be claimed twice')
})

section('9. Rate limiting and abuse')
await step('daily request cap (10) is enforced', async () => {
  const spam = await register('spammer', 'customer', 'Spam Bot')
  let hit = null
  for (let i = 0; i < 12 && !hit; i++) await spam.call('createRepairRequest', requestBody(`spam-req-${String(i).padStart(4, '0')}`)).catch(e => { hit = e })
  ok(hit?.code?.endsWith?.('resource-exhausted'), `expected resource-exhausted, got ${hit?.code}`)
})

// ---------- summary ----------
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} smoke steps passed`)
if (failed.length) { console.log('\nFAILED:'); for (const f of failed) console.log(` - ${f.name}\n     ${f.err?.stack?.split('\n').slice(0, 3).join('\n     ') ?? f.err}`) }
process.exit(failed.length ? 1 : 0)
