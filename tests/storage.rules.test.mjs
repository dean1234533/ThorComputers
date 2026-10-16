// Storage security rules, run against the local Storage + Firestore emulators (storage.rules reads Firestore for chat participants).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getBytes, getDownloadURL, deleteObject, updateMetadata } from 'firebase/storage'
import { readFileSync } from 'node:fs'
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { revokeRequestPhotoLinks } from '../scripts/revoke-request-photo-links.mjs'

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
test('repair photos: private until selection, then only the selected engineer and authorised admins can read', async () => {
  const path = 'requests/custA/job1/p.png'
  await assertSucceeds(put(cust(), path, png(), IMG))
  await assertFails(put(cust2(), 'requests/custA/job1/q.png', png(), IMG))
  await assertFails(put(cust(), 'requests/custA/job1/q.pdf', png(), PDF))
  await assertSucceeds(getBytes(ref(cust(), path)))
  const job = { customerId: 'custA', selectedEngineerId: null, photoPaths: [path] }
  const setJob = data => env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'repairRequests/custA_job1'), data))
  await setJob(job)
  await assertFails(getBytes(ref(eng(), path)))
  await assertFails(getDownloadURL(ref(eng(), path)))
  await assertFails(getBytes(ref(adm([]), path)))
  await assertSucceeds(getBytes(ref(adm(['jobs.manage']), path)))
  await assertFails(getBytes(ref(cust2(), path)))
  await setJob({ ...job, selectedEngineerId: 'eng1' })
  await assertSucceeds(getBytes(ref(eng(), path)))
  await assertFails(getBytes(ref(as('eng3', { role: 'engineer', engineerApproved: true }), path)))
  await assertFails(getBytes(ref(eng2(), path)))
  await assertFails(getBytes(ref(as('eng1', { role: 'engineer', engineerApproved: true, suspended: true }), path)))
  await assertFails(getBytes(ref(as('custA', { suspended: true }), path)))
  await assertFails(getBytes(ref(as('adm1', { role: 'admin', perms: ['jobs.manage'], suspended: true }), path)))
  await seed('requests/custA/job1/unlisted.png')
  await assertFails(getBytes(ref(eng(), 'requests/custA/job1/unlisted.png')))
  await seed('requests/custB/job2/private.png')
  await assertFails(getBytes(ref(eng(), 'requests/custB/job2/private.png')))
  await setJob({ ...job, selectedEngineerId: null })
  await assertFails(getBytes(ref(eng(), path)))
  await assertFails(deleteObject(ref(cust(), path)))
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

test('release migration: dry-run preserves links and apply refuses to claim success if Storage retains tokens', async () => {
  assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '', /^(localhost|127\.0\.0\.1):/)
  const require = createRequire(new URL('../functions/', import.meta.url))
  const { initializeApp, deleteApp } = require('firebase-admin/app'), { getStorage } = require('firebase-admin/storage')
  const app = initializeApp({ projectId: 'demo-thor' }, 'photo-link-migration')
  try {
    const bucket = getStorage(app).bucket('demo-thor.appspot.com'), token = '11111111-1111-4111-8111-111111111111'
    const path = 'requests/custA/job1/legacy.png', avatar = 'avatars/custA/legacy.png'
    for (const name of [path, avatar]) await bucket.file(name).save(png(), { metadata: { contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: token, preserved: 'yes' } } })
    const url = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
    assert.equal((await fetch(url)).status, 200)
    assert.deepEqual(await revokeRequestPhotoLinks(bucket), { scanned: 1, withTokens: 1, revoked: 0 })
    assert.equal((await fetch(url)).status, 200)
    // The local emulator preserves its separate downloadTokens array when the GCS metadata key is removed.
    // Verify the migration detects this instead of reporting a successful revocation.
    await assert.rejects(revokeRequestPhotoLinks(bucket, { apply: true }), /revocation not confirmed/)
    assert.equal((await bucket.file(path).getMetadata())[0].metadata.preserved, 'yes')
    assert.equal((await bucket.file(avatar).getMetadata())[0].metadata.firebaseStorageDownloadTokens, token)
    assert.equal((await bucket.file(path).download())[0].length, png().length)
  } finally { await deleteApp(app) }
})
