import test from 'node:test'
import assert from 'node:assert/strict'
import { normaliseProfile, profileErrors } from '../web/src/lib/engineer-profile.ts'

const complete = () => normaliseProfile({ displayName: 'Repair Engineer', bio: 'I repair computers and help customers resolve hardware and software problems.', yearsExperience: 5, serviceArea: { postcode: 'BR1 1AA', radiusMiles: 15 }, areasCovered: ['Bromley'], specialisations: ['laptop'], workingArrangements: ['home'], photoURL: 'https://example.test/profile.jpg' })

test('a new draft contains no undefined values that would prevent saving', () => {
  const profile = normaliseProfile({}, { fullName: 'Repair Engineer', postcode: 'BR1 1AA' })
  const check = value => { assert.notEqual(value, undefined); if (value && typeof value === 'object') for (const child of Object.values(value)) check(child) }
  check(profile)
  assert.equal(profile.bio, '')
  assert.equal(profile.photoURL, '')
  assert.equal(profile.serviceArea.postcode, 'BR1 1AA')
})
test('missing service choices name each field instead of reporting an array error', () => {
  const profile = complete(); profile.areasCovered = []; profile.specialisations = []; profile.workingArrangements = []
  const errors = profileErrors(profile, { submission: true, hasCertificate: true })
  assert.equal(errors.areasCovered, 'Add at least one town or area where you work.')
  assert.equal(errors.specialisations, 'Choose at least one type of repair you offer.')
  assert.equal(errors.workingArrangements, 'Choose at least one option, such as home visits or remote help.')
  assert.doesNotMatch(Object.values(errors).join(' '), /array|element|expected/i)
})
test('a complete application passes validation only with a certificate', () => {
  assert.deepEqual(profileErrors(complete(), { submission: true, hasCertificate: true }), {})
  assert.equal(profileErrors(complete(), { submission: true }).qualifications, 'Upload at least one certificate before sending your application.')
})
test('public profile updates do not require re-uploading a qualification', () => {
  assert.deepEqual(profileErrors(complete(), { submission: false }), {})
})
test('invalid profile details are caught before the save request', () => {
  const profile = complete(); profile.bio = 'Short'; profile.serviceArea.postcode = 'bad'; profile.photoURL = ''; profile.yearsExperience = 1.5; profile.serviceArea.radiusMiles = 0
  const errors = profileErrors(profile, { submission: true, hasCertificate: true })
  for (const key of ['bio', 'postcode', 'photoURL', 'yearsExperience', 'radiusMiles']) assert.equal(typeof errors[key], 'string')
})
