// Lead -> repair request automation.
// metaWebhookEvents/{leadId}  (verified webhook or reconciliation)  ->  processLeadEvent  ->  metaLeads/{leadId}
//   incomplete             -> awaiting_information  (secure link to add what's missing; nothing is invented)
//   complete, mode=confirm -> awaiting_confirmation (secure link; the customer reviews prefilled details and confirms)
//   complete, mode=auto    -> converted_to_job      (consented, complete leads publish straight away under the customer's account)
//   needs_review           -> an admin approves, edits, requests info or rejects
// Engineers only ever see the published job's public fields (device, problem, approximate area).
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { z } from 'zod'
import { db, auth, callable, requirePerm, setClaims, notifyAdmins, audit, FieldValue, Timestamp, HttpsError, APP_URL, REGION } from './core'
import { consentGiven, DEFAULT_REQUIRED_LEAD_FIELDS, LEAD_FIELDS, LeadMappingConfig, mapLeadFields, missingLeadFields, normaliseLead, NormalisedLead, routeLead, LeadField } from './domain'
import { graph, META_SECRETS, metaConfigured, pageToken } from './meta'
import { marketingSettings } from './settings'
import { createRequestFor, Attribution } from './jobs'
import { sendEmail, p } from './email'
import { newToken, sha256 } from './security'

const MAX_ATTEMPTS = 6
const METHODS_FOR: Record<string, string[]> = { phone: ['collection', 'workshop', 'home'], tablet: ['collection', 'workshop', 'home'], printer: ['home', 'office', 'collection', 'workshop'] }
const ALL_METHODS = ['home', 'office', 'remote', 'collection', 'workshop']

const LeadResponse = z.object({
  id: z.string(), created_time: z.string().optional(), field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()).optional() })).default([]),
  ad_id: z.string().optional(), adset_id: z.string().optional(), campaign_id: z.string().optional(), form_id: z.string().optional(), platform: z.string().optional(), is_organic: z.boolean().optional(),
  custom_disclaimer_responses: z.array(z.object({ checkbox_key: z.string().optional(), is_checked: z.union([z.string(), z.boolean()]).optional() })).optional(),
}).passthrough()

export async function mappingFor(formId: string | null): Promise<LeadMappingConfig & { connected: boolean }> {
  const m = formId ? (await db.doc(`leadMappings/${formId}`).get()).data() : undefined
  const form = formId ? (await db.doc(`metaLeadForms/${formId}`).get()).data() : undefined
  return { fieldMap: m?.fieldMap ?? {}, required: m?.required ?? DEFAULT_REQUIRED_LEAD_FIELDS, consentField: m?.consentField, connected: form?.connected !== false && m?.connected !== false }
}

export const onMetaWebhookEvent = onDocumentCreated({ document: 'metaWebhookEvents/{id}', region: REGION, secrets: META_SECRETS }, async (event) => { await processLeadEvent(event.params.id) })

export async function processLeadEvent(eventId: string) {
  const evRef = db.doc(`metaWebhookEvents/${eventId}`)
  const ev = await db.runTransaction(async tx => {
    const s = await tx.get(evRef), e = s.data()
    if (!e || ['processed', 'duplicate', 'skipped'].includes(e.status) || (e.status === 'processing' && e.claimedAt?.toMillis() > Date.now() - 120_000)) return null
    tx.update(evRef, { status: 'processing', claimedAt: Timestamp.now(), attempts: (e.attempts ?? 0) + 1 })
    return { ...e, attempts: (e.attempts ?? 0) + 1 } as FirebaseFirestore.DocumentData
  })
  if (!ev) return
  try {
    if ((await db.doc(`metaLeads/${ev.leadId}`).get()).exists) { await evRef.update({ status: 'duplicate', processedAt: FieldValue.serverTimestamp() }); return }
    const ms = await marketingSettings()
    if (!ms.autoImport) { await evRef.update({ status: 'skipped', note: 'automatic import is off', processedAt: FieldValue.serverTimestamp() }); return }
    if (!metaConfigured()) throw new Error('Meta integration is not configured')
    const token = await pageToken(ev.pageId)
    if (!token) throw new Error(`No access token for page ${ev.pageId}. Reconnect the Meta account.`)
    const raw = LeadResponse.parse(await graph(ev.leadId, token, { fields: 'id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,platform,is_organic,custom_disclaimer_responses' }))
    const formId = raw.form_id ?? ev.formId
    const cfg = await mappingFor(formId)
    if (!cfg.connected) { await evRef.update({ status: 'skipped', note: 'lead form not connected to the marketplace', processedAt: FieldValue.serverTimestamp() }); return }
    await importLead(raw, { pageId: ev.pageId, formId, adId: raw.ad_id ?? ev.adId, adsetId: raw.adset_id ?? ev.adsetId, source: ev.source }, cfg)
    await evRef.update({ status: 'processed', processedAt: FieldValue.serverTimestamp(), error: null })
    await db.doc('integrationHealth/meta').set({ lastLeadImportAt: FieldValue.serverTimestamp() }, { merge: true })
  } catch (e: any) {
    const dead = ev.attempts >= MAX_ATTEMPTS
    console.error('lead import failed', eventId, e?.message)
    await evRef.update({ status: dead ? 'dead_letter' : 'failed', error: String(e?.message ?? e).slice(0, 500), nextAttemptAt: Timestamp.fromMillis(Date.now() + Math.min(2 ** ev.attempts, 64) * 60_000) })
    await db.doc('integrationHealth/meta').set({ lastError: String(e?.message ?? e).slice(0, 300), lastErrorAt: FieldValue.serverTimestamp() }, { merge: true })
    if (dead) await notifyAdmins('leads.manage', { category: 'admin', dedupeKey: `lead-dead:${eventId}`, title: 'A lead could not be imported', body: 'Open Marketing > Webhook activity to retry it.', link: '/admin/marketing?tab=webhooks' })
  }
}

type Meta = { pageId: string; formId: string | null; adId?: string | null; adsetId?: string | null; source: string }
export async function importLead(raw: z.infer<typeof LeadResponse>, m: Meta, cfg: LeadMappingConfig) {
  const { values, unmapped } = mapLeadFields(raw.field_data, cfg)
  const disclaimer = raw.custom_disclaimer_responses?.some(r => r.is_checked === true || r.is_checked === '1' || r.is_checked === 'true') ?? false
  const consent = { given: disclaimer || consentGiven(values.consent), source: disclaimer ? 'meta_custom_disclaimer' : values.consent ? `form_field:${cfg.consentField}` : null, recordedAt: Timestamp.now() }
  const n = normaliseLead(values)
  const ms = await marketingSettings()
  const rule = routeLead(ms.routing, { campaignId: raw.campaign_id, formId: m.formId ?? undefined, deviceType: n.deviceType, postcode: n.postcode, urgency: n.urgency })
  if (rule?.set.deviceType && !n.deviceType) n.deviceType = rule.set.deviceType
  if (rule?.set.urgency && !n.urgency) n.urgency = rule.set.urgency
  const platform = raw.platform === 'ig' || raw.platform === 'instagram' ? 'instagram' : 'facebook'
  let duplicateOf: string | null = null
  if (n.email && ms.duplicateWindowDays > 0) {
    const d = await db.collection('metaLeads').where('mapped.email', '==', n.email).where('createdAt', '>=', Timestamp.fromMillis(Date.now() - ms.duplicateWindowDays * 86400_000)).limit(1).get()
    duplicateOf = d.docs[0]?.id ?? null
  }
  const lead = {
    leadId: raw.id, source: 'meta', platform, pageId: m.pageId, formId: m.formId, campaignId: raw.campaign_id ?? null, adsetId: raw.adset_id ?? m.adsetId ?? null, adId: raw.ad_id ?? m.adId ?? null, isOrganic: raw.is_organic ?? false,
    createdAt: raw.created_time ? Timestamp.fromDate(new Date(raw.created_time)) : Timestamp.now(), importedAt: FieldValue.serverTimestamp(), importedVia: m.source,
    mapped: stripUndef(n), unmapped, consent, routingRuleId: rule?.id ?? null, serviceMethods: rule?.set.serviceMethods ?? null,
    missing: missingLeadFields(n, cfg.required), status: duplicateOf ? 'duplicate' : 'imported', duplicateOf, jobId: null, customerId: null, quoteCount: 0, history: [{ status: duplicateOf ? 'duplicate' : 'imported', at: Timestamp.now(), by: 'system' }],
  }
  await db.doc(`metaLeads/${raw.id}`).create(lead)
  // Field values (including any not mapped) are kept only in this admin-only collection.
  await db.doc(`metaLeadRaw/${raw.id}`).set({ fieldData: raw.field_data, fetchedAt: FieldValue.serverTimestamp() })
  if (ms.notifyAdminsOnLead) await notifyAdmins('leads.manage', { category: 'admin', dedupeKey: `lead-new:${raw.id}`, title: `New ${platform === 'instagram' ? 'Instagram' : 'Facebook'} lead`, body: n.deviceType ? `A ${n.deviceType.replace('_', ' ')} repair enquiry arrived.` : 'A repair enquiry arrived.', link: `/admin/leads/${raw.id}` })
  if (!duplicateOf) await advanceLead(raw.id)
}
const stripUndef = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

const setLead = (id: string, status: string, extra: Record<string, unknown> = {}, by = 'system') =>
  db.doc(`metaLeads/${id}`).update({ status, ...extra, history: FieldValue.arrayUnion({ status, at: Timestamp.now(), by }), updatedAt: FieldValue.serverTimestamp() })

/** Decides the next step for an imported lead. Never publishes incomplete, unconsented or unapproved leads. */
export async function advanceLead(id: string, actor = 'system') {
  const l = (await db.doc(`metaLeads/${id}`).get()).data()
  if (!l || ['converted_to_job', 'receiving_bids', 'engineer_selected', 'converted_to_customer', 'completed', 'rejected'].includes(l.status)) return
  const ms = await marketingSettings()
  const camp = l.campaignId ? (await db.doc(`metaCampaigns/${l.campaignId}`).get()).data() : undefined
  if (camp?.feedsMarketplace === false) return setLead(id, 'needs_review', { reviewReason: 'Campaign is not set to feed the marketplace' })
  if (!l.mapped.email) return setLead(id, 'needs_review', { reviewReason: 'No valid email address to contact the customer' })
  if (l.missing.length) return sendLeadLink(id, l, 'awaiting_information')
  if (ms.leadPublishMode === 'review') return setLead(id, 'needs_review', { reviewReason: 'Leads are set to admin approval' })
  if (ms.leadPublishMode === 'auto' && l.consent?.given) return convertLeadToJob(id, actor)
  return sendLeadLink(id, l, 'awaiting_confirmation')
}

/** Secure single-purpose link (only the hash is stored). The customer signs in with the same email, reviews the prefilled request and confirms. */
async function sendLeadLink(id: string, l: FirebaseFirestore.DocumentData, status: 'awaiting_information' | 'awaiting_confirmation') {
  const n = l.mapped as NormalisedLead
  const token = newToken(), enquiryId = sha256(`meta:${id}`).slice(0, 40)
  await db.doc(`enquiries/${enquiryId}`).set({
    source: 'meta', leadId: id, status: 'awaiting_customer', email: n.email, emailHash: sha256(n.email!), tokenHash: sha256(token),
    fields: stripUndef({ first_name: n.fullName?.split(' ')[0] ?? '', full_name: n.fullName, email: n.email, phone: n.phone ?? '', postal_code: n.postcode ?? '', brand: n.manufacturer ?? '', model: n.model ?? '', problem: n.problem ?? '',
      device_type: n.deviceType, service_method: n.serviceMethod, urgency: n.urgency, preferred_date: n.preferredDate, service_methods: l.serviceMethods ?? undefined }),
    missing: l.missing, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 14 * 86400_000), consentAt: l.consent?.given ? FieldValue.serverTimestamp() : null,
  })
  const url = `${APP_URL}/continue?e=${enquiryId}&t=${token}`
  const name = n.fullName?.split(' ')[0] ?? 'there'
  await sendEmail({ to: n.email!, subject: status === 'awaiting_information' ? 'We need a little more information about your repair' : 'Confirm your Thor Computer repair request',
    heading: `Thanks, ${name}`, html: status === 'awaiting_information'
      ? `<p>We received your repair enquiry. To send it to approved engineers for quotes we need a few more details${l.missing.length ? ` (${l.missing.map((m: string) => p(m)).join(', ')})` : ''}.</p><p>It takes a minute. Nothing is shared with engineers until you confirm.</p>`
      : `<p>We received your repair enquiry${n.manufacturer ? ` for your <b>${p(n.manufacturer)} ${p(n.model ?? '')}</b>` : ''}.</p><p>Sign in or create a free account with this email address, check the details and confirm. Approved engineers covering your area will then send you quotes to compare. Nothing is shared with engineers until you confirm.</p>`,
    cta: { label: status === 'awaiting_information' ? 'Add the missing details' : 'Confirm my request', url } }).catch(e => console.error('lead email failed', id, e.message))
  await setLead(id, status, { enquiryId, linkSentAt: FieldValue.serverTimestamp() })
}

/** Creates (or reuses) the customer's account and publishes the request. Used by 'auto' mode and by an admin's approval. */
export async function convertLeadToJob(id: string, actor: string) {
  const l = (await db.doc(`metaLeads/${id}`).get()).data()!
  const n = l.mapped as NormalisedLead
  if (l.missing.length) throw new HttpsError('failed-precondition', `Missing: ${l.missing.join(', ')}`)
  let uid: string, created = false
  try {
    const u = await auth.getUserByEmail(n.email!)
    const prof = (await db.doc(`users/${u.uid}`).get()).data()
    if (prof && prof.role !== 'customer') { await setLead(id, 'needs_review', { reviewReason: 'That email belongs to a non-customer account' }); return }
    uid = u.uid
    if (!prof) await createCustomerProfile(uid, n)
  } catch (e: any) {
    if (e.code !== 'auth/user-not-found') throw e
    const u = await auth.createUser({ email: n.email!, displayName: n.fullName, emailVerified: false }); uid = u.uid; created = true
    await createCustomerProfile(uid, n)
  }
  const device = n.deviceType ?? 'other'
  const methods = l.serviceMethods?.length ? l.serviceMethods : n.serviceMethod ? [n.serviceMethod] : (METHODS_FOR[device] ?? ALL_METHODS)
  const attribution: Attribution = { leadId: id, campaignId: l.campaignId ?? undefined, adsetId: l.adsetId ?? undefined, adId: l.adId ?? undefined, formId: l.formId ?? undefined, pageId: l.pageId, platform: l.platform, leadCreatedAt: l.createdAt?.toDate?.().toISOString() }
  const res = await createRequestFor(uid, {
    requestKey: `meta_${id}`.slice(0, 64), device: { type: device as 'laptop', manufacturer: n.manufacturer ?? 'Unknown', model: n.model ?? '', os: '' }, serialNumber: '', issues: [], description: n.problem!, startedAt: '',
    urgency: (n.urgency ?? 'flexible') as 'flexible', serviceMethods: methods as ['home'], postcode: n.postcode!, addressLine: '', accessNotes: '', preferredDates: n.preferredDate ? [n.preferredDate] : [], photoPaths: [], source: 'meta',
  }, { attribution, publish: 'auto' })
  await setLead(id, 'converted_to_job', { jobId: res.jobId, jobReference: res.reference, customerId: uid, accountCreated: created }, actor)
  if (created) {
    const link = await auth.generatePasswordResetLink(n.email!, { url: `${APP_URL}/customer/repairs/${res.jobId}` }).catch(() => `${APP_URL}/forgot`)
    await sendEmail({ to: n.email!, subject: `Your repair request ${res.reference} is live`, heading: `Thanks, ${n.fullName?.split(' ')[0] ?? 'there'}`,
      html: `<p>Your repair enquiry is now live as <b>${p(res.reference)}</b>. Approved engineers covering your area can send you quotations.</p><p>We created a Thor Computer account for you with this email address. Set a password to compare quotes, message engineers and book.</p>`,
      cta: { label: 'Set my password', url: link } }).catch(e => console.error('lead account email failed', id, e.message))
  }
  return res
}
async function createCustomerProfile(uid: string, n: NormalisedLead) {
  await db.doc(`users/${uid}`).create({ role: 'customer', email: n.email, fullName: n.fullName ?? 'Customer', phone: n.phone ?? '', postcode: n.postcode ?? '', status: 'active', photoURL: null, createdVia: 'meta_lead',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), consent: { privacyAcceptedAt: null, leadFormConsentAt: FieldValue.serverTimestamp(), version: 'meta-lead' },
    notificationPrefs: { push: { quotes: true, messages: true, bookings: true, status: true, reviews: true, payments: true }, email: { quotes: true, messages: false, bookings: true, status: true, reviews: true, payments: true } }, privacy: { showCityOnProfile: true } })
  await setClaims(uid, { role: 'customer', perms: [], suspended: false, engineerApproved: false, specs: [] })
}

/** Called when a customer confirms an enquiry from the secure link (createRepairRequest). */
export async function markLeadConfirmed(leadId: string, jobId: string, reference: string, customerId: string) {
  await setLead(leadId, 'converted_to_job', { jobId, jobReference: reference, customerId, confirmedAt: FieldValue.serverTimestamp() }, customerId).catch(e => console.error('lead confirm', leadId, e.message))
}

// ---------- admin lead management ----------
export const adminLeadAction = callable(z.object({
  leadId: z.string().max(40), action: z.enum(['approve', 'reject', 'request_info', 'update_fields', 'resend', 'reprocess']), note: z.string().trim().max(500).optional().default(''),
  fields: z.object(Object.fromEntries(['fullName', 'email', 'phone', 'postcode', 'deviceType', 'manufacturer', 'model', 'problem', 'serviceMethod', 'preferredDate', 'urgency'].map(k => [k, z.string().max(2000).optional()]))).optional(),
}), async (req, d) => {
  const c = requirePerm(req, 'leads.manage')
  const ref = db.doc(`metaLeads/${d.leadId}`), l = (await ref.get()).data()
  if (!l) throw new HttpsError('not-found', 'Lead not found.')
  if (['converted_to_job', 'receiving_bids', 'engineer_selected', 'converted_to_customer', 'completed'].includes(l.status) && d.action !== 'update_fields') throw new HttpsError('failed-precondition', 'This lead is already a repair job.')
  let result: unknown = null
  if (d.action === 'update_fields') {
    const merged = normaliseLead({ ...Object.fromEntries(Object.entries(l.mapped).map(([k, v]) => [k, String(v)])), ...stripUndef(d.fields ?? {}) } as Record<string, string>)
    const cfg = await mappingFor(l.formId)
    await ref.update({ mapped: stripUndef(merged), missing: missingLeadFields(merged, cfg.required), editedBy: c.uid, updatedAt: FieldValue.serverTimestamp() })
  } else if (d.action === 'reject') {
    if (d.note.length < 3) throw new HttpsError('invalid-argument', 'Give a reason.')
    await setLead(d.leadId, 'rejected', { rejectReason: d.note }, c.uid)
  } else if (d.action === 'approve') {
    if (!l.mapped.email) throw new HttpsError('failed-precondition', 'The lead needs a valid email address.')
    if (!l.consent?.given && d.note.length < 10) throw new HttpsError('failed-precondition', 'This lead has no recorded marketplace consent. Record how consent was obtained in the note (at least 10 characters).')
    if (!l.consent?.given) await ref.update({ consent: { given: true, source: 'admin_recorded', note: d.note, by: c.uid, recordedAt: Timestamp.now() } })
    result = await convertLeadToJob(d.leadId, c.uid)
  } else if (d.action === 'request_info' || d.action === 'resend') {
    if (!l.mapped.email) throw new HttpsError('failed-precondition', 'The lead needs a valid email address.')
    await sendLeadLink(d.leadId, l, l.missing.length || d.action === 'request_info' ? 'awaiting_information' : 'awaiting_confirmation')
  } else if (d.action === 'reprocess') {
    await ref.update({ status: 'imported' }); await advanceLead(d.leadId, c.uid)
  }
  await audit(c.uid, `lead.${d.action}`, `metaLeads/${d.leadId}`, { note: d.note, fields: d.fields ? Object.keys(d.fields) : undefined })
  return { ok: true, result }
})

export const saveLeadMapping = callable(z.object({
  formId: z.string().regex(/^\d+$/), connected: z.boolean(), fieldMap: z.record(z.enum(LEAD_FIELDS)), required: z.array(z.enum(LEAD_FIELDS)).min(1), consentField: z.string().max(100).optional(),
}), async (req, d) => {
  const c = requirePerm(req, 'leads.manage')
  if (!d.required.includes('email' as LeadField)) throw new HttpsError('invalid-argument', 'Email must be required so the customer can confirm their request.')
  await db.doc(`leadMappings/${d.formId}`).set({ ...d, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp() })
  await db.doc(`metaLeadForms/${d.formId}`).set({ connected: d.connected }, { merge: true })
  await audit(c.uid, 'lead.mapping', `leadMappings/${d.formId}`, { connected: d.connected, required: d.required })
  return { ok: true }
})

export const retryMetaEvent = callable(z.object({ eventId: z.string().max(40) }), async (req, d) => {
  const c = requirePerm(req, 'leads.manage')
  const ref = db.doc(`metaWebhookEvents/${d.eventId}`), e = (await ref.get()).data()
  if (!e || !['failed', 'dead_letter', 'skipped'].includes(e.status)) throw new HttpsError('failed-precondition', 'Only failed or skipped events can be retried.')
  await ref.update({ status: 'failed', attempts: 0 })
  await processLeadEvent(d.eventId)
  await audit(c.uid, 'meta.event.retry', ref.path)
  return { status: (await ref.get()).data()?.status }
}, { secrets: META_SECRETS })

/** Every 30 minutes: retry failed imports, and poll connected forms for leads whose webhook never arrived. */
export const metaReconcile = onSchedule({ region: REGION, schedule: 'every 30 minutes', secrets: META_SECRETS }, async () => {
  const failed = await db.collection('metaWebhookEvents').where('status', '==', 'failed').where('nextAttemptAt', '<=', Timestamp.now()).limit(50).get()
  for (const f of failed.docs) await processLeadEvent(f.id)
  const conn = (await db.doc('metaConnections/default').get()).data()
  if (conn?.status !== 'connected' || !metaConfigured()) return
  const since = Math.floor((conn.lastReconcileAt?.toMillis() ?? Date.now() - 2 * 86400_000) / 1000) - 3600
  const forms = await db.collection('metaLeadForms').where('status', '==', 'ACTIVE').get()
  let found = 0
  for (const f of forms.docs) {
    if (f.data().connected === false) continue
    const token = await pageToken(f.data().pageId); if (!token) continue
    try {
      const leads: any = await graph(`${f.id}/leads`, token, { fields: 'id,created_time,ad_id,adset_id', limit: 100, filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]) })
      for (const l of leads.data ?? []) {
        if ((await db.doc(`metaLeads/${l.id}`).get()).exists) continue
        await db.doc(`metaWebhookEvents/${l.id}`).create({ leadId: l.id, pageId: f.data().pageId, formId: f.id, adId: l.ad_id ?? null, adsetId: l.adset_id ?? null, leadCreatedTime: l.created_time, source: 'reconcile', status: 'received', attempts: 0, receivedAt: FieldValue.serverTimestamp() })
          .then(() => found++, (e: any) => { if (e.code !== 6) throw e })
      }
    } catch (e: any) { console.warn('reconcile form', f.id, e.message) }
  }
  await db.doc('metaConnections/default').set({ lastReconcileAt: FieldValue.serverTimestamp(), lastReconcileFound: found }, { merge: true })
})
