import { z } from 'zod'
import { AggregateField } from 'firebase-admin/firestore'
import { db, auth, callable, requireRole, requirePerm, audit, FieldValue, Timestamp, adminMfaMode } from './core'

/** Dashboard numbers. Sections are included only for admins holding the matching permission (support never sees finance or marketing). */
export const adminStats = callable(z.object({ days: z.number().int().min(1).max(730).default(14), from: z.string().datetime().optional(), to: z.string().datetime().optional() }), async (req, d) => {
  const caller = requirePerm(req, 'reports.view')
  const c = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count
  const sum = async (q: FirebaseFirestore.Query, field: string) => Number((await q.aggregate({ v: AggregateField.sum(field) }).get()).data().v ?? 0)
  const toMs = d.to ? Date.parse(d.to) : Date.now(), fromMs = d.from ? Date.parse(d.from) : toMs - d.days * 86400_000
  const since = Timestamp.fromMillis(fromMs), until = Timestamp.fromMillis(toMs)
  const jobs = db.collection('repairRequests'), inRange = (q: FirebaseFirestore.Query) => q.where('createdAt', '>=', since).where('createdAt', '<=', until)
  const [customers, engineers, pendingApprovals, underReview, openJobs, awaitingQuotes, awaitingVerification, activeQuotes, acceptedQuotes, confirmed, completed, cancelled, disputed, reports, newRequests, recent, activity, openTickets] = await Promise.all([
    c(db.collection('users').where('role', '==', 'customer')), c(db.collection('engineerProfiles').where('status', '==', 'approved')),
    c(db.collection('engineerApplications').where('status', '==', 'pending')), c(db.collection('engineerApplications').where('status', '==', 'under_review')),
    c(jobs.where('status', '==', 'open')), c(jobs.where('status', '==', 'open').where('quoteCount', '==', 0)), c(jobs.where('status', '==', 'awaiting_verification')),
    c(db.collection('repairQuotes').where('status', '==', 'submitted')), c(inRange(db.collection('repairQuotes').where('status', '==', 'accepted'))), c(db.collection('appointments').where('status', '==', 'confirmed')),
    c(inRange(jobs.where('status', 'in', ['completed', 'closed']))), c(inRange(jobs.where('status', '==', 'cancelled'))), c(jobs.where('status', '==', 'disputed')), c(db.collection('reports').where('status', '==', 'open')),
    c(inRange(jobs)), inRange(jobs).select('createdAt', 'source').limit(5000).get(),
    db.collection('auditLogs').orderBy('createdAt', 'desc').limit(15).get(), c(db.collection('supportTickets').where('status', 'in', ['open', 'pending'])),
  ])
  const perDay: Record<string, number> = {}, bySource: Record<string, number> = {}
  recent.docs.forEach(x => { const k = x.data().createdAt.toDate().toISOString().slice(0, 10); perDay[k] = (perDay[k] ?? 0) + 1; const s = x.data().source ?? 'app'; bySource[s] = (bySource[s] ?? 0) + 1 })
  const out: Record<string, unknown> = {
    range: { from: fromMs, to: toMs },
    totals: { customers, engineers, pendingApprovals, underReview, openJobs, awaitingQuotes, awaitingVerification, activeQuotes, acceptedQuotes, confirmed, completed, cancelled, disputed, reports, newRequests, openTickets },
    requestsPerDay: perDay, requestsBySource: bySource,
    recentActivity: activity.docs.map(a => ({ id: a.id, ...a.data(), createdAt: a.data().createdAt?.toMillis() ?? null })),
  }
  const perms = (caller.token.perms as string[] | undefined) ?? []
  if (perms.includes('finance.view')) {
    const tx = db.collection('transactions').where('createdAt', '>=', since).where('createdAt', '<=', until)
    const [gross, commission, engineerShare, refunded, outstanding, disputes, payouts] = await Promise.all([
      sum(tx, 'grossPence'), sum(tx, 'commissionPence'), sum(tx, 'engineerSharePence'), sum(tx, 'refundedPence'),
      sum(db.collection('payments').where('status', 'in', ['open', 'processing', 'failed']), 'amountPence'), c(db.collection('paymentDisputes').where('status', 'in', ['needs_response', 'under_review', 'warning_needs_response'])),
      sum(db.collection('payouts').where('status', '==', 'paid').where('createdAt', '>=', since).where('createdAt', '<=', until), 'amountPence'),
    ])
    out.finance = { grossPence: gross, commissionPence: commission, engineerSharePence: engineerShare, refundedPence: refunded, outstandingPence: outstanding, openChargebacks: disputes, payoutsPaidPence: payouts }
  }
  if (perms.includes('marketing.view') || perms.includes('leads.manage')) {
    const leads = db.collection('metaLeads').where('createdAt', '>=', since).where('createdAt', '<=', until)
    const spendQ = db.collection('metaInsightsDaily').where('date', '>=', new Date(fromMs).toISOString().slice(0, 10)).where('date', '<=', new Date(toMs).toISOString().slice(0, 10))
    const adTx = db.collection('transactions').where('source', '==', 'meta').where('createdAt', '>=', since).where('createdAt', '<=', until)
    const [fb, ig, total, awaiting, converted, spendPence, adJobs, adRevenue, adCommission] = await Promise.all([
      c(leads.where('platform', '==', 'facebook')), c(leads.where('platform', '==', 'instagram')), c(leads),
      c(db.collection('metaLeads').where('status', 'in', ['imported', 'awaiting_information', 'awaiting_confirmation', 'needs_review'])),
      c(leads.where('status', 'in', ['converted_to_job', 'receiving_bids', 'engineer_selected', 'converted_to_customer', 'completed'])), sum(spendQ, 'spendPence'), c(inRange(jobs.where('source', '==', 'meta'))), sum(adTx, 'grossPence'), sum(adTx, 'commissionPence'),
    ])
    out.marketing = { facebookLeads: fb, instagramLeads: ig, totalLeads: total, leadsAwaiting: awaiting, leadsConverted: converted, spendPence, costPerLeadPence: total ? Math.round(spendPence / total) : null, adJobs, adRevenuePence: adRevenue, adCommissionPence: adCommission }
  }
  return out
})

const Settings = z.object({
  categories: z.array(z.object({ id: z.string(), label: z.string(), enabled: z.boolean() })).max(40).optional(),
  support: z.object({ email: z.string().email().or(z.literal('')), phone: z.string().max(30), hours: z.string().max(120) }).optional(),
  booking: z.object({ reminderHours: z.array(z.number().min(0.5).max(168)).max(4), leadMinutes: z.number().min(0).max(10080), cancelNoticeHours: z.number().min(0).max(168) }).optional(),
  coverage: z.object({ areas: z.array(z.string().max(60)).max(100), note: z.string().max(300) }).optional(),
  // Policies of Thor Computer's OWN direct services. Independent engineers' terms come from their own quotes.
  directServicePolicy: z.object({ warranty: z.string().max(1500), terms: z.string().max(1500) }).optional(),
  marketplaceDisclaimer: z.string().max(800).optional(),
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
