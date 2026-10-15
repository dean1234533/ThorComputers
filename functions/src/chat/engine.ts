// The chatbot brain. Pure and dependency-injected: it never touches Firebase or the network itself, so every conversation can be unit-tested and PROVEN to make no AI call.
// Order of decisions:  safety/escalation  ->  commands  ->  pending choice  ->  active intake  ->  FAQ intents / account questions  ->  start intake from a problem statement  ->  AI (only if allowed)  ->  deterministic fallback.
import { METHODS_FOR, METHOD_LABEL, JOB_STATUS_LABEL, DEVICE_LABEL } from '../catalog'
import { FAQ, FAQ_BY_ID, GENERIC_NO_MATCH, type FaqIntent, type QuickReply } from './faq'
import { buildWeights, decide, onTopic, scoreIntents, tokens, CONFIDENT, type IntentDef } from './nlu'
import { Ask, IntakeState, Slots, allowedMethods, changeTarget, detectDevice, emptyIntake, extract, hasSymptom, isComplete, isQuestion, isRestart, isYes, nextAsk, question, summary, toDraft } from './intake'

export interface ChatFacts {
  support?: { email?: string; phone?: string; hours?: string }; booking?: { cancelNoticeHours?: number; reminderHours?: number[] }; categories?: string[]; coverage?: { areas?: string[]; note?: string }
  directWarranty?: string; directTerms?: string; refundPolicy?: string; cancellationPolicy?: string; marketplaceDisclaimer?: string; escalation?: string
}
export interface AccountFacts { jobs: { reference: string; status: string; quoteCount: number; paid: boolean; agreedPence?: number }[]; nextAppointment?: { reference: string; startAt: number } | null }
export interface CustomFaq { id: string; questions: string[]; answer: string }
export interface Overrides { [intentId: string]: { answer?: string; enabled?: boolean } }
export interface AiResult { answer: string; escalate?: boolean }
export type AiReason = 'disabled' | 'quota' | 'global' | 'busy' | 'timeout' | 'error' | 'malformed' | 'guard'
export class AiUnavailable extends Error { constructor(public reason: AiReason) { super(reason) } }

export interface ChatState { intake?: IntakeState; lastIntent?: string; choice?: string[]; repeat?: number }
export interface Deps { facts: ChatFacts; overrides?: Overrides; custom?: CustomFaq[]; account?: () => Promise<AccountFacts>; ai?: (question: string) => Promise<AiResult> }
export interface TurnResult {
  reply: string; quick: QuickReply[]; state: ChatState; draft: ReturnType<typeof toDraft> | null; ready: boolean; openForm: boolean; escalate: boolean
  source: 'rules' | 'ai' | 'fallback'; intent?: string; aiReason?: AiReason
}

// ---------- templates ----------
const joinList = (a?: string[]) => (a ?? []).filter(Boolean).join(', ')
export function supportLine(f: ChatFacts): string {
  const s = f.support ?? {}, parts = [s.email && `email ${s.email}`, s.phone && `phone ${s.phone}`].filter(Boolean) as string[]
  const base = parts.length ? `You can reach our team by ${parts.join(' or ')}${s.hours ? ` (${s.hours})` : ''}.` : 'Please contact Thor Computer using the contact details on thorcomputer.com.'
  return f.escalation ? `${base} ${f.escalation}` : base
}
const methodRules = () => Object.entries(METHODS_FOR).filter(([, m]) => m.length < 5 && !['other'].includes(m.join())).map(([d, m]) => `${DEVICE_LABEL[d as keyof typeof DEVICE_LABEL] ?? d}: ${m.map(x => METHOD_LABEL[x].toLowerCase()).join(', ')}`).join('; ')
export function render(tpl: string, f: ChatFacts): string {
  const v: Record<string, string> = {
    support: supportLine(f), supportEmail: f.support?.email ?? '', supportPhone: f.support?.phone ?? '', supportHours: f.support?.hours ?? '', cancelNoticeHours: f.booking?.cancelNoticeHours != null ? String(f.booking.cancelNoticeHours) : '',
    reminderHours: joinList(f.booking?.reminderHours?.map(String)), categories: joinList(f.categories), coverage: [joinList(f.coverage?.areas), f.coverage?.note].filter(Boolean).join('. '), directWarranty: f.directWarranty ?? '', directTerms: f.directTerms ?? '',
    refundPolicy: f.refundPolicy ?? '', cancellationPolicy: f.cancellationPolicy ?? '', marketplaceDisclaimer: f.marketplaceDisclaimer ?? '', escalation: f.escalation ?? '', methodRules: methodRules(),
  }
  return tpl.replace(/\[\[if:(\w+)\]\]([\s\S]*?)\[\[\/if\]\]/g, (_m, k: string, body: string) => v[k] ? body : '').replace(/\{\{(\w+)\}\}/g, (_m, k: string) => v[k] ?? '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim()
}

// ---------- intent table (built-in FAQ + admin overrides/custom entries) ----------
function intentTable(deps: Deps): { defs: IntentDef[]; byId: Map<string, { label: string; answer: string; quick?: string[]; account?: FaqIntent['account']; action?: FaqIntent['action'] }> } {
  const byId = new Map<string, { label: string; answer: string; quick?: string[]; account?: FaqIntent['account']; action?: FaqIntent['action'] }>(), defs: IntentDef[] = []
  for (const f of FAQ) {
    const o = deps.overrides?.[f.id]; if (o?.enabled === false) continue
    byId.set(f.id, { label: f.label, answer: o?.answer?.trim() || f.answer, quick: f.quick, account: f.account, action: f.action }); defs.push({ id: f.id, phrases: f.phrases, keywords: f.keywords, negative: f.negative, needsMarker: !!f.account })
  }
  for (const c of deps.custom ?? []) { if (!c.questions.length || !c.answer.trim()) continue; byId.set(c.id, { label: c.questions[0], answer: c.answer, quick: ['contact_support'] }); defs.push({ id: c.id, phrases: c.questions, priority: 0.08 }) }
  return { defs, byId }
}
const weightsCache = new WeakMap<IntentDef[], Map<string, number>>()

const q = (label: string, value = label): QuickReply => ({ label, value })
const faqQuick = (ids: string[] | undefined, table: ReturnType<typeof intentTable>['byId']): QuickReply[] => (ids ?? []).filter(id => table.has(id)).map(id => q(table.get(id)!.label, `faq:${id}`))
const TOPICS = ['start_repair', 'prices', 'quotations', 'booking', 'payments_how', 'refunds', 'contact_support']
const topicQuick = (t: ReturnType<typeof intentTable>['byId']) => faqQuick(TOPICS, t)

const SAFETY = /\b(smoke|smoking|burning smell|burnt smell|smells? (of )?burn|sparks?|sparking|on fire|caught fire|swollen battery|bulging battery|battery (is )?(swollen|bulging|leaking)|electric shock|electrocuted)\b/
const ANGRY = /\b(scam|fraud|sue|solicitor|lawyer|legal action|police|trading standards|ripped off|rip off|furious|disgusting|ridiculous|unacceptable|terrible service)\b/
const HELP = /^(help|menu|options|topics|what can you do|what can i ask)$/

const result = (r: Partial<TurnResult> & Pick<TurnResult, 'reply' | 'state'>): TurnResult => ({ quick: [], draft: null, ready: false, openForm: false, escalate: false, source: 'rules', ...r })
const fmtDate = (ms: number) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(ms))
const gbp = (p: number) => `£${(p / 100).toFixed(2)}`

async function accountAnswer(kind: NonNullable<FaqIntent['account']>, deps: Deps): Promise<string> {
  const a = deps.account ? await deps.account() : { jobs: [] }
  if (!a.jobs.length && kind !== 'appointment') return 'You don’t have any repair requests yet. I can help you start one.'
  switch (kind) {
    case 'status': return a.jobs.slice(0, 3).map(j => `${j.reference}: ${JOB_STATUS_LABEL[j.status] ?? j.status}${j.status === 'open' ? `, ${j.quoteCount} quote${j.quoteCount === 1 ? '' : 's'} so far` : ''}.`).join('\n')
    case 'quotes': { const open = a.jobs.filter(j => j.status === 'open'); return open.length ? open.slice(0, 3).map(j => `${j.reference} has ${j.quoteCount} quote${j.quoteCount === 1 ? '' : 's'}${j.quoteCount ? ' ready to compare' : ' so far; engineers are being notified'}.`).join('\n') : 'None of your repairs is waiting for quotes right now.' }
    case 'appointment': return a.nextAppointment ? `Your next appointment is for ${a.nextAppointment.reference} on ${fmtDate(a.nextAppointment.startAt)} (UK time).` : 'You have no upcoming appointments. Once you choose an engineer you can book a time on the repair.'
    case 'payment': { const chosen = a.jobs.filter(j => j.agreedPence != null); return chosen.length ? chosen.slice(0, 3).map(j => `${j.reference}: ${j.paid ? 'paid' : `${gbp(j.agreedPence!)} agreed and not paid yet. Open the repair and press Pay securely.`}`).join('\n') : 'Nothing is due yet. You pay after you choose an engineer’s quote.' }
  }
}

function askNext(it: IntakeState, retry = false): { reply: string; quick: QuickReply[] } {
  const ask = nextAsk(it.slots, it)
  if (!ask) return { reply: '', quick: [] }
  it.asking = ask; const qu = question(ask, it.slots, retry); return { reply: qu.text, quick: qu.quick }
}
function confirmResult(it: IntakeState, state: ChatState, lead = ''): TurnResult {
  it.asking = null
  return result({ reply: `${lead}Here’s what I have:\n${summary(it.slots)}\n\nIf that looks right, I’ll open your repair request pre-filled so you can check it and submit it yourself. Nothing is sent until you do.`, state: { ...state, intake: it },
    quick: [q('Review & submit', 'review and submit'), q('Change something', 'change something'), q('Start over', 'start over')], draft: toDraft(it.slots), ready: true, intent: 'intake_confirm' })
}
const ackLine = (s: Slots) => { const bits = [s.device && DEVICE_LABEL[s.device].toLowerCase(), [s.manufacturer && s.manufacturer !== 'Unknown' ? s.manufacturer : '', s.model].filter(Boolean).join(' ') || '', s.problem && `“${s.problem.length > 60 ? s.problem.slice(0, 57) + '…' : s.problem}”`, s.method && METHOD_LABEL[s.method].toLowerCase(), s.postcode].filter(Boolean); return bits.length ? `Thanks, I’ve noted: ${bits.join(', ')}.` : '' }

function startIntake(text: string, state: ChatState, lead = ''): TurnResult {
  const it = emptyIntake(), { patch } = extract(text, null, {}); Object.assign(it.slots, patch)
  const next = askNext(it)
  if (!next.reply) return confirmResult(it, state, `${ackLine(it.slots)}\n\n`)
  return result({ reply: [lead, ackLine(it.slots), next.reply].filter(Boolean).join('\n\n'), quick: next.quick, state: { ...state, intake: it, choice: undefined }, intent: 'start_repair' })
}

const SLOT_CHANGE_QUICK: QuickReply[] = [q('Device'), q('Make or model'), q('Problem'), q('Service'), q('Postcode'), q('Urgency')].map(x => ({ label: x.label, value: `change ${x.label.toLowerCase()}` }))
const CLEAR: Record<Ask, (s: Slots) => void> = { device: s => { delete s.device }, manufacturer: s => { delete s.manufacturer; delete s.model }, problem: s => { delete s.problem }, method: s => { delete s.method }, postcode: s => { delete s.postcode }, urgency: s => { delete s.urgency } }

async function intakeTurn(text: string, state: ChatState, deps: Deps, table: ReturnType<typeof intentTable>): Promise<TurnResult | null> {
  const it: IntakeState = { ...state.intake!, slots: { ...state.intake!.slots } }, norm = text.trim().toLowerCase()
  if (isRestart(text)) return result({ reply: 'No problem, let’s start again. What needs repairing?', quick: question('device', {}).quick, state: { ...state, intake: { ...emptyIntake(), asking: 'device' } }, intent: 'intake_restart' })
  if (/^review (and|&) submit$/.test(norm) || (isComplete(it.slots) && it.asking === null && isYes(text))) {
    if (!isComplete(it.slots)) return null
    return result({ reply: 'Opening your repair request now. Check the details, then press Submit when you’re happy.', state: { ...state, intake: it }, draft: toDraft(it.slots), ready: true, openForm: true, intent: 'intake_open_form' })
  }
  if (norm === 'change something' || norm === 'change') return result({ reply: 'What would you like to change?', quick: SLOT_CHANGE_QUICK, state: { ...state, intake: { ...it, asking: null } }, intent: 'intake_change' })
  const target = changeTarget(text)
  if (target && !/^change (it|that)$/.test(norm)) { CLEAR[target](it.slots); const qu = question(target, it.slots); it.asking = target; it.retries = 0; return result({ reply: qu.text, quick: qu.quick, state: { ...state, intake: it }, intent: 'intake_change' }) }

  const { patch, understoodAsked } = extract(text, it.asking ?? null, it.slots)
  // A genuine question that is not an answer: answer it from the FAQ (or AI), then carry on exactly where we were.
  const asQuestion = isQuestion(text) && (!understoodAsked || text.trim().split(/\s+/).length >= 8)   // a brand name inside a long question is not an answer
  if (asQuestion) {
    for (const k of ['postcode', 'method', 'urgency'] as const) if (patch[k]) (it.slots as Record<string, unknown>)[k] = patch[k]    // reliable details are kept even when the message was really a question
    const faq = routeFaq(text, table, deps)
    if (faq.kind === 'match') { const out = await answerIntent(faq.id, text, { ...state, intake: it }, deps, table); const again = it.asking ? question(it.asking, it.slots) : null; return { ...out, reply: again ? `${out.reply}\n\nBack to your request: ${again.text}` : out.reply, quick: again ? again.quick : out.quick, state: { ...out.state, intake: it } } }
    return null     // let the caller decide (AI / fallback), then re-ask
  }
  const before = JSON.stringify(it.slots)
  const prevDevice = it.slots.device
  Object.assign(it.slots, patch)
  let note = ''
  if (it.slots.method && !allowedMethods(it.slots.device).includes(it.slots.method)) { note = `${METHOD_LABEL[it.slots.method]} isn’t available for a ${DEVICE_LABEL[it.slots.device!].toLowerCase()}, so I’ve cleared that choice. `; delete it.slots.method }
  const changed = JSON.stringify(it.slots) !== before
  if (!changed && !understoodAsked) {
    it.retries = (it.retries ?? 0) + 1
    if (it.retries >= 3) return result({ reply: `I’m having trouble understanding that. You can start over, or contact our team. ${supportLine(deps.facts)}`, quick: [q('Start over', 'start over'), ...faqQuick(['contact_support'], table.byId)], state: { ...state, intake: it }, escalate: true, intent: 'intake_stuck' })
    const qu = it.asking ? question(it.asking, it.slots, true) : { text: 'What would you like to change?', quick: SLOT_CHANGE_QUICK }
    return result({ reply: qu.text, quick: qu.quick, state: { ...state, intake: it }, intent: 'intake_retry' })
  }
  it.retries = 0
  if (prevDevice && it.slots.device && prevDevice !== it.slots.device && !patch.manufacturer) { /* new device type: keep make unless it clearly no longer applies */ }
  const next = askNext(it)
  if (!next.reply) return confirmResult(it, state, note ? `${note}\n\n` : '')
  return result({ reply: `${note}${next.reply}`, quick: next.quick, state: { ...state, intake: it }, intent: 'intake_step' })
}

function routeFaq(text: string, table: ReturnType<typeof intentTable>, _deps: Deps) {
  let w = weightsCache.get(table.defs); if (!w) { w = buildWeights(table.defs); weightsCache.set(table.defs, w) }
  const extra = (_deps.custom ?? []).flatMap(c => c.questions.flatMap(x => tokens(x)))
  return decide(scoreIntents(text, table.defs, w, extra))
}

async function answerIntent(id: string, text: string, state: ChatState, deps: Deps, table: ReturnType<typeof intentTable>): Promise<TurnResult> {
  const it = table.byId.get(id)!, repeated = state.lastIntent === id, repeat = repeated ? (state.repeat ?? 0) + 1 : 0
  const base: ChatState = { ...state, lastIntent: id, repeat, choice: undefined }
  if (it.action === 'start_intake') return startIntake(text, base)
  if (it.account) return result({ reply: await accountAnswer(it.account, deps), quick: faqQuick(it.quick, table.byId), state: base, intent: id })
  let reply = render(it.answer, deps.facts)
  if (repeated) reply = repeat >= 2 ? `${reply}\n\nIf that doesn’t answer it, our team can help. ${supportLine(deps.facts)}` : `Of course, here it is again.\n\n${reply}`
  const escalate = id === 'contact_support' || id === 'problem_with_repair' || repeat >= 2
  return result({ reply, quick: [...faqQuick(it.quick, table.byId), ...(repeat >= 2 ? faqQuick(['contact_support'], table.byId) : [])].slice(0, 5), state: base, escalate, intent: id })
}

const aiWorthy = (text: string) => { const t = text.trim(); return t.length >= 12 && t.length <= 400 && tokens(t).length >= 3 && !/^[\d\s\W]+$/.test(t) }
const FALLBACK_TEXT: Record<AiReason | 'none', string> = {
  none: GENERIC_NO_MATCH, disabled: GENERIC_NO_MATCH, quota: 'I’ve answered as many open-ended questions as I can for today, but the options below still work.', global: 'I can’t look that up right now, but the options below still work.',
  busy: 'I’m a little busy right now. The options below still work, or our team can help.', timeout: 'That’s taking longer than expected, so I’ve stopped waiting. The options below still work, or our team can help.',
  error: 'I couldn’t look that up just now. The options below still work, or our team can help.', malformed: 'I couldn’t put together a reliable answer to that. The options below still work, or our team can help.', guard: 'I can’t answer that reliably, and I don’t want to guess. The options below still work, or our team can help.',
}
function fallback(state: ChatState, deps: Deps, table: ReturnType<typeof intentTable>, reason: AiReason | 'none'): TurnResult {
  return result({ reply: `${FALLBACK_TEXT[reason]}\n${supportLine(deps.facts)}`, quick: topicQuick(table.byId), state: { ...state, choice: undefined }, escalate: reason !== 'none', source: 'fallback', aiReason: reason === 'none' ? undefined : reason, intent: 'fallback' })
}

/** One conversational turn. `text` is already length-limited by the caller. */
export async function handleTurn(textIn: string, stateIn: ChatState, deps: Deps): Promise<TurnResult> {
  const text = textIn.trim().slice(0, 500), table = intentTable(deps), state: ChatState = { ...stateIn }
  if (!text) return result({ reply: 'What would you like help with?', quick: topicQuick(table.byId), state })
  const norm = text.toLowerCase().replace(/\s+/g, ' ')

  // 1. safety and anger: never debate, always show a person
  if (SAFETY.test(norm)) return result({ reply: `If a device is hot, smoking, sparking, smells of burning or has a swollen battery: switch it off and unplug it if that is safe, move it away from anything flammable, and stop charging or using it. Please don’t open it. ${supportLine(deps.facts)}`, quick: faqQuick(['contact_support', 'start_repair'], table.byId), state, escalate: true, intent: 'safety' })
  if (ANGRY.test(norm)) return result({ reply: `I’m sorry things have gone wrong. A person should look at this. ${supportLine(deps.facts)}`, quick: faqQuick(['contact_support', 'problem_with_repair'], table.byId), state, escalate: true, intent: 'escalation' })

  // 2. quick-reply values and commands
  const faqValue = norm.match(/^faq:([a-z_]+)$/)
  if (faqValue && table.byId.has(faqValue[1])) return answerIntent(faqValue[1], text, state, deps, table)
  if (HELP.test(norm)) return result({ reply: 'I can help with these. Tap one, or just type your question.', quick: topicQuick(table.byId), state, intent: 'help' })
  if (!state.intake?.active && isRestart(text)) return result({ reply: 'Okay. What would you like to do?', quick: topicQuick(table.byId), state: {}, intent: 'restart' })

  // 3. an earlier "did you mean?" question
  if (state.choice?.length) {
    const pick = state.choice.find(id => { const l = table.byId.get(id)?.label.toLowerCase(); return l && (norm === l || norm.includes(l)) })
    if (pick) return answerIntent(pick, text, state, deps, table)
  }

  // 4. active repair intake
  if (state.intake?.active) { const r = await intakeTurn(text, state, deps, table); if (r) return r }

  // 5. FAQ and account intents
  const first = routeFaq(text, table, deps)
  const problemStatement = !isQuestion(text) && (hasSymptom(text) || (!!detectDevice(text) && /\b(my|our|the|i have|i've got|i got)\b/i.test(text)))
  if (first.kind === 'match' && !(problemStatement && first.score < 0.8 && !state.intake?.active)) return answerIntent(first.id, text, state, deps, table)
  if (first.kind === 'ambiguous' && !problemStatement) {
    const ids = first.ids.filter(id => table.byId.has(id))
    return result({ reply: 'Just to check, do you mean one of these?', quick: faqQuick(ids, table.byId), state: { ...state, choice: ids }, intent: 'clarify' })
  }

  // 6. a problem described in plain words starts the guided intake
  if (!state.intake?.active && problemStatement) return startIntake(text, state)

  // 7. the only place AI may be used: an open-ended question the rules can't handle
  const inIntake = !!state.intake?.active
  const allowed = aiWorthy(text) && onTopic(text, table.defs) && (!inIntake || (isQuestion(text) && tokens(text).length >= 4))
  let out: TurnResult
  if (allowed && deps.ai) {
    try {
      const r = await deps.ai(text)
      const aiReply = result({ reply: r.answer, quick: faqQuick(['contact_support', 'start_repair'], table.byId), state: { ...state, choice: undefined }, escalate: !!r.escalate, source: 'ai', intent: 'ai' })
      out = aiReply
    } catch (e) { out = fallback(state, deps, table, e instanceof AiUnavailable ? e.reason : 'error') }
  } else out = fallback(state, deps, table, allowed ? 'disabled' : 'none')
  if (inIntake && state.intake) { const again = state.intake.asking ? question(state.intake.asking, state.intake.slots) : null; if (again) return { ...out, reply: `${out.reply}\n\nBack to your request: ${again.text}`, quick: again.quick, state: { ...out.state, intake: state.intake } } }
  return out
}

export const FAQ_CATALOG = FAQ.map(f => ({ id: f.id, label: f.label, topic: f.topic, answer: f.answer, account: !!f.account }))
export { FAQ_BY_ID, CONFIDENT }
