import test from 'node:test'
import assert from 'node:assert/strict'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { stripNulls, requireRole, requirePerm, adminMfaMode, internalError } from './core'

const req = (token: Record<string, unknown>) => ({ auth: { uid: 'u1', token }, data: {} }) as unknown as CallableRequest
const admin = { role: 'admin', perms: ['settings.edit'], email_verified: true }
const withMfa = { ...admin, firebase: { sign_in_second_factor: 'totp' } }
const mode = (m?: string) => { if (m === undefined) delete process.env.REQUIRE_ADMIN_MFA; else process.env.REQUIRE_ADMIN_MFA = m }

test('stripNulls drops nulls (what the client SDK sends for undefined) at any depth, keeps other falsy values', () => {
  assert.deepEqual(stripNulls({ a: 1, b: null, c: { d: null, e: 0, f: '', g: false }, h: [null, 1] }), { a: 1, c: { e: 0, f: '', g: false }, h: [null, 1] })
})
test('admin MFA mode parsing: only "true" enforces, "warn" warns, anything else is off', () => {
  mode('true'); assert.equal(adminMfaMode(), 'enforce'); mode('warn'); assert.equal(adminMfaMode(), 'warn')
  mode('false'); assert.equal(adminMfaMode(), 'off'); mode(undefined); assert.equal(adminMfaMode(), 'off')
})
test('MFA off/warn: an admin without a second factor is allowed', () => {
  for (const m of [undefined, 'false', 'warn']) { mode(m); assert.equal(requirePerm(req(admin), 'settings.edit').uid, 'u1') }
})
test('MFA enforce: admin WITHOUT a second factor is refused with the enrol hint, WITH one is allowed', () => {
  mode('true')
  assert.throws(() => requirePerm(req(admin), 'settings.edit'), (e: any) => e.code === 'permission-denied' && /mfa-required/.test(e.message))
  assert.equal(requirePerm(req(withMfa), 'settings.edit').uid, 'u1')
})
test('MFA enforce never affects non-admin roles, and skipMfa lets an unenrolled admin reach the enrolment-status endpoint', () => {
  mode('true')
  assert.equal(requireRole(req({ role: 'customer' }), 'customer').role, 'customer')
  assert.equal(requireRole(req(admin), 'admin', { skipMfa: true }).role, 'admin')
})
test('permission checks still apply when MFA passes', () => {
  mode('true'); assert.throws(() => requirePerm(req(withMfa), 'admins.manage'), (e: any) => /Missing permission/.test(e.message))
})

test('unexpected errors become a reference-only client message; the real cause stays in the log', () => {
  const logged: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { logged.push(a.join(' ')) }
  try {
    const e = internalError(Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. https://console.firebase.google.com/...'), { code: 9 }), 'createrepairrequest', 'user123456789')
    assert.equal(e.code, 'internal'); assert.match(e.message, /^Something went wrong on our side \(ref E[0-9A-F]{6}\)\.$/)
    assert.doesNotMatch(e.message, /index|FAILED_PRECONDITION|console\.firebase/)
    const line = JSON.parse(logged[0]); assert.equal(line.ref, e.message.match(/E[0-9A-F]{6}/)![0]); assert.match(line.error, /requires an index/); assert.equal(line.where, 'createrepairrequest'); assert.ok(!line.uid.includes('user123456789'), 'uid must be shortened in logs')
  } finally { console.error = orig }
})
