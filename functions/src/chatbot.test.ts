import test from 'node:test'
import assert from 'node:assert/strict'
import { callGemini } from './chatbot'

const msgs = [{ role: 'user' as const, text: 'My laptop switches off' }]
const okBody = { candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'What make and model is it?', ready: false, escalate: false }) }] } }] }
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
const withKey = async (k: string | undefined, fn: () => Promise<void>) => { const o = process.env.GEMINI_API_KEY; if (k === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = k; try { await fn() } finally { if (o === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = o } }

test('an unknown/retired model name falls back to the next alias and still answers', async () => {
  const tried: string[] = [], log: string[] = []
  await withKey('k', async () => {
    const out = await callGemini('sys', msgs, { models: ['gemini-retired'], record: (ok, d) => { log.push(`${ok}:${d}`) },
      fetchImpl: (async (url: string) => { tried.push(String(url).match(/models\/([^:]+)/)![1]); return tried.length < 2 ? res(404, { error: { status: 'NOT_FOUND', message: 'models/gemini-retired is not found' } }) : res(200, okBody) }) as unknown as typeof fetch })
    assert.equal(out.reply, 'What make and model is it?'); assert.equal(tried[0], 'gemini-retired'); assert.equal(tried.length, 2); assert.match(log.at(-1)!, /^true:ok/)
  })
})
test('an invalid key stops immediately, records the reason for admins, and tells the customer only that setup is incomplete', async () => {
  const log: string[] = []; let calls = 0
  await withKey('bad-key', async () => {
    await assert.rejects(callGemini('sys', msgs, { record: (ok, d) => { log.push(`${ok}:${d}`) }, fetchImpl: (async () => { calls++; return res(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }) }) as unknown as typeof fetch }),
      (e: any) => e.code === 'failed-precondition' && !/key|valid/i.test(e.message) && /not set up correctly/.test(e.message))
  })
  assert.equal(calls, 1, 'a bad key must not be retried against every model'); assert.match(log[0], /^false:.*API key not valid/); assert.ok(!log[0].includes('bad-key'), 'the key must never be logged')
})
test('quota/overload errors surface as a generic "busy" message and are recorded', async () => {
  const log: string[] = []
  await withKey('k', async () => { await assert.rejects(callGemini('sys', msgs, { record: (ok, d) => { log.push(`${ok}:${d}`) }, fetchImpl: (async () => res(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } })) as unknown as typeof fetch }), (e: any) => e.code === 'unavailable' && /busy/.test(e.message)) })
  assert.match(log[0], /RESOURCE_EXHAUSTED/)
})
test('a missing or placeholder key is reported as not set up, without calling Google', async () => {
  let calls = 0
  for (const k of [undefined, 'not-set-yet']) await withKey(k, async () => { await assert.rejects(callGemini('sys', msgs, { record: () => {}, fetchImpl: (async () => { calls++; return res(200, okBody) }) as unknown as typeof fetch }), (e: any) => e.code === 'failed-precondition') })
  assert.equal(calls, 0)
})
