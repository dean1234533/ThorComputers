// One-time bootstrap: makes an existing Firebase user the first Super Admin.
// Usage (from repo root, with GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key kept OUTSIDE the repo):
//   node scripts-grant-super-admin.mjs you@thorcomputer.com
import { createRequire } from 'node:module'
const require = createRequire(new URL('./functions/', import.meta.url))
const { initializeApp, applicationDefault } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const email = process.argv[2]
if (!email) { console.error('Usage: node scripts-grant-super-admin.mjs <email>'); process.exit(1) }
initializeApp({ credential: applicationDefault() })
const user = await getAuth().getUserByEmail(email)
const perms = ['engineers.review', 'customers.manage', 'jobs.manage', 'reviews.moderate', 'messages.audit', 'settings.edit', 'admins.manage', 'reports.view']
await getAuth().setCustomUserClaims(user.uid, { role: 'admin', adminLevel: 'super_admin', perms, suspended: false, engineerApproved: false, specs: [] })
await getFirestore().doc(`users/${user.uid}`).set({ role: 'admin', adminLevel: 'super_admin', perms, email, fullName: user.displayName ?? 'Super Admin', status: 'active', createdAt: FieldValue.serverTimestamp() }, { merge: true })
console.log(`Granted super admin to ${email} (${user.uid}). Next: sign in and enrol two-step verification in the app (Admin > Security), then roll out REQUIRE_ADMIN_MFA (docs/DEPLOYMENT.md 4a).`)
