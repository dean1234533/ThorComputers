// End-to-end checks for the marketplace upgrade (payments, commission, Meta lead automation, assistant, support, disputes) against the
// LOCAL emulators only. Stripe and the Meta Graph API are replaced by small local test doubles on 127.0.0.1:12111 / :12112, which the
// functions use ONLY inside the emulator (STRIPE_API_HOST / META_GRAPH_BASE in functions/.env.local). Webhooks are genuinely signed with
// the local test secrets and verified by the real handlers. Nothing here proves anything about live Stripe or Meta accounts.
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import http from 'node:http'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, sendEmailVerification, applyActionCode } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, addDoc, collection, serverTimestamp, getDocs, query, where } from 'firebase/firestore'
import { getStorage, connectStorageEmulator, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'

const PROJECT = 'demo-thor'
for (const k of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) if (!/^(127\.0\.0\.1|localhost)/.test(process.env[k] ?? '')) { console.error(`Refusing to run: ${k} is not a local emulator.`); process.exit(2) }
process.env.GCLOUD_PROJECT = PROJECT
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199'
const require = createRequire(new URL('../functions/', import.meta.url))
const { initializeApp: adminInit } = require('firebase-admin/app'); const { getAuth: adminAuth } = require('firebase-admin/auth'); const { getFirestore: adminDb, FieldValue } = require('firebase-admin/firestore')
const Stripe = require('stripe'); const { encryptSecret } = require('./lib/security.js')
adminInit({ projectId: PROJECT })
const A = { auth: adminAuth(), db: adminDb() }
const FN = 'http://127.0.0.1:5001/demo-thor/europe-west2'
const SECRETS = { stripe: 'whsec_local_platform_endpoint_secret', connect: 'whsec_local_connect_endpoint_secret', metaApp: 'local-meta-app-secret', metaVerify: 'local-meta-verify-token', metaKey: 'local-meta-token-encryption-key' }

// ---------- harness ----------
const results = []
async function step(name, fn) { try { await fn(); results.push(true); console.log(`  ✔ ${name}`) } catch (e) { results.push(false); console.log(`  ✖ ${name}\n      ${String(e?.message ?? e).split('\n')[0]}`) } }
const section = t => console.log(`\n${t}`)
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ?? 'expected equal'}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`) }
const ok = (v, m) => { if (!v) throw new Error(m ?? 'expected truthy') }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, what, ms = 30000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`); await sleep(300) } }
async function denied(p, code, frag) {
  try { await p } catch (e) { const c = String(e?.code ?? ''); if (code && !c.endsWith(code)) throw new Error(`expected ${code}, got ${c}: ${e.message}`); if (frag && !String(e.message).toLowerCase().includes(frag.toLowerCase())) throw new Error(`expected "${frag}" in: ${e.message}`); return e }
  throw new Error('expected rejection but it succeeded')
}

// ---------- local test doubles ----------
const fake = { stripe: { n: 0, sessions: {}, pis: {}, fees: {}, refunds: [] }, graph: { leads: {}, calls: [] } }
const body = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)) })
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
const stripeServer = http.createServer(async (req, res) => {
  const p = new URLSearchParams(await body(req)), url = new URL(req.url, 'http://x'), s = fake.stripe
  if (req.method === 'POST' && url.pathname === '/v1/accounts') return json(res, 200, { id: `acct_test_${++s.n}`, object: 'account', charges_enabled: false, payouts_enabled: false, details_submitted: false, capabilities: { transfers: 'inactive' }, requirements: { currently_due: ['external_account'], disabled_reason: null }, metadata: { uid: p.get('metadata[uid]') } })
  if (req.method === 'POST' && url.pathname === '/v1/account_links') return json(res, 200, { object: 'account_link', url: 'https://connect.stripe.test/setup' })
  if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
    const id = `cs_test_${++s.n}`; const sess = { id, object: 'checkout.session', url: `https://checkout.stripe.test/${id}`, expires_at: Number(p.get('expires_at')), amount_total: Number(p.get('line_items[0][price_data][unit_amount]')),
      fee: Number(p.get('payment_intent_data[application_fee_amount]')), destination: p.get('payment_intent_data[transfer_data][destination]'), currency: p.get('line_items[0][price_data][currency]'), metadata: { paymentId: p.get('metadata[paymentId]'), jobId: p.get('metadata[jobId]'), kind: p.get('metadata[kind]') } }
    s.sessions[id] = sess; return json(res, 200, sess)
  }
  const pi = url.pathname.match(/^\/v1\/payment_intents\/(.+)$/)
  if (pi) { const x = s.pis[pi[1]]; return x ? json(res, 200, { id: pi[1], object: 'payment_intent', application_fee_amount: x.fee, latest_charge: { id: `ch_${pi[1]}`, object: 'charge', receipt_url: 'https://pay.stripe.test/receipt', balance_transaction: { id: 'txn_1', fee: x.stripeFee } } }) : json(res, 404, { error: { message: 'no such pi' } }) }
  if (req.method === 'POST' && url.pathname === '/v1/refunds') { const r = { id: `re_test_${++s.n}`, object: 'refund', amount: Number(p.get('amount')), status: 'pending', payment_intent: p.get('payment_intent'), reverse: p.get('reverse_transfer'), feeRefund: p.get('refund_application_fee') }; s.refunds.push(r); return json(res, 200, r) }
  const fee = url.pathname.match(/^\/v1\/application_fees\/(.+)$/)
  if (fee) return json(res, 200, { id: fee[1], object: 'application_fee', amount_refunded: s.fees[fee[1]] ?? 0 })
  json(res, 404, { error: { message: `fake stripe: unhandled ${req.method} ${url.pathname}` } })
})
const graphServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); fake.graph.calls.push(`${req.method} ${url.pathname}`)
  ok(url.searchParams.get('appsecret_proof') || req.method === 'POST', 'appsecret_proof missing')
  const id = url.pathname.slice(1)
  if (fake.graph.leads[id]) return json(res, 200, fake.graph.leads[id])
  json(res, 404, { error: { message: 'Unsupported get request', code: 100 } })
})
await new Promise(r => stripeServer.listen(12111, '127.0.0.1', r)); await new Promise(r => graphServer.listen(12112, '127.0.0.1', r))

const stripeSigner = new Stripe('sk_test_signing_only')
let evtN = 0
async function stripeEvent(type, object, { account, secret = SECRETS.stripe, id } = {}) {
  const payload = JSON.stringify({ id: id ?? `evt_test_${Date.now()}_${++evtN}`, object: 'event', type, created: Math.floor(Date.now() / 1000), livemode: false, ...(account ? { account } : {}), data: { object } })
  const r = await fetch(`${FN}/stripeWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': stripeSigner.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload })
  return { status: r.status, body: await r.json().catch(() => null), payload }
}
async function metaPost(entry, { secret = SECRETS.metaApp } = {}) {
  const payload = JSON.stringify({ object: 'page', entry })
  const sig = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex')
  const r = await fetch(`${FN}/metaWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const leadEntry = (leadId, formId = 'F1') => [{ id: 'PAGE1', time: Math.floor(Date.now() / 1000), changes: [{ field: 'leadgen', value: { leadgen_id: leadId, page_id: 'PAGE1', form_id: formId, ad_id: 'AD1', adgroup_id: 'AS1', created_time: Math.floor(Date.now() / 1000) } }] }]

// ---------- actors ----------
let n = 0
function actor(label) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, appId: 'demo', storageBucket: `${PROJECT}.appspot.com` }, `${label}-${n++}`)
  const auth = getAuth(app), db = getFirestore(app), storage = getStorage(app), fns = getFunctions(app, 'europe-west2')
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true }); connectFirestoreEmulator(db, '127.0.0.1', 8080); connectStorageEmulator(storage, '127.0.0.1', 9199); connectFunctionsEmulator(fns, '127.0.0.1', 5001)
  return { label, auth, db, storage, call: (name, data = {}) => httpsCallable(fns, name)(data).then(r => r.data), get uid() { return auth.currentUser?.uid }, refresh: () => auth.currentUser.getIdToken(true) }
}
const stamp = Date.now().toString(36), email = r => `${r}.${stamp}@mkt.demo.test`, PASSWORD = 'Passw0rd!smoke'
async function verify(a, addr) {
  await sendEmailVerification(a.auth.currentUser)
  const codes = (await (await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/oobCodes`)).json()).oobCodes.filter(c => c.email === addr && c.requestType === 'VERIFY_EMAIL')
  await applyActionCode(a.auth, codes.at(-1).oobCode); await a.auth.currentUser.reload()
}
async function register(label, role, addr = email(label)) {
  const a = actor(label); await createUserWithEmailAndPassword(a.auth, addr, PASSWORD); await verify(a, addr)
  await a.call('completeRegistration', { role, fullName: `${label} Person`, phone: '07700900123', postcode: 'BR1 1AA', consent: true }); await a.refresh(); a.addr = addr; return a
}
async function bootstrapAdmin(label, level, perms) {
  const a = actor(label), addr = email(label), cred = await createUserWithEmailAndPassword(a.auth, addr, PASSWORD)
  await A.auth.updateUser(cred.user.uid, { emailVerified: true }); await A.auth.setCustomUserClaims(cred.user.uid, { role: 'admin', adminLevel: level, perms, suspended: false, engineerApproved: false, specs: [] })
  await A.db.doc(`users/${cred.user.uid}`).set({ role: 'admin', adminLevel: level, perms, email: addr, fullName: `Admin ${level}`, status: 'active', createdAt: FieldValue.serverTimestamp() })
  await a.refresh(); return a
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), PDF = new Uint8Array([37, 80, 68, 70])
async function approvedEngineer(label, admin) {
  const a = await register(label, 'engineer')
  const photo = ref(a.storage, `avatars/${a.uid}/me.png`); await uploadBytes(photo, PNG, { contentType: 'image/png' })
  await setDoc(doc(a.db, `engineerApplications/${a.uid}`), { status: 'draft', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), profile: { displayName: `${label} Repairs`, businessName: '', bio: 'Fictional engineer for local tests with many years repairing laptops, desktops and Macs in south-east London.', yearsExperience: 9,
    serviceArea: { postcode: 'BR1 1AA', radiusMiles: 25 }, areasCovered: ['Bromley', 'Stratford'], specialisations: ['laptop', 'desktop'], certificationsText: '', workingArrangements: ['home', 'workshop'], typicalPricing: '', photoURL: await getDownloadURL(photo) } })
  const path = `qualifications/${a.uid}/c.pdf`; await uploadBytes(ref(a.storage, path), PDF, { contentType: 'application/pdf' })
  await addDoc(collection(a.db, 'engineerQualifications'), { engineerId: a.uid, verification: 'pending', storagePath: path, name: 'CompTIA A+', issuer: 'CompTIA', createdAt: serverTimestamp() })
  await a.call('submitEngineerApplication'); await admin.call('reviewEngineerApplication', { engineerId: a.uid, decision: 'approve' }); await a.refresh(); return a
}
const request = (key, over = {}) => ({ requestKey: key, device: { type: 'laptop', manufacturer: 'HP', model: 'Pavilion 15', os: '' }, serialNumber: '', issues: [], description: 'Laptop keeps switching off after about ten minutes of use.', urgency: 'soon', serviceMethods: ['home', 'workshop'], postcode: 'BR1 1AA', addressLine: '1 Test Road', accessNotes: '', preferredDates: [], photoPaths: [], ...over })
const quote = (jobId, over = {}) => ({ jobId, repairPence: 8000, labourPence: 6000, partsEstimatePence: 2000, diagnosticPence: 0, calloutPence: 2000, durationHours: 1, availability: 'Weekdays', partsIncluded: true, warranty: '90 days', expiresAt: new Date(Date.now() + 5 * 86400_000).toISOString(), serviceMethod: 'home', earliestAppointment: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10), includedServices: 'Diagnosis and fitting', excludedServices: 'Data backup', ...over })
const ALL = ['engineers.review', 'customers.manage', 'jobs.manage', 'jobs.view', 'reviews.moderate', 'messages.audit', 'settings.edit', 'admins.manage', 'reports.view', 'finance.view', 'payments.manage', 'payments.configure', 'marketing.view', 'marketing.manage', 'leads.manage', 'disputes.manage', 'support.handle', 'chatbot.manage', 'audit.view']
const ADMIN = ['engineers.review', 'customers.manage', 'jobs.manage', 'jobs.view', 'reviews.moderate', 'reports.view', 'leads.manage', 'marketing.view', 'disputes.manage', 'support.handle']
const SUPPORT = ['customers.manage', 'jobs.view', 'reports.view', 'support.handle']
const mailbox = async to => (await A.db.collection('devMailbox').where('to', '==', to).get()).docs.map(d => d.data())
const nextWeekday = () => { const d = new Date(Date.now() + 3 * 86400_000); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

console.log(`Thor Computer marketplace upgrade smoke test (project ${PROJECT}; emulators + local Stripe/Meta test doubles)\n`)
let superAdmin, admin, support, customer, other, engineer, jobId, quoteId, paymentId, pi1

section('1. Roles and settings')
await step('actors: super admin, admin, support admin, customers, an approved engineer', async () => {
  superAdmin = await bootstrapAdmin('super', 'super_admin', ALL); admin = await bootstrapAdmin('admin', 'admin', ADMIN); support = await bootstrapAdmin('support', 'support', SUPPORT)
  customer = await register('cust', 'customer'); other = await register('other', 'customer'); engineer = await approvedEngineer('eng', superAdmin)
})
const paySettings = (over = {}) => ({ enabled: true, commissionPercent: 15, policy: 'full_before', depositPercent: 20, refundApplicationFee: true, cancellationFeePence: 0, refundPolicyText: 'Refunds per our policy.', methods: ['card'], reason: 'Enable Stripe Connect payments', ...over })
await step('only a super admin can change commission and payment settings (admin and support refused)', async () => {
  await denied(admin.call('savePaymentSettings', paySettings()), 'permission-denied')
  await denied(support.call('savePaymentSettings', paySettings()), 'permission-denied')
  await denied(customer.call('savePaymentSettings', paySettings()), 'permission-denied')
  eq((await superAdmin.call('savePaymentSettings', paySettings())).commissionBps, 1500)
  const logs = await A.db.collection('auditLogs').where('action', '==', 'settings.payments').get(); ok(logs.size >= 1, 'payment settings change not audited')
})
await step('support cannot see finance; finance report and dashboard money are super-admin only', async () => {
  await denied(support.call('financeReport', { from: new Date(Date.now() - 86400_000).toISOString(), to: new Date().toISOString() }), 'permission-denied')
  const s = await support.call('adminStats', { days: 7 }); ok(!s.finance && !s.marketing, 'support received finance/marketing numbers')
  const t = await superAdmin.call('adminStats', { days: 7 }); ok(t.finance && t.marketing, 'super admin is missing finance/marketing sections')
})

section('2. Stripe Connect onboarding, quotes and the 15% commission')
await step('customer request gets a THOR-YYYY-NNNNNN reference', async () => {
  const r = await customer.call('createRepairRequest', request(`mkt-${stamp}-1`)); jobId = r.jobId
  ok(/^THOR-\d{4}-\d{6}$/.test(r.reference), `bad reference ${r.reference}`)
})
await step('with payments on, an engineer without a ready Stripe account cannot quote', async () => {
  await denied(engineer.call('submitQuote', quote(jobId)), 'failed-precondition', 'payouts')
})
await step('engineer starts Stripe Express onboarding (account + hosted link, no bank details stored by Thor)', async () => {
  eq((await engineer.call('stripeOnboardingLink')).url, 'https://connect.stripe.test/setup')
  const a = (await A.db.doc(`stripeConnectedAccounts/${engineer.uid}`).get()).data(); ok(a.accountId.startsWith('acct_test_')); eq(a.transfersActive, false)
  ok(!JSON.stringify(a).match(/sort|iban|account_number/i), 'banking data stored')
})
await step('a signed Connect account.updated webhook activates payouts; a bad signature is rejected', async () => {
  const acct = (await A.db.doc(`stripeConnectedAccounts/${engineer.uid}`).get()).data().accountId
  eq((await stripeEvent('account.updated', { id: acct, object: 'account', charges_enabled: true, payouts_enabled: true, details_submitted: true, capabilities: { transfers: 'active' }, requirements: { currently_due: [] }, metadata: { uid: engineer.uid } }, { account: acct, secret: 'whsec_wrong' })).status, 400)
  eq((await stripeEvent('account.updated', { id: acct, object: 'account', charges_enabled: true, payouts_enabled: true, details_submitted: true, capabilities: { transfers: 'active' }, requirements: { currently_due: [] }, metadata: { uid: engineer.uid } }, { account: acct, secret: SECRETS.connect })).status, 200)
  eq((await A.db.doc(`stripeConnectedAccounts/${engineer.uid}`).get()).data().transfersActive, true)
})
await step('£100 quote: commission rate fixed on the quote = £15, engineer £85; labour+parts must add up', async () => {
  await denied(engineer.call('submitQuote', quote(jobId, { labourPence: 5000 })), 'invalid-argument', 'add up')
  quoteId = (await engineer.call('submitQuote', quote(jobId))).quoteId
  const q = (await A.db.doc(`repairQuotes/${quoteId}`).get()).data()
  eq(q.totalPence, 10000); eq(q.commissionBps, 1500); eq(q.platformFeePence, 1500); eq(q.engineerSharePence, 8500); eq(q.includedServices, 'Diagnosis and fitting')
  ok((await mailbox(customer.addr)).some(m => /received a repair quote/i.test(m.subject)), 'customer quote email missing')
})
await step('£200 quote on another job: £30 commission / £170 engineer', async () => {
  const r = await customer.call('createRepairRequest', request(`mkt-${stamp}-2`))
  const q2 = (await engineer.call('submitQuote', quote(r.jobId, { repairPence: 18000, labourPence: 18000, partsEstimatePence: 0 }))).quoteId
  const q = (await A.db.doc(`repairQuotes/${q2}`).get()).data(); eq(q.totalPence, 20000); eq(q.platformFeePence, 3000); eq(q.engineerSharePence, 17000)
})
await step('accepting moves the job to awaiting payment; booking is blocked until Stripe confirms', async () => {
  await customer.call('acceptQuote', { quoteId })
  const j = (await A.db.doc(`repairRequests/${jobId}`).get()).data(); eq(j.status, 'awaiting_payment'); eq(j.commissionBps, 1500); eq(j.payment.policy, 'full_before')
  await denied(customer.call('bookAppointment', { jobId, startAt: new Date(Date.now() + 5 * 86400_000).toISOString() }), 'failed-precondition')
})
await step('Checkout is created server-side with the 15% application fee and transfer to the engineer; reopening reuses it', async () => {
  const c = await customer.call('createCheckout', { jobId }); paymentId = c.paymentId
  ok(c.url.startsWith('https://checkout.stripe.test/'))
  const sess = Object.values(fake.stripe.sessions).at(-1); eq(sess.amount_total, 10000); eq(sess.fee, 1500); eq(sess.currency, 'gbp')
  eq(sess.destination, (await A.db.doc(`stripeConnectedAccounts/${engineer.uid}`).get()).data().accountId)
  eq((await customer.call('createCheckout', { jobId })).url, c.url)
  await denied(other.call('createCheckout', { jobId }), 'permission-denied')
})
await step('a browser can never mark a payment paid (rules)', async () => {
  await denied(setDoc(doc(customer.db, `payments/${paymentId}`), { status: 'paid' }, { merge: true }))
  await denied(setDoc(doc(customer.db, 'transactions/pi_fake'), { customerId: customer.uid, grossPence: 10000 }))
})
await step('verified checkout.session.completed: £100 paid, £15 commission, £85 engineer, Stripe fee recorded; job unlocked', async () => {
  const sess = Object.values(fake.stripe.sessions).at(-1); pi1 = `pi_test_${stamp}_1`; fake.stripe.pis[pi1] = { fee: 1500, stripeFee: 170 }
  const ev = await stripeEvent('checkout.session.completed', { id: sess.id, object: 'checkout.session', payment_status: 'paid', amount_total: 10000, currency: 'gbp', payment_intent: pi1, metadata: sess.metadata }, { id: `evt_paid_${stamp}` })
  eq(ev.status, 200)
  const t = (await A.db.doc(`transactions/${pi1}`).get()).data(); eq(t.grossPence, 10000); eq(t.commissionPence, 1500); eq(t.engineerSharePence, 8500); eq(t.stripeFeePence, 170); eq(t.commissionBps, 1500)
  eq((await A.db.doc(`commissionRecords/${pi1}`).get()).data().amountPence, 1500)
  const j = (await A.db.doc(`repairRequests/${jobId}`).get()).data(); eq(j.status, 'engineer_selected'); eq(j.payment.paidPence, 10000); eq(j.payment.status, 'paid')
  eq((await A.db.doc(`payments/${paymentId}`).get()).data().status, 'paid')
})
await step('replaying the same Stripe event changes nothing (no duplicate transaction or commission)', async () => {
  const sess = Object.values(fake.stripe.sessions).at(-1)
  const ev = await stripeEvent('checkout.session.completed', { id: sess.id, object: 'checkout.session', payment_status: 'paid', amount_total: 10000, currency: 'gbp', payment_intent: pi1, metadata: sess.metadata }, { id: `evt_paid_${stamp}` })
  eq(ev.status, 200); eq(ev.body.duplicate, true)
  const again = await stripeEvent('checkout.session.completed', { id: sess.id, object: 'checkout.session', payment_status: 'paid', amount_total: 10000, currency: 'gbp', payment_intent: pi1, metadata: sess.metadata })   // new event id, same payment
  eq(again.status, 200)
  eq((await A.db.doc(`repairRequests/${jobId}`).get()).data().payment.paidPence, 10000)
  eq((await A.db.collection('transactions').where('jobId', '==', jobId).get()).size, 1)
})
await step('a session whose amount does not match the server record is rejected for retry, not applied', async () => {
  const r = await customer.call('createRepairRequest', request(`mkt-${stamp}-3`)); const q = (await engineer.call('submitQuote', quote(r.jobId))).quoteId
  await customer.call('acceptQuote', { quoteId: q }); const c = await customer.call('createCheckout', { jobId: r.jobId })
  const sess = Object.values(fake.stripe.sessions).at(-1), pi = `pi_test_${stamp}_bad`; fake.stripe.pis[pi] = { fee: 1500, stripeFee: 170 }
  eq((await stripeEvent('checkout.session.completed', { id: sess.id, object: 'checkout.session', payment_status: 'paid', amount_total: 1, currency: 'gbp', payment_intent: pi, metadata: sess.metadata })).status, 500)
  eq((await A.db.doc(`payments/${c.paymentId}`).get()).data().status, 'open'); eq((await A.db.doc(`repairRequests/${r.jobId}`).get()).data().status, 'awaiting_payment')
})
await step('failed payment is recorded and the customer notified', async () => {
  const p = (await A.db.collection('payments').where('status', '==', 'open').limit(1).get()).docs[0]
  eq((await stripeEvent('payment_intent.payment_failed', { id: 'pi_x', object: 'payment_intent', metadata: { paymentId: p.id }, last_payment_error: { message: 'Your card was declined.' } })).status, 200)
  eq((await A.db.doc(`payments/${p.id}`).get()).data().status, 'failed')
})

section('3. Booking, additional work, completion, balance payment')
await step('customer books after payment; engineer proposes extra work; customer approves; total rises to £120', async () => {
  const slots = (await customer.call('getSlots', { jobId, date: nextWeekday() })).slots; ok(slots.length, 'no slots')
  await customer.call('bookAppointment', { jobId, startAt: slots[0] })
  await engineer.call('changeJobStatus', { jobId, to: 'in_progress' })
  await denied(other.call('respondQuoteRevision', { jobId, accept: true }), 'permission-denied')
  await engineer.call('proposeQuoteRevision', { jobId, additionalPence: 2000, reason: 'The battery is swollen and must be replaced as well.' })
  await denied(engineer.call('changeJobStatus', { jobId, to: 'completed' }), 'failed-precondition', 'revised')
  await customer.call('respondQuoteRevision', { jobId, accept: true })
  eq((await A.db.doc(`repairRequests/${jobId}`).get()).data().agreedTotalPence, 12000)
})
await step('after completion the £20 balance carries exactly £3 commission (total £18 = 15% of £120, never charged twice)', async () => {
  await engineer.call('changeJobStatus', { jobId, to: 'completed' })
  await denied(customer.call('changeJobStatus', { jobId, to: 'closed' }), 'failed-precondition', 'balance')
  const c = await customer.call('createCheckout', { jobId }); const sess = Object.values(fake.stripe.sessions).at(-1); eq(sess.amount_total, 2000); eq(sess.fee, 300); eq(sess.metadata.kind, 'balance')
  const pi = `pi_test_${stamp}_2`; fake.stripe.pis[pi] = { fee: 300, stripeFee: 50 }
  eq((await stripeEvent('checkout.session.completed', { id: sess.id, object: 'checkout.session', payment_status: 'paid', amount_total: 2000, currency: 'gbp', payment_intent: pi, metadata: sess.metadata })).status, 200)
  const txs = (await A.db.collection('transactions').where('jobId', '==', jobId).get()).docs.map(d => d.data())
  eq(txs.reduce((s, t) => s + t.commissionPence, 0), 1800); eq(txs.reduce((s, t) => s + t.grossPence, 0), 12000)
  eq((await A.db.doc(`payments/${c.paymentId}`).get()).data().status, 'paid')
})

section('4. Disputes and refunds')
await step('customer raises a problem (complaint required); engineer responds; strangers cannot read it', async () => {
  await denied(customer.call('changeJobStatus', { jobId, to: 'disputed', note: 'bad' }), 'invalid-argument')
  await customer.call('changeJobStatus', { jobId, to: 'disputed', note: 'The laptop still switches off after the repair.' })
  await engineer.call('respondToDispute', { jobId, response: 'I can revisit free of charge this week.' })
  await denied(getDoc(doc(other.db, `disputes/${jobId}`)))
  const d = (await A.db.doc(`disputes/${jobId}`).get()).data(); eq(d.status, 'open'); eq(d.paidPence, 12000)
})
await step('admin without payments.manage cannot refund; super admin resolves with a £20 refund via Stripe (reverse transfer)', async () => {
  const bal = (await A.db.collection('payments').where('jobId', '==', jobId).where('kind', '==', 'balance').get()).docs[0]
  await denied(admin.call('resolveDispute', { jobId, outcome: 'closed', resolution: 'Partial refund for the inconvenience.', refund: { paymentId: bal.id, amountPence: 2000 }, requestKey: `rk-${stamp}-1` }), 'permission-denied')
  await superAdmin.call('resolveDispute', { jobId, outcome: 'closed', resolution: 'Partial refund for the inconvenience.', refund: { paymentId: bal.id, amountPence: 2000 }, requestKey: `rk-${stamp}-2` })
  const r = fake.stripe.refunds.at(-1); eq(r.amount, 2000); eq(r.reverse, 'true'); eq(r.feeRefund, 'true')
  eq((await A.db.doc(`repairRequests/${jobId}`).get()).data().status, 'closed'); eq((await A.db.doc(`disputes/${jobId}`).get()).data().status, 'resolved')
})
await step('charge.refunded (cumulative) adjusts transaction and commission records; replay is harmless', async () => {
  const pi = `pi_test_${stamp}_2`; fake.stripe.fees[`fee_${stamp}`] = 300
  const charge = { id: `ch_${pi}`, object: 'charge', payment_intent: pi, amount_refunded: 2000, application_fee: `fee_${stamp}` }
  eq((await stripeEvent('charge.refunded', charge)).status, 200); eq((await stripeEvent('charge.refunded', charge)).status, 200)
  const t = (await A.db.doc(`transactions/${pi}`).get()).data(); eq(t.refundedPence, 2000); eq(t.commissionRefundedPence, 300); eq(t.status, 'refunded')
  eq((await A.db.doc(`commissionRecords/${pi}`).get()).data().status, 'refunded')
  eq((await A.db.doc(`repairRequests/${jobId}`).get()).data().payment.refundedPence, 2000)
})
await step('finance report reflects only confirmed Stripe events', async () => {
  const r = await superAdmin.call('financeReport', { from: new Date(Date.now() - 86400_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() })
  ok(r.grossPence >= 12000 && r.commissionPence >= 1800, JSON.stringify({ g: r.grossPence, c: r.commissionPence })); ok(r.refundsPence >= 2000)
  eq(r.netPlatformRevenuePence, r.commissionPence - r.commissionRefundedPence - r.stripeFeesPence - r.disputesLostPence)
})

section('5. Meta Lead Ads: webhook, import, conversion, attribution')
await step('webhook verification handshake: correct token echoes the challenge, wrong token is refused', async () => {
  eq(await (await fetch(`${FN}/metaWebhook?hub.mode=subscribe&hub.verify_token=${SECRETS.metaVerify}&hub.challenge=12345`)).text(), '12345')
  eq((await fetch(`${FN}/metaWebhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status, 403)
})
const leadEmail = email('lead1'), autoEmail = email('lead3')
const leadFixture = (id, fields, extra = {}) => ({ id, created_time: new Date().toISOString(), form_id: 'F1', ad_id: 'AD1', adset_id: 'AS1', campaign_id: 'C1', platform: 'ig', field_data: Object.entries(fields).map(([name, v]) => ({ name, values: [v] })), custom_disclaimer_responses: [{ checkbox_key: 'mk', is_checked: '1' }], ...extra })
await step('connected page token is stored encrypted; unsigned webhook posts are refused', async () => {
  await A.db.doc('metaSecrets/page_PAGE1').set({ tokenEnc: encryptSecret('PAGE-TOKEN', SECRETS.metaKey) })
  await A.db.doc('metaCampaigns/C1').set({ id: 'C1', name: 'Laptop Repairs London', feedsMarketplace: true, status: 'ACTIVE' })
  eq((await metaPost(leadEntry('L0'), { secret: 'wrong' })).status, 401)
})
await step('complete consented lead is imported once and the customer is emailed a secure confirmation link', async () => {
  fake.graph.leads[`L1${stamp}`] = leadFixture(`L1${stamp}`, { full_name: 'Lena Lead', email: leadEmail, phone_number: '+447700900111', post_code: 'E15 2AB', device_type: 'Laptop', brand: 'HP', model: 'Pavilion', describe_the_problem: 'Switches off after ten minutes of use', repair_type: 'Home visit' })
  eq((await metaPost(leadEntry(`L1${stamp}`))).body.accepted, 1)
  const l = await until(async () => { const d = (await A.db.doc(`metaLeads/L1${stamp}`).get()).data(); return d?.status === 'awaiting_confirmation' && d }, 'lead L1 awaiting confirmation')
  eq(l.platform, 'instagram'); eq(l.campaignId, 'C1'); eq(l.mapped.postcode, 'E15 2AB'); eq(l.mapped.deviceType, 'laptop'); eq(l.consent.given, true)
  ok((await mailbox(leadEmail)).some(m => /Confirm your Thor Computer repair request/.test(m.subject)), 'confirmation email missing')
})
await step('a replayed webhook for the same lead is a duplicate (no second lead)', async () => {
  eq((await metaPost(leadEntry(`L1${stamp}`))).body.duplicates, 1)
  eq((await A.db.collection('metaLeads').where('mapped.email', '==', leadEmail).get()).size, 1)
})
await step('an incomplete lead stays pending (awaiting information) and is not published', async () => {
  fake.graph.leads[`L2${stamp}`] = leadFixture(`L2${stamp}`, { full_name: 'Ivy Incomplete', email: email('lead2') })
  await metaPost(leadEntry(`L2${stamp}`))
  const l = await until(async () => { const d = (await A.db.doc(`metaLeads/L2${stamp}`).get()).data(); return d?.status === 'awaiting_information' && d }, 'lead L2 awaiting information')
  ok(l.missing.includes('postcode') && l.missing.includes('problem')); eq(l.jobId, null)
})
let leadJob
await step('the lead customer confirms from the link: one job, source meta, campaign attribution kept, lead converted', async () => {
  const leadCust = await register('leadcust', 'customer', leadEmail)
  const url = new URL((await mailbox(leadEmail)).find(m => m.cta?.url?.includes('/continue')).cta.url)
  const enquiry = { id: url.searchParams.get('e'), token: url.searchParams.get('t') }
  await denied(other.call('getEnquiry', enquiry), 'permission-denied')
  const f = (await leadCust.call('getEnquiry', enquiry)).fields; eq(f.device_type, 'laptop'); eq(f.service_method, 'home')
  const r = await leadCust.call('createRepairRequest', request(`lead-${stamp}`, { postcode: 'E15 2AB', serviceMethods: ['home'], enquiry })); leadJob = r.jobId
  const j = (await A.db.doc(`repairRequests/${r.jobId}`).get()).data(); eq(j.source, 'meta'); eq(j.attribution.campaignId, 'C1'); eq(j.attribution.leadId, `L1${stamp}`)
  eq((await A.db.doc(`metaLeads/L1${stamp}`).get()).data().status, 'converted_to_job')
  await denied(leadCust.call('createRepairRequest', request(`lead-${stamp}-again`, { enquiry })), 'failed-precondition')
})
await step('engineers covering the area are notified; a quote moves the lead to receiving bids', async () => {
  ok((await A.db.doc(`notifications/job-new:${leadJob}:${engineer.uid}`).get()).exists, 'engineer not notified')
  await engineer.call('submitQuote', quote(leadJob))
  await until(async () => (await A.db.doc(`metaLeads/L1${stamp}`).get()).data()?.status === 'receiving_bids', 'lead receiving bids')
})
await step('auto mode: a complete consented lead becomes a published job under a new customer account automatically', async () => {
  await denied(admin.call('saveMarketingSettings', { leadPublishMode: 'auto', duplicateWindowDays: 14, autoImport: true, notifyAdminsOnLead: true, maxDailyBudgetPence: 50000, maxBudgetChangePercent: 50, attributionWindowDays: 90, routing: [] }), 'permission-denied')   // admin cannot raise budget limits (and lacks marketing.manage)
  await superAdmin.call('saveMarketingSettings', { leadPublishMode: 'auto', duplicateWindowDays: 14, autoImport: true, notifyAdminsOnLead: true, maxDailyBudgetPence: 10000, maxBudgetChangePercent: 50, attributionWindowDays: 90,
    routing: [{ id: 'r1', name: 'Gaming', enabled: true, priority: 1, match: { campaignIds: ['C9'] }, set: { deviceType: 'gaming_pc' } }] })
  await sleep(16000)   // settings are cached for 15s per function instance
  fake.graph.leads[`L3${stamp}`] = leadFixture(`L3${stamp}`, { full_name: 'Abe Auto', email: autoEmail, post_code: 'BR1 1AA', device: 'laptop', describe_the_problem: 'Cracked screen needs replacing please' })
  await metaPost(leadEntry(`L3${stamp}`))
  const l = await until(async () => { const d = (await A.db.doc(`metaLeads/L3${stamp}`).get()).data(); return d?.status === 'converted_to_job' && d }, 'lead L3 auto-converted', 40000)
  const u = await A.auth.getUserByEmail(autoEmail); eq(l.customerId, u.uid)
  const j = (await A.db.doc(`repairRequests/${l.jobId}`).get()).data(); eq(j.status, 'open'); eq(j.source, 'meta'); eq(j.customerId, u.uid)
  ok((await mailbox(autoEmail)).some(m => /is live/.test(m.subject)), 'set-password email missing')
})
await step('auto mode never publishes a lead without consent; routing rules fill a missing category', async () => {
  fake.graph.leads[`L4${stamp}`] = leadFixture(`L4${stamp}`, { full_name: 'No Consent', email: email('lead4'), post_code: 'BR1 1AA', describe_the_problem: 'Gaming PC will not boot at all' }, { campaign_id: 'C9', custom_disclaimer_responses: [] })
  await metaPost(leadEntry(`L4${stamp}`))
  const l = await until(async () => { const d = (await A.db.doc(`metaLeads/L4${stamp}`).get()).data(); return d?.status === 'awaiting_confirmation' && d }, 'lead L4 held for confirmation')
  eq(l.jobId, null); eq(l.mapped.deviceType, 'gaming_pc'); eq(l.routingRuleId, 'r1')
})
await step('lead management: support cannot act on leads; admin rejects spam with an audit trail', async () => {
  await denied(support.call('adminLeadAction', { leadId: `L2${stamp}`, action: 'reject', note: 'spam' }), 'permission-denied')
  await admin.call('adminLeadAction', { leadId: `L2${stamp}`, action: 'reject', note: 'Spam submission' })
  eq((await A.db.doc(`metaLeads/L2${stamp}`).get()).data().status, 'rejected')
  ok((await A.db.collection('auditLogs').where('action', '==', 'lead.reject').get()).size >= 1)
})

section('6. Assistant, support tickets')
await step('assistant: only chatbot managers configure it; customers get replies within the daily limit', async () => {
  const cfg = { enabled: true, welcome: 'Hello', dailyLimitPerUser: 2, maxTurns: 6, model: 'gemini-2.5-flash', useCases: ['repair_request', 'support'], knowledge: [], escalationNote: '' }
  await denied(admin.call('saveChatbotSettings', cfg), 'permission-denied'); await superAdmin.call('saveChatbotSettings', cfg)
  await sleep(16000)   // settings are cached for 15s per function instance
  const r = await customer.call('assistantChat', { messages: [{ role: 'user', text: 'My HP laptop keeps switching off' }] }); ok(r.reply.length > 0); eq(r.draft.deviceType, 'laptop')
  await customer.call('assistantChat', { messages: [{ role: 'user', text: 'hello' }] })
  await denied(customer.call('assistantChat', { messages: [{ role: 'user', text: 'again' }] }), 'resource-exhausted')
})
await step('support ticket: customer opens, support replies, other customers cannot read it', async () => {
  const { ticketId } = await customer.call('createSupportTicket', { subject: 'Where is my engineer?', message: 'My engineer has not arrived yet, please help.', category: 'repair' })
  await denied(other.call('replySupportTicket', { ticketId, text: 'hi' }), 'permission-denied')
  await support.call('replySupportTicket', { ticketId, text: 'We have contacted them and they are on the way.' })
  const msgs = await getDocs(collection(customer.db, `supportTickets/${ticketId}/messages`)); eq(msgs.size, 2)
  await denied(getDoc(doc(other.db, `supportTickets/${ticketId}`)))
  eq((await A.db.doc(`supportTickets/${ticketId}`).get()).data().status, 'pending')
})

section('7. Contact list and work progress')
await step('contact summary is kept by triggers: repairs counted, money only in the finance-only document', async () => {
  const u = await until(async () => { const x = (await A.db.doc(`users/${customer.uid}`).get()).data(); return x?.contact?.totalRepairs >= 3 && x }, 'contact summary')
  ok(u.contact.activeRepairs >= 1, 'active repairs not counted'); eq(u.contact.source, 'app'); ok(!('totalPaidPence' in u.contact), 'money leaked onto the user document')
  eq((await A.db.doc(`contactFinance/${customer.uid}`).get()).data().totalPaidPence, 10000)   // £120 paid − £20 refunded
})
let noteId
await step('staff note and tags are hidden from the customer; only the author edits a note', async () => {
  noteId = (await support.call('addContactNote', { userId: customer.uid, text: 'Prefers a call after 5pm.' })).noteId
  await support.call('updateContact', { userId: customer.uid, tags: ['VIP', 'business'], assignedTo: admin.uid })
  await denied(getDoc(doc(customer.db, `users/${customer.uid}/contactNotes/${noteId}`))); await denied(getDoc(doc(engineer.db, `users/${customer.uid}/contactNotes/${noteId}`)))
  await denied(getDoc(doc(customer.db, `contactMeta/${customer.uid}`)))
  ok(!('contactTags' in (await getDoc(doc(customer.db, `users/${customer.uid}`))).data()), 'tags on the customer-readable user document')
  eq(JSON.stringify((await A.db.doc(`contactMeta/${customer.uid}`).get()).data().tags), JSON.stringify(['vip', 'business']))
  await denied(admin.call('editContactNote', { userId: customer.uid, noteId, text: 'changed' }), 'permission-denied', 'author')
  await denied(customer.call('addContactNote', { userId: customer.uid, text: 'hi' }), 'permission-denied')
})
await step('export is audited; support gets basic fields only, finance admins get totals', async () => {
  const s = (await support.call('exportContacts', {})).rows.find(r => r.email === customer.addr); ok(s && !('totalPaidGBP' in s) && !('postcode' in s), JSON.stringify(s))
  const f = (await superAdmin.call('exportContacts', { tag: 'vip' })).rows; eq(f.length, 1); eq(f[0].totalPaidGBP, '100.00')
  ok((await A.db.collection('auditLogs').where('action', '==', 'contact.export').get()).size >= 2)
})
await step('overdue follow-up task is counted on the dashboard', async () => {
  await denied(support.call('upsertContactTask', { userId: customer.uid, title: 'Call back', dueAt: new Date().toISOString(), ownerId: customer.uid }), 'invalid-argument')
  await support.call('upsertContactTask', { userId: customer.uid, title: 'Call back about the battery', dueAt: new Date(Date.now() - 3600_000).toISOString(), ownerId: support.uid })
  ok((await superAdmin.call('adminStats', { days: 7 })).totals.overdueTasks >= 1)
})
let progJob
await step('engineer posts a progress update; the customer is notified; strangers cannot read it', async () => {
  await superAdmin.call('savePaymentSettings', paySettings({ enabled: false, reason: 'Test progress without payments' }))
  await sleep(16000)   // settings cache
  progJob = (await customer.call('createRepairRequest', request(`prog-${stamp}`))).jobId
  const q = (await engineer.call('submitQuote', quote(progJob))).quoteId; await customer.call('acceptQuote', { quoteId: q })
  await denied(engineer.call('postProgressUpdate', { jobId: progJob, text: 'Too early' }), 'failed-precondition')
  const slots = (await customer.call('getSlots', { jobId: progJob, date: nextWeekday() })).slots; await customer.call('bookAppointment', { jobId: progJob, startAt: slots.at(-1) })
  await denied(engineer.call('postProgressUpdate', { jobId: progJob, text: 'x', photoPaths: ['requests/other/p.jpg'] }), 'invalid-argument')
  const { updateId } = await engineer.call('postProgressUpdate', { jobId: progJob, text: 'Parts ordered, arriving Thursday.', percent: 40 })
  ok((await A.db.doc(`notifications/progress:${updateId}`).get()).exists, 'customer not notified')
  ok((await getDoc(doc(customer.db, `repairRequests/${progJob}/progress/${updateId}`))).exists())
  await denied(getDoc(doc(other.db, `repairRequests/${progJob}/progress/${updateId}`)))
  eq((await A.db.doc(`repairRequests/${progJob}`).get()).data().progressPercent, 40)
})
await step('board moves: invalid transitions and missing reasons are refused; target times are settings-only', async () => {
  await denied(superAdmin.call('changeJobStatus', { jobId: progJob, to: 'completed', note: 'skip ahead' }), 'failed-precondition')
  await denied(superAdmin.call('changeJobStatus', { jobId: progJob, to: 'cancelled' }), 'invalid-argument', 'reason')
  await denied(support.call('changeJobStatus', { jobId: progJob, to: 'cancelled', note: 'not allowed' }), 'permission-denied')
  await denied(support.call('saveSlaSettings', { hours: { open: 24 } }), 'permission-denied')
  await superAdmin.call('saveSlaSettings', { hours: { open: 24, in_progress: 96 } })
  eq((await A.db.doc('platformSettings/public').get()).data().sla.hours.open, 24)
})

stripeServer.close(); graphServer.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} marketplace steps passed`)
process.exit(passed === results.length ? 0 : 1)
