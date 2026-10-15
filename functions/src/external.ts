// Shared plumbing for third-party integrations (Stripe, Meta, Gemini).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { db } from './core'

/** True under the Functions emulator or MOCK_EXTERNAL=true: integrations then use local fixtures and NEVER call a real third-party API. */
export const MOCK = () => process.env.FUNCTIONS_EMULATOR === 'true' || process.env.MOCK_EXTERNAL === 'true'

/** application/x-www-form-urlencoded with Stripe-style nesting: { a: { b: 1 }, c: [1,2] } -> a[b]=1&c[0]=1&c[1]=2 */
export function formEncode(obj: Record<string, unknown>, prefix = ''): string {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((x, i) => out.push(typeof x === 'object' ? formEncode(x as Record<string, unknown>, `${key}[${i}]`) : `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`))
    else if (typeof v === 'object') out.push(formEncode(v as Record<string, unknown>, key))
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
  }
  return out.filter(Boolean).join('&')
}

/** AES-256-GCM for access tokens stored in Firestore. The key is derived from a server secret, so a database read alone does not reveal tokens. */
const key = (secret: string) => createHash('sha256').update('thor-token-key:' + secret).digest()
export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(secret), iv), enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.')
}
export function decryptToken(blob: string, secret: string): string {
  const [iv, tag, enc] = blob.split('.').map(s => Buffer.from(s, 'base64'))
  const d = createDecipheriv('aes-256-gcm', key(secret), iv); d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

// ---------- platform settings (server-side defaults; admins change them through audited callables) ----------
export interface FinanceSettings { commissionBps: number; requirePaymentBeforeBooking: boolean; refundPolicy: string; cancellationPolicy: string }
export interface MarketingSettings { requiredFields: string[]; defaultFeedsMarketplace: boolean; attributionWindowDays: number; maxDailyBudgetPence: number; maxBudgetChangePct: number; autoImport: boolean }
export interface MarketplaceSettings { newRequestsEnabled: boolean; biddingEnabled: boolean; maxQuotesPerJob: number; maxQuoteValidityDays: number }
export interface AiSettings {
  enabled: boolean                 // show the assistant at all
  aiFallbackEnabled: boolean       // allow the (paid) AI for questions the rules cannot answer; the guided assistant keeps working when off
  welcome: string; escalation: string; knowledge: string; model?: string
  dailyLimit: number               // messages per customer per day (rules and AI)
  aiDailyLimit: number             // AI fallbacks per customer per day
  globalAiDailyLimit: number       // AI fallbacks across all customers per day: the spending safeguard
  aiTimeoutMs: number; costInMicrosPer1k: number; costOutMicrosPer1k: number   // cost rates are estimates in micro-pounds per 1,000 tokens, editable
  faqOverrides?: Record<string, { answer?: string; enabled?: boolean }>; customFaqs?: { id: string; questions: string[]; answer: string }[]
}

export const FINANCE_DEFAULTS: FinanceSettings = { commissionBps: 1500, requirePaymentBeforeBooking: false, refundPolicy: 'Refunds follow the engineer’s agreed terms and Thor Computer’s marketplace policy.', cancellationPolicy: '' }
export const MARKETING_DEFAULTS: MarketingSettings = { requiredFields: ['name', 'email', 'postcode', 'problem'], defaultFeedsMarketplace: true, attributionWindowDays: 30, maxDailyBudgetPence: 5000, maxBudgetChangePct: 50, autoImport: true }
export const MARKETPLACE_DEFAULTS: MarketplaceSettings = { newRequestsEnabled: true, biddingEnabled: true, maxQuotesPerJob: 10, maxQuoteValidityDays: 30 }
export const AI_DEFAULTS: AiSettings = { enabled: true, aiFallbackEnabled: true, welcome: 'Hi, I’m the Thor Computer assistant. I can help you describe a repair, understand quotes, or find support.', dailyLimit: 150, aiDailyLimit: 10, globalAiDailyLimit: 300, aiTimeoutMs: 8000, costInMicrosPer1k: 80, costOutMicrosPer1k: 320, escalation: '', knowledge: '' }

export async function getSettings<T>(docId: string, defaults: T): Promise<T> {
  const d = (await db.doc(`platformSettings/${docId}`).get()).data()
  return { ...defaults, ...(d ?? {}) } as T
}
export const getFinanceSettings = () => getSettings('finance', FINANCE_DEFAULTS)
export const getMarketingSettings = () => getSettings('marketing', MARKETING_DEFAULTS)
export const getMarketplaceSettings = () => getSettings('marketplace', MARKETPLACE_DEFAULTS)
export const getAiSettings = () => getSettings('ai', AI_DEFAULTS)

/** Integration health, shown on the admin Integrations panel. */
export async function health(name: string, ok: boolean, detail = '') {
  await db.doc(`integrationHealth/${name}`).set({ ok, detail: detail.slice(0, 300), at: new Date() }, { merge: true })
}
