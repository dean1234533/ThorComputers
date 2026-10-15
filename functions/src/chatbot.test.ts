import test from 'node:test'
import assert from 'node:assert/strict'
import { askAi, guardAnswer } from './chatbot'
import { AiUnavailable } from './chat/engine'

const good = { candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'Ask support.', escalate: false }) }] } }] }
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
const withKey = async (k: string | undefined, fn: () => Promise<void>) => { const o = process.env.GEMINI_API_KEY; if (k === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = k; try { await fn() } finally { if (o === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = o } }
const reason = async (p: Promise<unknown>) => { try { await p } catch (e) { assert.ok(e instanceof AiUnavailable, String(e)); return e.reason } throw new Error('expected AiUnavailable') }
const stub = (impl: (url: string, n: number) => Promise<Response>) => { const calls: string[] = []; return { calls, fetchImpl: (async (u: string) => { calls.push(String(u).match(/models\/([^:]+)/)![1]); return impl(String(u), calls.length) }) as unknown as typeof fetch } }

test('an unknown/retired model name falls back to the next model and still answers', async () => {
  const s = stub(async (_u, n) => n < 2 ? res(404, { error: { status: 'NOT_FOUND', message: 'models/x is not found' } }) : res(200, good))
  await withKey('k', async () => { const r = await askAi('sys', 'q', { models: ['retired'], record: () => {}, fetchImpl: s.fetchImpl }); assert.equal(r.result.answer, 'Ask support.'); assert.equal(s.calls[0], 'retired'); assert.equal(s.calls.length, 2) })
})
test('an invalid key stops immediately (one call), records the reason, never logs the key', async () => {
  const log: string[] = []; const s = stub(async () => res(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }))
  await withKey('super-secret-key', async () => { assert.equal(await reason(askAi('sys', 'q', { record: (ok, d) => { log.push(`${ok}:${d}`) }, fetchImpl: s.fetchImpl })), 'error') })
  assert.equal(s.calls.length, 1); assert.match(log[0], /^false:.*API key not valid/); assert.ok(!log[0].includes('super-secret-key'))
})
test('quota/rate-limit (429) is reported as quota and not retried', async () => {
  const s = stub(async () => res(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }))
  await withKey('k', async () => { assert.equal(await reason(askAi('sys', 'q', { record: () => {}, fetchImpl: s.fetchImpl })), 'quota') }); assert.equal(s.calls.length, 1)
})
test('a transient 503 is retried exactly once: success on the retry, error after two failures', async () => {
  const ok = stub(async (_u, n) => n === 1 ? res(503, { error: { message: 'overloaded' } }) : res(200, good))
  await withKey('k', async () => { await askAi('sys', 'q', { record: () => {}, fetchImpl: ok.fetchImpl }) }); assert.equal(ok.calls.length, 2)
  const bad = stub(async () => res(503, { error: { message: 'overloaded' } }))
  await withKey('k', async () => { assert.equal(await reason(askAi('sys', 'q', { record: () => {}, fetchImpl: bad.fetchImpl })), 'error') }); assert.equal(bad.calls.length, 2, 'never more than one retry')
})
test('a timeout is retried once and then reported as timeout; the call is bounded by AbortSignal', async () => {
  let sawSignal = false
  const f = (async (_u: string, init?: RequestInit) => { sawSignal = !!init?.signal; throw Object.assign(new Error('t'), { name: 'TimeoutError' }) }) as unknown as typeof fetch
  await withKey('k', async () => { assert.equal(await reason(askAi('sys', 'q', { record: () => {}, fetchImpl: f })), 'timeout') }); assert.ok(sawSignal)
})
test('a malformed or schema-invalid answer is rejected', async () => {
  for (const text of ['not json at all', JSON.stringify({ reply: 'wrong shape' }), JSON.stringify({ answer: '' })]) {
    const s = stub(async () => res(200, { candidates: [{ content: { parts: [{ text }] } }] }))
    await withKey('k', async () => { assert.equal(await reason(askAi('sys', 'q', { record: () => {}, fetchImpl: s.fetchImpl })), 'malformed') })
  }
})
test('a missing or placeholder key never calls Google', async () => {
  for (const k of [undefined, 'not-set-yet']) { const s = stub(async () => res(200, good)); await withKey(k, async () => { assert.equal(await reason(askAi('sys', 'q', { record: () => {}, fetchImpl: s.fetchImpl })), 'error') }); assert.equal(s.calls.length, 0) }
})
test('the AI request is size-limited and low-token', async () => {
  let body: any; const f = (async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return res(200, good) }) as unknown as typeof fetch
  await withKey('k', async () => { await askAi('sys', 'x'.repeat(5000), { record: () => {}, fetchImpl: f }) })
  assert.ok(body.contents[0].parts[0].text.length <= 400); assert.ok(body.generationConfig.maxOutputTokens <= 300)
})

const approved = 'Support: email help@example.test. Cancellation notice: 24 hours. Refund policy: refunds follow the engineer terms.'
test('guard: invented prices, durations, contact details and links are rejected; approved facts and plain text pass', () => {
  assert.equal(guardAnswer('It will cost about £49.99.', approved), false)
  assert.equal(guardAnswer('The repair takes 2 days.', approved), false)
  assert.equal(guardAnswer('Email fake@evil.test for help.', approved), false)
  assert.equal(guardAnswer('See https://evil.test/refund', approved), false)
  assert.equal(guardAnswer('Please give 24 hours notice, or email help@example.test.', approved), true)
  assert.equal(guardAnswer('Engineers set their own warranty in each quote, so compare them.', approved), true)
  assert.equal(guardAnswer('x'.repeat(800), approved), false)
})
