import { z } from 'zod'
import { engineerRemainingPence } from './stripe'
import { db, auth, callable, requireRole, requirePerm, requireSuperAdmin, HttpsError, audit, FieldValue, Timestamp, adminMfaMode } from './core'

export const adminStats = callable(z.object({}), async (req) => {
  const caller = requirePerm(req, 'reports.view')
  const has = (perm: string) => caller.token.adminLevel === 'super_admin' || ((caller.token.perms as string[] | undefined) ?? []).includes(perm)
  const c = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count
  const since = Timestamp.fromMillis(Date.now() - 14 * 86400_000)
  const [customers, engineers, pendingApprovals, openJobs, activeQuotes, confirmed, completed, reports, recent, activity] = await Promise.all([
    c(db.collection('users').where('role', '==', 'customer')), c(db.collection('engineerProfiles').where('status', '==', 'approved')),
    c(db.collection('engineerApplications').where('status', '==', 'pending')), c(db.collection('repairRequests').where('status', '==', 'open')),
    c(db.collection('repairQuotes').where('status', '==', 'submitted')), c(db.collection('appointments').where('status', '==', 'confirmed')),
    c(db.collection('repairRequests').where('status', 'in', ['completed', 'closed'])), c(db.collection('reports').where('status', '==', 'open')),
    db.collection('repairRequests').where('createdAt', '>', since).select('createdAt').limit(2000).get(),
    db.collection('auditLogs').orderBy('createdAt', 'desc').limit(15).get(),
  ])
  const perDay: Record<string, number> = {}
  recent.docs.forEach(d => { const k = d.data().createdAt.toDate().toISOString().slice(0, 10); perDay[k] = (perDay[k] ?? 0) + 1 })
  // Marketing and finance figures are only returned to admins who hold those permissions (support admins never see money).
  let marketing: Record<string, number> | null = null, finance: Record<string, number> | null = null
  if (has('marketing.manage')) {
    const [fb, ig, awaiting, adJobs, camps] = await Promise.all([c(db.collection('metaLeads').where('platform', '==', 'facebook')), c(db.collection('metaLeads').where('platform', '==', 'instagram')),
      c(db.collection('metaLeads').where('status', 'in', ['awaiting_confirmation', 'awaiting_information'])), c(db.collection('repairRequests').where('attribution.source', '==', 'meta')), db.collection('metaCampaigns').get()])
    const spend = camps.docs.reduce((a, x) => a + (x.data().nonGbp ? 0 : (x.data().insights?.spendPence ?? 0)), 0), leads = camps.docs.reduce((a, x) => a + (x.data().insights?.leads ?? 0), 0)
    marketing = { facebookLeads: fb, instagramLeads: ig, leadsAwaitingVerification: awaiting, advertisingSpendPence: spend, costPerLeadPence: spend && leads ? Math.round(spend / leads) : 0, advertisingJobs: adJobs }
  }
  if (has('finance.view')) {
    const [tx, outstanding, disputed] = await Promise.all([db.collection('transactions').where('status', 'in', ['paid', 'partially_refunded', 'refunded', 'disputed']).limit(2000).get(), c(db.collection('transactions').where('status', 'in', ['checkout_created', 'payment_failed'])), c(db.collection('transactions').where('status', '==', 'disputed'))])
    const sum = (f: (t: any) => number) => tx.docs.reduce((a, x) => a + (f(x.data()) || 0), 0)
    finance = { transactionValuePence: sum(t => t.totalPence), commissionPence: sum(t => t.commissionPence - (t.commissionRefundedPence ?? 0)), engineerPayoutPence: sum(t => t.payoutStatus === 'transferred' ? engineerRemainingPence(t) : 0), outstandingPayments: outstanding, disputedTransactions: disputed,
      advertisingRevenuePence: sum(t => t.attribution?.source === 'meta' ? t.totalPence : 0) }
  }
  const [cancelled] = await Promise.all([c(db.collection('repairRequests').where('status', '==', 'cancelled'))])
  const [activeEngineers, scheduled, awaitingBids] = await Promise.all([c(db.collection('engineerProfiles').where('status', '==', 'approved')), c(db.collection('appointments').where('status', '==', 'confirmed')), c(db.collection('repairRequests').where('status', '==', 'open').where('quoteCount', '==', 0))])
  return { totals: { customers, engineers, pendingApprovals, openJobs, activeQuotes, confirmed, completed, reports, cancelled, activeEngineers, scheduled, awaitingBids }, marketing, finance, requestsPerDay: perDay,
    recentActivity: activity.docs.map(a => ({ id: a.id, ...a.data(), createdAt: a.data().createdAt?.toMillis() ?? null })) }
})

const Settings = z.object({
  categories: z.array(z.object({ id: z.string(), label: z.string(), enabled: z.boolean() })).max(40).optional(),
  support: z.object({ email: z.string().email().or(z.literal('')), phone: z.string().max(30), hours: z.string().max(120) }).optional(),
  booking: z.object({ reminderHours: z.array(z.number().min(0.5).max(168)).max(4), leadMinutes: z.number().min(0).max(10080), cancelNoticeHours: z.number().min(0).max(168) }).optional(),
  coverage: z.object({ areas: z.array(z.string().max(60)).max(100), note: z.string().max(300) }).optional(),
  // Policies of Thor Computer's OWN direct services. Independent engineers' terms come from their own quotes.
  directServicePolicy: z.object({ warranty: z.string().max(1500), terms: z.string().max(1500) }).optional(),
  marketplaceDisclaimer: z.string().max(800).optional(),
  pricingGuidance: z.string().max(800).optional(),      // approved wording about prices; the assistant quotes it and never invents figures
})
export const savePlatformSettings = callable(Settings, async (req, d) => {
  const c = requirePerm(req, 'settings.edit')
  await db.doc('platformSettings/public').set({ ...d, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid }, { merge: true })
  await audit(c.uid, 'settings.save', 'platformSettings/public', { keys: Object.keys(d) })
  return { ok: true }
})

/** Deliberately callable WITHOUT a second factor: an admin who has not enrolled yet must still be able to see why they are blocked.
 *  Super admins (admins.manage) also get every admin's enrolment state, to check before switching REQUIRE_ADMIN_MFA to "true". */
export const adminMfaStatus = callable(z.object({}), async (req) => {
  const c = requireRole(req, 'admin', { skipMfa: true })
  const factors = async (uid: string) => (await auth.getUser(uid)).multiFactor?.enrolledFactors.length ?? 0
  const out: { mode: string; sessionHasSecondFactor: boolean; enrolledFactors: number; admins?: { uid: string; email: string; enrolledFactors: number }[] } =
    { mode: adminMfaMode(), sessionHasSecondFactor: !!req.auth?.token.firebase?.sign_in_second_factor, enrolledFactors: await factors(c.uid) }
  if ((c.token.perms as string[] | undefined)?.includes('admins.manage')) {
    const admins = await db.collection('users').where('role', '==', 'admin').where('status', '==', 'active').get()
    out.admins = await Promise.all(admins.docs.map(async a => ({ uid: a.id, email: String(a.data().email ?? ''), enrolledFactors: await factors(a.id) })))
  }
  return out
})

export const saveMarketplaceSettings = callable(z.object({ newRequestsEnabled: z.boolean(), biddingEnabled: z.boolean(), maxQuotesPerJob: z.number().int().min(1).max(50), maxQuoteValidityDays: z.number().int().min(1).max(90) }), async (req, d) => {
  const c = requirePerm(req, 'settings.edit')
  await db.doc('platformSettings/marketplace').set({ ...d, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid }, { merge: true })
  await audit(c.uid, 'marketplace.settings', 'platformSettings/marketplace', d)
  return { ok: true }
})

/** The owner supplies the approved privacy policy and business details. Nothing is invented here: until `approved` is set with all required details, the app keeps its "draft for legal review" notice. */
export const saveLegalSettings = callable(z.object({
  businessName: z.string().trim().max(120), registeredAddress: z.string().trim().max(300), companyNumber: z.string().trim().max(20).optional().default(''), contactEmail: z.string().trim().max(120),
  icoNumber: z.string().trim().max(30).optional().default(''), icoExempt: z.boolean().optional().default(false), privacyText: z.string().max(30000), approved: z.boolean(),
}), async (req, d) => {
  const c = requireSuperAdmin(req)
  if (d.approved) {
    const missing = [!d.businessName && 'business name', !d.registeredAddress && 'registered address', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.contactEmail) && 'contact email', (!d.icoNumber && !d.icoExempt) && 'ICO registration number (or confirm an exemption)', d.privacyText.trim().length < 200 && 'the full privacy policy text'].filter(Boolean)
    if (missing.length) throw new HttpsError('failed-precondition', `To publish the policy, add: ${missing.join(', ')}.`)
  }
  await db.doc('platformSettings/public').set({ legal: { ...d, approvedBy: d.approved ? c.uid : null, approvedAt: d.approved ? FieldValue.serverTimestamp() : null, updatedAt: FieldValue.serverTimestamp() } }, { merge: true })
  await audit(c.uid, 'legal.settings', 'platformSettings/public', { approved: d.approved, businessName: d.businessName })
  return { ok: true }
})
