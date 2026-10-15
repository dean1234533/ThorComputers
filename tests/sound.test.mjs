import test from 'node:test'
import assert from 'node:assert/strict'

// Minimal browser stand-ins so the real lib/sound.ts runs under node.
const store = new Map(); globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
let started = 0, resumed = 0
class FakeCtx { constructor() { this.currentTime = 0; this.state = 'suspended'; this.destination = {} } resume() { resumed++; this.state = 'running' } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: n => n } } createOscillator() { return { frequency: {}, connect: n => n, start() { started++ }, stop() {} } } }
globalThis.window = globalThis; globalThis.AudioContext = FakeCtx
const { playChime, soundEnabled, setSoundEnabled } = await import('../web/src/lib/sound.ts')

test('the chime plays two notes by default', () => { assert.equal(soundEnabled(), true); playChime(); assert.equal(started, 2); assert.ok(resumed >= 1, 'a suspended audio context must be resumed') })
test('turning sound off silences it, and the choice is remembered', () => { setSoundEnabled(false); assert.equal(soundEnabled(), false); const before = started; playChime(); assert.equal(started, before) })
test('"Play test sound" still plays when sound is off (force), and turning it back on works', () => { const before = started; playChime(true); assert.equal(started, before + 2); setSoundEnabled(true); playChime(); assert.equal(started, before + 4) })
test('a browser with no Web Audio support never throws', () => { const C = globalThis.AudioContext; delete globalThis.AudioContext; assert.doesNotThrow(() => playChime(true)); globalThis.AudioContext = C })
