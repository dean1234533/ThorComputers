import test from 'node:test'
import assert from 'node:assert/strict'
import { handleTurn, AiUnavailable, type ChatFacts, type ChatState, type Deps, type TurnResult, type AiReason } from './chat/engine'
import { FAQ } from './chat/faq'
import { resolveAppUrl, appLinks, DEFAULT_APP_URL } from './app-url'
import { StateSchema } from './chatbot'
import { stripNulls } from './core'
import { engineerRemainingPence, engineerRefundedPence, payoutState } from './stripe'

const facts: ChatFacts = { support: { email: 'help@example.test', phone: '0123 456789', hours: 'Mon–Fri 9–5' }, booking: { cancelNoticeHours: 24, reminderHours: [24, 2] }, categories: ['Laptop', 'Printer'], coverage: { areas: ['London', 'Kent'] }, refundPolicy: 'Refunds follow the engineer terms.', cancellationPolicy: '' }
function harness(over: Partial<Deps> = {}) {
  const c = { ai: 0, account: 0 }
  const deps: Deps = { facts, ai: async () => { c.ai++; return { answer: 'AI ANSWER' } }, account: async () => { c.account++; return { jobs: [{ reference: 'THR-AAA', status: 'open', quoteCount: 2, paid: false }, { reference: 'THR-BBB', status: 'engineer_selected', quoteCount: 1, paid: false, agreedPence: 9500 }], nextAppointment: { reference: 'THR-BBB', startAt: Date.UTC(2026, 9, 20, 9, 0) } } }, ...over }
  const run = async (messages: string[], state: ChatState = {}) => { const out: TurnResult[] = []; for (const m of messages) { const r = await handleTurn(m, state, deps); out.push(r); state = r.state } return out }
  return { deps, c, run, say: async (m: string, state: ChatState = {}) => handleTurn(m, state, deps) }
}

// ---------- routing: phrases, synonyms, misspellings, context ----------
const TABLE: [string, string][] = [
  ['hello', 'greeting'], ['hi there', 'greeting'], ['good morning', 'greeting'], ['thanks', 'thanks'], ['thank you so much', 'thanks'], ['bye', 'bye'],
  ['how much does a repair cost', 'prices'], ['what do you charge', 'prices'], ['is there a call out fee', 'prices'], ['how much for a screen repair', 'prices'], ['whats the price', 'prices'],
  ['how do quotes work', 'quotations'], ['how do i compare quotes', 'quotations'], ['when do quotations expire', 'quotations'], ['how do i pick an engineer', 'quotations'],
  ['how do i book an appointment', 'booking'], ['can i book a time', 'booking'], ['when can the engineer come', 'booking'],
  ['can i reschedule my apointment', 'reschedule'], ['change the time of my booking', 'reschedule'], ['move my appointment to another day', 'reschedule'],
  ['how do i cancel my appointment', 'cancel_appointment'], ['i cant make my booking cancel it', 'cancel_appointment'],
  ['how do i cancel my repair request', 'cancel_repair'], ['i dont want the repair anymore', 'cancel_repair'],
  ['how do i pay', 'payments_how'], ['what payment methods do you accept', 'payments_how'], ['do you take cards', 'payments_how'], ['is payment before or after the repair', 'payments_how'],
  ['is it safe to pay by card', 'payment_security'], ['do you store my card details', 'payment_security'],
  ['my payment failed', 'payment_failed'], ['card was declined', 'payment_failed'], ['checkout error', 'payment_failed'],
  ['can i get a refund', 'refunds'], ['wheres my refnd', 'refunds'], ['i want my money back', 'refunds'], ['refund policy', 'refunds'],
  ['is there a warranty', 'warranty'], ['do you guarantee the repair', 'warranty'], ['what warrenty do i get', 'warranty'],
  ['are the engineers verified', 'engineer_verification'], ['are your enginers qualified', 'engineer_verification'], ['how do you vet engineers', 'engineer_verification'],
  ['will engineers see my address', 'privacy_info'], ['who sees my phone number', 'privacy_info'],
  ['can i message the engineer', 'messaging'], ['how do i contact my engineer', 'messaging'],
  ['what if the engineer wants more money', 'extra_work'], ['unexpected extra charges', 'extra_work'],
  ['i am unhappy with the repair', 'problem_with_repair'], ['the engineer did not turn up', 'problem_with_repair'],
  ['what devices do you repair', 'supported_devices'], ['do you fix printers', 'supported_devices'], ['can you repair macs', 'supported_devices'],
  ['can the engineer come to my house', 'service_methods'], ['do you offer remote repair', 'service_methods'], ['can i bring my laptop to a workshop', 'service_methods'],
  ['do you cover london', 'coverage'], ['what areas do you work in', 'coverage'],
  ['how long will it take', 'how_long'], ['how quickly will i get quotes', 'how_long'],
  ['how does this work', 'how_it_works'], ['what is the process', 'how_it_works'],
  ['i forgot my password', 'password'], ['cannot log in', 'password'],
  ['how do i delete my account', 'account_data'], ['download my data', 'account_data'],
  ['how do i install the app', 'install_app'], ['how do i turn on notifications', 'notifications_help'],
  ['how do i become an engineer', 'engineer_signup'], ['i want to talk to a human', 'contact_support'], ['whats your phone number', 'contact_support'], ['contact support', 'contact_support'],
  ['how do i leave a review', 'reviews'], ['i need it fixed urgently', 'urgent'],
  ['what is the status of my repair', 'acct_status'], ['have i got any quotes', 'acct_quotes'], ['when is my appointment', 'acct_appointment'], ['have i paid', 'acct_payment'],
]
test('routing: ≥75 real-sounding phrases (synonyms, misspellings, filler) reach the right answer with ZERO AI calls', async () => {
  const h = harness(), wrong: string[] = []
  assert.ok(TABLE.length >= 75, `only ${TABLE.length} phrases`)
  for (const [phrase, want] of TABLE) { const r = await h.say(phrase); if (r.intent !== want || r.source !== 'rules') wrong.push(`${phrase} -> ${r.intent}/${r.source} (wanted ${want})`) }
  assert.deepEqual(wrong, []); assert.equal(h.c.ai, 0)
})
test('routing tolerates filler words, politeness and mixed case', async () => {
  const h = harness()
  for (const [m, want] of [['Hi! Could you possibly tell me how much a repair would cost, thanks', 'prices'], ['HELLO, how do I CANCEL my APPOINTMENT please?', 'cancel_appointment'], ['um, so, is the payment safe?', 'payment_security'], ['I was wondering whether the engineers are verified', 'engineer_verification']] as const) assert.equal((await h.say(m)).intent, want, m)
  assert.equal(h.c.ai, 0)
})
test('ambiguous messages ask a clarifying question with buttons instead of guessing; the choice is then answered', async () => {
  const h = harness(), [a, b] = await h.run(['cancel', 'faq:cancel_appointment'])
  assert.equal(a.intent, 'clarify'); assert.ok(a.quick.length >= 2 && a.quick.every(x => x.value.startsWith('faq:'))); assert.equal(b.intent, 'cancel_appointment'); assert.equal(h.c.ai, 0)
  const [x, y] = await h.run(['cancel', 'cancel my repair request']); assert.equal(x.intent, 'clarify'); assert.equal(y.intent, 'cancel_repair')
})
test('quick-reply values route deterministically; unknown values are treated as ordinary text', async () => {
  const h = harness(); assert.equal((await h.say('faq:refunds')).intent, 'refunds'); assert.notEqual((await h.say('faq:does_not_exist')).intent, 'refunds'); assert.equal(h.c.ai, 0)
})
test('greetings, thanks, repeated questions and help are handled without AI; repeats escalate to support politely', async () => {
  const h = harness(), r = await h.run(['hello', 'how do refunds work', 'how do refunds work', 'how do refunds work', 'thanks', 'help'])
  assert.equal(r[0].intent, 'greeting'); assert.equal(r[3].intent, 'refunds'); assert.match(r[2].reply, /here it is again/i); assert.match(r[3].reply, /help@example\.test/); assert.equal(r[3].escalate, true); assert.equal(r[4].intent, 'thanks'); assert.equal(r[5].intent, 'help'); assert.ok(r[5].quick.length >= 5); assert.equal(h.c.ai, 0)
})

// ---------- business facts come from settings, never hard-coded ----------
test('support details, notice periods, coverage and policies are read from settings and change when settings change', async () => {
  const a = await harness().say('how do i contact you'), b = await harness({ facts: { support: { email: 'other@x.test', phone: '999' } } }).say('how do i contact you')
  assert.match(a.reply, /help@example\.test/); assert.match(a.reply, /0123 456789/); assert.match(b.reply, /other@x\.test/); assert.doesNotMatch(b.reply, /help@example\.test/)
  assert.match((await harness().say('how do i cancel my appointment')).reply, /24 hours/); assert.doesNotMatch((await harness({ facts: {} }).say('how do i cancel my appointment')).reply, /hours’ notice/)
  assert.match((await harness().say('do you cover london')).reply, /London, Kent/); assert.match((await harness().say('can i get a refund')).reply, /Refunds follow the engineer terms/)
})
test('with NO settings configured no answer contains placeholders, "undefined" or an invented price/fee/number', async () => {
  const h = harness({ facts: {} })
  for (const f of FAQ.filter(x => !x.account)) { const r = await h.say(`faq:${f.id}`); assert.doesNotMatch(r.reply, /\{\{|\[\[|undefined|null/, f.id); assert.doesNotMatch(r.reply, /£\s?\d|\d+\s?%/, `${f.id} states a number`); assert.ok(r.reply.length > 20, f.id) }
  assert.equal(h.c.ai, 0)
})
test('the answers never promise outcomes: no "guaranteed refund", no fixed prices or times', async () => {
  const h = harness()
  for (const f of FAQ.filter(x => !x.account)) { const r = await h.say(`faq:${f.id}`); assert.doesNotMatch(r.reply, /we (will|guarantee) (refund|fix)|definitely|always cheaper|within \d+ (hours|minutes)/i, f.id) }
})

// ---------- guided repair intake ----------
test('intake: step by step, answers kept between steps, ends in a pre-filled draft, and submission is explicit', async () => {
  const h = harness(), r = await h.run(['my laptop keeps switching off', 'HP Pavilion 15', 'come to my house', 'e15 1aa', 'urgent'])
  assert.equal(r[0].intent, 'start_repair'); assert.match(r[0].reply, /make and model/i); assert.equal(r[0].draft, null)
  assert.match(r[1].reply, /how would you like it repaired/i); assert.ok(r[1].quick.length >= 4)
  assert.match(r[2].reply, /postcode/i); assert.match(r[3].reply, /urgent/i)
  const last = r[4]; assert.equal(last.intent, 'intake_confirm'); assert.equal(last.ready, true); assert.equal(last.openForm, false, 'must not open the form before the customer asks')
  assert.deepEqual(last.draft, { device: 'laptop', manufacturer: 'HP', model: 'Pavilion 15', problem: 'my laptop keeps switching off', serviceMethods: ['home'], postcode: 'E15 1AA', urgency: 'urgent' })
  assert.deepEqual(last.quick.map(q => q.label), ['Review & submit', 'Change something', 'Start over'])
  const go = await h.say('review and submit', last.state); assert.equal(go.openForm, true); assert.match(go.reply, /check the details/i)
  assert.equal(h.c.ai, 0)
})
test('intake: everything in one message goes straight to the summary', async () => {
  const h = harness(), r = await h.say('My HP Pavilion laptop keeps switching off, I am in SW1A 1AA, can someone come to my house? it is urgent')
  assert.equal(r.intent, 'intake_confirm'); assert.equal(r.draft?.postcode, 'SW1A 1AA'); assert.equal(r.draft?.manufacturer, 'HP'); assert.equal(r.draft?.urgency, 'urgent'); assert.deepEqual(r.draft?.serviceMethods, ['home']); assert.equal(h.c.ai, 0)
})
test('intake: misspelt device and symptom words still start it ("laptpo wont turn on")', async () => {
  const r = await harness().say('my laptpo wont turn on'); assert.equal(r.intent, 'start_repair'); assert.match(r.reply, /laptop/i); assert.match(r.reply, /won/i)
})
test('intake: quick-reply taps work as answers, and "don’t know" is accepted for make/model', async () => {
  const h = harness(), r = await h.run(['I need a repair', 'Laptop', 'Don’t know', 'Slow or freezing', 'Remote assistance', 'BR1 1AA', 'Flexible'])
  assert.equal(r[0].intent, 'start_repair'); assert.equal(r[6].intent, 'intake_confirm'); assert.equal(r[6].draft?.manufacturer, undefined); assert.equal(r[6].draft?.device, 'laptop'); assert.deepEqual(r[6].draft?.serviceMethods, ['remote']); assert.equal(h.c.ai, 0)
})
test('intake: methods are limited by device; an unsupported choice is explained and re-asked', async () => {
  const h = harness(), r = await h.run(['my iphone screen is cracked', 'Apple iPhone 13', 'remote assistance'])
  assert.deepEqual(r[2].quick.map(q => q.label).sort(), ['Collection and return', 'Home visit', 'Workshop repair']); assert.match(r[2].reply, /isn’t available for a mobile phone/i)
})
test('intake: an invalid postcode is re-asked with an example, and after three failures a person is offered', async () => {
  const h = harness(), r = await h.run(['my laptop is broken', 'Dell XPS 13', 'workshop', 'nowhere', 'banana', 'still no'])
  assert.match(r[3].reply, /E15 1AA/); assert.equal(r[5].intent, 'intake_stuck'); assert.match(r[5].reply, /help@example\.test/); assert.equal(r[5].escalate, true); assert.ok(r[5].quick.some(q => q.label === 'Start over')); assert.equal(h.c.ai, 0)
})
test('intake: corrections, "change X", "actually it is a Dell", restart', async () => {
  const h = harness(), base = await h.run(['my laptop keeps shutting down, HP Pavilion, workshop, E15 1AA, soon'])
  assert.equal(base[0].intent, 'intake_confirm')
  const ch = await h.say('change postcode', base[0].state); assert.match(ch.reply, /postcode/i); const fixed = await h.say('N1 9GU', ch.state); assert.equal(fixed.draft?.postcode, 'N1 9GU'); assert.equal(fixed.draft?.manufacturer, 'HP')
  const act = await h.say('actually it’s a Dell XPS', fixed.state); assert.equal(act.draft?.manufacturer, 'Dell'); assert.equal(act.draft?.postcode, 'N1 9GU')
  const menu = await h.say('change something', act.state); assert.ok(menu.quick.length === 6)
  const mid = await h.run(['my laptop is slow', 'start over', 'Desktop PC']); assert.match(mid[1].reply, /start again/i); assert.equal(mid[2].state.intake?.slots.device, 'desktop'); assert.equal(mid[2].state.intake?.slots.problem, undefined)
  assert.equal(h.c.ai, 0)
})
test('intake: a question in the middle is answered from the FAQ and the intake carries on exactly where it was, without AI', async () => {
  const h = harness(), r = await h.run(['my laptop keeps switching off', 'HP Pavilion', 'how much will it cost?'])
  assert.equal(r[2].intent, 'prices'); assert.match(r[2].reply, /Back to your request: How would you like it repaired/i); assert.ok(r[2].quick.length >= 4); assert.equal(r[2].state.intake?.slots.manufacturer, 'HP'); assert.equal(h.c.ai, 0)
  const next = await h.say('workshop', r[2].state); assert.match(next.reply, /postcode/i)
})
test('intake: vague answers are re-asked, never sent to AI', async () => {
  const h = harness(), r = await h.run(['I need a repair', 'hmm', 'dunno what to say'])
  assert.equal(r[1].intent, 'intake_retry'); assert.equal(h.c.ai, 0)
})

// ---------- account-specific answers ----------
test('account questions use the caller’s own structured data and only then; other questions never touch it', async () => {
  const h = harness()
  await h.say('how do refunds work'); await h.say('how do i pay'); assert.equal(h.c.account, 0)
  const s = await h.say('what is the status of my repair'), a = await h.say('when is my appointment'), p = await h.say('have i paid'), q = await h.say('have i got any quotes')
  assert.match(s.reply, /THR-AAA: open for quotes, 2 quotes/); assert.match(a.reply, /THR-BBB on .*20 October 2026/); assert.match(p.reply, /THR-BBB: £95\.00 agreed and not paid yet/); assert.match(q.reply, /THR-AAA has 2 quotes/); assert.equal(h.c.account, 4); assert.equal(h.c.ai, 0)
})
test('a customer with nothing yet is told so and offered a repair; an account provider that fails never leaks details', async () => {
  const none = await harness({ account: async () => ({ jobs: [], nextAppointment: null }) }).say('where is my repair'); assert.match(none.reply, /don’t have any repair requests yet/i)
  await assert.rejects(harness({ account: async () => { throw new Error('db down with secret details') } }).say('where is my repair'))
})

// ---------- safety, anger, AI fallback ----------
test('safety and angry messages always show support details and never go to AI', async () => {
  const h = harness(), s = await h.say('there is smoke coming from my laptop battery'), a = await h.say('this is a scam i am going to trading standards')
  assert.equal(s.escalate, true); assert.match(s.reply, /switch it off and unplug/i); assert.match(s.reply, /help@example\.test/); assert.equal(a.escalate, true); assert.match(a.reply, /0123 456789/); assert.equal(h.c.ai, 0)
})
test('AI is used ONLY for an on-topic question the rules cannot answer, exactly once', async () => {
  const h = harness(), r = await h.say('does thor computer work with apple pencil screen protectors on tablets in kent')
  assert.equal(r.source, 'ai'); assert.equal(h.c.ai, 1); assert.equal(r.reply, 'AI ANSWER'); assert.ok(r.quick.length > 0)
})
test('out-of-scope or tiny messages never reach AI: they get a polite menu', async () => {
  const h = harness(); for (const m of ['tell me a joke about cats', 'asdf qwerty zxcv', 'ok', '???', '123456']) { const r = await h.say(m); assert.equal(r.source, 'fallback', m); assert.ok(r.quick.length >= 5, m); assert.match(r.reply, /help@example\.test|thorcomputer\.com/, m) }
  assert.equal(h.c.ai, 0)
})
test('every AI failure mode gives a useful deterministic answer with support details and buttons (never a dead end)', async () => {
  for (const reason of ['disabled', 'quota', 'global', 'busy', 'timeout', 'error', 'malformed', 'guard'] as AiReason[]) {
    const h = harness({ ai: async () => { throw new AiUnavailable(reason) } }), r = await h.say('does thor computer work with apple pencil screen protectors on tablets in kent')
    assert.equal(r.source, 'fallback', reason); assert.equal(r.aiReason, reason); assert.match(r.reply, /help@example\.test/, reason); assert.ok(r.quick.length >= 5, reason); assert.doesNotMatch(r.reply, /rephrase|didn.t catch/i, reason)
  }
})
test('an unexpected (non-AiUnavailable) AI error is also contained', async () => {
  const r = await harness({ ai: async () => { throw new Error('boom') } }).say('does thor computer work with apple pencil screen protectors on tablets in kent'); assert.equal(r.source, 'fallback'); assert.equal(r.aiReason, 'error')
})
test('during intake, AI is allowed only for a real question; the pending step is repeated afterwards', async () => {
  const h = harness(), r = await h.run(['my laptop keeps switching off', 'does thor computer work with apple pencil screen protectors on tablets in kent?'])
  assert.equal(h.c.ai, 1); assert.equal(r[1].source, 'ai'); assert.match(r[1].reply, /Back to your request: Which make and model/i); assert.ok(r[1].state.intake?.slots.problem)
})

// ---------- admin-managed content ----------
test('admins can disable, rewrite and add FAQ entries without code changes', async () => {
  const off = await harness({ overrides: { refunds: { enabled: false } } }).say('can i get a refund'); assert.notEqual(off.intent, 'refunds')
  const re = await harness({ overrides: { warranty: { answer: 'Our custom warranty text for {{supportEmail}}.' } } }).say('is there a warranty'); assert.match(re.reply, /Our custom warranty text for help@example\.test/)
  const cu = await harness({ custom: [{ id: 'custom_opening', questions: ['what are your opening hours', 'when are you open'], answer: 'We answer messages every day.' }] }).say('when are you open'); assert.equal(cu.intent, 'custom_opening'); assert.equal(cu.reply, 'We answer messages every day.')
})

// ---------- app URL and finance helpers (same release) ----------
test('app base URL: one validated origin; dead/invalid values fall back to the deployed app', () => {
  assert.equal(resolveAppUrl(undefined).url, DEFAULT_APP_URL); assert.ok(!DEFAULT_APP_URL.includes('app.thorcomputer.com'))
  assert.deepEqual(resolveAppUrl('https://example.com/'), { url: 'https://example.com', valid: true, problem: '' })
  assert.equal(resolveAppUrl('https://example.com/some/path?x=1').url, 'https://example.com'); assert.match(resolveAppUrl('https://example.com/some/path').problem, /only the origin/)
  assert.equal(resolveAppUrl('http://localhost:5173').url, 'http://localhost:5173')
  for (const bad of ['http://example.com', 'not a url', 'https://user:pw@example.com', 'https://nodots', 'ftp://example.com']) { const r = resolveAppUrl(bad); assert.equal(r.valid, false, bad); assert.equal(r.url, DEFAULT_APP_URL, bad) }
})
test('every link sent to Stripe, Meta or customers is built from the one base', () => {
  const L = appLinks('https://app.example.test')
  assert.equal(L.checkoutSuccess('job1'), 'https://app.example.test/customer/repairs/job1?paid=1'); assert.equal(L.checkoutCancel('job1'), 'https://app.example.test/customer/repairs/job1?paid=0')
  assert.equal(L.onboardingReturn(), 'https://app.example.test/settings?stripe=return'); assert.equal(L.onboardingRefresh(), 'https://app.example.test/settings?stripe=refresh')
  assert.equal(L.metaReturn('meta=connected'), 'https://app.example.test/admin/marketing?meta=connected'); assert.equal(L.continueLink('e1', 't1'), 'https://app.example.test/continue?e=e1&t=t1')
  for (const u of [L.checkoutSuccess('x'), L.onboardingReturn(), L.metaReturn('a=b')]) assert.ok(u.startsWith(resolveAppUrl(undefined, DEFAULT_APP_URL).url) === false)
})
test('finance after refunds: original share vs refunded vs remaining payable; a fully reversed transaction is never "pending"', () => {
  const t = { status: 'paid', payoutStatus: 'pending', engineerSharePence: 85, refundedPence: 0, commissionRefundedPence: 0 }
  assert.deepEqual([engineerRefundedPence(t), engineerRemainingPence(t), payoutState(t)], [0, 85, 'pending'])
  const partial = { ...t, status: 'partially_refunded', refundedPence: 50, commissionRefundedPence: 8 }          // £1 payment, 50p refund: 8p of commission returned, 42p taken from the engineer
  assert.deepEqual([engineerRefundedPence(partial), engineerRemainingPence(partial), payoutState(partial)], [42, 43, 'pending (reduced)'])
  const full = { ...t, status: 'refunded', refundedPence: 100, commissionRefundedPence: 15 }
  assert.deepEqual([engineerRefundedPence(full), engineerRemainingPence(full), payoutState(full)], [85, 0, 'reversed'])
  assert.equal(payoutState({ ...partial, payoutStatus: 'transferred' }), 'transferred (reduced)'); assert.equal(payoutState({ ...t, payoutStatus: 'transferred' }), 'transferred')
  assert.equal(engineerRemainingPence({ ...full, refundedPence: 500 }), 0, 'never negative')
})

test('the conversation state the server returns always passes the schema it is validated with (a mismatch would silently restart every conversation)', async () => {
  const h = harness(); let state: ChatState = {}
  for (const m of ['my laptop keeps switching off', 'HP Pavilion 15', 'come to my house', 'e15 1aa', 'urgent', 'change something', 'change postcode', 'N1 9GU', 'faq:refunds', 'cancel']) {
    const r = await h.say(m, StateSchema.parse(stripNulls(JSON.parse(JSON.stringify(state)))) as ChatState); state = JSON.parse(JSON.stringify(r.state))   // exactly what the callable does: nulls are stripped, then validated
    const parsed = StateSchema.safeParse(stripNulls(state)); assert.ok(parsed.success, `state after "${m}" rejected: ${JSON.stringify((parsed as any).error?.issues)}`)
  }
})
