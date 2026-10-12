// Real-browser check of the web app against the LOCAL emulators (headless Chrome via puppeteer-core).
// Run with `npm run test:browser` from the repo root. Signs in through the actual UI as each seeded role, visits every route,
// and records console errors, uncaught exceptions, failed requests and any network traffic that leaves localhost.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

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

console.log('\nCustomer')
const cust = await newSession('customer')
await step('customer signs in through the UI and lands on /customer', async () => { await login(cust, 'customer@demo.test'); ok(new URL(cust.page.url()).pathname === '/customer', cust.page.url()) })
for (const p of ['/customer', '/customer/repairs', '/customer/quotations', '/customer/appointments', '/messages', '/notifications', '/profile', '/settings', '/support'])
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
  await clickText(cust.page, 'Submit request')
  await cust.page.waitForFunction(() => document.body.innerText.includes('Request submitted'), { timeout: 20000 }).catch(async e => { throw new Error(`${e.message} | page says: ${(await bodyText(cust.page)).replace(/\s+/g, ' ').slice(0, 400)} | console: ${cust.lines.filter(l => l.includes('callable')).join(' // ').slice(0, 400)}`) })
  await visit(cust, '/customer/repairs'); ok((await bodyText(cust.page)).includes('ThinkPad'), 'new job not listed')
})
await step('customer signs out cleanly (mobile: via the More sheet)', async () => { await clickText(cust.page, 'More'); await sleep(600); await clickText(cust.page, 'Sign out'); await cust.page.waitForFunction(() => location.pathname === '/login', { timeout: 10000 }) })

console.log('\nEngineer')
const eng = await newSession('engineer')
await step('approved engineer signs in and lands on /engineer', async () => { await login(eng, 'engineer@demo.test'); ok(new URL(eng.page.url()).pathname === '/engineer', eng.page.url()) })
for (const p of ['/engineer', '/engineer/jobs', '/engineer/quotations', '/engineer/my-jobs', '/engineer/appointments', '/engineer/reviews', '/engineer/profile', '/engineer/payouts', '/support', '/messages', '/notifications', '/settings'])
  await step(`engineer ${p}`, () => visit(eng, p))
await step('engineer sees the open job but NOT the exact address or serial', async () => {
  await visit(eng, '/engineer/jobs/demo-job-open'); const t = await bodyText(eng.page)
  ok(/XPS 13|laptop/i.test(t), 'job not shown'); ok(!/1 Demo Road|DEMO123/.test(t), 'exact address or serial leaked to a bidding engineer')
})
await step('engineer is bounced from customer/admin areas', async () => { await visit(eng, '/customer', { expectPath: '/engineer' }); await visit(eng, '/admin/settings', { expectPath: '/engineer' }) })
const pend = await newSession('pending-engineer')
await step('unapproved engineer can reach onboarding but sees no available jobs', async () => {
  await login(pend, 'pending-engineer@demo.test'); await visit(pend, '/engineer/profile'); await visit(pend, '/engineer/jobs')
  ok(!(await bodyText(pend.page)).includes('XPS 13'), 'unapproved engineer can see open jobs')
})

console.log('\nAdmin (super admin) and support admin')
const adm = await newSession('superadmin', false)
await step('super admin signs in and lands on /admin', async () => { await login(adm, 'superadmin@demo.test'); ok(new URL(adm.page.url()).pathname === '/admin', adm.page.url()) })
for (const p of ['/admin', '/admin/approvals', '/admin/customers', '/admin/engineers', '/admin/jobs', '/admin/quotations', '/admin/appointments', '/admin/reviews', '/admin/reports', '/admin/settings', '/admin/leads', '/admin/marketing', '/admin/marketing?tab=campaigns', '/admin/marketing?tab=roi', '/admin/marketing?tab=forms', '/admin/marketing?tab=settings', '/admin/marketing?tab=webhooks', '/admin/finance', '/admin/disputes', '/admin/support', '/notifications', '/settings'])
  await step(`super admin ${p}`, () => visit(adm, p))
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
await step('support admin signs in; settings page does not crash', async () => { await login(sup, 'support@demo.test'); await visit(sup, '/admin'); await visit(sup, '/admin/customers'); await visit(sup, '/admin/settings'); await visit(sup, '/admin/support'); await visit(sup, '/admin/finance', { mustContain: 'No access' }) })

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
