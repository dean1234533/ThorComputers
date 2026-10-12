// Removes only demo fixtures from the local demo-thor emulators.
// Dry-run by default. Use --apply after reviewing the printed plan.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
const require = createRequire(new URL('../functions/', import.meta.url))
for (const name of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
  process.env[name] ??= name.includes('AUTH') ? '127.0.0.1:9099' : '127.0.0.1:8080'
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name])) throw new Error('Cleanup is restricted to localhost emulators.')
}
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
initializeApp({ projectId: 'demo-thor' })
const auth = getAuth(), db = getFirestore()
const users = []
let pageToken
 do {
  const page = await auth.listUsers(1000, pageToken)
  users.push(...page.users.filter(u => u.email?.endsWith('@demo.test')))
  pageToken = page.pageToken
} while (pageToken)
const demoIds = new Set(users.map(u => u.uid))
const docs = []
for (const col of await db.listCollections()) {
  for (const snap of (await col.get()).docs) docs.push(snap)
}
// Profiles may survive a previous removal of an authentication account.
for (const snap of docs) if (snap.ref.parent.id === 'users' && snap.data().email?.endsWith('@demo.test')) demoIds.add(snap.id)
const related = value => typeof value === 'string' ? demoIds.has(value) : Array.isArray(value) ? value.some(related) : value && typeof value === 'object' ? Object.entries(value).some(([key, v]) => demoIds.has(key) || related(v)) : false
const jobIds = new Set(docs.filter(s => s.ref.parent.id === 'repairRequests' && (s.id === 'demo-job-open' || related(s.data()))).map(s => s.id))
const matches = docs.filter(s => s.ref.parent.id !== 'platformSettings' && (demoIds.has(s.id) || related(s.data()) || jobIds.has(s.data().jobId) || s.id === 'demo-job-open'))
const settings = docs.find(s => s.ref.path === 'platformSettings/public')
const demoSupport = settings?.data().support?.email?.endsWith('@demo.test') || settings?.data().support?.phone === '0000 000000'
console.log(JSON.stringify({ project: 'demo-thor', accounts: users.map(u => u.email), documents: matches.map(s => s.ref.path), removeDemoSupport: !!demoSupport, apply: process.argv.includes('--apply') }, null, 2))
if (!process.argv.includes('--apply')) process.exit(0)
const backup = []
async function collect(ref) {
  const snap = await ref.get()
  if (snap.exists) backup.push({ path: ref.path, data: snap.data() })
  for (const col of await ref.listCollections()) for (const child of (await col.get()).docs) await collect(child.ref)
}
for (const snap of matches) await collect(snap.ref)
const backupPath = `/private/tmp/thor-demo-backup-${Date.now()}.json`
writeFileSync(backupPath, JSON.stringify({ project: 'demo-thor', users: users.map(u => u.toJSON()), documents: backup, settings: settings?.data() }, null, 2), { mode: 0o600 })
for (const snap of matches) await db.recursiveDelete(snap.ref)
if (settings) {
  const update = {}
  if (demoSupport) update.support = FieldValue.delete()
  if (demoIds.has(settings.data().updatedBy)) update.updatedBy = FieldValue.delete()
  if (Object.keys(update).length) await settings.ref.update(update)
}
for (const u of users) await auth.deleteUser(u.uid)
for (const snap of matches) if ((await snap.ref.get()).exists) throw new Error(`Demo record still exists: ${snap.ref.path}`)
const remaining = await auth.listUsers(1000)
if (remaining.users.some(u => u.email?.endsWith('@demo.test'))) throw new Error('Demo accounts remain.')
console.log(`Removed ${users.length} demo accounts and ${backup.length} demo documents. Backup: ${backupPath}`)
