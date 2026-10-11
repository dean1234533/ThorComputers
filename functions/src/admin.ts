import { z } from 'zod'
import { db, auth, callable, requireRole, requirePerm, audit, FieldValue, Timestamp, adminMfaMode } from './core'

export const adminStats = callable(z.object({}), async (req) => {
  requirePerm(req, 'reports.view')
  const c = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count
  const [customers, engineers, pendingApprovals, openJobs, activeQuotes, confirmed, completed, reports] = await Promise.all([
    c(db.collection('users').where('role', '==', 'customer')), c(db.collection('engineerProfiles').where('status', '==', 'approved')),
    c(db.collection('engineerApplications').where('status', '==', 'pending')), c(db.collection('repairRequests').where('status', '==', 'open')),
    c(db.collection('repairQuotes').where('status', '==', 'submitted')), c(db.collection('appointments').where('status', '==', 'confirmed')),
    c(db.collection('repairRequests').where('status', 'in', ['completed', 'closed'])), c(db.collection('reports').where('status', '==', 'open')),
  ])
  const since = Timestamp.fromMillis(Date.now() - 14 * 86400_000)
  const recent = await db.collection('repairRequests').where('createdAt', '>', since).select('createdAt').limit(2000).get()
  const perDay: Record<string, number> = {}
  recent.docs.forEach(d => { const k = d.data().createdAt.toDate().toISOString().slice(0, 10); perDay[k] = (perDay[k] ?? 0) + 1 })
  const activity = await db.collection('auditLogs').orderBy('createdAt', 'desc').limit(15).get()
  return { totals: { customers, engineers, pendingApprovals, openJobs, activeQuotes, confirmed, completed, reports }, requestsPerDay: perDay,
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
