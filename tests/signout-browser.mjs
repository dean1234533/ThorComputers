// Isolated localhost regression check. Creates and removes its own accounts and records.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
const require = createRequire(new URL('../functions/', import.meta.url))
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const backend = initializeApp({ projectId: 'demo-thor' }, `signout-check-${randomUUID()}`)
const auth = getAuth(backend), db = getFirestore(backend)
const base = join(homedir(), '.cache/puppeteer/chrome')
const chrome = readdirSync(base).reverse().map(v => join(base, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')).find(existsSync)
const accounts = [], records = []
let browser
try {
  for (const role of ['customer', 'admin']) {
    const uid = `signout-check-${randomUUID()}`, email = `${uid}@demo.test`, password = randomUUID()
    await auth.createUser({ uid, email, password, emailVerified: true }); accounts.push({ uid, email, password, role })
    await auth.setCustomUserClaims(uid, { role, suspended: false, ...(role === 'admin' ? { adminLevel: 'super_admin', perms: ['engineers.review'] } : {}) })
    const profile = db.doc(`users/${uid}`); records.push(profile)
    await profile.set({ fullName: 'Local check', email, role, status: 'active', phone: '', postcode: '' })
  }
  const admin = accounts[1]
  const application = db.doc(`engineerApplications/${admin.uid}`); records.push(application)
  await application.set({ status: 'pending', submittedAt: Timestamp.now(), profile: { displayName: 'Spacing check', bio: 'LongBiography'.repeat(35), yearsExperience: 5, specialisations: ['laptops', 'desktops'], serviceArea: { postcode: 'SW1A 1AA', radiusMiles: 10 } } })
  const qualification = db.collection('engineerQualifications').doc(); records.push(qualification)
  await qualification.set({ engineerId: admin.uid, name: 'A certificate with a long title for checking button spacing', issuer: 'Local check', storagePath: 'unused', verification: 'pending' })
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.setRequestInterception(true)
  page.on('request', r => { const u = new URL(r.url()); ['127.0.0.1', 'localhost'].includes(u.hostname) || !u.protocol.startsWith('http') ? r.continue() : r.abort() })
  await page.goto('http://127.0.0.1:5174/login')
  const login = async account => {
    await page.waitForSelector('input[type=email]'); await page.type('input[type=email]', account.email); await page.type('input[type=password]', account.password)
    await page.click('button[type=submit]')
    await page.waitForFunction(role => location.pathname === `/${role}` && document.querySelector('[aria-label="Sign out"]'), { timeout: 15000 }, account.role)
  }
  for (let round = 0; round < 2; round++) {
    await login(accounts[0])
    const marker = await page.evaluate(() => { window.signoutMarker = crypto.randomUUID(); return window.signoutMarker })
    await page.click('[aria-label="Sign out"]')
    await page.waitForFunction(() => location.pathname === '/login' && document.querySelector('input[type=email]'))
    assert.equal(await page.evaluate(() => window.signoutMarker), marker, 'sign-out must not reload the document')
    assert.equal(await page.evaluate(() => document.querySelector('input[type=email]').value), '')
  }
  console.log('PASS: two sign-in/sign-out cycles return to login without a website reload')
  await login(admin)
  await page.evaluate(() => document.querySelector('a[href="/admin/approvals"]').click())
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Spacing check')))
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Spacing check')).click())
  await page.waitForSelector('.ui-sheet')
  await page.waitForFunction(() => [...document.querySelectorAll('.ui-sheet button')].some(b => b.textContent === 'Verify'))
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 })
    await new Promise(r => setTimeout(r, 500))
    const layout = await page.evaluate(() => {
      const sheet = document.querySelector('.ui-sheet'); sheet.scrollTop = sheet.scrollHeight
      const buttons = [...sheet.querySelectorAll('button')].filter(b => ['Approve', 'Request info', 'Reject'].includes(b.textContent))
      return { padding: parseFloat(getComputedStyle(sheet).paddingBottom), overflow: sheet.scrollWidth > sheet.clientWidth, rects: buttons.map(b => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }) }
    })
    assert.ok(layout.padding >= 24); assert.equal(layout.overflow, false)
    for (let i = 0; i < layout.rects.length; i++) for (let j = i + 1; j < layout.rects.length; j++) {
      const a = layout.rects[i], b = layout.rects[j]
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'buttons must not overlap')
    }
    await page.screenshot({ path: `/private/tmp/thor-buttons-${width}.png` })
  }
  assert.deepEqual(errors, [])
  console.log('PASS: review buttons have bottom padding and do not overlap at desktop/mobile widths')
} finally {
  if (browser) await browser.close()
  for (const record of records) await record.delete()
  for (const account of accounts) await auth.deleteUser(account.uid)
  await deleteApp(backend)
  console.log('Temporary local records removed.')
}
