// Admin MFA behaviour of the deployed-shape functions, under whatever REQUIRE_ADMIN_MFA the emulator was started with.
//   enforce: npm run test:smoke:mfa            (this script sets REQUIRE_ADMIN_MFA=true via the npm script)
// NOTE: the Auth emulator cannot enrol or sign in with TOTP, so a REAL second factor is never present here. This covers what the
// server does for an admin WITHOUT one: refuse admin actions, but never block the status endpoint they need to recover.
import { createRequire } from 'node:module'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
const MODE = process.env.REQUIRE_ADMIN_MFA ?? 'off'
for (const k of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) if (!/^(127\.0\.0\.1|localhost)/.test(process.env[k] ?? '')) { console.error(`Refusing to run: ${k} is not local.`); process.exit(2) }
process.env.GCLOUD_PROJECT = 'demo-thor'
const require = createRequire(new URL('../functions/', import.meta.url))
const { initializeApp: adminInit } = require('firebase-admin/app'); const { getAuth: adminAuth } = require('firebase-admin/auth'); const { getFirestore: adminDb, FieldValue } = require('firebase-admin/firestore')
adminInit({ projectId: 'demo-thor' })
const results = []
const step = async (n, f) => { try { await f(); results.push(1); console.log(`  ✔ ${n}`) } catch (e) { results.push(0); console.log(`  ✖ ${n}\n      ${String(e.message).split('\n')[0]}`) } }
const ok = (v, m) => { if (!v) throw new Error(m ?? 'assertion failed') }
async function denied(p, frag) { try { await p } catch (e) { if (frag && !String(e.message).includes(frag)) throw new Error(`wrong error: ${e.message}`); return } throw new Error('expected rejection') }
async function admin(label, perms) {
  const app = initializeApp({ apiKey: 'demo', projectId: 'demo-thor', appId: 'x' }, label + Date.now()), auth = getAuth(app), fns = getFunctions(app, 'europe-west2')
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true }); connectFunctionsEmulator(fns, '127.0.0.1', 5001)
  const email = `${label}.${Date.now()}@mfa.demo.test`, c = await createUserWithEmailAndPassword(auth, email, 'Passw0rd!mfa')
  await adminAuth().updateUser(c.user.uid, { emailVerified: true })
  await adminAuth().setCustomUserClaims(c.user.uid, { role: 'admin', adminLevel: 'super_admin', perms, suspended: false })
  await adminDb().doc(`users/${c.user.uid}`).set({ role: 'admin', perms, email, status: 'active', fullName: 'MFA Test', createdAt: FieldValue.serverTimestamp() })
  await auth.currentUser.getIdToken(true)
  return { call: (n, d = {}) => httpsCallable(fns, n)(d).then(r => r.data) }
}
console.log(`Admin MFA server behaviour, REQUIRE_ADMIN_MFA=${MODE}\n`)
const a = await admin('mfa-admin', ['settings.edit', 'admins.manage', 'reports.view'])
await step('status endpoint always works for an admin with no second factor and reports the configured mode', async () => {
  const s = await a.call('adminMfaStatus'); ok(s.mode === (MODE === 'true' ? 'enforce' : MODE === 'warn' ? 'warn' : 'off'), `mode ${s.mode}`); ok(s.sessionHasSecondFactor === false); ok(s.enrolledFactors === 0); ok(s.admins.some(x => x.enrolledFactors === 0))
})
if (MODE === 'true') {
  await step('ENFORCE: admin actions are refused without a second factor, with an actionable message', async () => {
    await denied(a.call('adminStats'), 'mfa-required'); await denied(a.call('savePlatformSettings', { marketplaceDisclaimer: 'x' }), 'Open Admin > Security')
  })
  await step('ENFORCE: Firestore-triggered/other roles unaffected (customer can still register and use callables)', async () => {
    const app = initializeApp({ apiKey: 'demo', projectId: 'demo-thor', appId: 'x' }, 'cust' + Date.now()), auth = getAuth(app), fns = getFunctions(app, 'europe-west2')
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true }); connectFunctionsEmulator(fns, '127.0.0.1', 5001)
    await createUserWithEmailAndPassword(auth, `c.${Date.now()}@mfa.demo.test`, 'Passw0rd!mfa')
    await httpsCallable(fns, 'completeRegistration')({ role: 'customer', fullName: 'Plain Customer', phone: '07700900123', postcode: 'BR1 1AA', consent: true })
    await httpsCallable(fns, 'exportMyData')({})
  })
} else {
  await step(`${MODE.toUpperCase()}: admin actions still work (no lockout while MFA is not enforced)`, async () => { ok((await a.call('adminStats')).totals); await a.call('savePlatformSettings', { marketplaceDisclaimer: 'ok' }) })
}
const f = results.filter(r => !r).length; console.log(`\n${results.length - f}/${results.length} MFA checks passed`); process.exit(f ? 1 : 0)
