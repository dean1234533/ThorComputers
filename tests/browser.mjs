// Real-browser check of the web app against the LOCAL emulators (headless Chrome via puppeteer-core).
// Run with `npm run test:browser` from the repo root. Signs in through the actual UI as each seeded role, visits every route,
// and records console errors, uncaught exceptions, failed requests and any network traffic that leaves localhost.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { createRequire } from 'node:module'

const WEB = 'http://127.0.0.1:5173'
const SHOTS = process.env.SHOT_DIR
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
for (const k of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) if (!/^(127\.0\.0\.1|localhost)/.test(process.env[k] ?? '')) { console.error(`Refusing to run: ${k} is not local.`); process.exit(2) }

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const base = join(homedir(), '.cache/puppeteer/chrome')
  if (existsSync(base)) for (const v of readdirSync(base).sort().reverse()) {
    const p = join(base, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'); if (existsSync(p)) return p
  }
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']) if (existsSync(p)) return p
  throw new Error('No Chrome found. Set CHROME_PATH.')
}

// ---------- seed + dev server ----------
execFileSync('node', ['../scripts/seed.mjs'], { stdio: 'inherit' })
const vite = spawn('npm', ['--prefix', '../web', 'run', 'dev:emulator'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, detached: true })
let viteLog = ''; vite.stdout.on('data', d => viteLog += d); vite.stderr.on('data', d => viteLog += d)
const stopVite = () => { try { process.kill(-vite.pid) } catch { vite.kill() } }
process.on('exit', () => vite.kill())
for (let i = 0; i < 60; i++) { try { if ((await fetch(WEB)).ok) break } catch { /* wait */ } await new Promise(r => setTimeout(r, 500)); if (i === 59) { console.error('vite did not start\n' + viteLog); process.exit(1) } }

// ---------- harness ----------
const results = []; const problems = []
const step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name}`) } catch (e) { results.push({ name, ok: false, err: e }); console.log(`  ✖ ${name}\n      ${String(e.message).split('\n')[0]}`) } }
const ok = (v, m) => { if (!v) throw new Error(m ?? 'assertion failed') }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ALLOWED_EXTERNAL = /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/   // web fonts only; no Google APIs / Firebase production hosts
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox'] })

async function newSession(label, mobile = true) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage()
  if (mobile) await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  else await page.setViewport({ width: 1280, height: 800 })
  const s = { label, ctx, page, logs: [], errors: [], external: new Set(), lines: [] }
  page.on('console', m => {
    const t = m.text(); s.lines.push(`[${m.type()}] ${t}`)
    // Expected, benign: the browser logs every non-2xx fetch (e.g. rules-denied reads we assert on) as a console error line; and offline-persistence/SW notes.
    if (m.type() === 'error' && !/Failed to load resource/.test(t)) s.errors.push(t)
  })
  page.on('response', async r => { if (r.status() >= 400 && r.url().includes('/europe-west2/')) s.lines.push(`[callable ${r.status()}] ${r.url().split('/').pop()} ${(await r.text().catch(() => '')).slice(0, 300)}`) })
  page.on('pageerror', e => s.errors.push('UNCAUGHT: ' + e.message))
  page.on('requestfailed', r => { if (!/favicon|\.map$|ERR_ABORTED/.test(r.url() + (r.failure()?.errorText ?? ''))) s.errors.push(`REQUEST FAILED ${r.url()} ${r.failure()?.errorText}`) })
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http') && !ALLOWED_EXTERNAL.test(u.hostname)) s.external.add(u.hostname) })
  return s
}
async function fillLabel(page, label, value) {
  // steps animate in (AnimatePresence mode="wait"), so wait for the field to exist
  await page.waitForFunction(t => [...document.querySelectorAll('label')].some(x => x.textContent.trim().toLowerCase().startsWith(t.toLowerCase())), { timeout: 8000 }, label).catch(() => {})
  const h = await page.evaluateHandle(t => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim().toLowerCase().startsWith(t.toLowerCase())); return l ? (l.querySelector('input,textarea') ?? document.getElementById(l.htmlFor)) : null }, label)
  const el = h.asElement(); if (!el) throw new Error(`no field labelled "${label}"`); await el.click({ clickCount: 3 }); await el.type(value)
}
async function clickText(page, text, sel = 'button, a, [role=radio], [role=checkbox]') {
  await page.waitForFunction((t, s) => [...document.querySelectorAll(s)].some(x => x.getClientRects().length && (x.textContent.trim().toLowerCase().includes(t.toLowerCase()) || x.getAttribute('aria-label')?.toLowerCase() === t.toLowerCase())), { timeout: 8000 }, text, sel).catch(() => {})
  const h = await page.evaluateHandle((t, s) => [...document.querySelectorAll(s)].find(x => x.getClientRects().length && (x.textContent.trim().toLowerCase().includes(t.toLowerCase()) || x.getAttribute('aria-label')?.toLowerCase() === t.toLowerCase())), text, sel)
  const el = h.asElement(); if (!el) throw new Error(`no clickable "${text}"`); await el.click()
}
const bodyText = page => page.evaluate(() => document.body.innerText)
async function settle(page, ms = 1200) { await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {}); await sleep(ms) }
async function login(s, email) {
  const { page } = s
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('input[type=email]')
  await fillLabel(page, 'Email', email); await fillLabel(page, 'Password', 'Passw0rd!demo'); await clickText(page, 'Sign in', 'button[type=submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 }); await settle(page)
}
async function visit(s, path, { expectPath, mustContain, mustNot = [] } = {}) {
  const before = s.errors.length
  await s.page.goto(WEB + path, { waitUntil: 'domcontentloaded' }); await settle(s.page, 1500)
  const url = new URL(s.page.url()).pathname, txt = await bodyText(s.page)
  if (expectPath ? url !== expectPath : url !== path.split('?')[0].replace(/\/$/, '') && !(path === '/messages' && url.startsWith('/messages'))) throw new Error(`${path} ended at ${url}`)
  if (/Something went wrong/.test(txt)) throw new Error(`${path} hit the error boundary`)
  if (txt.trim().length < 40) throw new Error(`${path} rendered almost nothing`)
  if (mustContain && !txt.includes(mustContain)) throw new Error(`${path} missing text "${mustContain}"`)
  for (const m of mustNot) if (txt.includes(m)) throw new Error(`${path} unexpectedly shows "${m}"`)
  if (SHOTS) await s.page.screenshot({ path: join(SHOTS, `${s.label}${path.replace(/[^\w]+/g, '_')}.png`) })
  const fresh = s.errors.slice(before); if (fresh.length) throw new Error(`${path} console errors: ${fresh[0].slice(0, 200)}`)
}

console.log('Thor Computer browser check (headless Chrome, emulators only)\n')

console.log('Public screens + emulator wiring')
const pub = await newSession('public')
await step('login page renders and reports it is using the local emulators', async () => {
  await pub.page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' }); await settle(pub.page)
  ok(pub.lines.some(l => l.includes('using LOCAL EMULATORS') && l.includes('demo-thor')), 'emulator banner not logged; app may be pointing at a real project')
  ok(!(await bodyText(pub.page)).includes('isn’t configured'), 'app shows the Firebase-not-configured warning')
})
for (const p of ['/register', '/forgot', '/install', '/privacy']) await step(`public ${p} renders without console errors`, () => visit(pub, p))
await step('signed-out visit to a protected route redirects to /login', () => visit(pub, '/customer', { expectPath: '/login' }))
await step('bad password shows a friendly error and stays on /login', async () => {
  await pub.page.goto(`${WEB}/login`); await pub.page.waitForSelector('input[type=email]')
  await fillLabel(pub.page, 'Email', 'customer@demo.test'); await fillLabel(pub.page, 'Password', 'wrong-password-1'); await clickText(pub.page, 'Sign in', 'button[type=submit]')
  await pub.page.waitForFunction(() => document.body.innerText.includes('Incorrect email or password'), { timeout: 10000 })
})

await step('privacy page keeps its "Draft for legal review" notice until the owner publishes an approved policy', async () => { await visit(pub, '/privacy', { mustContain: 'Draft for legal review' }) })

console.log('\nCustomer')
const cust = await newSession('customer')
await step('customer signs in through the UI and lands on /customer', async () => { await login(cust, 'customer@demo.test'); ok(new URL(cust.page.url()).pathname === '/customer', cust.page.url()) })
for (const p of ['/customer', '/customer/repairs', '/customer/quotations', '/customer/appointments', '/messages', '/notifications', '/profile', '/settings'])
  await step(`customer ${p}`, () => visit(cust, p))
await step('customer sees the seeded repair and its quote on the repair detail page', async () => {
  await visit(cust, '/customer/repairs/demo-job-open'); const t = await bodyText(cust.page)
  ok(/THR-DEMO01|XPS 13/.test(t), 'seeded repair not shown'); ok(/115\.00|£115/.test(t), 'seeded quote total (£115.00) not shown')
})
await step('customer is bounced away from engineer and admin areas', async () => { await visit(cust, '/admin', { expectPath: '/customer' }); await visit(cust, '/engineer/jobs', { expectPath: '/customer' }) })
await step('customer completes the request wizard in the UI and the job appears', async () => {
  await visit(cust, '/customer/new-request')
  await clickText(cust.page, 'Laptop', '[role=radio]'); await clickText(cust.page, 'Continue')
  await fillLabel(cust.page, 'Manufacturer', 'Lenovo'); await fillLabel(cust.page, 'Model', 'ThinkPad T14'); await clickText(cust.page, 'Continue')
  await fillLabel(cust.page, 'Describe', 'Keyboard stopped responding after a Windows update.'); await clickText(cust.page, 'Continue')
  await clickText(cust.page, 'Home visit', '[role=checkbox]').catch(() => clickText(cust.page, 'home', '[role=checkbox]')); await clickText(cust.page, 'Continue')
  await clickText(cust.page, 'Continue')   // postcode prefilled from the profile
  // A server failure must leave a PERSISTENT, actionable message (a toast alone vanishes), keep the draft, and a retry must work. The first callable POST is forced to fail with
  // the reference message the backend now returns for unexpected errors.
  let failOnce = true; await cust.page.setRequestInterception(true)
  cust.page.on('request', r => {
    if (r.isInterceptResolutionHandled()) return
    if (failOnce && r.method() === 'POST' && r.url().includes('/createRepairRequest')) { failOnce = false; r.respond({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: 'Something went wrong on our side (ref EA1B2C3).', status: 'INTERNAL' } }) }) }
    else r.continue()
  })
  await clickText(cust.page, 'Submit request')
  await cust.page.waitForFunction(() => [...document.querySelectorAll('[role=alert]')].some(e => e.textContent.includes('EA1B2C3')), { timeout: 10000 })
  await sleep(6500)                                   // longer than any toast
  const persistentAlerts = await cust.page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map(e => e.textContent ?? ''))
  ok(persistentAlerts.some(t => t.includes('Your request wasn’t sent') && t.includes('EA1B2C3')), `error banner disappeared: ${JSON.stringify(persistentAlerts)}; page: ${(await bodyText(cust.page)).slice(-700)}`)
  ok(!(await bodyText(cust.page)).includes('Request submitted'), 'a failed submission must not look successful')
  const cover = await cust.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /submit request/i.test(x.textContent)); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e === b || b.contains(e) ? null : `${e?.tagName}: ${(e?.textContent || '').slice(0, 50)}` })
  ok(!cover, `something covers the Submit button on mobile: ${cover}`)   // regression: the notification prompt used to sit on top of it
  await clickText(cust.page, 'Submit request')        // same draft, same idempotency key
  await cust.page.waitForFunction(() => document.body.innerText.includes('Request submitted'), { timeout: 20000 }).catch(async e => { throw new Error(`${e.message} | page says: ${(await bodyText(cust.page)).replace(/\s+/g, ' ').slice(0, 400)} | console: ${cust.lines.filter(l => l.includes('callable')).join(' // ').slice(0, 400)}`) })
  await visit(cust, '/customer/repairs'); ok((await bodyText(cust.page)).includes('ThinkPad'), 'new job not listed')
})
const dismissPrompts = async page => { for (const t of ['Maybe later', 'Not now']) await clickText(page, t, 'button').catch(() => {}) }
const chatSay = async (s, label) => { await clickText(s.page, label, 'button'); await sleep(900) }
const panelRect = page => page.evaluate(() => { const r = document.querySelector('[role=dialog][aria-label="Thor Computer assistant"]')?.getBoundingClientRect(); return r ? { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth } : null })
await step('assistant (mobile 390px): guided intake by tapping and typing, no AI needed, ends in a pre-filled request the customer still has to submit', async () => {
  await visit(cust, '/customer'); await dismissPrompts(cust.page); await clickText(cust.page, 'Open assistant', 'button'); await sleep(500)
  const r0 = await panelRect(cust.page); ok(r0 && r0.left >= 0 && r0.right <= r0.vw && r0.sw <= r0.vw, `chat panel overflows the mobile screen: ${JSON.stringify(r0)}`)
  await chatSay(cust, 'Request a repair'); await cust.page.waitForFunction(() => document.body.innerText.includes('What needs repairing'), { timeout: 8000 })
  await chatSay(cust, 'Laptop'); await cust.page.waitForFunction(() => document.body.innerText.includes('make and model'), { timeout: 8000 })
  await chatSay(cust, 'HP'); await cust.page.waitForFunction(() => document.body.innerText.includes('What’s it doing'), { timeout: 8000 })
  await chatSay(cust, 'Slow or freezing'); await cust.page.waitForFunction(() => document.body.innerText.includes('How would you like it repaired'), { timeout: 8000 })
  await chatSay(cust, 'Home visit'); await cust.page.waitForFunction(() => document.body.innerText.includes('postcode'), { timeout: 8000 })
  await cust.page.type('input[aria-label=Message]', 'e15 1aa'); await cust.page.keyboard.press('Enter'); await cust.page.waitForFunction(() => document.body.innerText.includes('How urgent'), { timeout: 8000 })
  await chatSay(cust, 'Urgent'); await cust.page.waitForFunction(() => document.body.innerText.includes('Here’s what I have'), { timeout: 8000 })
  const t = await bodyText(cust.page); ok(/Device: Laptop \(HP\)/.test(t) && /Postcode: E15 1AA/.test(t) && /Urgency: Urgent/.test(t), 'summary is wrong: ' + t.slice(-400)); ok(!/Request submitted/.test(t))
  await chatSay(cust, 'Review & submit'); await cust.page.waitForFunction(() => location.pathname === '/customer/new-request', { timeout: 10000 })
  const draft = JSON.parse(await cust.page.evaluate(() => sessionStorage.getItem('thor.request.draft') ?? '{}'))
  ok(draft.device === 'laptop' && draft.manufacturer === 'HP' && draft.postcode === 'E15 1AA' && draft.urgency === 'urgent' && draft.methods?.includes('home') && /slow/i.test(draft.description), 'the request form was not pre-filled: ' + JSON.stringify(draft))
  ok(!(await bodyText(cust.page)).includes('Request submitted'), 'the assistant must not submit for the customer')
  ok(!(await cust.page.evaluate(() => !!document.querySelector('[aria-label="Open assistant"]'))), 'the chat button must not sit on top of the request form’s Continue button')
})
await step('assistant: FAQ answers, buttons, restart and the support route all work without any AI', async () => {
  await visit(cust, '/customer'); await dismissPrompts(cust.page); await clickText(cust.page, 'Open assistant', 'button'); await sleep(400)
  await cust.page.type('input[aria-label=Message]', 'how do i cancel my appointment'); await cust.page.keyboard.press('Enter'); await cust.page.waitForFunction(() => /Cancel on the booking/.test(document.body.innerText), { timeout: 8000 })
  await cust.page.type('input[aria-label=Message]', 'i want to talk to a human'); await cust.page.keyboard.press('Enter'); await cust.page.waitForFunction(() => /Talk to a person/.test(document.body.innerText), { timeout: 8000 })
  await clickText(cust.page, 'Start over', 'button'); await sleep(400); ok(!/Cancel on the booking/.test(await bodyText(cust.page)), 'restart did not clear the conversation')
})
await step('assistant (desktop 1280px): panel sits inside the window and the page does not scroll sideways', async () => {
  const d = await newSession('chatdesk', false); await login(d, 'customer@demo.test'); await visit(d, '/customer'); await dismissPrompts(d.page); await clickText(d.page, 'Open assistant', 'button'); await sleep(500)
  const r = await panelRect(d.page); ok(r && r.left >= 0 && r.right <= r.vw && r.top >= 0 && r.bottom <= r.vh && r.sw <= r.vw && r.right - r.left <= 440, JSON.stringify(r)); await d.ctx.close()
})
await step('customer signs out cleanly (mobile: via the More sheet)', async () => { await clickText(cust.page, 'More'); await sleep(600); await clickText(cust.page, 'Sign out'); await cust.page.waitForFunction(() => location.pathname === '/login', { timeout: 10000 }) })


console.log('\nLayout: repair page with booking strip, payment panel and progress sidebar')
const adminRequire = createRequire(new URL('../functions/', import.meta.url)); process.env.GCLOUD_PROJECT = 'demo-thor'
const { initializeApp: adminInit } = adminRequire('firebase-admin/app'), { getAuth: adminAuth } = adminRequire('firebase-admin/auth'), { getFirestore: adminDb, FieldValue: FV, Timestamp: TS } = adminRequire('firebase-admin/firestore')
const layoutApp = adminInit({ projectId: 'demo-thor' }, 'layout')
const layoutCustomer = await adminAuth(layoutApp).getUserByEmail('customer@demo.test')
const LAYOUT_JOB = `${layoutCustomer.uid}_layout-photo`
const LAYOUT_PHOTO = `requests/${layoutCustomer.uid}/layout-photo/photo.png`
await step('set up a repair in the "engineer selected" state (booking strip + unpaid payment + progress sidebar)', async () => {
  const au = adminAuth(layoutApp), db = adminDb(layoutApp), c = await au.getUserByEmail('customer@demo.test'), e = await au.getUserByEmail('engineer@demo.test'), qid = `${LAYOUT_JOB}_${e.uid}`
  await db.doc(`repairRequests/${LAYOUT_JOB}`).set({ reference: 'THR-LAYOUT1', customerId: c.uid, status: 'engineer_selected', selectedEngineerId: e.uid, acceptedQuoteId: qid, agreedTotalPence: 11500, agreedMethod: 'workshop', commissionBps: 1500, paymentStatus: 'unpaid', provider: 'independent',
    device: { type: 'laptop', manufacturer: 'Dell', model: 'XPS 13', os: '' }, issues: [], summary: 'Layout fixture', description: 'Layout test fixture: a repair waiting to be paid and booked.', urgency: 'flexible', serviceMethods: ['workshop'], requiredSpecs: ['laptop'], photoPaths: [LAYOUT_PHOTO], preferredDates: [],
    location: { area: 'Bromley · BR1', outcode: 'BR1', lat: 51.4, lng: 0 }, quoteCount: 1, source: 'app', statusHistory: [{ status: 'engineer_selected', at: TS.now(), by: c.uid }], createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() })
  await adminRequire('firebase-admin/storage').getStorage(layoutApp).bucket('demo-thor.appspot.com').file(LAYOUT_PHOTO).save(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII=', 'base64'), { contentType: 'image/png' })
  await db.doc(`repairRequests/${LAYOUT_JOB}/private/details`).set({ postcode: 'BR1 1AA', addressLine: '', accessNotes: '', serialNumber: '' })
  await db.doc(`repairQuotes/${qid}`).set({ jobId: LAYOUT_JOB, engineerId: e.uid, customerId: c.uid, repairPence: 8000, diagnosticPence: 1500, calloutPence: 2000, totalPence: 11500, currency: 'GBP', durationHours: 1, availability: 'This week', partsIncluded: false, partsNote: '', warranty: '30 days', notes: '', serviceMethod: 'workshop', provider: 'independent', status: 'accepted', version: 1, expiresAt: TS.fromMillis(Date.now() + 7 * 86400000), createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() })
})
const lay = await newSession('layout', true)
await login(lay, 'customer@demo.test')
const measure = page => page.evaluate(() => {
  const vw = innerWidth, aside = document.querySelector('#main-content aside'), pay = [...document.querySelectorAll('button')].find(b => /pay securely/i.test(b.textContent)), strip = document.querySelector('[role=listbox][aria-label="Choose a day"]')
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) } }
  const wide = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !el.closest('[role=listbox]') && getComputedStyle(el).position !== 'fixed' }).slice(0, 5).map(el => `${el.tagName}.${String(el.className).slice(0, 50)}`)
  const pr = pay?.getBoundingClientRect(), hit = pr && document.elementFromPoint(pr.x + pr.width / 2, pr.y + pr.height / 2)
  return { vw, vh: innerHeight, payHit: !!pay && (hit === pay || pay.contains(hit)), scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, aside: rect(aside), pay: rect(pay), strip: strip ? { client: strip.clientWidth, scroll: strip.scrollWidth, ...rect(strip) } : null, wide }
})
for (const [label, mobile, width] of [['mobile 390px', true, 390], ['desktop 1280px', false, 1280]]) {
  await step(`repair page at ${label}: no sideways page scroll, day strip scrolls inside itself, payment action and progress sidebar fully inside the window`, async () => {
    await lay.page.setViewport(mobile ? { width, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width, height: 800 })
    await lay.page.goto(`${WEB}/customer/repairs/${LAYOUT_JOB}`, { waitUntil: 'domcontentloaded' }); await settle(lay.page, 2500); await dismissPrompts(lay.page)
    await lay.page.waitForFunction(() => document.querySelector('[role=listbox][aria-label="Choose a day"]'), { timeout: 10000 })
    await lay.page.waitForFunction(() => [...document.querySelectorAll('img[src^="blob:"]')].some(i => i.complete && i.naturalWidth > 0), { timeout: 10000 })
    if (SHOTS) await lay.page.screenshot({ path: join(SHOTS, `layout-repair-${width}.png`), fullPage: true })
    await lay.page.evaluate(() => [...document.querySelectorAll('button')].find(b => /pay securely/i.test(b.textContent))?.scrollIntoView({ block: 'center' }))
    const m = await measure(lay.page); lay.measures = { ...(lay.measures ?? {}), [width]: m }
    ok(m.scrollWidth <= m.clientWidth + 1, `page scrolls sideways: scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth}; widest: ${m.wide.join(', ')}`)
    ok(m.strip && m.strip.right <= m.vw + 1 && m.strip.scroll > m.strip.client, `the day strip must fit the screen and scroll inside itself: ${JSON.stringify(m.strip)}`)
    ok(m.pay && m.pay.left >= 0 && m.pay.right <= m.vw && m.pay.w > 80, `Pay securely is not fully visible: ${JSON.stringify(m.pay)}`)
    ok(m.payHit && m.pay.top >= 0 && m.pay.bottom <= m.vh, `payment action is covered: ${JSON.stringify(m.pay)}`)
    ok(m.aside && m.aside.w > 0 && m.aside.left >= 0 && m.aside.right <= m.vw, `progress sidebar is clipped: ${JSON.stringify(m.aside)}`)
  })
  await step(`chat assistant stays inside the window on the repair page at ${label}, and its controls remain usable`, async () => {
    await clickText(lay.page, 'Open assistant', 'button'); await sleep(500); const r = await panelRect(lay.page)
    ok(r && r.left >= 0 && r.right <= r.vw && r.top >= 0 && r.bottom <= r.vh && r.sw <= r.vw + 1, `chat panel outside the window: ${JSON.stringify(r)}`)
    await lay.page.type('input[aria-label=Message]', 'how do i pay'); await lay.page.keyboard.press('Enter'); await lay.page.waitForFunction(() => { const panel = document.querySelector('[role=dialog][aria-label="Thor Computer assistant"]'); return panel && /Stripe/.test(panel.innerText) && !/Working on it|Still working on it/.test(panel.innerText) }, { timeout: 10000 })
    if (SHOTS) await lay.page.screenshot({ path: join(SHOTS, `layout-chat-${width}.png`) })
    await clickText(lay.page, 'Close assistant', 'button')
  })
}
if (SHOTS) writeFileSync(join(SHOTS, 'layout-measurements.json'), JSON.stringify(lay.measures, null, 2))
console.log('\nEngineer')
const eng = await newSession('engineer')
await step('approved engineer signs in and lands on /engineer', async () => { await login(eng, 'engineer@demo.test'); ok(new URL(eng.page.url()).pathname === '/engineer', eng.page.url()) })
for (const p of ['/engineer', '/engineer/jobs', '/engineer/quotations', '/engineer/my-jobs', '/engineer/appointments', '/engineer/reviews', '/engineer/profile', '/messages', '/notifications', '/settings'])
  await step(`engineer ${p}`, () => visit(eng, p))
await step('engineer sees the open job but NOT the exact address or serial', async () => {
  await visit(eng, '/engineer/jobs/demo-job-open'); const t = await bodyText(eng.page)
  ok(/XPS 13|laptop/i.test(t), 'job not shown'); ok(!/1 Demo Road|DEMO123/.test(t), 'exact address or serial leaked to a bidding engineer')
})
await step('request photos: bidders see a privacy notice; selected engineers receive authenticated image blobs', async () => {
  const db = adminDb(layoutApp), engineer = await adminAuth(layoutApp).getUserByEmail('engineer@demo.test')
  await db.doc(`repairRequests/${LAYOUT_JOB}`).update({ status: 'open', selectedEngineerId: null })
  await visit(eng, `/engineer/jobs/${LAYOUT_JOB}`, { mustContain: 'The customer has attached photos' })
  ok(await eng.page.evaluate(() => !document.querySelector('img[src^="blob:"]')), 'bidder received photo bytes')
  if (SHOTS) await eng.page.screenshot({ path: join(SHOTS, 'photos-bidder-private.png') })
  await db.doc(`repairRequests/${LAYOUT_JOB}`).update({ status: 'engineer_selected', selectedEngineerId: engineer.uid })
  await eng.page.goto(`${WEB}/engineer/my-jobs/${LAYOUT_JOB}`, { waitUntil: 'domcontentloaded' })
  await eng.page.waitForFunction(() => [...document.querySelectorAll('img[src^="blob:"]')].some(i => i.complete && i.naturalWidth > 0), { timeout: 10000 })
  if (SHOTS) await eng.page.screenshot({ path: join(SHOTS, 'photos-selected-visible.png') })
})
await step('engineer is bounced from customer/admin areas', async () => { await visit(eng, '/customer', { expectPath: '/engineer' }); await visit(eng, '/admin/settings', { expectPath: '/engineer' }) })
const pend = await newSession('pending-engineer')
await step('unapproved engineer can reach onboarding but sees no available jobs', async () => {
  await login(pend, 'pending-engineer@demo.test'); await visit(pend, '/engineer/profile'); await visit(pend, '/engineer/jobs')
  ok(!(await bodyText(pend.page)).includes('XPS 13'), 'unapproved engineer can see open jobs')
})
await step('unapproved engineer sees WHY availability is unavailable instead of an editor that cannot save', async () => {
  await visit(pend, '/engineer/appointments', { mustContain: 'Available once you’re approved' })
  ok(!(await pend.page.evaluate(() => [...document.querySelectorAll('button')].some(b => /save availability/i.test(b.textContent)))), 'a Save availability button is shown to an unapproved engineer')
})

console.log('\nAdmin (super admin) and support admin')
const adm = await newSession('superadmin', false)
await step('super admin signs in and lands on /admin', async () => { await login(adm, 'superadmin@demo.test'); ok(new URL(adm.page.url()).pathname === '/admin', adm.page.url()) })
for (const p of ['/admin', '/admin/approvals', '/admin/customers', '/admin/engineers', '/admin/jobs', '/admin/quotations', '/admin/appointments', '/admin/reviews', '/admin/reports', '/admin/leads', '/admin/marketing', '/admin/finance', '/admin/settings', '/notifications', '/settings'])
  await step(`super admin ${p}`, () => visit(adm, p))
await step('admin overview lists new repair requests live, with source and status', async () => {
  await visit(adm, '/admin', { mustContain: 'New repair requests' }); const t = await bodyText(adm.page); ok(/THR-DEMO01|XPS 13|ThinkPad/.test(t), 'no incoming jobs shown on the overview')
})
await step('finance page separates original engineer share, refunded amounts and remaining payable', async () => { await visit(adm, '/admin/finance', { mustContain: 'Remaining payable to engineers' }); const t = await bodyText(adm.page); ok(/Engineer share \(original\)/.test(t) && /Refunded from engineers/.test(t) && /Awaiting payout \(after refunds\)/.test(t)) })
await step('marketing page: the connection check reports honestly (nothing connected ⇒ never "working")', async () => {
  await visit(adm, '/admin/marketing', { mustContain: 'View incoming leads' }); await clickText(adm.page, 'Connection', 'nav[aria-label="Marketing sections"] button'); await clickText(adm.page, 'Run connection check', 'button')
  await adm.page.waitForFunction(() => /Lead import NOT verified yet/.test(document.body.innerText), { timeout: 15000 }); const t = await bodyText(adm.page)
  ok(/no Meta account is connected|required settings are missing/.test(t), t.slice(0, 600)); ok(!/Set up correctly/.test(t), 'claimed to be set up while nothing is connected'); await clickText(adm.page, 'View connection checks', 'summary'); ok(/What to do:/.test(await bodyText(adm.page)), 'no remedy shown')
})
await step('settings: assistant FAQ/limits/metrics editor and the legal publishing form are present', async () => {
  await visit(adm, '/admin/settings', { mustContain: 'Assistant (guided answers + AI fallback)' }); const t = await bodyText(adm.page)
  ok(/AI answers per customer per day/.test(t) && /spending cap/.test(t) && /Legal: privacy policy and business details/.test(t) && /Publish approved policy/.test(t), 'settings sections missing')
  await clickText(adm.page, 'Edit FAQ answers', 'button'); await adm.page.waitForFunction(() => /Cancelling an appointment/.test(document.body.innerText), { timeout: 8000 })
})
await step('mobile admin navigation stays aligned at 320px and 390px', async () => {
  await visit(adm, '/admin')
  for (const width of [320, 390]) {
    await adm.page.setViewport({ width, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    // Changing the mobile emulation can reload the page; wait for auth and the shell again.
    await adm.page.waitForSelector('.mobile-tab')
    const layout = await adm.page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.mobile-tab')]
      return { overflow: document.documentElement.scrollWidth > innerWidth, heights: tabs.map(t => t.getBoundingClientRect().height), labelsFit: tabs.every(t => { const l = t.querySelector('.tab-label'); return l.scrollWidth <= t.clientWidth }), requests: tabs.some(t => t.textContent === 'Requests') }
    })
    ok(!layout.overflow, `horizontal overflow at ${width}px`)
    ok(layout.heights.length === 5 && layout.heights.every(h => h === 64), 'tabs must have equal heights')
    ok(layout.labelsFit && layout.requests, 'mobile labels must fit on one line')
  }
  if (SHOTS) await adm.page.screenshot({ path: join(SHOTS, 'admin-mobile-overview.png') })
  await adm.page.setViewport({ width: 1280, height: 800 })
})
await step('admin is bounced from customer/engineer areas', async () => { await visit(adm, '/customer', { expectPath: '/admin' }) })
const sup = await newSession('support', false)
await step('support admin signs in; settings page does not crash', async () => { await login(sup, 'support@demo.test'); await visit(sup, '/admin'); await visit(sup, '/admin/customers'); await visit(sup, '/admin/settings') })
await step('support admin sees no Finance, Marketing or Leads (menu hidden and pages refuse)', async () => {
  const t = await bodyText(sup.page); ok(!/Finance|Incoming Leads|Marketing/.test(t), 'support admin can see money/marketing menu items')
  await visit(sup, '/admin/finance', { mustContain: 'No access' }); await visit(sup, '/admin/marketing', { mustContain: 'No access' }); await visit(sup, '/admin/leads', { mustContain: 'No access' })
})

console.log('\nAdmin MFA guard (status response simulated; the emulator cannot do TOTP)')
async function mfaSession(label, mode, sessionHasSecondFactor = false) {
  const m = await newSession(label, false); await m.page.setRequestInterception(true)
  const cors = { 'access-control-allow-origin': WEB, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
  m.page.on('request', r => {
    if (!r.url().includes('/adminMfaStatus')) return r.continue()
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors })
    r.respond({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ result: { mode, sessionHasSecondFactor, enrolledFactors: 0, admins: [{ uid: 'a', email: 'superadmin@demo.test', enrolledFactors: 0 }, { uid: 'b', email: 'admin@demo.test', enrolledFactors: 1 }] } }) })
  })
  return m
}
const enf = await mfaSession('mfa-enforced', 'enforce')
await step('ENFORCE + not enrolled: admin is redirected to /admin/security, never into a wall of errors', async () => {
  await login(enf, 'superadmin@demo.test'); await visit(enf, '/admin', { expectPath: '/admin/security', mustContain: 'Two-step verification is required' }); await visit(enf, '/admin/jobs', { expectPath: '/admin/security' })
})
await step('ENFORCE: security page offers enrolment and the readiness table; non-admin pages still reachable; can sign out', async () => {
  await visit(enf, '/admin/security', { mustContain: 'Set up authenticator app' }); const t = await bodyText(enf.page); ok(/Not set up/.test(t) && /Everyone has set up|still need to set up/i.test(t), 'readiness table missing')
  await visit(enf, '/settings'); await visit(enf, '/notifications')
  await enf.page.goto(`${WEB}/admin/security`); await settle(enf.page); await clickText(enf.page, 'Sign out'); await enf.page.waitForFunction(() => location.pathname === '/login', { timeout: 10000 })
})
await step('ENFORCE: enrolment flow asks for the password first (reauthentication) and rejects a wrong one without crashing', async () => {
  await login(enf, 'superadmin@demo.test'); await visit(enf, '/admin/security'); await clickText(enf.page, 'Set up authenticator app')
  await fillLabel(enf.page, 'Confirm your password', 'definitely-wrong'); await clickText(enf.page, 'Continue')
  await enf.page.waitForFunction(() => /not correct/.test(document.body.innerText), { timeout: 10000 })
})
const warn = await mfaSession('mfa-warn', 'warn')
await step('WARN: admin keeps full access and sees a non-blocking reminder', async () => {
  await login(warn, 'superadmin@demo.test'); await visit(warn, '/admin', { expectPath: '/admin', mustContain: 'Set it up now' }); await visit(warn, '/admin/jobs')
})
const enrolled = await mfaSession('mfa-enrolled', 'enforce', true)
await step('ENFORCE + session has a second factor: normal access, no banner', async () => {
  await login(enrolled, 'superadmin@demo.test'); await visit(enrolled, '/admin', { expectPath: '/admin', mustNot: ['Set it up now', 'Two-step verification is required'] })
})

// ---------- report ----------
console.log('\nNetwork and console hygiene')
for (const s of [pub, cust, eng, pend, adm, sup, enf, warn, enrolled]) {
  await step(`${s.label}: no traffic left localhost (except web fonts)`, async () => ok(s.external.size === 0, `contacted: ${[...s.external].join(', ')}`))
  await step(`${s.label}: no console errors or uncaught exceptions`, async () => ok(s.errors.length === 0, s.errors[0]?.slice(0, 220)))
}
await browser.close(); stopVite()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`)
if (failed.length) { console.log('\nFAILED:'); for (const f of failed) console.log(` - ${f.name}\n     ${String(f.err?.message).slice(0, 300)}`) }
process.exit(failed.length ? 1 : 0)
