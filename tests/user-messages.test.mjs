import test from 'node:test'
import assert from 'node:assert/strict'
import { userMessage } from '../web/src/lib/errors.ts'

test('sign-in failures give a clear next step without account enumeration', () => {
  for (const code of ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found']) assert.equal(userMessage({ code }), 'Incorrect email or password.')
  assert.match(userMessage({ code: 'auth/requires-recent-login' }), /sign in again/i)
})
test('connection errors suggest checking the connection', () => {
  for (const code of ['auth/network-request-failed', 'functions/unavailable', 'storage/retry-limit-exceeded']) assert.match(userMessage({ code, message: 'Firebase: transport failure' }), /internet connection/)
})
test('booking conflicts keep the useful reason instead of a generic code', () => {
  assert.equal(userMessage({ code: 'functions/already-exists', message: 'That time was just taken. Please choose another slot.' }), 'That time has just been booked. Please choose another time.')
  assert.match(userMessage({ code: 'functions/failed-precondition', message: 'An appointment already exists. Use reschedule.' }), /Open Appointments/)
})
test('permission and admin verification errors hide internal configuration names', () => {
  assert.match(userMessage({ code: 'functions/permission-denied', message: 'Missing permission: engineers.review' }), /contact an administrator/)
  assert.equal(userMessage({ code: 'functions/permission-denied', message: 'mfa-required: Multi-factor authentication is required for admin actions. Open Admin > Security to enrol.' }), 'Open Security and set up two-step verification, then sign in again.')
})
test('validation failures never expose schema paths or validation internals', () => {
  const message = userMessage({ code: 'functions/invalid-argument', message: 'device.manufacturer: Invalid input: expected string, received undefined' })
  assert.equal(message, 'Please check the details you entered and try again.')
})
test('known review instructions survive Firebase message wrappers', () => {
  assert.equal(userMessage({ code: 'functions/invalid-argument', message: 'Firebase: Please remove phone numbers and email addresses from your review. (functions/invalid-argument)' }), 'Please remove phone numbers and email addresses from your review.')
})
test('unknown failures never expose paths, secrets, service errors or object properties', () => {
  for (const error of [null, undefined, new Error('INTERNAL projects/private/secret'), { message: 'constructor' }, { message: 'toString' }, { code: 'failed-precondition', message: 'The query requires an index. Create it at https://console.firebase.google.com/private' }]) {
    const message = userMessage(error)
    assert.equal(typeof message, 'string')
    assert.doesNotMatch(message, /INTERNAL|projects\/|secret|index|firebase|constructor|toString/i)
  }
})
test('changing repair states uses ordinary language', () => {
  assert.match(userMessage({ code: 'functions/failed-precondition', message: 'engineer cannot move a job from in_progress to engineer_selected.' }), /Refresh the page/)
  assert.match(userMessage({ message: 'Application is already info_requested.' }), /latest status/)
})

test('an unexpected server error shows the reference so support can find the log line, and never leaks internals', () => {
  const m = userMessage({ code: 'functions/internal', message: 'Something went wrong on our side (ref EA1B2C3).' })
  assert.match(m, /EA1B2C3/); assert.match(m, /try again/i); assert.doesNotMatch(m, /INTERNAL|index|FAILED_PRECONDITION/)
  assert.doesNotMatch(userMessage({ code: 'functions/internal', message: 'INTERNAL' }), /INTERNAL/)
})
