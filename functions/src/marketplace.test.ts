import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { commissionPence, applicationFeeFor, splitPayment, amountDuePence, depositPence, formatJobRef, canTransition, mapLeadFields, normaliseLead, missingLeadFields,
  DEFAULT_REQUIRED_LEAD_FIELDS, routeLead, RoutingRule, normaliseDevice, normaliseMethod, normalisePostcode, consentGiven, DEFAULT_COMMISSION_BPS } from './domain'
import { verifyMetaSignature, encryptSecret, decryptSecret } from './security'

test('15% commission on the documented examples (integer pence)', () => {
  assert.equal(DEFAULT_COMMISSION_BPS, 1500)
  assert.deepEqual(splitPayment(10_000, 1500), { grossPence: 10_000, commissionPence: 1_500, engineerSharePence: 8_500 })   // £100 -> £15 / £85
  assert.deepEqual(splitPayment(20_000, 1500), { grossPence: 20_000, commissionPence: 3_000, engineerSharePence: 17_000 })  // £200 -> £30 / £170
  assert.deepEqual(splitPayment(50_000, 1500), { grossPence: 50_000, commissionPence: 7_500, engineerSharePence: 42_500 })  // £500 -> £75 / £425
  assert.equal(commissionPence(75_000, 1500), 11_250)                                                                         // £750 -> £112.50
})

test('commission rounds half up and never uses floating point drift', () => {
  assert.equal(commissionPence(3, 1500), 0)     // 0.45p
  assert.equal(commissionPence(10, 1500), 2)    // 1.5p -> 2p
  assert.equal(commissionPence(9_999, 1500), 1_500)
  assert.equal(commissionPence(0, 1500), 0)
})

test('deposit + balance + additional work: fees always sum to the commission on the total, never charged twice', () => {
  for (const total of [10_000, 12_345, 99, 777_777]) {
    const dep = depositPence(total, 20), extra = 1_234
    const f1 = applicationFeeFor(0, dep, 1500), f2 = applicationFeeFor(dep, total - dep, 1500), f3 = applicationFeeFor(total, extra, 1500)
    assert.equal(f1 + f2, commissionPence(total, 1500))
    assert.equal(f1 + f2 + f3, commissionPence(total + extra, 1500))
  }
})

test('amount due follows the payment policy', () => {
  assert.equal(amountDuePence('full_before', 'pre', 10_000, 0, 20), 10_000)
  assert.equal(amountDuePence('full_before', 'pre', 10_000, 10_000, 20), 0)
  assert.equal(amountDuePence('deposit_before', 'pre', 10_000, 0, 20), 2_000)
  assert.equal(amountDuePence('deposit_before', 'pre', 10_000, 2_000, 20), 0)
  assert.equal(amountDuePence('deposit_before', 'post', 10_000, 2_000, 20), 8_000)
  assert.equal(amountDuePence('after_completion', 'pre', 10_000, 0, 20), 0)
  assert.equal(amountDuePence('after_completion', 'post', 12_000, 0, 20), 12_000)   // includes an approved revision
  assert.equal(depositPence(100, 10), 30)                                           // never below Stripe's GBP minimum
})

test('THOR references and new job states', () => {
  assert.equal(formatJobRef(2026, 125), 'THOR-2026-000125')
  assert.equal(canTransition('admin', 'awaiting_verification', 'open'), true)
  assert.equal(canTransition('customer', 'awaiting_verification', 'open'), false)
  assert.equal(canTransition('customer', 'awaiting_payment', 'cancelled'), true)
  assert.equal(canTransition('engineer', 'awaiting_payment', 'in_progress'), false)
})

test('Meta lead mapping: standard keys, custom mapping, consent, nothing invented', () => {
  const fd = [{ name: 'full_name', values: ['Jo Bloggs'] }, { name: 'email', values: ['JO@Example.COM'] }, { name: 'phone_number', values: ['+44 7700 900123'] },
    { name: 'post_code', values: ['e152ab'] }, { name: 'what_device_is_it?', values: ['HP Pavilion laptop'] }, { name: 'describe_the_problem', values: ['It switches off after ten minutes'] },
    { name: 'marketplace_ok', values: ['Yes'] }, { name: 'favourite_colour', values: ['blue'] }]
  const { values, unmapped } = mapLeadFields(fd, { fieldMap: { 'what_device_is_it?': 'deviceType' }, required: DEFAULT_REQUIRED_LEAD_FIELDS, consentField: 'marketplace_ok' })
  assert.equal(values.consent, 'Yes'); assert.equal(consentGiven(values.consent), true)
  assert.deepEqual(unmapped, { favourite_colour: 'blue' })
  const n = normaliseLead(values)
  assert.equal(n.email, 'jo@example.com'); assert.equal(n.postcode, 'E15 2AB'); assert.equal(n.deviceType, 'laptop'); assert.equal(n.phone, '+447700900123')
  assert.deepEqual(missingLeadFields(n, DEFAULT_REQUIRED_LEAD_FIELDS), [])
  const partial = normaliseLead(mapLeadFields([{ name: 'first_name', values: ['Sam'] }, { name: 'email', values: ['not-an-email'] }], { fieldMap: {}, required: [] }).values)
  assert.equal(partial.fullName, 'Sam'); assert.equal(partial.email, undefined); assert.equal(partial.deviceType, undefined)
  assert.deepEqual(missingLeadFields(partial, DEFAULT_REQUIRED_LEAD_FIELDS), ['email', 'postcode', 'deviceType', 'problem'])
  assert.equal(consentGiven('No'), false); assert.equal(consentGiven(undefined), false)
})

test('normalisers', () => {
  assert.equal(normaliseDevice('MacBook Pro'), 'mac'); assert.equal(normaliseDevice('Gaming PC'), 'gaming_pc'); assert.equal(normaliseDevice('iPhone 13'), 'phone')
  assert.equal(normaliseDevice('iPad'), 'tablet'); assert.equal(normaliseDevice('toaster'), 'other')
  assert.equal(normaliseMethod('Home visit'), 'home'); assert.equal(normaliseMethod('Collect and return'), 'collection'); assert.equal(normaliseMethod('???'), undefined)
  assert.equal(normalisePostcode('br1 1aa'), 'BR1 1AA'); assert.equal(normalisePostcode('12345'), undefined)
})

test('campaign routing picks the first matching enabled rule by priority', () => {
  const rules: RoutingRule[] = [
    { id: 'gaming', name: 'Gaming', enabled: true, priority: 2, match: { campaignIds: ['222'] }, set: { deviceType: 'gaming_pc' } },
    { id: 'london-laptop', name: 'Laptop London', enabled: true, priority: 1, match: { campaignIds: ['111'], outcodePrefixes: ['E', 'EC'] }, set: { deviceType: 'laptop', serviceMethods: ['home', 'collection'] } },
    { id: 'off', name: 'Disabled', enabled: false, priority: 0, match: {}, set: { deviceType: 'phone' } },
  ]
  assert.equal(routeLead(rules, { campaignId: '111', postcode: 'E15 2AB' })?.id, 'london-laptop')
  assert.equal(routeLead(rules, { campaignId: '111', postcode: 'BR1 1AA' }), null)
  assert.equal(routeLead(rules, { campaignId: '222' })?.id, 'gaming')
  assert.equal(routeLead([], { campaignId: '222' }), null)
})

test('Meta webhook signature verification', () => {
  const body = Buffer.from('{"object":"page"}'), secret = 'app-secret'
  const good = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  assert.equal(verifyMetaSignature(body, good, secret), true)
  assert.equal(verifyMetaSignature(Buffer.from('{"object":"page" }'), good, secret), false)
  assert.equal(verifyMetaSignature(body, good, 'other'), false)
  assert.equal(verifyMetaSignature(body, undefined, secret), false)
  assert.equal(verifyMetaSignature(body, good, ''), false)
})

test('token encryption round-trips and detects tampering', () => {
  const enc = encryptSecret('EAAB-token', 'k1')
  assert.notEqual(enc.includes('EAAB'), true)
  assert.equal(decryptSecret(enc, 'k1'), 'EAAB-token')
  assert.throws(() => decryptSecret(enc, 'k2'))
  const parts = enc.split('.'); parts[3] = Buffer.from('xxxx').toString('base64')
  assert.throws(() => decryptSecret(parts.join('.'), 'k1'))
})
