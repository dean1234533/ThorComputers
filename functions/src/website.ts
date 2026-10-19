import { createHash } from 'node:crypto'
import { z } from 'zod'
import { callable, db, Timestamp, HttpsError, requirePerm, notifyAdmins } from './core'
import { DEVICES } from './catalog'
import { normalisePostcode } from './integrations-domain'
import { createLeadEnquiry } from './meta'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const Text = z.string().trim().max(100).default('')
const Input = z.object({
  submissionId: z.string().uuid(), consent: z.literal(true), website: z.literal('').default(''),
  name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(120),
  phone: z.string().trim().max(30).default(''), postcode: z.string().trim().max(12).refine(v => !!normalisePostcode(v), 'Enter a valid UK postcode'),
  device: z.enum(DEVICES), problem: z.string().trim().min(10).max(2000),
  tracking: z.object({ source: Text, medium: Text, campaign: Text, content: Text, term: Text }).default({}),
})

/** Public website intake. Writes are server-only, consent is explicit, quotas and idempotency are atomic. No Meta credentials are used. */
export const submitWebsiteEnquiry = callable(Input, async (req, d) => {
  const id = `web_${sha(d.submissionId).slice(0, 36)}`, ref = db.doc(`metaLeads/${id}`)
  const emailHash = sha(d.email), fingerprint = sha(JSON.stringify(d))
  const hour = Math.floor(Date.now() / 3600_000)
  const limits = [
    { ref: db.doc(`websiteIntakeLimits/email_${emailHash}_${hour}`), max: 5 },
    { ref: db.doc(`websiteIntakeLimits/ip_${sha(req.rawRequest.ip || 'unknown')}_${hour}`), max: 20 },
  ]
  const platform = /^(facebook|fb)$/i.test(d.tracking.source) ? 'facebook' : /^(instagram|ig)$/i.test(d.tracking.source) ? 'instagram' : 'website'
  const now = Timestamp.now(), campaign = d.tracking.campaign || null
  const duplicate = await db.runTransaction(async tx => {
    const previous = await tx.get(ref)
    if (previous.exists) {
      if (previous.data()?.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'This submission has already been used. Start a new enquiry.')
      if (!['awaiting_confirmation', 'verified'].includes(previous.data()?.status)) throw new HttpsError('failed-precondition', 'This enquiry has already been handled. Please sign in to see your repairs.')
      return true
    }
    const counters = await Promise.all(limits.map(l => tx.get(l.ref)))
    if (counters.some((s, i) => (s.data()?.count ?? 0) >= limits[i].max)) throw new HttpsError('resource-exhausted', 'Too many enquiries. Please try again in an hour.')
    counters.forEach((s, i) => tx.set(limits[i].ref, { count: (s.data()?.count ?? 0) + 1, expiresAt: Timestamp.fromMillis((hour + 2) * 3600_000) }))
    const attribution = { source: 'website', platform, leadId: id, campaignId: campaign, campaignName: campaign, leadCreatedAt: now, ...Object.fromEntries(Object.entries(d.tracking).map(([k, v]) => [`utm_${k}`, v])) }
    tx.create(ref, {
      source: 'website', leadId: id, platform, campaignId: campaign, campaignName: campaign, fingerprint, emailHash,
      status: 'awaiting_confirmation', statusNote: 'Website enquiry; awaiting customer confirmation.',
      mapped: { name: d.name, email: d.email, phone: d.phone, postcode: normalisePostcode(d.postcode), device: d.device, problem: d.problem },
      missing: [], invalid: [], attribution, consent: { given: true, via: 'website_form', at: now },
      createdAt: now, updatedAt: now,
    })
    return false
  })
  const { url } = await createLeadEnquiry(id, false)
  if (!duplicate) await notifyAdmins('marketing.manage', { category: 'admin', dedupeKey: `lead:${id}`, title: 'New website enquiry', body: 'A customer submitted the repair enquiry page. Open Incoming Leads to follow up.', link: '/admin/leads' }).catch(e => console.error('website lead notification failed', e.code))
  return { ok: true, duplicate, url }
}, { maxInstances: 5 })

/** First-party outcomes only: no claims about Meta impressions, clicks or advertising spend. */
export const websiteMarketingStats = callable(z.object({}), async req => {
  requirePerm(req, 'marketing.manage')
  const snap = await db.collection('metaLeads').where('source', '==', 'website').limit(2000).get()
  const leads = snap.docs.map(d => d.data()), jobs = new Map<string, FirebaseFirestore.DocumentData>()
  const ids = [...new Set(leads.map(l => l.jobId).filter(Boolean))] as string[]
  for (let i = 0; i < ids.length; i += 30) (await db.collection('repairRequests').where('__name__', 'in', ids.slice(i, i + 30)).get()).docs.forEach(d => jobs.set(d.id, d.data()))
  const campaigns = new Map<string, { name: string; leads: number; jobs: number; paid: number; completed: number }>()
  for (const l of leads) {
    const name = l.campaignName || 'Direct / no campaign', row = campaigns.get(name) ?? { name, leads: 0, jobs: 0, paid: 0, completed: 0 }
    row.leads++
    const job = jobs.get(l.jobId)
    if (job) { row.jobs++; if (job.paymentStatus === 'paid' || job.paymentStatus === 'partially_refunded') row.paid++; if (['completed', 'closed'].includes(job.status)) row.completed++ }
    campaigns.set(name, row)
  }
  const rows = [...campaigns.values()], sum = (key: 'leads' | 'jobs' | 'paid' | 'completed') => rows.reduce((n, r) => n + r[key], 0)
  return { leads: sum('leads'), jobs: sum('jobs'), paid: sum('paid'), completed: sum('completed'), campaigns: rows, limited: snap.size === 2000 }
})
