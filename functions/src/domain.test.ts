import test from 'node:test'
import assert from 'node:assert/strict'
import { canTransition, quoteTotalPence, freeStarts, slotKeysFor, requiredSpecsFor, londonDate, canEditReview, containsContactDetails, Availability } from './domain'

const avail: Availability = {
  slotMinutes: 30, unavailableDates: ['2026-12-25'],
  weekly: Object.fromEntries(['0','1','2','3','4','5','6'].map(d => [d, { enabled: !['0','6'].includes(d), start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] }])) as Availability['weekly'],
}
const past = new Date('2026-01-01T00:00:00Z')

test('engineers cannot skip states or reopen jobs', () => {
  assert.equal(canTransition('engineer', 'appointment_scheduled', 'on_the_way'), true)
  assert.equal(canTransition('engineer', 'in_progress', 'closed'), false)
  assert.equal(canTransition('engineer', 'open', 'in_progress'), false)
  assert.equal(canTransition('engineer', 'completed', 'in_progress'), false)
  assert.equal(canTransition('customer', 'in_progress', 'cancelled'), false)
})
test('quote total sums all charges', () => assert.equal(quoteTotalPence({ repairPence: 8000, diagnosticPence: 1500, calloutPence: 2000 }), 11500))
test('specs widen for virus/data issues', () => {
  assert.deepEqual(requiredSpecsFor('laptop', ['Virus or malware']).sort(), ['laptop', 'virus'])
  assert.ok(requiredSpecsFor('gaming_pc', []).includes('desktop'))
})
test('slots skip breaks, weekends, holidays and booked slots', () => {
  const mon = freeStarts(avail, '2026-12-14', 60, new Set(), past)
  assert.ok(mon.length > 0)
  assert.ok(!mon.some(d => d.toISOString().startsWith('2026-12-14T12:30')), 'no start inside the 12-13 break')
  assert.equal(freeStarts(avail, '2026-12-13', 60, new Set(), past).length, 0, 'Sunday')
  assert.equal(freeStarts(avail, '2026-12-25', 60, new Set(), past).length, 0, 'unavailable date')
  const first = mon[0]
  const booked = new Set(slotKeysFor(first, 60))
  const after = freeStarts(avail, '2026-12-14', 60, booked, past)
  assert.ok(!after.some(d => d.getTime() === first.getTime()))
  assert.ok(!after.some(d => d.getTime() === first.getTime() + 30 * 60000), 'overlapping start also blocked')
})
test('lead time hides imminent slots', () => {
  const now = new Date('2026-12-14T09:00:00Z')
  assert.ok(freeStarts(avail, '2026-12-14', 30, new Set(), now).every(d => d.getTime() >= now.getTime() + 2 * 3600_000))
})
test('London time handles GMT and BST', () => {
  assert.equal(londonDate('2026-12-14', 9 * 60).toISOString(), '2026-12-14T09:00:00.000Z')
  assert.equal(londonDate('2026-07-14', 9 * 60).toISOString(), '2026-07-14T08:00:00.000Z')
})
test('review edit window: once, within 48h', () => {
  const t = new Date('2026-01-01T00:00:00Z')
  assert.equal(canEditReview(t, new Date('2026-01-02T00:00:00Z'), 0), true)
  assert.equal(canEditReview(t, new Date('2026-01-04T00:00:00Z'), 0), false)
  assert.equal(canEditReview(t, new Date('2026-01-02T00:00:00Z'), 1), false)
})
test('contact details are detected', () => {
  assert.equal(containsContactDetails('call me on 07700 900123'), true)
  assert.equal(containsContactDetails('mail me a@b.com'), true)
  assert.equal(containsContactDetails('screen replaced, great'), false)
})
