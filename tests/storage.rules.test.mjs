// Storage security rules, run against the local Storage + Firestore emulators (storage.rules reads Firestore for chat participants).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getBytes, deleteObject, updateMetadata } from 'firebase/storage'
import { readFileSync } from 'node:fs'
import test, { before, after, beforeEach } from 'node:test'

let env
const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), png9mb = () => new Uint8Array(9 * 1024 * 1024)
const IMG = { contentType: 'image/png' }, PDF = { contentType: 'application/pdf' }
const base = { role: 'customer', perms: [], suspended: false, engineerApproved: false, email_verified: true }
const as = (uid, extra = {}) => env.authenticatedContext(uid, { ...base, ...extra }).storage()
const cust = () => as('custA'), cust2 = () => as('custB')
const eng = () => as('eng1', { role: 'engineer', engineerApproved: true }), eng2 = () => as('eng2', { role: 'engineer' })
const adm = perms => as('adm1', { role: 'admin', perms })
const anon = () => env.unauthenticatedContext().storage()
const put = (s, path, bytes, meta) => uploadBytes(ref(s, path), bytes, meta)
const seed = (path, bytes = png(), meta = IMG) => env.withSecurityRulesDisabled(c => uploadBytes(ref(c.storage(), path), bytes, meta))

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-thor',
    firestore: { rules: readFileSync('../firestore.rules', 'utf8') }, storage: { rules: readFileSync('../storage.rules', 'utf8') } })
})
after(() => env.cleanup())
beforeEach(async () => {
  await env.clearFirestore(); await env.clearStorage()   // tests use distinct object names so they never depend on cleanup between tests
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'conversations/c1'), { participants: ['custA', 'eng1'], closed: false }))
})

test('unauthenticated users cannot read or write any storage path', async () => {
  await seed('avatars/custA/seed-a.png'); await seed('qualifications/eng1/seed-q.pdf', png(), PDF); await seed('requests/custA/job1/seed-p.png'); await seed('chat/c1/seed-m.png')
  for (const p of ['avatars/custA/seed-a.png', 'qualifications/eng1/seed-q.pdf', 'requests/custA/job1/seed-p.png', 'chat/c1/seed-m.png']) await assertFails(getBytes(ref(anon(), p)))
  await assertFails(put(anon(), 'avatars/custA/x.png', png(), IMG))
  await assertFails(put(anon(), 'anything/else.png', png(), IMG))
})
test('avatars: owner may write images only; others cannot overwrite; size and type limits', async () => {
  await assertSucceeds(put(cust(), 'avatars/custA/me.png', png(), IMG))
  await assertFails(put(cust2(), 'avatars/custA/me.png', png(), IMG))
  await assertFails(put(cust(), 'avatars/custA/me.html', png(), { contentType: 'text/html' }))
  await assertFails(put(cust(), 'avatars/custA/big.png', png9mb(), IMG))
  await assertSucceeds(getBytes(ref(cust2(), 'avatars/custA/me.png')))   // avatars are visible to signed-in users
})
test('qualification evidence is private: owner + reviewing admins only', async () => {
  await assertSucceeds(put(eng(), 'qualifications/eng1/cert.pdf', png(), PDF))
  await assertFails(put(cust(), 'qualifications/custA/cert.pdf', png(), PDF))                // only engineers upload
  await assertFails(put(eng(), 'qualifications/eng9/cert.pdf', png(), PDF))                  // not someone else's folder
  await assertFails(put(eng(), 'qualifications/eng1/evil.exe', png(), { contentType: 'application/x-msdownload' }))
  await assertSucceeds(getBytes(ref(eng(), 'qualifications/eng1/cert.pdf')))
  await assertFails(getBytes(ref(eng2(), 'qualifications/eng1/cert.pdf')))
  await assertFails(getBytes(ref(cust(), 'qualifications/eng1/cert.pdf')))
  await assertFails(getBytes(ref(adm(['jobs.manage', 'customers.manage']), 'qualifications/eng1/cert.pdf')))   // admin without engineers.review
  await assertSucceeds(getBytes(ref(adm(['engineers.review']), 'qualifications/eng1/cert.pdf')))
  await assertFails(deleteObject(ref(eng(), 'qualifications/eng1/cert.pdf')))                // immutable evidence
  await assertFails(put(eng(), 'qualifications/eng1/cert.pdf', png(), PDF))                  // no overwrite
})
test('repair photos: customer uploads to own folder; owner, admins and approved engineers read; pending engineers and other customers cannot', async () => {
  await assertSucceeds(put(cust(), 'requests/custA/job1/p.png', png(), IMG))
  await assertFails(put(cust2(), 'requests/custA/job1/q.png', png(), IMG))
  await assertFails(put(cust(), 'requests/custA/job1/q.pdf', png(), PDF))
  await assertSucceeds(getBytes(ref(cust(), 'requests/custA/job1/p.png')))
  await assertSucceeds(getBytes(ref(eng(), 'requests/custA/job1/p.png')))
  await assertSucceeds(getBytes(ref(adm([]), 'requests/custA/job1/p.png')))
  await assertFails(getBytes(ref(cust2(), 'requests/custA/job1/p.png')))
  await assertFails(getBytes(ref(eng2(), 'requests/custA/job1/p.png')))
  await assertFails(deleteObject(ref(cust(), 'requests/custA/job1/p.png')))
})
test('suspended users cannot upload', async () => {
  await assertFails(put(as('custA', { suspended: true }), 'avatars/custA/me.png', png(), IMG))
  await assertFails(put(as('custA', { suspended: true }), 'requests/custA/job1/p.png', png(), IMG))
})
test('chat attachments: conversation participants only', async () => {
  await assertSucceeds(put(cust(), 'chat/c1/photo.png', png(), IMG))
  await assertSucceeds(put(eng(), 'chat/c1/photo2.png', png(), IMG))
  await assertFails(put(cust2(), 'chat/c1/photo3.png', png(), IMG))
  await assertFails(put(adm(['messages.audit']), 'chat/c1/photo4.png', png(), IMG))   // admins use the audited callable instead
  await assertSucceeds(getBytes(ref(eng(), 'chat/c1/photo.png')))
  await assertFails(getBytes(ref(cust2(), 'chat/c1/photo.png')))
  await assertFails(getBytes(ref(adm(['messages.audit']), 'chat/c1/photo.png')))
})
test('paths outside the known folders are denied for everyone', async () => {
  await assertFails(put(cust(), 'random/file.png', png(), IMG))
  await assertFails(put(adm(['admins.manage', 'settings.edit']), 'random/file.png', png(), IMG))
  await assertFails(getBytes(ref(adm(['admins.manage']), 'random/file.png')))
})
