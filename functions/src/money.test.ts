import test from 'node:test'
import assert from 'node:assert/strict'
import { commissionSplit, commissionRefund, DEFAULT_COMMISSION_BPS } from './money'
import { verifyStripeSignature, signStripePayload, verifyMetaSignature, signMetaPayload, mapLead, DEFAULT_MAPPING, advanceLead, normalisePostcode } from './integrations-domain'

test('15% commission: £100 → £15 / £85, £200 → £30 / £170, £500 → £75 / £425 (pence)', () => {
  assert.deepEqual(commissionSplit(10000, DEFAULT_COMMISSION_BPS), { commissionPence: 1500, engineerSharePence: 8500 })
  assert.deepEqual(commissionSplit(20000, DEFAULT_COMMISSION_BPS), { commissionPence: 3000, engineerSharePence: 17000 })
  assert.deepEqual(commissionSplit(50000, DEFAULT_COMMISSION_BPS), { commissionPence: 7500, engineerSharePence: 42500 })
})
test('commission rounds half up in whole pence and the two shares always add up to the total', () => {
  assert.equal(commissionSplit(1033, 1500).commissionPence, 155)   // 154.95 -> 155
  assert.equal(commissionSplit(1, 1500).commissionPence, 0)
  for (const t of [1, 7, 99, 101, 1999, 12345, 999999]) { const s = commissionSplit(t, 1500); assert.equal(s.commissionPence + s.engineerSharePence, t) }
})
test('commission rejects non-integers, negatives and absurd rates', () => {
  assert.throws(() => commissionSplit(10.5, 1500)); assert.throws(() => commissionSplit(-1, 1500)); assert.throws(() => commissionSplit(100, 5000)); assert.throws(() => commissionSplit(100, 15.5))
})
test('refund returns a proportional share of the commission, never more than it', () => {
  assert.equal(commissionRefund(10000, 1500, 10000), 1500); assert.equal(commissionRefund(10000, 1500, 5000), 750)
  assert.equal(commissionRefund(10000, 1500, 99999), 1500); assert.equal(commissionRefund(10000, 1500, 0), 0)
})

const body = JSON.stringify({ id: 'evt_1', type: 'x' })
test('Stripe signature: valid, tampered body, wrong secret, stale timestamp, missing header', () => {
  const now = 1_700_000_000, h = signStripePayload(body, 'whsec_a', now)
  assert.equal(verifyStripeSignature(body, h, 'whsec_a', now), true)
  assert.equal(verifyStripeSignature(body + ' ', h, 'whsec_a', now), false)
  assert.equal(verifyStripeSignature(body, h, 'whsec_b', now), false)
  assert.equal(verifyStripeSignature(body, h, 'whsec_a', now + 301), false)
  assert.equal(verifyStripeSignature(body, undefined, 'whsec_a', now), false); assert.equal(verifyStripeSignature(body, h, '', now), false)
})
test('Meta signature: valid, tampered, wrong secret, wrong prefix', () => {
  const h = signMetaPayload(body, 'app-secret')
  assert.equal(verifyMetaSignature(body, h, 'app-secret'), true); assert.equal(verifyMetaSignature(body + 'x', h, 'app-secret'), false)
  assert.equal(verifyMetaSignature(body, h, 'other'), false); assert.equal(verifyMetaSignature(body, h.replace('sha256=', 'sha1='), 'app-secret'), false); assert.equal(verifyMetaSignature(body, undefined, 'app-secret'), false)
})

test('lead mapping: standard Instant Form fields map and normalise', () => {
  const m = mapLead([{ name: 'full_name', values: ['Pia Ahmed'] }, { name: 'email', values: ['PIA@Example.com'] }, { name: 'phone_number', values: ['+447700900123'] }, { name: 'post_code', values: ['e151aa'] },
    { name: 'What device needs repairing?', values: ['HP Laptop'] }, { name: 'problem', values: ['Switches off after ten minutes'] }, { name: 'repair_type', values: ['Engineer home visit'] }])
  assert.deepEqual(m.missing, []); assert.equal(m.values.email, 'pia@example.com'); assert.equal(m.values.postcode, 'E15 1AA'); assert.equal(m.values.device, 'laptop'); assert.equal(m.values.method, 'home')
})
test('lead mapping never invents data: missing and invalid required fields are reported, not filled', () => {
  const m = mapLead([{ name: 'full_name', values: ['Pia'] }, { name: 'email', values: ['not-an-email'] }, { name: 'post_code', values: ['12345'] }])
  assert.deepEqual(m.invalid.sort(), ['email', 'postcode']); assert.deepEqual(m.missing, ['problem']); assert.equal(m.values.email, undefined); assert.equal(m.values.postcode, undefined)
})
test('custom mapping overrides the defaults and required list', () => {
  const m = mapLead([{ name: 'tell_us_more', values: ['screen is cracked badly'] }, { name: 'mail', values: ['a@b.co'] }], { fields: { problem: ['tell_us_more'], email: ['mail'] }, required: ['email', 'problem'] })
  assert.deepEqual(m.missing, []); assert.equal(m.values.problem, 'screen is cracked badly')
  assert.ok(DEFAULT_MAPPING.required.includes('postcode'))
})
test('lead status only moves forward; rejected/duplicate are terminal', () => {
  assert.equal(advanceLead('imported', 'converted_to_job'), 'converted_to_job'); assert.equal(advanceLead('receiving_bids', 'converted_to_job'), 'receiving_bids')
  assert.equal(advanceLead('rejected', 'verified'), 'rejected'); assert.equal(advanceLead('duplicate', 'completed'), 'duplicate')
})
test('postcode normalisation', () => { assert.equal(normalisePostcode('sw1a1aa'), 'SW1A 1AA'); assert.equal(normalisePostcode('E1 6AN'), 'E1 6AN'); assert.equal(normalisePostcode('hello'), '') })
