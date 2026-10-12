// Security rules tests. Run with:  cd tests && npm i && npm test   (needs Java 21+; `npm run test:rules` at the repo root finds one)
// Executed locally against the Firestore emulator via `npm run test:rules` (repo root).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, addDoc, serverTimestamp } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import test, { before, after, beforeEach } from 'node:test'

let env
const claims = { role: 'customer', perms: [], suspended: false, engineerApproved: false, specs: [], email_verified: true }
const as = (uid, extra = {}) => env.authenticatedContext(uid, { ...claims, ...extra }).firestore()
const customerA = () => as('custA'), customerB = () => as('custB')
const eng = () => as('eng1', { role: 'engineer', engineerApproved: true, specs: ['laptop'] })
const pendingEng = () => as('eng2', { role: 'engineer' })
const admin = (perms = ['engineers.review', 'jobs.manage', 'messages.audit']) => as('adm1', { role: 'admin', perms })

before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-thor', firestore: { rules: readFileSync('../firestore.rules', 'utf8') } }) })
after(() => env.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/custA'), { role: 'customer', fullName: 'A', status: 'active' })
    await setDoc(doc(db, 'users/custB'), { role: 'customer', fullName: 'B', status: 'active' })
    await setDoc(doc(db, 'repairRequests/job1'), { customerId: 'custA', status: 'open', selectedEngineerId: null, requiredSpecs: ['laptop'] })
    await setDoc(doc(db, 'repairRequests/job1/private/details'), { addressLine: '1 Secret Road', postcode: 'BR1 1AA' })
    await setDoc(doc(db, 'repairRequests/job2'), { customerId: 'custA', status: 'engineer_selected', selectedEngineerId: 'eng1', requiredSpecs: ['laptop'] })
    await setDoc(doc(db, 'repairQuotes/job1_eng1'), { jobId: 'job1', engineerId: 'eng1', customerId: 'custA', status: 'submitted', totalPence: 5000 })
    await setDoc(doc(db, 'conversations/c1'), { participants: ['custA', 'eng1'], closed: false, unread: { custA: 0, eng1: 0 } })
    await setDoc(doc(db, 'conversations/c1/messages/m1'), { senderId: 'custA', text: 'hi', readBy: ['custA'] })
    await setDoc(doc(db, 'engineerProfiles/eng1'), { status: 'approved', displayName: 'E' })
    await setDoc(doc(db, 'engineerProfiles/eng3'), { status: 'pending', displayName: 'Hidden' })
    await setDoc(doc(db, 'engineerApplications/eng2'), { status: 'pending', profile: {} })
    await setDoc(doc(db, 'engineerQualifications/q1'), { engineerId: 'eng1', verification: 'pending', storagePath: 'qualifications/eng1/x.pdf' })
  })
})

test('customers cannot read other customers’ jobs, quotes or private details', async () => {
  await assertSucceeds(getDoc(doc(customerA(), 'repairRequests/job1')))
  await assertFails(getDoc(doc(customerB(), 'repairRequests/job1')))
  await assertFails(getDoc(doc(customerB(), 'repairRequests/job1/private/details')))
  await assertFails(getDoc(doc(customerB(), 'repairQuotes/job1_eng1')))
})
test('exact address is hidden from bidders and from the engineer until selected', async () => {
  await assertFails(getDoc(doc(eng(), 'repairRequests/job1/private/details')))       // open job, not selected
  await assertSucceeds(getDoc(doc(customerA(), 'repairRequests/job1/private/details')))
})
test('selected engineer can read private details only after selection', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'repairRequests/job2/private/details'), { addressLine: 'x' }))
  await assertSucceeds(getDoc(doc(eng(), 'repairRequests/job2/private/details')))
  await assertFails(getDoc(doc(as('eng9', { role: 'engineer', engineerApproved: true, specs: ['laptop'] }), 'repairRequests/job2/private/details')))
})
test('unapproved engineers cannot see open jobs; approved can list them', async () => {
  await assertFails(getDocs(query(collection(pendingEng(), 'repairRequests'), where('status', '==', 'open'))))
  await assertSucceeds(getDocs(query(collection(eng(), 'repairRequests'), where('status', '==', 'open'))))
})
test('clients can never write jobs, quotes, appointments or reviews directly', async () => {
  await assertFails(setDoc(doc(customerA(), 'repairRequests/new'), { customerId: 'custA', status: 'open' }))
  await assertFails(updateDoc(doc(customerA(), 'repairRequests/job1'), { status: 'completed' }))
  await assertFails(setDoc(doc(eng(), 'repairQuotes/job1_eng1'), { totalPence: 1 }))
  await assertFails(setDoc(doc(eng(), 'reviews/x'), { rating: 5 }))
  await assertFails(setDoc(doc(eng(), 'appointments/a'), { engineerId: 'eng1' }))
})
test('users cannot escalate role or status on their own profile', async () => {
  await assertFails(updateDoc(doc(customerA(), 'users/custA'), { role: 'admin' }))
  await assertFails(updateDoc(doc(customerA(), 'users/custA'), { perms: ['settings.edit'] }))
  await assertFails(updateDoc(doc(customerA(), 'users/custA'), { status: 'active', fullName: 'A' , role: 'admin' }))
  await assertSucceeds(updateDoc(doc(customerA(), 'users/custA'), { fullName: 'New Name' }))
  await assertFails(setDoc(doc(customerA(), 'users/custB'), { fullName: 'hijack' }))
})
test('a user claiming role=admin without the claim cannot read admin data', async () => {
  await assertFails(getDocs(collection(customerA(), 'auditLogs')))
  await assertFails(getDoc(doc(customerA(), 'engineerApplications/eng2')))
  await assertSucceeds(getDoc(doc(admin(), 'engineerApplications/eng2')))
})
test('support staff without permission cannot review engineers', async () => {
  await assertFails(getDoc(doc(admin(['customers.manage']), 'engineerApplications/eng2')))
})
test('unapproved engineer profiles are not public', async () => {
  await assertFails(getDoc(doc(customerA(), 'engineerProfiles/eng3')))
  await assertSucceeds(getDoc(doc(customerA(), 'engineerProfiles/eng1')))
})
test('engineers cannot self-verify qualifications or change application status', async () => {
  await assertFails(updateDoc(doc(eng(), 'engineerQualifications/q1'), { verification: 'verified' }))
  await assertFails(addDoc(collection(eng(), 'engineerQualifications'), { engineerId: 'eng1', verification: 'verified', storagePath: 'qualifications/eng1/y.pdf' }))
  await assertFails(updateDoc(doc(pendingEng(), 'engineerApplications/eng2'), { status: 'approved' }))
})
test('conversations: only participants read/write; admins cannot read directly', async () => {
  await assertSucceeds(getDoc(doc(customerA(), 'conversations/c1/messages/m1')))
  await assertFails(getDoc(doc(customerB(), 'conversations/c1/messages/m1')))
  await assertFails(getDoc(doc(admin(), 'conversations/c1')))
  await assertFails(addDoc(collection(customerB(), 'conversations/c1/messages'), { senderId: 'custB', text: 'x', createdAt: serverTimestamp(), readBy: ['custB'] }))
  await assertSucceeds(addDoc(collection(customerA(), 'conversations/c1/messages'), { senderId: 'custA', text: 'ok', createdAt: serverTimestamp(), readBy: ['custA'] }))
  await assertFails(addDoc(collection(customerA(), 'conversations/c1/messages'), { senderId: 'eng1', text: 'spoof', createdAt: serverTimestamp(), readBy: ['eng1'] }))
})
test('notifications are private and only the read flag is writable', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'notifications/n1'), { userId: 'custA', read: false, title: 't' }))
  await assertFails(getDoc(doc(customerB(), 'notifications/n1')))
  await assertSucceeds(updateDoc(doc(customerA(), 'notifications/n1'), { read: true }))
  await assertFails(updateDoc(doc(customerA(), 'notifications/n1'), { title: 'forged' }))
})
test('suspended users cannot write', async () => {
  const s = as('custA', { suspended: true })
  await assertFails(updateDoc(doc(s, 'users/custA'), { fullName: 'x' }))
})

// ---------- additional coverage: unauthenticated access, role boundaries, privilege escalation ----------
const anon = () => env.unauthenticatedContext().firestore()

test('unauthenticated clients can read and write nothing', async () => {
  for (const path of ['users/custA', 'repairRequests/job1', 'repairRequests/job1/private/details', 'repairQuotes/job1_eng1', 'engineerProfiles/eng1', 'engineerApplications/eng2',
    'engineerQualifications/q1', 'conversations/c1', 'conversations/c1/messages/m1', 'platformSettings/secret', 'auditLogs/a', 'enquiries/e', 'integrationEvents/i', 'appointmentSlots/s'])
    await assertFails(getDoc(doc(anon(), path)))
  await assertFails(getDocs(collection(anon(), 'repairRequests')))
  await assertFails(setDoc(doc(anon(), 'platformSettings/public'), { x: 1 }))
  await assertFails(setDoc(doc(anon(), 'users/hacker'), { role: 'admin' }))
  await assertFails(setDoc(doc(anon(), 'reports/r'), { reporterId: 'x', status: 'open', reason: 'x' }))
  await assertFails(setDoc(doc(anon(), 'deviceTokens/t'), { userId: 'x', token: 't' }))
})
test('unknown collections are denied even to admins', async () => {
  await assertFails(getDoc(doc(admin(['settings.edit', 'admins.manage', 'jobs.manage', 'engineers.review']), 'devMailbox/x')))
  await assertFails(setDoc(doc(admin(['settings.edit']), 'devMailbox/x'), { a: 1 }))
})
test('role claim boundaries: customer and engineer claims never grant admin reads', async () => {
  for (const ctx of [customerA(), eng(), pendingEng(), as('x', { role: 'customer', perms: ['settings.edit', 'admins.manage', 'jobs.manage'] }), as('y', { role: 'engineer', perms: ['jobs.manage', 'engineers.review'] })]) {
    await assertFails(getDoc(doc(ctx, 'platformSettings/internal')))
    await assertFails(getDocs(collection(ctx, 'auditLogs')))
    await assertFails(getDocs(collection(ctx, 'integrationEvents')))
  }
  await assertFails(getDoc(doc(as('y', { role: 'engineer', perms: ['engineers.review'] }), 'engineerApplications/eng2')))
})
test('admin permissions are granular', async () => {
  const support = admin(['customers.manage']), reviewer = admin(['engineers.review'])
  await assertSucceeds(getDoc(doc(support, 'users/custA')))
  await assertFails(getDoc(doc(reviewer, 'users/custA')))
  await assertFails(getDoc(doc(support, 'repairRequests/job2')))
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'repairRequests/job2/private/details'), { addressLine: 'x' }))
  await assertSucceeds(getDoc(doc(admin(['jobs.manage']), 'repairRequests/job2/private/details')))
  await assertFails(getDoc(doc(support, 'platformSettings/internal')))
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'platformSettings/internal'), { k: 1 }))
  await assertSucceeds(getDoc(doc(admin(['settings.edit']), 'platformSettings/internal')))
  await assertFails(getDocs(collection(support, 'auditLogs')))
  await assertSucceeds(getDocs(collection(admin(['admins.manage']), 'auditLogs')))
  for (const ctx of [support, reviewer, admin(['settings.edit', 'admins.manage', 'jobs.manage', 'reviews.moderate', 'customers.manage', 'engineers.review'])]) {
    await assertFails(setDoc(doc(ctx, 'platformSettings/public'), { x: 1 }))   // even super admins write settings through the audited callable
    await assertFails(updateDoc(doc(ctx, 'users/custA'), { status: 'suspended' }))
    await assertFails(updateDoc(doc(ctx, 'engineerApplications/eng2'), { status: 'approved' }))
  }
})
test('platformSettings: only the public document is readable by ordinary users', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'platformSettings/public'), { categories: [] }))
  await assertSucceeds(getDoc(doc(customerA(), 'platformSettings/public')))
  await assertFails(getDoc(doc(customerA(), 'platformSettings/other')))
  // By design 'public' (categories, support contacts, policy text; no PII) is also readable before sign-in.
  await assertSucceeds(getDoc(doc(anon(), 'platformSettings/public')))
})
test('self privilege escalation attempts all fail', async () => {
  const c = customerA()
  for (const patch of [{ role: 'admin' }, { adminLevel: 'super_admin' }, { perms: ['admins.manage'] }, { status: 'deleted' }, { email: 'a@b.c' }, { engineerStatus: 'approved' }, { consent: {} }, { claimsUpdatedAt: 1 }])
    await assertFails(updateDoc(doc(c, 'users/custA'), patch))
  await assertFails(setDoc(doc(c, 'users/newadmin'), { role: 'admin', perms: ['admins.manage'] }))
  await assertFails(updateDoc(doc(c, 'users/custA'), { fullName: 'x'.repeat(81) }))
  // an engineer cannot grant themselves approval via their application or profile
  await assertFails(updateDoc(doc(pendingEng(), 'engineerApplications/eng2'), { status: 'approved' }))
  await assertFails(setDoc(doc(pendingEng(), 'engineerProfiles/eng2'), { status: 'approved' }))
  await assertFails(updateDoc(doc(eng(), 'engineerProfiles/eng1'), { status: 'suspended', ratingAvg: 5 }))
  await assertFails(updateDoc(doc(pendingEng(), 'engineerApplications/eng2'), { profile: {}, status: 'approved' }))
})
test('engineer application: draft creation only as draft, owner only', async () => {
  const e = as('eng5', { role: 'engineer' })
  await assertFails(setDoc(doc(e, 'engineerApplications/eng5'), { status: 'approved', profile: {}, createdAt: 1, updatedAt: 1 }))
  await assertFails(setDoc(doc(e, 'engineerApplications/eng6'), { status: 'draft', profile: {}, createdAt: 1, updatedAt: 1 }))
  await assertSucceeds(setDoc(doc(e, 'engineerApplications/eng5'), { status: 'draft', profile: {}, createdAt: 1, updatedAt: 1 }))
  await assertFails(setDoc(doc(customerA(), 'engineerApplications/custA'), { status: 'draft', profile: {}, createdAt: 1, updatedAt: 1 }))
})
test('qualification documents: create pending only, own storage path only, cannot delete once verified', async () => {
  const e = pendingEng()
  await assertSucceeds(setDoc(doc(e, 'engineerQualifications/qn'), { engineerId: 'eng2', verification: 'pending', storagePath: 'qualifications/eng2/a.pdf' }))
  await assertFails(setDoc(doc(e, 'engineerQualifications/qn2'), { engineerId: 'eng2', verification: 'pending', storagePath: 'qualifications/someoneelse/a.pdf' }))
  await assertFails(setDoc(doc(e, 'engineerQualifications/qn3'), { engineerId: 'eng1', verification: 'pending', storagePath: 'qualifications/eng2/a.pdf' }))
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'engineerQualifications/qv'), { engineerId: 'eng2', verification: 'verified', storagePath: 'qualifications/eng2/v.pdf' }))
  const { deleteDoc } = await import('firebase/firestore')
  await assertFails(deleteDoc(doc(e, 'engineerQualifications/qv')))
  await assertFails(getDoc(doc(eng(), 'engineerQualifications/qv')))
  await assertSucceeds(getDoc(doc(admin(), 'engineerQualifications/qv')))
})
test('customers can only see published customer->engineer reviews, plus their own', async () => {
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore()
    await setDoc(doc(db, 'reviews/r1'), { direction: 'customer_to_engineer', status: 'published', authorId: 'custA', subjectId: 'eng1' })
    await setDoc(doc(db, 'reviews/r2'), { direction: 'engineer_to_customer', status: 'pending', authorId: 'eng1', subjectId: 'custA' })
    await setDoc(doc(db, 'reviews/r3'), { direction: 'customer_to_engineer', status: 'removed', authorId: 'custA', subjectId: 'eng1' })
  })
  await assertSucceeds(getDoc(doc(customerB(), 'reviews/r1')))
  await assertFails(getDoc(doc(customerB(), 'reviews/r2')))
  await assertFails(getDoc(doc(customerB(), 'reviews/r3')))
  await assertSucceeds(getDoc(doc(customerA(), 'reviews/r2')))   // subject can see feedback about them
  await assertFails(getDoc(doc(anon(), 'reviews/r1')))
})
test('quotes: bidders cannot see each other’s quotes; other engineers cannot read', async () => {
  await assertSucceeds(getDoc(doc(eng(), 'repairQuotes/job1_eng1')))
  await assertFails(getDoc(doc(as('eng9', { role: 'engineer', engineerApproved: true }), 'repairQuotes/job1_eng1')))
  await assertFails(getDocs(query(collection(as('eng9', { role: 'engineer', engineerApproved: true }), 'repairQuotes'), where('jobId', '==', 'job1'))))
})
test('device tokens: only the owner, no hijacking another user’s token', async () => {
  const c = customerA()
  await assertSucceeds(setDoc(doc(c, 'deviceTokens/t1'), { userId: 'custA', token: 'tok', platform: 'web', createdAt: 1, lastSeenAt: 1, userAgent: 'x' }))
  await assertFails(setDoc(doc(c, 'deviceTokens/t2'), { userId: 'custB', token: 'tok', platform: 'web', createdAt: 1, lastSeenAt: 1, userAgent: 'x' }))
  await assertFails(getDoc(doc(customerB(), 'deviceTokens/t1')))
  await assertFails(updateDoc(doc(customerB(), 'deviceTokens/t1'), { userId: 'custB' }))
})
test('reports: reporter can create and read own; others cannot read; nobody updates', async () => {
  const r = { reporterId: 'custA', status: 'open', reason: 'rude' }
  await assertSucceeds(setDoc(doc(customerA(), 'reports/r1'), r))
  await assertFails(setDoc(doc(customerA(), 'reports/r2'), { ...r, reporterId: 'custB' }))
  await assertFails(setDoc(doc(customerA(), 'reports/r3'), { ...r, status: 'actioned' }))
  await assertSucceeds(getDoc(doc(customerA(), 'reports/r1')))
  await assertFails(getDoc(doc(customerB(), 'reports/r1')))
  await assertFails(updateDoc(doc(customerA(), 'reports/r1'), { status: 'dismissed' }))
})

// ---------- marketplace upgrade: payments, Meta, support, disputes ----------
const SUPPORT = ['customers.manage', 'jobs.view', 'reports.view', 'support.handle']
const ADMIN = ['engineers.review', 'customers.manage', 'jobs.manage', 'jobs.view', 'reviews.moderate', 'reports.view', 'leads.manage', 'marketing.view', 'disputes.manage', 'support.handle']
const seedMore = () => env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'payments/p1'), { jobId: 'job2', customerId: 'custA', engineerId: 'eng1', amountPence: 10000, status: 'paid' })
  await setDoc(doc(db, 'transactions/pi1'), { jobId: 'job2', customerId: 'custA', engineerId: 'eng1', grossPence: 10000, commissionPence: 1500 })
  await setDoc(doc(db, 'commissionRecords/pi1'), { amountPence: 1500 })
  await setDoc(doc(db, 'stripeConnectedAccounts/eng1'), { accountId: 'acct_1', transfersActive: true })
  await setDoc(doc(db, 'stripeEvents/evt1'), { type: 'x' })
  await setDoc(doc(db, 'metaSecrets/user'), { tokenEnc: 'v1.secret' })
  await setDoc(doc(db, 'metaLeads/l1'), { status: 'imported', mapped: { email: 'x@y.z' } })
  await setDoc(doc(db, 'metaConnections/default'), { status: 'connected' })
  await setDoc(doc(db, 'platformSettings/marketing'), { leadPublishMode: 'confirm' })
  await setDoc(doc(db, 'platformSettings/chatbot'), { enabled: true })
  await setDoc(doc(db, 'supportTickets/t1'), { userId: 'custA', status: 'open' })
  await setDoc(doc(db, 'supportTickets/t1/messages/m1'), { authorId: 'custA', text: 'help' })
  await setDoc(doc(db, 'disputes/job2'), { customerId: 'custA', engineerId: 'eng1', status: 'open' })
})

test('payments and transactions: only the parties and finance admins; nobody writes from a browser', async () => {
  await seedMore()
  await assertSucceeds(getDoc(doc(customerA(), 'payments/p1'))); await assertSucceeds(getDoc(doc(eng(), 'transactions/pi1')))
  await assertFails(getDoc(doc(customerB(), 'payments/p1'))); await assertFails(getDoc(doc(customerB(), 'transactions/pi1')))
  await assertFails(setDoc(doc(customerA(), 'payments/p2'), { jobId: 'job2', customerId: 'custA', status: 'paid', amountPence: 1 }))
  await assertFails(updateDoc(doc(customerA(), 'payments/p1'), { status: 'refunded' }))
  await assertFails(setDoc(doc(customerA(), 'transactions/pi2'), { customerId: 'custA', commissionPence: 0 }))
  await assertFails(getDoc(doc(admin(SUPPORT), 'transactions/pi1')))                 // support never sees finance
  await assertFails(getDoc(doc(admin(SUPPORT), 'commissionRecords/pi1')))
  await assertFails(getDoc(doc(admin(ADMIN), 'commissionRecords/pi1')))
  await assertSucceeds(getDoc(doc(admin(['finance.view']), 'commissionRecords/pi1')))
  await assertFails(getDoc(doc(admin(['finance.view', 'admins.manage']), 'stripeEvents/evt1')))
  await assertSucceeds(getDoc(doc(eng(), 'stripeConnectedAccounts/eng1'))); await assertFails(getDoc(doc(customerA(), 'stripeConnectedAccounts/eng1')))
})
test('Meta tokens are unreadable by everyone; leads only for lead managers', async () => {
  await seedMore()
  await assertFails(getDoc(doc(admin([...ADMIN, 'marketing.manage', 'settings.edit', 'admins.manage']), 'metaSecrets/user')))
  await assertSucceeds(getDoc(doc(admin(ADMIN), 'metaLeads/l1'))); await assertFails(getDoc(doc(admin(SUPPORT), 'metaLeads/l1'))); await assertFails(getDoc(doc(customerA(), 'metaLeads/l1')))
  await assertSucceeds(getDoc(doc(admin(['marketing.view']), 'metaConnections/default'))); await assertFails(getDoc(doc(admin(SUPPORT), 'metaConnections/default')))
  await assertSucceeds(getDoc(doc(admin(['marketing.view']), 'platformSettings/marketing'))); await assertFails(getDoc(doc(customerA(), 'platformSettings/marketing')))
  await assertFails(getDoc(doc(admin(ADMIN), 'platformSettings/chatbot'))); await assertSucceeds(getDoc(doc(admin(['chatbot.manage']), 'platformSettings/chatbot')))
  await assertFails(setDoc(doc(admin([...ADMIN, 'marketing.manage']), 'metaLeads/l2'), { status: 'converted_to_job' }))
})
test('support tickets and disputes: owner/parties and the right staff only', async () => {
  await seedMore()
  await assertSucceeds(getDoc(doc(customerA(), 'supportTickets/t1'))); await assertSucceeds(getDoc(doc(customerA(), 'supportTickets/t1/messages/m1')))
  await assertFails(getDoc(doc(customerB(), 'supportTickets/t1'))); await assertFails(getDoc(doc(customerB(), 'supportTickets/t1/messages/m1')))
  await assertSucceeds(getDoc(doc(admin(SUPPORT), 'supportTickets/t1/messages/m1')))
  await assertFails(setDoc(doc(customerA(), 'supportTickets/t2'), { userId: 'custA', status: 'open' }))
  await assertSucceeds(getDoc(doc(eng(), 'disputes/job2'))); await assertFails(getDoc(doc(customerB(), 'disputes/job2'))); await assertFails(getDoc(doc(admin(SUPPORT), 'disputes/job2')))
  await assertSucceeds(getDoc(doc(admin(ADMIN), 'disputes/job2')))
})
test('jobs awaiting verification are hidden from engineers; support can view jobs but not addresses', async () => {
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'repairRequests/job3'), { customerId: 'custA', status: 'awaiting_verification', selectedEngineerId: null, requiredSpecs: ['laptop'] }))
  await assertFails(getDoc(doc(eng(), 'repairRequests/job3')))
  await assertSucceeds(getDoc(doc(admin(SUPPORT), 'repairRequests/job1')))
  await assertFails(getDoc(doc(admin(SUPPORT), 'repairRequests/job1/private/details')))
})
