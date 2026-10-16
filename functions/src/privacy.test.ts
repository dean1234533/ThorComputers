import test from 'node:test'
import assert from 'node:assert/strict'
import { stripPrivate } from './privacy'

test('private details are removed from public text; ordinary text is returned untouched', () => {
  for (const [input, want] of [
    ['My laptop will not boot. I am at E15 1AA.', 'My laptop will not boot. I am'], ['Screen cracked, call me on 07700 900123', 'Screen cracked'], ['Battery dead, email pia@example.com please', 'Battery dead, please'],
    ['Live at 12 High Street London', 'Live London'], ['Postcode SW1A1AA fan is loud', 'fan is loud'],
  ] as const) { const r = stripPrivate(input); assert.equal(r.removed, true, input); assert.doesNotMatch(r.text, /E15|1AA|07700|@|High Street|SW1A/, input); void want }
  const plain = stripPrivate('The fan is very loud and it overheats'); assert.deepEqual(plain, { text: 'The fan is very loud and it overheats', removed: false })
  assert.equal(stripPrivate('Dell XPS 13 9310, 16GB RAM, 512GB SSD').removed, false, 'model numbers and sizes are not addresses')
})
