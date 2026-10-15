// Firestore INDEX COVERAGE. The emulator does not enforce composite indexes, so a query with no matching index passes every local test and then fails in production
// (this broke repair submission, the Appointments page and the customer Quotations page). This test derives the index each query needs and checks it exists in
// firestore.indexes.json, with the direction rules production applies. Runs without emulators.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EQ = new Set(['==', 'in']), ARR = new Set(['array-contains', 'array-contains-any']), INEQ = new Set(['<', '<=', '>', '>=', '!='])

/** query = { collection, filters: [{ field, op }], orders: [{ field, dir }] } -> required composite index shape, or null when single-field indexes suffice. */
export function requiredIndex(q) {
  const eq = [...new Set(q.filters.filter(f => EQ.has(f.op)).map(f => f.field))], arr = [...new Set(q.filters.filter(f => ARR.has(f.op)).map(f => f.field))]
  const ineq = [...new Set(q.filters.filter(f => INEQ.has(f.op)).map(f => f.field))]
  const order = []                                   // inequality field(s) come first, then explicit orderBys; default direction is ascending
  for (const f of ineq) order.push({ field: f, dir: q.orders.find(o => o.field === f)?.dir ?? 'asc' })
  for (const o of q.orders) if (!order.some(x => x.field === o.field)) order.push(o)
  const equals = [...eq, ...arr].filter(f => !order.some(o => o.field === f))
  if (!((equals.length >= 1 && order.length >= 1) || order.length >= 2)) return null
  return { collection: q.collection, prefix: [...eq.filter(f => !order.some(o => o.field === f)).map(f => ({ field: f, kind: 'asc' })), ...arr.map(f => ({ field: f, kind: 'contains' }))], order }
}
export function satisfies(index, need) {
  if (index.collectionGroup !== need.collection) return false
  const f = index.fields.filter(x => x.fieldPath !== '__name__'), n = need.prefix.length
  if (f.length !== n + need.order.length) return false
  const head = f.slice(0, n).map(x => `${x.fieldPath}:${x.arrayConfig ? 'contains' : 'asc'}`).sort(), want = need.prefix.map(x => `${x.field}:${x.kind}`).sort()
  if (JSON.stringify(head) !== JSON.stringify(want)) return false
  return f.slice(n).every((x, i) => x.fieldPath === need.order[i].field && (x.order ?? 'ASCENDING') === (need.order[i].dir === 'desc' ? 'DESCENDING' : 'ASCENDING'))
}
const covered = (indexes, q) => { const need = requiredIndex(q); return need === null || indexes.some(i => satisfies(i, need)) }

// ---------- extract query shapes from the source ----------
const strip = s => s.replace(/\/\/.*$/gm, '')
const parseChain = (collection, chain, where) => ({ collection, where,
  filters: [...chain.matchAll(/\.?where\(\s*(?:'([^']+)'|`([^`]+)`|([A-Za-z_]\w*))\s*,\s*'([^']+)'/g)].map(m => ({ field: m[1] ?? m[2] ?? `$${m[3]}`, op: m[4] })).filter(f => f.field !== '__name__'),
  orders: [...chain.matchAll(/\.?orderBy\(\s*'([^']+)'(?:\s*,\s*'(asc|desc)')?/g)].map(m => ({ field: m[1], dir: m[2] ?? 'asc' })) })
export function backendQueries() {
  const dir = join(ROOT, 'functions/src'), out = []
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const src = strip(readFileSync(join(dir, file), 'utf8'))
    for (const m of src.matchAll(/(?:db|getFirestore\(\))\.collection\('([A-Za-z]+)'\)((?:\s*\.(?:where|orderBy|limit|select|count|get)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*)/g)) out.push(parseChain(m[1], m[2], `functions/src/${file}`))
  }
  return out
}
export function webQueries() {
  const out = []; const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : [])
  for (const file of walk(join(ROOT, 'web/src'))) {
    for (const line of strip(readFileSync(file, 'utf8')).split('\n')) {
      const m = line.match(/useQuery(?:<.*?>)?\(([^]*?)\(\)\s*=>\s*(.*?\]|\{.*?return c\s*\})\s*,\s*\[/); if (!m || !/where\(|orderBy\(/.test(m[2])) continue
      const col = m[1].match(/'([A-Za-z]+)'/)?.[1]; if (!col) continue
      out.push(parseChain(col, m[2], file.replace(ROOT + '/', '')))
    }
  }
  return out
}
// Fields passed as variables: Appointments.tsx queries customerId or engineerId depending on role.
const expand = q => q.filters.some(f => f.field.startsWith('$')) && /Appointments\.tsx$/.test(q.where)
  ? ['customerId', 'engineerId'].map(v => ({ ...q, filters: q.filters.map(f => f.field.startsWith('$') ? { ...f, field: v } : f) })) : [q]

const INDEXES = JSON.parse(readFileSync(join(ROOT, 'firestore.indexes.json'), 'utf8')).indexes

test('index logic: the exact shapes that failed in production are detected', () => {
  const deployedBefore = [{ collectionGroup: 'repairRequests', fields: [{ fieldPath: 'customerId', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }] },
    { collectionGroup: 'appointments', fields: [{ fieldPath: 'customerId', order: 'ASCENDING' }, { fieldPath: 'startAt', order: 'ASCENDING' }] }]
  const f = (field, op) => ({ field, op })
  // repair rate limit: customerId == and createdAt > with NO orderBy needs an ASC index -> not covered by the DESC one (this was the HTTP 500)
  assert.equal(covered(deployedBefore, { collection: 'repairRequests', filters: [f('customerId', '=='), f('createdAt', '>')], orders: [] }), false)
  // ...but the same query ordered DESC is served by it (verified against the live database)
  assert.equal(covered(deployedBefore, { collection: 'repairRequests', filters: [f('customerId', '=='), f('createdAt', '>')], orders: [{ field: 'createdAt', dir: 'desc' }] }), true)
  // Appointments page: orderBy startAt DESC is NOT served by an ASC index
  assert.equal(covered(deployedBefore, { collection: 'appointments', filters: [f('customerId', '==')], orders: [{ field: 'startAt', dir: 'desc' }] }), false)
  assert.equal(covered(deployedBefore, { collection: 'appointments', filters: [f('customerId', '==')], orders: [{ field: 'startAt', dir: 'asc' }] }), true)
  // equality-only and single-field queries need no composite index
  assert.equal(requiredIndex({ collection: 'x', filters: [f('a', '=='), f('b', '==')], orders: [] }), null)
  assert.equal(requiredIndex({ collection: 'x', filters: [], orders: [{ field: 'createdAt', dir: 'desc' }] }), null)
  assert.equal(requiredIndex({ collection: 'x', filters: [f('createdAt', '>=')], orders: [{ field: 'createdAt', dir: 'desc' }] }), null)
})
test('the scanner finds the queries it is supposed to guard (so the next test cannot pass by finding nothing)', () => {
  const b = backendQueries(), w = webQueries()
  assert.ok(b.length >= 30, `only ${b.length} backend queries found`); assert.ok(w.length >= 18, `only ${w.length} web queries found`)
  assert.ok(b.some(q => q.collection === 'repairRequests' && q.where.endsWith('jobs.ts') && q.filters.some(f => f.field === 'createdAt')), 'rate-limit query not found')
  assert.ok(w.some(q => q.collection === 'appointments'), 'Appointments query not found'); assert.ok(w.some(q => q.collection === 'repairQuotes' && q.filters.length === 2 && q.orders.length === 1), 'Quotations query not found')
})
test('EVERY query in the backend and web app is covered by a deployed index (direction included)', () => {
  const gaps = []
  for (const q of [...backendQueries(), ...webQueries()].flatMap(expand)) if (!covered(INDEXES, q)) {
    const n = requiredIndex(q); gaps.push(`${q.where}: ${q.collection} needs [${[...n.prefix.map(p => p.field + (p.kind === 'contains' ? ' (array)' : '')), ...n.order.map(o => `${o.field} ${o.dir.toUpperCase()}`)].join(', ')}]`)
  }
  assert.deepEqual(gaps, [], `Add these to firestore.indexes.json (and deploy them):\n${gaps.join('\n')}`)
})
