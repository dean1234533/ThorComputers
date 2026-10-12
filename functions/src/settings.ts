import { z } from 'zod'
import { db, callable, requirePerm, requireSuperAdmin, audit, FieldValue, Timestamp, HttpsError } from './core'
import { DEFAULT_COMMISSION_BPS, PaymentPolicy, RoutingRule } from './domain'

// platformSettings/public    : readable by everyone (customer-facing rules, commission rate, payment policy, support details)
// platformSettings/marketing : marketing.view (lead conversion, routing, budget limits)
// platformSettings/chatbot   : chatbot.manage (AI assistant configuration)
export interface MarketplaceSettings {
  requestsEnabled: boolean; biddingEnabled: boolean; maxBidsPerJob: number; quoteExpiryMaxDays: number
  publishMode: 'auto' | 'review'          // 'review' holds new requests in awaiting_verification until an admin publishes them
  maxRequestsPerDay: number; enabledDevices: string[]
}
export interface PaymentSettings {
  enabled: boolean; commissionBps: number; policy: PaymentPolicy; depositPercent: number
  refundApplicationFee: boolean; cancellationFeePence: number; refundPolicyText: string; methods: string[]
}
export interface MarketingSettings {
  leadPublishMode: 'confirm' | 'auto' | 'review'   // confirm = customer confirms via secure link; auto = publish complete consented leads; review = admin approves each
  duplicateWindowDays: number; autoImport: boolean; notifyAdminsOnLead: boolean
  maxDailyBudgetPence: number; maxBudgetChangePercent: number; attributionWindowDays: number
  routing: RoutingRule[]
}
export interface ChatbotSettings {
  enabled: boolean; welcome: string; dailyLimitPerUser: number; maxTurns: number; model: string
  useCases: string[]; knowledge: { id: string; title: string; body: string; enabled: boolean }[]; escalationNote: string
}

export const DEFAULTS = {
  marketplace: { requestsEnabled: true, biddingEnabled: true, maxBidsPerJob: 10, quoteExpiryMaxDays: 30, publishMode: 'auto', maxRequestsPerDay: 10,
    enabledDevices: ['laptop', 'desktop', 'gaming_pc', 'mac', 'phone', 'tablet', 'printer', 'other'] } as MarketplaceSettings,
  // Payments stay OFF until a super admin has configured Stripe and switched them on (Admin > Payments). See docs/DEPLOYMENT.md.
  payments: { enabled: false, commissionBps: DEFAULT_COMMISSION_BPS, policy: 'full_before', depositPercent: 20, refundApplicationFee: true, cancellationFeePence: 0,
    refundPolicyText: '', methods: ['card'] } as PaymentSettings,
  marketing: { leadPublishMode: 'confirm', duplicateWindowDays: 14, autoImport: true, notifyAdminsOnLead: true, maxDailyBudgetPence: 10_000, maxBudgetChangePercent: 50,
    attributionWindowDays: 90, routing: [] } as MarketingSettings,
  chatbot: { enabled: false, welcome: 'Hi, I’m the Thor Computer assistant. Tell me what’s wrong with your device and I’ll help you request repair quotes.', dailyLimitPerUser: 30, maxTurns: 12,
    model: 'gemini-2.5-flash', useCases: ['repair_request', 'job_status', 'quotes', 'payments', 'appointments', 'support'], knowledge: [], escalationNote: '' } as ChatbotSettings,
}

let cache: { at: number; pub: FirebaseFirestore.DocumentData; mkt: FirebaseFirestore.DocumentData; bot: FirebaseFirestore.DocumentData } | null = null
async function load() {
  if (cache && Date.now() - cache.at < 15_000) return cache
  const [pub, mkt, bot] = await db.getAll(db.doc('platformSettings/public'), db.doc('platformSettings/marketing'), db.doc('platformSettings/chatbot'))
  cache = { at: Date.now(), pub: pub.data() ?? {}, mkt: mkt.data() ?? {}, bot: bot.data() ?? {} }
  return cache
}
export const clearSettingsCache = () => { cache = null }
export const marketplaceSettings = async (): Promise<MarketplaceSettings> => ({ ...DEFAULTS.marketplace, ...(await load()).pub.marketplace })
export const paymentSettings = async (): Promise<PaymentSettings> => ({ ...DEFAULTS.payments, ...(await load()).pub.payments })
export const marketingSettings = async (): Promise<MarketingSettings> => ({ ...DEFAULTS.marketing, ...(await load()).mkt })
export const chatbotSettings = async (): Promise<ChatbotSettings> => ({ ...DEFAULTS.chatbot, ...(await load()).bot })

const DEVICES = ['laptop', 'desktop', 'gaming_pc', 'mac', 'phone', 'tablet', 'printer', 'other'] as const
export const saveMarketplaceSettings = callable(z.object({
  requestsEnabled: z.boolean(), biddingEnabled: z.boolean(), maxBidsPerJob: z.number().int().min(1).max(50), quoteExpiryMaxDays: z.number().int().min(1).max(90),
  publishMode: z.enum(['auto', 'review']), maxRequestsPerDay: z.number().int().min(1).max(100), enabledDevices: z.array(z.enum(DEVICES)).min(1),
}), async (req, d) => {
  const c = requirePerm(req, 'settings.edit')
  await db.doc('platformSettings/public').set({ marketplace: d, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid }, { merge: true })
  await audit(c.uid, 'settings.marketplace', 'platformSettings/public', d); clearSettingsCache()
  return { ok: true }
})

/** Commission policy: the rate is snapshotted onto each quotation when it is submitted (and kept on acceptance), so a change applies only to
 *  quotations submitted afterwards. An accepted quotation's rate is never changed. Every change is kept in commissionHistory. */
export const savePaymentSettings = callable(z.object({
  enabled: z.boolean(), commissionPercent: z.number().min(0).max(50), policy: z.enum(['full_before', 'deposit_before', 'after_completion']),
  depositPercent: z.number().int().min(5).max(90), refundApplicationFee: z.boolean(), cancellationFeePence: z.number().int().min(0).max(100_000),
  refundPolicyText: z.string().max(2000), methods: z.array(z.enum(['card', 'link', 'paypal', 'klarna', 'revolut_pay'])).min(1).default(['card']),
  reason: z.string().trim().min(5).max(300),
}), async (req, d) => {
  const c = requireSuperAdmin(req)
  const commissionBps = Math.round(d.commissionPercent * 100)
  const prev = await paymentSettings()
  const { reason, commissionPercent: _p, ...rest } = d
  const next = { ...rest, commissionBps }
  const b = db.batch()
  b.set(db.doc('platformSettings/public'), { payments: next, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid }, { merge: true })
  if (prev.commissionBps !== commissionBps) b.create(db.collection('commissionHistory').doc(), { fromBps: prev.commissionBps, toBps: commissionBps, by: c.uid, reason, effectiveFrom: Timestamp.now(), appliesTo: 'quotations submitted from now on' })
  await b.commit()
  await audit(c.uid, 'settings.payments', 'platformSettings/public', { ...next, previousCommissionBps: prev.commissionBps, reason }); clearSettingsCache()
  return { ok: true, commissionBps }
})

const Rule = z.object({
  id: z.string().min(1).max(40), name: z.string().trim().min(1).max(80), enabled: z.boolean(), priority: z.number().int().min(0).max(1000),
  match: z.object({ campaignIds: z.array(z.string().max(40)).max(50).optional(), formIds: z.array(z.string().max(40)).max(50).optional(), deviceTypes: z.array(z.enum(DEVICES)).optional(),
    outcodePrefixes: z.array(z.string().max(4)).max(100).optional(), urgency: z.array(z.enum(['flexible', 'soon', 'urgent'])).optional() }),
  set: z.object({ deviceType: z.enum(DEVICES).optional(), urgency: z.enum(['flexible', 'soon', 'urgent']).optional(), serviceMethods: z.array(z.enum(['home', 'office', 'remote', 'collection', 'workshop'])).optional() }),
})
export const saveMarketingSettings = callable(z.object({
  leadPublishMode: z.enum(['confirm', 'auto', 'review']), duplicateWindowDays: z.number().int().min(0).max(365), autoImport: z.boolean(), notifyAdminsOnLead: z.boolean(),
  maxDailyBudgetPence: z.number().int().min(100).max(10_000_000), maxBudgetChangePercent: z.number().int().min(1).max(500), attributionWindowDays: z.number().int().min(1).max(365),
  routing: z.array(Rule).max(100),
}), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  const prev = await marketingSettings()
  // Budget safety limits are financial controls: only super admins may raise them.
  if ((d.maxDailyBudgetPence > prev.maxDailyBudgetPence || d.maxBudgetChangePercent > prev.maxBudgetChangePercent) && c.token.adminLevel !== 'super_admin') throw new HttpsError('permission-denied', 'Only a super administrator can raise budget limits.')
  await db.doc('platformSettings/marketing').set({ ...d, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid })
  await audit(c.uid, 'settings.marketing', 'platformSettings/marketing', { leadPublishMode: d.leadPublishMode, rules: d.routing.length, maxDailyBudgetPence: d.maxDailyBudgetPence }); clearSettingsCache()
  return { ok: true }
})

export const saveChatbotSettings = callable(z.object({
  enabled: z.boolean(), welcome: z.string().trim().max(400), dailyLimitPerUser: z.number().int().min(1).max(500), maxTurns: z.number().int().min(2).max(30),
  model: z.string().regex(/^[\w.-]{3,60}$/), useCases: z.array(z.enum(['repair_request', 'job_status', 'quotes', 'payments', 'appointments', 'support'])),
  knowledge: z.array(z.object({ id: z.string().max(40), title: z.string().trim().max(120), body: z.string().trim().max(4000), enabled: z.boolean() })).max(40), escalationNote: z.string().max(400),
}), async (req, d) => {
  const c = requirePerm(req, 'chatbot.manage')
  await db.doc('platformSettings/chatbot').set({ ...d, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid })
  await db.doc('platformSettings/public').set({ assistant: { enabled: d.enabled, welcome: d.welcome } }, { merge: true })   // what the app needs to show the widget
  await audit(c.uid, 'settings.chatbot', 'platformSettings/chatbot', { enabled: d.enabled, knowledge: d.knowledge.length, limit: d.dailyLimitPerUser }); clearSettingsCache()
  return { ok: true }
})
