// Pure natural-language helpers for the rules-first chatbot. No Firebase imports.
// Matching is phrase- and meaning-based (weighted token overlap over canonicalised words), not single-keyword lookup, and it tolerates common misspellings.

/** Multi-word expressions collapsed to one canonical word BEFORE tokenising ("how much" -> price). Longest first. */
const PHRASES: [RegExp, string][] = [
  [/\bhow much notice\b/g, ' notice '], [/\b(how (do|can|should|would|could) (i|we)|how to|where (do|can|should) (i|we)|how am i (meant|supposed|able) to) pay(ing)?\b/g, ' howtopay '],
  [/\bhow much\b/g, ' price '], [/\bhow long\b/g, ' duration '], [/\bmoney back\b/g, ' refund '], [/\bget in touch\b/g, ' contact '], [/\bspeak to (a |an )?(human|person|someone|agent)\b/g, ' contact '],
  [/\btalk to (a |an )?(human|person|someone|agent)\b/g, ' contact '], [/\bcall off\b/g, ' cancel '], [/\bcalled off\b/g, ' cancel '], [/\bturn(s|ed|ing)? off\b/g, ' shutdown '], [/\bswitch(es|ed|ing)? off\b/g, ' shutdown '],
  [/\bshut(s|ting)? down\b/g, ' shutdown '], [/\bwon'?t (turn|switch|power) on\b/g, ' deadpc '], [/\bnot (turning|switching|powering) on\b/g, ' deadpc '], [/\bwill not (turn|switch|power) on\b/g, ' deadpc '],
  [/\bno power\b/g, ' deadpc '], [/\bcome to (me|my)\b/g, ' homevisit '], [/\bhome visit\b/g, ' homevisit '], [/\bat my (house|home|place)\b/g, ' homevisit '], [/\bdrop off\b/g, ' workshop '], [/\bbring (it )?in\b/g, ' workshop '],
  [/\bpick(ed)? up\b/g, ' collection '], [/\bcollect(ion|ed)?\b/g, ' collection '], [/\bcredit card\b/g, ' card '], [/\bdebit card\b/g, ' card '], [/\bsign (up|in|on)\b/g, ' signup '], [/\blog ?in\b/g, ' signin '],
  [/\b(i )?(need|want|require|would like|d like) (a |an |my |some )?(repair|repairs|fix|fixing|something fixed|something repaired|help with my (laptop|pc|computer|phone|tablet|printer|mac))\b/g, ' start repair '],
  [/\b(have|has) (i|my|we|anyone|they|an engineer|the engineer|any)\b/g, ' acctmark '], [/\bdid (i|my|anyone|the|you|an|any)\b/g, ' acctmark '],
  [/\b(your|the|a|support|customer service) (phone|telephone|contact) number\b/g, ' contact '], [/\b(quick|one|another|different|a) questions?\b/g, ' '],
  [/\bwhat happens\b/g, ' process '], [/\bhow does (it|this|that|thor|the app) work\b/g, ' process '], [/\bhow do(es)? (you|this|it) work\b/g, ' process '],
]
/** word -> canonical word. Synonyms and the common ways people mis-type them. */
const CANON: Record<string, string> = {
  price: 'price', prices: 'price', pricing: 'price', cost: 'price', costs: 'price', costing: 'price', charge: 'price', charges: 'price', fee: 'price', fees: 'price', rate: 'price', rates: 'price', expensive: 'price', cheap: 'price', afford: 'price',
  quote: 'quote', quotes: 'quote', quotation: 'quote', quotations: 'quote', quoted: 'quote', estimate: 'quote', estimates: 'quote', bid: 'quote', bids: 'quote',
  fix: 'repair', fixed: 'repair', fixing: 'repair', repair: 'repair', repairs: 'repair', repairing: 'repair', repaired: 'repair', mend: 'repair', sort: 'repair', service: 'repair', servicing: 'repair', job: 'repair', jobs: 'repair', request: 'repair', requests: 'repair',
  booking: 'book', bookings: 'book', book: 'book', booked: 'book', appointment: 'appointment', appointments: 'appointment', slot: 'appointment', slots: 'appointment', visit: 'appointment', schedule: 'appointment', scheduled: 'appointment',
  rebook: 'reschedule', reschedule: 'reschedule', rescheduling: 'reschedule', postpone: 'reschedule', move: 'reschedule', rearrange: 'reschedule', change: 'change', changes: 'change', changing: 'change', amend: 'change', edit: 'change',
  cancel: 'cancel', cancels: 'cancel', cancelled: 'cancel', canceled: 'cancel', cancelling: 'cancel', canceling: 'cancel', cancellation: 'cancel', abort: 'cancel', withdraw: 'cancel', stop: 'cancel',
  refund: 'refund', refunds: 'refund', refunded: 'refund', refunding: 'refund', reimburse: 'refund', reimbursed: 'refund', reimbursement: 'refund', repay: 'refund', compensation: 'refund',
  pay: 'payment', paid: 'paid', paying: 'payment', payment: 'payment', payments: 'payment', checkout: 'payment', stripe: 'payment', card: 'card', invoice: 'receipt', invoices: 'receipt', receipt: 'receipt', receipts: 'receipt',
  warranty: 'warranty', warranties: 'warranty', guarantee: 'warranty', guaranteed: 'warranty', guarantees: 'warranty', aftercare: 'warranty',
  engineer: 'engineer', engineers: 'engineer', technician: 'engineer', technicians: 'engineer', repairer: 'engineer', tech: 'engineer', expert: 'engineer', professional: 'engineer',
  verified: 'verify', verify: 'verify', verification: 'verify', vetted: 'verify', checked: 'verify', qualified: 'verify', qualification: 'verify', qualifications: 'verify', certificate: 'verify', certificates: 'verify', certified: 'verify', trust: 'verify', trusted: 'verify', safe: 'safe',
  help: 'help', support: 'contact', contact: 'contact', phone: 'phone', call: 'contact', email: 'contact', emailing: 'contact', ring: 'contact', human: 'contact', agent: 'contact', person: 'contact', complaint: 'complaint', complain: 'complaint',
  device: 'device', devices: 'device', gadget: 'device', gadgets: 'device', laptop: 'laptop', laptops: 'laptop', notebook: 'laptop', macbook: 'mac', macbooks: 'mac', imac: 'mac', mac: 'mac', desktop: 'desktop', desktops: 'desktop', pc: 'desktop', computer: 'desktop', computers: 'desktop', tower: 'desktop',
  gaming: 'gaming', tablet: 'tablet', tablets: 'tablet', ipad: 'tablet', ipads: 'tablet', mobile: 'phone', mobiles: 'phone', iphone: 'phone', iphones: 'phone', smartphone: 'phone', android: 'phone', printer: 'printer', printers: 'printer',
  home: 'homevisit', house: 'homevisit', flat: 'homevisit', number: 'number', see: 'see', sees: 'see', seen: 'see', view: 'see', share: 'see', shared: 'see', remote: 'remote', remotely: 'remote', online: 'remote', workshop: 'workshop', collection: 'collection', homevisit: 'homevisit', onsite: 'homevisit', office: 'office', business: 'office', premises: 'office',
  area: 'coverage', areas: 'coverage', cover: 'coverage', covered: 'coverage', coverage: 'coverage', location: 'coverage', locations: 'coverage', london: 'coverage', kent: 'coverage', postcode: 'postcode', near: 'coverage', nearby: 'coverage', local: 'coverage',
  notice: 'notice', howtopay: 'howtopay', information: 'data', info: 'data', details: 'data', detail: 'data', account: 'account', profile: 'account', delete: 'delete', erase: 'delete', remove: 'delete', export: 'export', download: 'export', data: 'data', privacy: 'privacy', gdpr: 'privacy', personal: 'privacy', password: 'password', reset: 'reset', forgot: 'reset', forgotten: 'reset',
  install: 'install', app: 'install', pwa: 'install', homescreen: 'install', notification: 'notify', notifications: 'notify', notify: 'notify', alerts: 'notify', alert: 'notify', sound: 'notify', push: 'notify',
  message: 'message', messages: 'message', chat: 'message', messaging: 'message', review: 'review', reviews: 'review', rating: 'review', ratings: 'review', feedback: 'review', stars: 'review',
  extra: 'extra', additional: 'extra', unexpected: 'extra', extras: 'extra', dispute: 'dispute', problem: 'problem', problems: 'problem', issue: 'problem', issues: 'problem', wrong: 'problem', unhappy: 'problem', unsatisfied: 'problem', bad: 'problem', poor: 'problem',
  duration: 'duration', quick: 'duration', quickly: 'duration', fast: 'duration', soon: 'duration', long: 'duration', takes: 'duration', urgent: 'urgent', urgently: 'urgent', asap: 'urgent', emergency: 'urgent', waiting: 'duration', wait: 'duration',
  process: 'process', works: 'process', start: 'start', begin: 'start', started: 'start', new: 'new', create: 'start', submit: 'start', raise: 'start', post: 'start',
  join: 'signup', signup: 'signup', register: 'signup', apply: 'signup', signin: 'signin', login: 'signin', logon: 'signin', deadpc: 'deadpc', shutdown: 'shutdown', slow: 'slow', virus: 'virus', malware: 'virus', cracked: 'cracked', broken: 'broken', smashed: 'cracked',
  cheaper: 'price', high: 'price', low: 'price', pricey: 'price', overpriced: 'price', affordable: 'price', discount: 'price', free: 'price', deposit: 'price', commission: 'price', vat: 'price', tax: 'price',
  not: 'neg', no: 'neg', cannot: 'neg', cant: 'neg', dont: 'neg', wont: 'neg', isnt: 'neg', arent: 'neg', wasnt: 'neg', didnt: 'neg', doesnt: 'neg', couldnt: 'neg', shouldnt: 'neg', wouldnt: 'neg', never: 'neg', unable: 'neg',
  hello: 'hello', hi: 'hello', hey: 'hello', hiya: 'hello', morning: 'hello', afternoon: 'hello', evening: 'hello', thanks: 'thanks', thank: 'thanks', cheers: 'thanks', ta: 'thanks', bye: 'bye', goodbye: 'bye', cya: 'bye',
}
/** Typos seen in real support chats that edit-distance alone would miss. */
const TYPOS: Record<string, string> = { repares: 'repair', repare: 'repair', repaires: 'repair', repiar: 'repair', repiars: 'repair', reapir: 'repair', reapirs: 'repair', repairr: 'repair', cancelation: 'cancel', cancelations: 'cancel', paymnt: 'payment', priceing: 'price', infomation: 'information', informaton: 'information', laptpo: 'laptop', labtop: 'laptop', lapto: 'laptop', lap: 'laptop', refnd: 'refund', refudn: 'refund', apointment: 'appointment', appoitment: 'appointment', appointmnet: 'appointment', apoitment: 'appointment', quoet: 'quote', qoute: 'quote', qoutes: 'quote', enginer: 'engineer', enginear: 'engineer', engeneer: 'engineer', paiment: 'payment', payement: 'payment', paymnet: 'payment', cancle: 'cancel', cancell: 'cancel', canel: 'cancel', warrenty: 'warranty', garantee: 'guarantee', gurantee: 'guarantee', reschedual: 'reschedule', resheduling: 'reschedule', recieve: 'receive', refering: 'referring', wensday: 'wednesday', tomorow: 'tomorrow', brocken: 'broken', brokn: 'broken', scren: 'screen', screan: 'screen', batery: 'battery', batary: 'battery', compter: 'computer', computor: 'computer', pc: 'pc', printr: 'printer', phne: 'phone', ipone: 'iphone', tablit: 'tablet' }
/** Repair vocabulary that is on-topic even though no FAQ phrase spells it out. */
const DOMAIN = new Set('screen battery keyboard virus windows wifi charger fan drive ssd ram memory cable port speaker camera microphone display monitor mouse trackpad touchpad software hardware upgrade data files photos backup router network internet email password update'.split(' '))
const KNOWN_CANON = new Set(Object.values(CANON))
export const STOP = new Set('a an the i me my mine we us our you your it its is are was were am be been being do does did doing done have has had having can could would should will shall may might must to of in on at for from with by about as into onto over under up down out off this that these those there here and or but if so then than too very just also yes please pls plz ok okay want need like get got let lets hows whats im ive id youre theres thor app website site how what why which who whom whose tell know wondering whether guys any some wheres thats whos heres much lot many really um uh er erm well actually basically honestly anyway maybe perhaps possibly kindly sorry excuse question questions make give giving required'.split(' '))

const CONTRACTIONS: [RegExp, string][] = [[/won't/g, 'will not'], [/can't/g, 'cannot'], [/n't/g, ' not'], [/'re/g, ' are'], [/'ve/g, ' have'], [/'ll/g, ' will'], [/'m/g, ' am'], [/'s/g, ' is'], [/'d/g, ' would']]

export function normalise(text: string): string {
  let t = text.toLowerCase().replace(/[’‘`]/g, "'").replace(/£/g, ' pounds ')
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to)
  t = t.replace(/[^a-z0-9\s]/g, ' ')
  for (const [re, to] of PHRASES) t = t.replace(re, to)
  return t.replace(/\s+/g, ' ').trim()
}

/** Damerau-Levenshtein (adjacent transposition counts as one edit). */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
  }
  return d[a.length][b.length]
}

const VOCAB = Object.keys(CANON).filter(w => w.length >= 5)
/** Corrects a token to a known word when it is a near miss: same first letter, and 1 edit for 5-8 letter words or 2 for 9+ (short words are never "corrected": too risky). */
export function correct(tok: string, extra: Iterable<string> = []): string {
  if (TYPOS[tok]) return TYPOS[tok]
  if (CANON[tok] !== undefined || tok.length < 5 || /\d/.test(tok)) return tok
  let best = tok, bestD = 3, tie = false
  for (const w of [...VOCAB, ...extra]) {
    if (w[0] !== tok[0]) continue
    const lim = tok.length >= 9 || (tok.length >= 7 && w.slice(0, 3) === tok.slice(0, 3)) ? 2 : 1       // 7-8 letter words: two edits only when the first three letters agree
    if (Math.abs(w.length - tok.length) > lim) continue
    const dist = editDistance(tok, w, lim); if (dist > lim) continue
    if (dist < bestD) { best = w; bestD = dist; tie = false } else if (dist === bestD && w !== best) tie = true
  }
  return bestD <= 2 && !tie ? best : tok
}

/** Canonical content words of a message (stop words removed, synonyms merged, typos fixed). */
export function tokens(text: string, extraVocab: Iterable<string> = []): string[] {
  const out = normalise(text).split(' ').filter(Boolean).map(w => STOP.has(w) ? w : correct(w, extraVocab)).map(w => CANON[w] ?? w).filter(w => !STOP.has(w))
  return out.length > 1 ? out.filter(w => w !== 'hello' && w !== 'thanks' && w !== 'bye') : out   // a greeting or thanks around a real question is just politeness
}
/** The corrected (but not canonicalised) text, used by the slot extractors so "laptpo" still means laptop. */
export function correctedText(text: string): string { return normalise(text).split(' ').map(w => STOP.has(w) ? w : correct(w)).join(' ') }

export interface IntentDef { id: string; phrases: string[]; keywords?: string[]; negative?: string[]; priority?: number; needsMarker?: boolean }
/** Account-specific questions are about the customer's own records: they need "my", "have I" and similar. */
const ACCOUNT_MARKER = /\b(my|mine|have i|has my|did i|did my|do i have|am i|is my|was my|i have|i paid|i booked|i got|i sent)\b/
export interface Candidate { id: string; score: number }

/** Document frequency of each canonical token across intents -> rarer tokens weigh more. */
export function buildWeights(intents: IntentDef[]): Map<string, number> {
  const df = new Map<string, number>()
  for (const it of intents) for (const t of new Set(it.phrases.flatMap(p => tokens(p)))) df.set(t, (df.get(t) ?? 0) + 1)
  const n = intents.length
  return new Map([...df].map(([t, c]) => [t, Math.log(1 + n / c)]))
}

export function scoreIntents(text: string, intents: IntentDef[], weights = buildWeights(intents), extraVocab: Iterable<string> = []): Candidate[] {
  const raw = tokens(text, extraVocab), msg = [...new Set(raw)], set = new Set(msg)
  if (!msg.length) return []
  const w = (t: string) => Math.min(2.2, weights.get(t) ?? 1.3)      // a word no intent knows is unexplained content, so it lowers confidence; one rare word never dominates
  const unknown = msg.filter(t => !weights.has(t) && !KNOWN_CANON.has(t) && !DOMAIN.has(t)).length
  const offTopic = 1 / (1 + 0.45 * unknown), hasMarker = ACCOUNT_MARKER.test(text.toLowerCase().replace(/[’‘`]/g, "'"))
  const msgW = msg.reduce((a, t) => a + w(t), 0)
  const out: Candidate[] = []
  for (const it of intents) {
    let best = 0
    for (const phrase of it.phrases) {
      const pt = [...new Set(tokens(phrase))]; if (!pt.length) continue
      const pW = pt.reduce((a, t) => a + w(t), 0), hit = pt.filter(t => set.has(t)), hitW = hit.reduce((a, t) => a + w(t), 0)
      if (!hit.length) continue
      let s = Math.sqrt(hitW / pW) * (hitW / msgW)        // how much of the phrase is present x how much of the message the phrase explains
      const seq = tokens(phrase); for (let i = 0; i + 1 < seq.length; i++) if (raw.some((t, j) => t === seq[i] && raw[j + 1] === seq[i + 1])) { s += 0.06; break }   // contiguous pair
      best = Math.max(best, Math.min(1, s))
    }
    if (it.keywords?.some(k => set.has(k)) && best >= 0.35) best = Math.min(1, best + 0.1 * (1 - best))   // a gentle nudge, never enough to turn a weak match into a confident one
    if (it.negative?.some(k => set.has(k))) best *= 0.4
    best = Math.min(1, best * offTopic + (it.priority ?? 0))
    if (it.needsMarker && !hasMarker) best *= 0.55
    if (best > 0) out.push({ id: it.id, score: Math.round(best * 1000) / 1000 })
  }
  return out.sort((a, b) => b.score - a.score)
}

export const CONFIDENT = 0.55, CLOSE = 0.12, FLOOR = 0.4
export type Decision = { kind: 'match'; id: string; score: number } | { kind: 'ambiguous'; ids: string[] } | { kind: 'none' }
/** Answer only when clearly ahead; ask a clarifying question when two meanings are close; otherwise "none". */
export function decide(c: Candidate[]): Decision {
  const a = c[0]; if (!a || a.score < FLOOR) return { kind: 'none' }
  const near = c.filter(x => x.score >= FLOOR && a.score - x.score < CLOSE).slice(0, 3)
  if (near.length > 1) return { kind: 'ambiguous', ids: near.map(x => x.id) }
  return a.score >= CONFIDENT ? { kind: 'match', id: a.id, score: a.score } : { kind: 'none' }
}

/** True when the message contains at least one word about repairs, devices, quotes, bookings, payments or support. A message with none of these is out of scope and never reaches the AI. */
export function onTopic(text: string, intents: IntentDef[]): boolean {
  const GENERIC = new Set(['neg', 'start', 'new', 'help', 'change', 'acctmark', 'process', 'duration'])      // words that appear in any sentence say nothing about the topic
  const vocab = new Set(intents.flatMap(i => i.phrases.flatMap(p => tokens(p))))
  return tokens(text).some(t => !GENERIC.has(t) && (vocab.has(t) || KNOWN_CANON.has(t) || DOMAIN.has(t)))
}
