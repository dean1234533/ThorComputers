// One-off: fills users/{uid}.contact and contactFinance/{uid} for customers created before the contact list existed.
// Safe to re-run (it recomputes from repairRequests). New activity is kept up to date by the onRepairRequestWrittenContact trigger.
//   npm --prefix functions run build
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/service-account.json node scripts/backfill-contact-summaries.mjs
// Local emulators: bash scripts/local-env.sh env FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-thor node scripts/backfill-contact-summaries.mjs
import { createRequire } from 'node:module'
const require = createRequire(new URL('../functions/', import.meta.url))
const { refreshContactSummary } = require('./lib/contacts.js')          // also initialises firebase-admin
const { getFirestore } = require('firebase-admin/firestore')
const snap = await getFirestore().collection('users').where('role', '==', 'customer').select().get()
let done = 0
for (const u of snap.docs) { await refreshContactSummary(u.id); if (++done % 100 === 0) console.log(`${done}/${snap.size}`) }
console.log(`Contact summaries refreshed for ${done} customer(s).`)
