import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { z } from 'zod'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db, callable, requirePerm, notifyAdmins, audit, FieldValue, Timestamp, HttpsError, LINKS, REGION } from './core'
import { MOCK, encryptToken, decryptToken, getMarketingSettings, MARKETING_DEFAULTS, health } from './external'
import { resolveAppUrl } from './app-url'
import { verifyMetaSignature, mapLead, DEFAULT_MAPPING, APP_LEAD_FIELDS, isTruthyConsent, LeadMapping, MetaFieldData, AppLeadField } from './integrations-domain'
import { sendEmail, p } from './email'

const META_SECRETS = ['META_APP_SECRET', 'META_VERIFY_TOKEN']
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0'
// Minimum permissions for this integration; each needs Meta App Review in Live mode. Add none beyond these.
export const META_SCOPES = ['ads_read', 'ads_management', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_manage_ads', 'business_management']
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const appSecret = () => process.env.META_APP_SECRET ?? ''

const expectedWebhookUrl = () => `https://${REGION}-${process.env.GCLOUD_PROJECT ?? 'your-project'}.cloudfunctions.net/metaWebhook`
export class MetaError extends Error { constructor(public status: number, public code: number | null, msg: string) { super(msg) } }

// ---------- Graph API client (real in production, local fixtures under the emulator) ----------
async function mockGraph(path: string, method: string, params: Record<string, string>): Promise<any> {
  if (path === '/oauth/access_token') return { access_token: 'mock-token', expires_in: 5184000 }
  if (path === '/me') return { id: '1000', name: 'Mock Meta User' }
  if (path === '/me/accounts') return { data: [{ id: 'PAGE1', name: 'Thor Computer (mock page)', access_token: 'mock-page-token' }] }
  if (path === '/me/adaccounts') return { data: [{ id: 'act_1', name: 'Thor Ads (mock)', currency: 'GBP', account_status: 1 }] }
  if (path === '/me/permissions') return { data: ['ads_read', 'ads_management', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_manage_ads', 'business_management'].map(permission => ({ permission, status: 'granted' })) }
  if (/\/subscribed_apps$/.test(path)) return method === 'GET' ? { data: [{ id: process.env.META_APP_ID ?? 'mock', subscribed_fields: ['leadgen'] }] } : { success: true }
  if (/\/subscriptions$/.test(path)) return { data: [{ object: 'page', callback_url: expectedWebhookUrl(), active: true, fields: [{ name: 'leadgen', version: 'v26.0' }] }] }
  if (/^\/act_\w+\/campaigns$/.test(path)) return { data: [{ id: 'camp_1', name: 'Laptop Repairs London', status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: '2000' }, { id: 'camp_2', name: 'Gaming PC Repairs', status: 'PAUSED', objective: 'OUTCOME_LEADS', daily_budget: '1500' }] }
  if (/^\/act_\w+\/insights$/.test(path)) return { data: [{ campaign_id: 'camp_1', spend: '45.50', impressions: '12000', reach: '9000', clicks: '310', actions: [{ action_type: 'lead', value: '12' }] }, { campaign_id: 'camp_2', spend: '10.00', impressions: '2000', reach: '1500', clicks: '40', actions: [{ action_type: 'lead', value: '2' }] }] }
  if (/\/leadgen_forms$/.test(path)) return { data: [{ id: 'form_1', name: 'Laptop repair form', status: 'ACTIVE' }] }
  if (/^\/\w+\/leads$/.test(path)) { const s = await db.collection('devMetaLeads').where('form_id', '==', path.split('/')[1]).get(); return { data: s.docs.map(d => d.data()) } }
  if (method === 'POST' && /^\/camp_\w+$/.test(path)) return { success: true }
  const lead = (await db.doc(`devMetaLeads/${path.slice(1)}`).get()).data()
  if (lead) return lead
  throw new MetaError(400, 100, 'mock: object does not exist')
}
async function graph(path: string, o: { method?: 'GET' | 'POST'; params?: Record<string, string>; token?: string } = {}): Promise<any> {
  const method = o.method ?? 'GET', params = { ...(o.params ?? {}) }
  if (MOCK()) return mockGraph(path, method, params)
  if (o.token) params.access_token = o.token
  const qs = new URLSearchParams(params).toString()
  const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}${path}${method === 'GET' && qs ? `?${qs}` : ''}`, {
    method, headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined, body: method === 'POST' ? qs : undefined })
  const body: any = await r.json().catch(() => ({}))
  if (!r.ok || body.error) { const e = body.error ?? {}; throw new MetaError(r.status, e.code ?? null, e.message ?? `Graph ${r.status}`) }
  return body
}
const isAuthError = (e: unknown) => e instanceof MetaError && (e.code === 190 || e.code === 10 || e.code === 200)

async function markReauth(reason: string) {
  await db.doc('metaAssets/main').set({ status: 'reauth_required', statusReason: reason.slice(0, 200), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  await health('meta', false, `reconnect needed: ${reason}`)
  await notifyAdmins('integrations.manage', { category: 'admin', dedupeKey: `meta-reauth:${new Date().toISOString().slice(0, 10)}`, title: 'Reconnect Meta', body: 'The Meta connection expired or permissions were revoked.', link: '/admin/marketing' })
}
async function pageToken(pageId: string): Promise<string> {
  const conn = (await db.doc('metaConnections/main').get()).data()
  const pg = (conn?.pages as { id: string; tokenEnc: string }[] | undefined)?.find(x => x.id === pageId)
  if (!pg) throw new MetaError(0, null, `Page ${pageId} is not connected`)
  return decryptToken(pg.tokenEnc, appSecret())
}
async function userToken(): Promise<string> {
  const conn = (await db.doc('metaConnections/main').get()).data()
  if (!conn?.tokenEnc) throw new HttpsError('failed-precondition', 'Meta is not connected.')
  return decryptToken(conn.tokenEnc, appSecret())
}

// ---------- connect (official OAuth: no passwords ever reach this app) ----------
const redirectUri = () => MOCK() ? `http://127.0.0.1:5001/${process.env.GCLOUD_PROJECT ?? 'demo-thor'}/${REGION}/metaOAuthCallback` : `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/metaOAuthCallback`
const signState = (payload: string) => createHmac('sha256', appSecret()).update(payload).digest('hex')

export const metaConnectUrl = callable(z.object({}), async (req) => {
  const c = requirePerm(req, 'integrations.manage')
  const payload = Buffer.from(JSON.stringify({ uid: c.uid, n: randomBytes(8).toString('hex'), exp: Date.now() + 10 * 60_000 })).toString('base64url')
  const state = `${payload}.${signState(payload)}`
  if (MOCK()) return { url: `${redirectUri()}?code=mock-code&state=${state}` }
  const appId = process.env.META_APP_ID; if (!appId) throw new HttpsError('failed-precondition', 'META_APP_ID is not configured.')
  return { url: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${new URLSearchParams({ client_id: appId, redirect_uri: redirectUri(), state, scope: META_SCOPES.join(','), response_type: 'code' })}` }
}, { secrets: META_SECRETS })

export const metaOAuthCallback = onRequest({ region: REGION, cors: false, secrets: META_SECRETS }, async (req, res) => {
  const back = (q: string) => res.redirect(302, LINKS.metaReturn(q))
  try {
    const code = String(req.query.code ?? ''), state = String(req.query.state ?? '')
    const [payload, sig] = state.split('.')
    const ok = payload && sig && sig.length === signState(payload).length && timingSafeEqual(Buffer.from(sig), Buffer.from(signState(payload)))
    const st = ok ? JSON.parse(Buffer.from(payload, 'base64url').toString()) : null
    if (!st || st.exp < Date.now() || !code) { back('meta=denied'); return }
    const admin = (await db.doc(`users/${st.uid}`).get()).data()
    if (admin?.role !== 'admin' || !(admin.adminLevel === 'super_admin' || (admin.perms ?? []).includes('integrations.manage'))) { back('meta=denied'); return }

    const short = await graph('/oauth/access_token', { params: { client_id: process.env.META_APP_ID ?? 'mock', redirect_uri: redirectUri(), client_secret: appSecret(), code } })
    const long = await graph('/oauth/access_token', { params: { grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID ?? 'mock', client_secret: appSecret(), fb_exchange_token: short.access_token } })
    await saveConnection(long.access_token as string, st.uid, long.expires_in ?? null, 'oauth')
    back('meta=connected')
  } catch (e: any) { console.error('meta oauth failed', e.message); back('meta=failed') }
})

/** Stores a working Meta token and imports the Pages / ad accounts it can see. Used by both the Facebook login flow and a pasted Business (system user) token. */
async function saveConnection(token: string, uid: string, expiresIn: number | null, via: 'oauth' | 'system_user') {
  const [me, pages, adAccounts] = await Promise.all([graph('/me', { token, params: { fields: 'id,name' } }), graph('/me/accounts', { token, params: { fields: 'id,name,access_token', limit: '100' } }), graph('/me/adaccounts', { token, params: { fields: 'id,name,currency,account_status', limit: '100' } })])
  const subscribed: string[] = []
  for (const pg of pages.data as { id: string; name: string; access_token: string }[]) {
    try { await graph(`/${pg.id}/subscribed_apps`, { method: 'POST', token: pg.access_token, params: { subscribed_fields: 'leadgen' } }); subscribed.push(pg.id) } catch (e: any) { console.warn('leadgen subscribe failed', pg.id, e.message) }
  }
  await db.doc('metaConnections/main').set({ userId: me.id, via, tokenEnc: encryptToken(token, appSecret()), expiresAt: expiresIn ? Timestamp.fromMillis(Date.now() + expiresIn * 1000) : null,
    pages: (pages.data as any[]).map(pg => ({ id: pg.id, tokenEnc: encryptToken(pg.access_token, appSecret()) })), connectedBy: uid, connectedAt: FieldValue.serverTimestamp() })
  await db.doc('metaAssets/main').set({ status: 'connected', statusReason: '', via, metaUserName: me.name, connectedBy: uid, scopes: META_SCOPES, subscribedPages: subscribed,
    pages: (pages.data as any[]).map(pg => ({ id: pg.id, name: pg.name })), adAccounts: (adAccounts.data as any[]).map(a => ({ id: a.id, name: a.name, currency: a.currency, active: a.account_status === 1 })), updatedAt: FieldValue.serverTimestamp() })
  await audit(uid, 'meta.connect', 'metaConnections/main', { via, pages: pages.data.length, adAccounts: adAccounts.data.length })
  await health('meta', true, 'connected')
  return { pages: pages.data.length as number, adAccounts: adAccounts.data.length as number, subscribedPages: subscribed.length }
}

/** Connect without the Facebook login round-trip: a Business Manager system user token (Business settings → Users → System users → Generate token) never expires and
 *  is not tied to one person's Facebook account. It is checked against Meta before anything is saved, and stored encrypted like the OAuth token. */
export const metaConnectWithToken = callable(z.object({ token: z.string().trim().min(20).max(1000) }), async (req, d) => {
  const c = requirePerm(req, 'integrations.manage')
  if (!MOCK() && !appSecret()) throw new HttpsError('failed-precondition', 'META_APP_SECRET is not configured.')
  try { return await saveConnection(d.token, c.uid, null, 'system_user') }
  catch (e: any) { throw new HttpsError('invalid-argument', e instanceof MetaError ? `Meta rejected this token: ${e.message.slice(0, 160)}` : 'Could not connect with this token.') }
}, { secrets: META_SECRETS })

export const metaDisconnect = callable(z.object({}), async (req) => {
  const c = requirePerm(req, 'integrations.manage')
  await db.doc('metaConnections/main').delete()
  await db.doc('metaAssets/main').set({ status: 'disconnected', pages: [], adAccounts: [], subscribedPages: [], updatedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'meta.disconnect', 'metaConnections/main')
  return { ok: true }
})

// ---------- lead import ----------
interface LeadRef { leadgenId: string; pageId?: string; formId?: string; adId?: string; adsetId?: string; campaignId?: string; createdTime?: number }
interface GraphLead { id: string; created_time?: string; ad_id?: string; adset_id?: string; campaign_id?: string; form_id?: string; platform?: string; is_organic?: boolean; field_data?: MetaFieldData[]; custom_disclaimer_responses?: { checkbox_key?: string; status?: string }[]; ad_name?: string; adset_name?: string; campaign_name?: string }

async function mappingFor(formId: string | undefined, s: typeof MARKETING_DEFAULTS): Promise<LeadMapping> {
  const m = formId ? (await db.doc(`leadMappings/${formId}`).get()).data() : null
  const d = m ?? (await db.doc('leadMappings/default').get()).data()
  return { fields: { ...DEFAULT_MAPPING.fields, ...(d?.fields ?? {}) }, required: (d?.required ?? s.requiredFields) as AppLeadField[] }
}
const platformOf = (v?: string) => /ig|insta/i.test(v ?? '') ? 'instagram' : 'facebook'

export async function importMetaLead(ref: LeadRef, via: 'webhook' | 'reconcile' | 'manual' = 'webhook'): Promise<{ status: string; duplicate: boolean }> {
  const lRef = db.doc(`metaLeads/${ref.leadgenId}`)
  const existing = (await lRef.get()).data()
  if (existing && !(existing.status === 'new' && existing.importError)) return { status: existing.status, duplicate: true }   // idempotent: webhook retries and reconciliation never create a second lead
  if (!existing) {
    try { await lRef.create({ leadId: ref.leadgenId, status: 'new', via, pageId: ref.pageId ?? null, formId: ref.formId ?? null, adId: ref.adId ?? null, adsetId: ref.adsetId ?? null, campaignId: ref.campaignId ?? null, receivedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), retries: 0 }) }
    catch (e: any) { if (e.code === 6) return { status: 'new', duplicate: true }; throw e }
  }
  let lead: GraphLead
  try {
    const token = MOCK() ? 'mock' : await pageToken(ref.pageId ?? (await db.doc('metaAssets/main').get()).data()?.pages?.[0]?.id)
    lead = await graph(`/${ref.leadgenId}`, { token, params: { fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic,field_data,custom_disclaimer_responses' } })
  } catch (e: any) {
    await lRef.update({ importError: String(e.message).slice(0, 200), retries: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() })
    if (isAuthError(e)) await markReauth(e.message)
    throw e
  }
  const s = await getMarketingSettings()
  const formId = lead.form_id ?? ref.formId, campaignId = lead.campaign_id ?? ref.campaignId ?? null
  const mapped = mapLead(lead.field_data ?? [], await mappingFor(formId, s))
  const explicitNo = mapped.values.consent !== undefined && !isTruthyConsent(mapped.values.consent)
  const routing = campaignId ? (await db.doc(`campaignRouting/${campaignId}`).get()).data() : null
  const feeds = routing ? routing.enabled !== false : s.defaultFeedsMarketplace
  const email = mapped.values.email
  let duplicate = false
  if (email) {
    const emailHash = sha(email)
    const dup = await db.collection('metaLeads').where('emailHash', '==', emailHash).where('createdAt', '>', Timestamp.fromMillis(Date.now() - 86400_000)).limit(3).get()
    duplicate = dup.docs.some(d => d.id !== ref.leadgenId && d.data().status !== 'duplicate')
  }
  const attribution = {
    source: 'meta', platform: platformOf(lead.platform), leadId: ref.leadgenId, pageId: ref.pageId ?? null, formId: formId ?? null, campaignId, campaignName: lead.campaign_name ?? null, adsetId: lead.adset_id ?? ref.adsetId ?? null, adId: lead.ad_id ?? ref.adId ?? null,
    leadCreatedAt: lead.created_time ? Timestamp.fromDate(new Date(lead.created_time)) : Timestamp.now(),
  }
  const needs = [...mapped.missing, ...mapped.invalid]
  let status: string = 'imported', note = ''
  if (duplicate) { status = 'duplicate'; note = 'Same email already submitted in the last 24 hours.' }
  else if (!feeds) { note = 'This campaign is not set to feed the marketplace.' }
  else if (explicitNo) { status = 'awaiting_information'; note = 'The form explicitly declined consent.' }
  else if (needs.length) { status = 'awaiting_information'; note = `Needs: ${needs.join(', ')}` }
  else status = 'awaiting_confirmation'
  const consent = { given: !explicitNo, via: mapped.values.consent ? 'form_field' : 'instant_form_submission', at: attribution.leadCreatedAt }
  await lRef.set({ status, statusNote: note, importError: FieldValue.delete(), emailHash: email ? sha(email) : null, attribution, ...attribution, campaignName: lead.campaign_name ?? null, adName: lead.ad_name ?? null, adsetName: lead.adset_name ?? null,
    mapped: mapped.values, missing: mapped.missing, invalid: mapped.invalid, unmapped: mapped.unmapped, raw: lead.field_data ?? [], consent, organic: !!lead.is_organic, routingExcluded: !feeds, importedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  await db.collection('leadConversionEvents').doc(`${ref.leadgenId}_imported`).set({ leadId: ref.leadgenId, event: 'imported', to: status, at: FieldValue.serverTimestamp() }, { merge: true })
  if (status === 'awaiting_confirmation') await createLeadEnquiry(ref.leadgenId, true)
  await notifyAdmins('marketing.manage', { category: 'admin', dedupeKey: `lead:${ref.leadgenId}`, title: status === 'awaiting_information' ? 'Lead needs information' : 'New advertising lead', body: `A ${attribution.platform} lead arrived${campaignId ? ' from a campaign' : ''}. Open Incoming Leads.`, link: '/admin/leads' })
  return { status, duplicate: false }
}

/** Creates (or re-creates) the enquiry the customer confirms through /continue, exactly like the WordPress flow. Returns a fresh confirmation URL; only the hash is stored. */
export async function createLeadEnquiry(leadId: string, sendMail: boolean): Promise<{ url: string; email: string }> {
  const lead = (await db.doc(`metaLeads/${leadId}`).get()).data()
  const v = lead?.mapped as Record<string, string> | undefined
  if (!lead || !v?.email || !v.name || !v.postcode || !v.problem) throw new HttpsError('failed-precondition', 'The lead is missing required details.')
  const enqId = sha(`meta:${leadId}`).slice(0, 40), eRef = db.doc(`enquiries/${enqId}`)
  const token = randomBytes(24).toString('hex')
  const fields = { first_name: v.name.split(/\s+/)[0].slice(0, 80), full_name: v.name.slice(0, 120), email: v.email, phone: (v.phone ?? '').slice(0, 30), postal_code: v.postcode, brand: (v.brand ?? '').slice(0, 60), model: (v.model ?? '').slice(0, 80), serial_n: '', problem: v.problem.slice(0, 2000),
    device: v.device ?? '', method: v.method ?? '', urgency: v.urgency ?? '', preferred_date: v.date ?? '' }
  const cur = (await eRef.get()).data()
  if (cur && cur.status !== 'awaiting_customer') throw new HttpsError('failed-precondition', 'This lead has already been confirmed by the customer.')
  await eRef.set({ source: 'meta', submissionId: `meta:${leadId}`, metaLeadId: leadId, status: 'awaiting_customer', fields, email: v.email, emailHash: sha(v.email), tokenHash: sha(token),
    attribution: lead.attribution, consent: lead.consent, createdAt: cur?.createdAt ?? FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 14 * 86400_000) }, { merge: true })
  await db.doc(`metaLeads/${leadId}`).update({ enquiryId: enqId, updatedAt: FieldValue.serverTimestamp() })
  const url = LINKS.continueLink(enqId, token)
  if (sendMail) await sendEmail({ to: v.email, subject: 'Confirm your Thor Computer repair request', heading: `Thanks, ${fields.first_name}`,
    html: `<p>We received your repair enquiry${fields.brand ? ` for your <b>${p(fields.brand)} ${p(fields.model)}</b>` : ''}.</p><p>Confirm the details to send your request to approved engineers, who will then send you quotations.</p>`, cta: { label: 'Confirm my request', url } })
    .catch(e => console.error('lead email failed', e.message))
  return { url, email: v.email }
}

// ---------- webhook ----------
export const metaWebhook = onRequest({ region: REGION, cors: false, secrets: META_SECRETS }, async (req, res) => {
  if (req.method === 'GET') {   // subscription handshake
    const tok = String(req.query['hub.verify_token'] ?? ''), want = process.env.META_VERIFY_TOKEN ?? ''
    const ok = want && tok.length === want.length && timingSafeEqual(Buffer.from(tok), Buffer.from(want))
    if (req.query['hub.mode'] === 'subscribe' && ok) { res.status(200).send(String(req.query['hub.challenge'] ?? '')); return }
    res.status(403).end(); return
  }
  const raw = (req.rawBody ?? Buffer.from('')).toString('utf8')
  if (req.method !== 'POST' || !verifyMetaSignature(raw, req.header('x-hub-signature-256'), appSecret())) { res.status(401).json({ error: 'signature' }); return }
  const body = JSON.parse(raw) as { object?: string; entry?: { id: string; changes?: { field: string; value: any }[] }[] }
  const eventId = sha(raw), eRef = db.doc(`metaWebhookEvents/${eventId}`)
  const leads: LeadRef[] = []
  for (const en of body.entry ?? []) for (const ch of en.changes ?? []) if (ch.field === 'leadgen' && ch.value?.leadgen_id)
    leads.push({ leadgenId: String(ch.value.leadgen_id), pageId: String(ch.value.page_id ?? en.id), formId: ch.value.form_id && String(ch.value.form_id), adId: ch.value.ad_id && String(ch.value.ad_id), adsetId: ch.value.adgroup_id && String(ch.value.adgroup_id), createdTime: ch.value.created_time })
  try { await eRef.create({ receivedAt: FieldValue.serverTimestamp(), leadCount: leads.length, leadIds: leads.map(l => l.leadgenId), status: 'processing' }) }
  catch (e: any) { if (e.code !== 6) throw e }   // same payload delivered again: leads are idempotent, so processing continues harmlessly
  const results: Record<string, string> = {}
  let failed = false
  for (const l of leads) {
    try { results[l.leadgenId] = (await importMetaLead(l, 'webhook')).status } catch (e: any) { failed = true; results[l.leadgenId] = `error: ${String(e.message).slice(0, 80)}` }
  }
  await eRef.set({ status: failed ? 'partial' : 'done', results, doneAt: FieldValue.serverTimestamp() }, { merge: true })
  res.status(failed ? 500 : 200).json({ ok: !failed })   // 500 makes Meta retry; reconciliation also recovers anything missed
})

// ---------- reconciliation of missed webhooks ----------
export async function reconcileLeads(): Promise<{ checked: number; imported: number }> {
  const assets = (await db.doc('metaAssets/main').get()).data()
  if (assets?.status !== 'connected') return { checked: 0, imported: 0 }
  let checked = 0, imported = 0
  // 1) leads whose first import attempt failed
  for (const d of (await db.collection('metaLeads').where('status', '==', 'new').limit(50).get()).docs) {
    if ((d.data().retries ?? 0) >= 8) continue
    try { const r = await importMetaLead({ leadgenId: d.id, pageId: d.data().pageId ?? undefined, formId: d.data().formId ?? undefined, campaignId: d.data().campaignId ?? undefined }, 'reconcile'); checked++; if (!r.duplicate) imported++ } catch { /* counted by retries */ }
  }
  // 2) leads Meta has that we never received
  const since = Math.floor((Date.now() - 3 * 86400_000) / 1000)
  for (const pg of (assets.pages ?? []) as { id: string }[]) {
    try {
      const token = MOCK() ? 'mock' : await pageToken(pg.id)
      const forms = await graph(`/${pg.id}/leadgen_forms`, { token, params: { fields: 'id,name,status', limit: '50' } })
      for (const f of forms.data as { id: string }[]) {
        const leads = await graph(`/${f.id}/leads`, { token, params: { fields: 'id,created_time,form_id', limit: '100', filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]) } })
        for (const l of leads.data as { id: string }[]) { checked++; if (!(await db.doc(`metaLeads/${l.id}`).get()).exists) { await importMetaLead({ leadgenId: l.id, pageId: pg.id, formId: f.id }, 'reconcile'); imported++ } }
      }
    } catch (e: any) { if (isAuthError(e)) await markReauth(e.message); else console.error('reconcile failed', pg.id, e.message) }
  }
  await health('meta', true, `reconciled ${checked} (${imported} new)`)
  return { checked, imported }
}
export const reconcileMetaLeads = callable(z.object({}), async (req) => { requirePerm(req, 'marketing.manage'); return reconcileLeads() }, { secrets: META_SECRETS })
export const reconcileMetaLeadsScheduled = onSchedule({ region: REGION, schedule: 'every 60 minutes', secrets: META_SECRETS }, async () => { await reconcileLeads() })

// ---------- campaigns ----------
const toPence = (v: unknown) => Math.round(parseFloat(String(v ?? '0')) * 100) || 0
export async function syncCampaigns(): Promise<{ campaigns: number }> {
  const assets = (await db.doc('metaAssets/main').get()).data()
  if (assets?.status !== 'connected') return { campaigns: 0 }
  const token = MOCK() ? 'mock' : await userToken()
  let n = 0
  try {
    for (const a of (assets.adAccounts ?? []) as { id: string; currency: string }[]) {
      const [camps, ins] = await Promise.all([graph(`/${a.id}/campaigns`, { token, params: { fields: 'id,name,status,objective,daily_budget,lifetime_budget', limit: '200' } }),
        graph(`/${a.id}/insights`, { token, params: { level: 'campaign', fields: 'campaign_id,spend,impressions,reach,clicks,actions', date_preset: 'maximum', limit: '500' } })])
      const byId = new Map((ins.data as any[]).map(i => [i.campaign_id, i]))
      for (const c of camps.data as any[]) {
        const i = byId.get(c.id) as any
        await db.doc(`metaCampaigns/${c.id}`).set({ name: c.name, status: c.status, objective: c.objective ?? null, adAccountId: a.id, currency: a.currency, nonGbp: a.currency !== 'GBP',
          dailyBudgetPence: c.daily_budget ? Number(c.daily_budget) : null, lifetimeBudgetPence: c.lifetime_budget ? Number(c.lifetime_budget) : null,
          insights: { spendPence: toPence(i?.spend), impressions: Number(i?.impressions ?? 0), reach: Number(i?.reach ?? 0), clicks: Number(i?.clicks ?? 0), leads: Number((i?.actions ?? []).find((x: any) => x.action_type === 'lead')?.value ?? 0) }, syncedAt: FieldValue.serverTimestamp() }, { merge: true })
        n++
      }
    }
    for (const pg of (assets.pages ?? []) as { id: string }[]) {
      const forms = await graph(`/${pg.id}/leadgen_forms`, { token: MOCK() ? 'mock' : await pageToken(pg.id), params: { fields: 'id,name,status', limit: '100' } })
      for (const f of forms.data as any[]) await db.doc(`metaLeadForms/${f.id}`).set({ name: f.name, status: f.status, pageId: pg.id, syncedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
    await health('meta', true, `synced ${n} campaigns`)
  } catch (e: any) { if (isAuthError(e)) await markReauth(e.message); throw e }
  return { campaigns: n }
}
export const syncMetaCampaigns = callable(z.object({}), async (req) => { requirePerm(req, 'marketing.manage'); return syncCampaigns() }, { secrets: META_SECRETS })
export const syncMetaCampaignsScheduled = onSchedule({ region: REGION, schedule: 'every 6 hours', secrets: META_SECRETS }, async () => { await syncCampaigns().catch(e => console.error('campaign sync', e.message)); await purgeStaleLeads() })

/** Retention: unconverted leads lose their personal data after 90 days (the anonymous counts stay for reporting). */
export async function purgeStaleLeads(days = 90) {
  const cutoff = Timestamp.fromMillis(Date.now() - days * 86400_000)
  const s = await db.collection('metaLeads').where('createdAt', '<', cutoff).where('status', 'in', ['rejected', 'duplicate', 'awaiting_information', 'awaiting_confirmation', 'imported']).limit(200).get()
  await Promise.all(s.docs.filter(d => !d.data().purged).map(d => d.ref.update({ raw: FieldValue.delete(), mapped: FieldValue.delete(), emailHash: FieldValue.delete(), purged: true, purgedAt: FieldValue.serverTimestamp() })))
}

export const setMetaCampaignStatus = callable(z.object({ campaignId: z.string().max(40), status: z.enum(['ACTIVE', 'PAUSED']), confirm: z.literal(true) }), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  const camp = (await db.doc(`metaCampaigns/${d.campaignId}`).get()).data(); if (!camp) throw new HttpsError('not-found', 'Campaign not found. Sync campaigns first.')
  try { await graph(`/${d.campaignId}`, { method: 'POST', token: MOCK() ? 'mock' : await userToken(), params: { status: d.status } }) }
  catch (e: any) { if (isAuthError(e)) await markReauth(e.message); throw new HttpsError('failed-precondition', e instanceof MetaError && e.code === 200 ? 'Your Meta permissions do not allow changing this campaign.' : 'Meta rejected the change.') }
  await db.doc(`metaCampaigns/${d.campaignId}`).update({ status: d.status, updatedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'meta.campaign.status', `metaCampaigns/${d.campaignId}`, { from: camp.status, to: d.status })
  return { ok: true }
}, { secrets: META_SECRETS })

export const setMetaCampaignBudget = callable(z.object({ campaignId: z.string().max(40), dailyBudgetPence: z.number().int().min(100).max(10_000_000), confirm: z.literal(true) }), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  const s = await getMarketingSettings(), camp = (await db.doc(`metaCampaigns/${d.campaignId}`).get()).data()
  if (!camp) throw new HttpsError('not-found', 'Campaign not found. Sync campaigns first.')
  if (camp.nonGbp) throw new HttpsError('failed-precondition', 'Budget changes are only supported for GBP ad accounts.')
  if (d.dailyBudgetPence > s.maxDailyBudgetPence) throw new HttpsError('failed-precondition', `Daily budget is limited to £${(s.maxDailyBudgetPence / 100).toFixed(2)} by your safety limit.`)
  if (camp.dailyBudgetPence && Math.abs(d.dailyBudgetPence - camp.dailyBudgetPence) * 100 > camp.dailyBudgetPence * s.maxBudgetChangePct) throw new HttpsError('failed-precondition', `A single change is limited to ${s.maxBudgetChangePct}% of the current budget.`)
  try { await graph(`/${d.campaignId}`, { method: 'POST', token: MOCK() ? 'mock' : await userToken(), params: { daily_budget: String(d.dailyBudgetPence) } }) }
  catch (e: any) { if (isAuthError(e)) await markReauth(e.message); throw new HttpsError('failed-precondition', 'Meta rejected the budget change.') }
  await db.doc(`metaCampaigns/${d.campaignId}`).update({ dailyBudgetPence: d.dailyBudgetPence, updatedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'meta.campaign.budget', `metaCampaigns/${d.campaignId}`, { from: camp.dailyBudgetPence ?? null, to: d.dailyBudgetPence })
  return { ok: true }
}, { secrets: META_SECRETS })

// ---------- lead management ----------
export const rejectMetaLead = callable(z.object({ leadId: z.string(), reason: z.string().trim().min(3).max(300) }), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  const ref = db.doc(`metaLeads/${d.leadId}`), l = (await ref.get()).data(); if (!l) throw new HttpsError('not-found', 'Lead not found.')
  if (['converted_to_job', 'receiving_bids', 'engineer_selected', 'converted_to_customer', 'completed'].includes(l.status)) throw new HttpsError('failed-precondition', 'This lead already became a repair job.')
  await ref.update({ status: 'rejected', statusNote: d.reason, rejectedBy: c.uid, updatedAt: FieldValue.serverTimestamp() })
  if (l.enquiryId) await db.doc(`enquiries/${l.enquiryId}`).update({ status: 'cancelled' }).catch(() => {})
  await audit(c.uid, 'lead.reject', `metaLeads/${d.leadId}`, { reason: d.reason })
  return { ok: true }
})

const FieldPatch = z.object(Object.fromEntries(APP_LEAD_FIELDS.map(f => [f, z.string().trim().max(2000).optional()])) as Record<AppLeadField, z.ZodOptional<z.ZodString>>)
/** Admin corrects mapped values (e.g. a typo'd postcode) and re-runs validation; if now complete, the confirmation enquiry is created. */
export const updateMetaLead = callable(z.object({ leadId: z.string(), fields: FieldPatch }), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  const ref = db.doc(`metaLeads/${d.leadId}`), l = (await ref.get()).data(); if (!l) throw new HttpsError('not-found', 'Lead not found.')
  if (!['imported', 'awaiting_information', 'awaiting_confirmation'].includes(l.status)) throw new HttpsError('failed-precondition', 'This lead can no longer be edited.')
  const s = await getMarketingSettings(), mapping = await mappingFor(l.formId ?? undefined, s)
  const merged = { ...(l.mapped ?? {}), ...Object.fromEntries(Object.entries(d.fields).filter(([, v]) => v)) } as Record<string, string>
  const re = mapLead(Object.entries(merged).map(([name, v]) => ({ name, values: [v] })), { fields: Object.fromEntries(APP_LEAD_FIELDS.map(f => [f, [f]])) as LeadMapping['fields'], required: mapping.required })
  const status = re.missing.length || re.invalid.length ? 'awaiting_information' : 'awaiting_confirmation'
  await ref.update({ mapped: re.values, missing: re.missing, invalid: re.invalid, status, statusNote: status === 'awaiting_information' ? `Needs: ${[...re.missing, ...re.invalid].join(', ')}` : '', updatedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'lead.update', `metaLeads/${d.leadId}`, { fields: Object.keys(d.fields).filter(k => (d.fields as any)[k]) })
  if (status === 'awaiting_confirmation') await createLeadEnquiry(d.leadId, false)
  return { status }
})

/** Admin follow-up when email is not enabled: mints a fresh single-use link to hand to the customer (call/SMS). Logged. */
export const issueLeadConfirmationLink = callable(z.object({ leadId: z.string(), sendEmail: z.boolean().optional().default(false) }), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  const l = (await db.doc(`metaLeads/${d.leadId}`).get()).data(); if (!l) throw new HttpsError('not-found', 'Lead not found.')
  if (!['awaiting_confirmation', 'awaiting_information'].includes(l.status)) throw new HttpsError('failed-precondition', 'The customer has already confirmed or the lead was closed.')
  const out = await createLeadEnquiry(d.leadId, d.sendEmail)
  await db.doc(`metaLeads/${d.leadId}`).update({ status: 'awaiting_confirmation', linkIssuedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'lead.link', `metaLeads/${d.leadId}`, { emailed: d.sendEmail })
  return { url: out.url }
})

export const saveLeadMapping = callable(z.object({ formId: z.string().max(40).regex(/^[\w-]+$/), fields: z.record(z.enum(APP_LEAD_FIELDS), z.array(z.string().max(80)).max(12)), required: z.array(z.enum(APP_LEAD_FIELDS)).max(12) }), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  await db.doc(`leadMappings/${d.formId}`).set({ fields: d.fields, required: d.required, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'lead.mapping', `leadMappings/${d.formId}`, { required: d.required })
  return { ok: true }
})
export const saveCampaignRouting = callable(z.object({ campaignId: z.string().max(40), enabled: z.boolean(), deviceType: z.string().max(30).optional().default(''), serviceMethod: z.string().max(30).optional().default('') }), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  await db.doc(`campaignRouting/${d.campaignId}`).set({ enabled: d.enabled, deviceType: d.deviceType, serviceMethod: d.serviceMethod, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'campaign.routing', `campaignRouting/${d.campaignId}`, { enabled: d.enabled })
  return { ok: true }
})
export const saveMarketingSettings = callable(z.object({
  requiredFields: z.array(z.enum(APP_LEAD_FIELDS)).max(12), defaultFeedsMarketplace: z.boolean(), attributionWindowDays: z.number().int().min(1).max(365),
  maxDailyBudgetPence: z.number().int().min(100).max(10_000_000), maxBudgetChangePct: z.number().int().min(1).max(500), autoImport: z.boolean(),
}), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  await db.doc('platformSettings/marketing').set({ ...d, updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  await audit(c.uid, 'marketing.settings', 'platformSettings/marketing', d)
  return { ok: true }
})

// ---------- advertising performance (attribution: Lead -> Customer -> Job -> Quote -> Payment -> Completed) ----------
export const adminMarketingStats = callable(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), async (req, d) => {
  requirePerm(req, 'marketing.manage')
  const s = await getMarketingSettings(), window = s.attributionWindowDays * 86400_000
  let lq: FirebaseFirestore.Query = db.collection('metaLeads').orderBy('createdAt', 'desc')
  if (d.from) lq = lq.where('createdAt', '>=', Timestamp.fromDate(new Date(`${d.from}T00:00:00Z`)))
  if (d.to) lq = lq.where('createdAt', '<=', Timestamp.fromDate(new Date(`${d.to}T23:59:59Z`)))
  const leads = (await lq.limit(2000).get()).docs.map(x => ({ id: x.id, ...x.data() as any }))
  const [camps, txs] = await Promise.all([db.collection('metaCampaigns').get(), db.collection('transactions').where('attribution.source', '==', 'meta').where('status', 'in', ['paid', 'partially_refunded', 'refunded', 'disputed']).limit(2000).get()])
  const jobs = new Map<string, any>(); const jobIds = [...new Set(leads.map(l => l.jobId).filter(Boolean))] as string[]
  for (let i = 0; i < jobIds.length; i += 30) (await db.collection('repairRequests').where('__name__', 'in', jobIds.slice(i, i + 30)).get()).docs.forEach(x => jobs.set(x.id, x.data()))
  const leadById = new Map(leads.map(l => [l.id, l]))
  const payments = txs.docs.map(x => x.data()).filter(t => { const l = leadById.get(t.attribution?.leadId); const paid = t.paidAt?.toMillis?.(); return l && paid && paid - (l.attribution?.leadCreatedAt?.toMillis?.() ?? 0) <= window })
  const per = new Map<string, any>()
  const row = (id: string, name: string) => { if (!per.has(id)) per.set(id, { campaignId: id, name, spendPence: 0, leads: 0, valid: 0, jobs: 0, withBids: 0, accepted: 0, paid: 0, completed: 0, grossPence: 0, commissionPence: 0 }); return per.get(id) }
  camps.docs.forEach(x => { const c = row(x.id, x.data().name); if (!x.data().nonGbp) c.spendPence = x.data().insights?.spendPence ?? 0; c.metaLeads = x.data().insights?.leads ?? 0; c.status = x.data().status })
  for (const l of leads) {
    const r = row(l.campaignId ?? 'unknown', l.campaignName ?? 'Unknown campaign'); r.leads++
    if (!['rejected', 'duplicate', 'awaiting_information'].includes(l.status)) r.valid++
    if (l.jobId) { r.jobs++; const j = jobs.get(l.jobId); if ((j?.quoteCount ?? 0) > 0 || j?.acceptedQuoteId) r.withBids++; if (j?.acceptedQuoteId) r.accepted++; if (['completed', 'closed'].includes(j?.status)) r.completed++ }
  }
  for (const t of payments) { const r = row(t.attribution.campaignId ?? 'unknown', t.attribution.campaignName ?? 'Unknown campaign'); r.paid++; r.grossPence += t.totalPence; r.commissionPence += t.commissionPence - (t.commissionRefundedPence ?? 0) }
  const campaigns = [...per.values()].map(r => ({ ...r, costPerLeadPence: r.spendPence && (r.metaLeads || r.leads) ? Math.round(r.spendPence / (r.metaLeads || r.leads)) : null }))
  const T = (f: (r: any) => number) => campaigns.reduce((a, r) => a + f(r), 0)
  const byStatus: Record<string, number> = {}; leads.forEach(l => { byStatus[l.status] = (byStatus[l.status] ?? 0) + 1 })
  const platform = { facebook: leads.filter(l => l.platform === 'facebook').length, instagram: leads.filter(l => l.platform === 'instagram').length }
  const spend = T(r => r.spendPence), leadCount = leads.length
  return { attributionWindowDays: s.attributionWindowDays, spendPence: spend, leads: leadCount, platform, byStatus, costPerLeadPence: spend && leadCount ? Math.round(spend / leadCount) : null,
    validLeads: T(r => r.valid), jobs: T(r => r.jobs), withBids: T(r => r.withBids), accepted: T(r => r.accepted), paid: T(r => r.paid), completed: T(r => r.completed), grossPence: T(r => r.grossPence), commissionPence: T(r => r.commissionPence),
    // Commission is revenue, not profit: ad spend is shown beside it, Stripe fees/refunds/operating costs/tax are not deducted here.
    commissionMinusSpendPence: T(r => r.commissionPence) - spend, campaigns }
})


// ---------- connection self-check: real API calls, honest verdicts ----------
interface Check { id: string; label: string; ok: boolean; detail: string; fix?: string; required?: boolean }
const isPlaceholder = (v?: string) => !v || v === 'not-set-yet'

/** Never reports "working" because a page loads. It calls Meta and compares what Meta actually says with what the integration needs, and it separates "set up correctly" from
 *  "a lead has really been imported". Meta only sends real lead webhooks once the app is published; in Development mode use Meta's Lead Ads Testing Tool plus "Check for missed leads". */
export const metaSelfTest = callable(z.object({}), async (req) => {
  requirePerm(req, 'marketing.manage')
  const checks: Check[] = [], add = (c: Check) => checks.push({ required: true, ...c })
  const appId = process.env.META_APP_ID, secret = process.env.META_APP_SECRET, verify = process.env.META_VERIFY_TOKEN
  add({ id: 'app_id', label: 'Meta app ID configured', ok: !isPlaceholder(appId), detail: appId ? `META_APP_ID is set (${appId.slice(0, 4)}…)` : 'META_APP_ID is not set', fix: 'Add META_APP_ID=<your app id> to functions/.env and redeploy functions.' })
  add({ id: 'app_secret', label: 'Meta app secret saved', ok: !isPlaceholder(secret), detail: isPlaceholder(secret) ? 'META_APP_SECRET is missing or still the placeholder' : 'Saved', fix: 'Run: firebase functions:secrets:set META_APP_SECRET (value from Meta app → App settings → Basic), then redeploy.' })
  add({ id: 'verify_token', label: 'Webhook verify token saved', ok: !isPlaceholder(verify), detail: isPlaceholder(verify) ? 'META_VERIFY_TOKEN is missing or still the placeholder' : 'Saved', fix: 'Run: firebase functions:secrets:set META_VERIFY_TOKEN with a long random string, redeploy, and enter the same string in Meta → Webhooks.' })
  const app = resolveAppUrl(process.env.APP_URL)
  add({ id: 'app_url', label: 'App web address valid', ok: app.valid, detail: `${app.url}${app.problem ? ` (${app.problem})` : ''}`, fix: 'Set APP_URL in functions/.env to the https address that actually loads the app.' })
  const assets = (await db.doc('metaAssets/main').get()).data()
  const connected = assets?.status === 'connected'
  add({ id: 'connected', label: 'Meta account connected', ok: connected, detail: connected ? `Connected as ${assets?.metaUserName ?? 'unknown'}` : assets?.status === 'reauth_required' ? `Reconnect needed: ${assets.statusReason ?? ''}` : 'Not connected', fix: 'Press "Connect Meta account" and sign in with the Facebook account that manages your Page.' })
  const configured = checks.every(c => c.ok || c.id === 'connected')
  let permsOk = false, missing: string[] = []
  if (configured && connected) {
    const token = MOCK() ? 'mock' : await userToken().catch(() => '')
    try {
      await graph('/me', { token, params: { fields: 'id,name' } })
      add({ id: 'token', label: 'Access token accepted by Meta', ok: true, detail: 'Meta accepted the stored token' })
      const perms = await graph('/me/permissions', { token }), granted = new Set((perms.data as { permission: string; status: string }[]).filter(p => p.status === 'granted').map(p => p.permission))
      const must = ['leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'ads_read'], want = META_SCOPES.filter(x => !must.includes(x))
      missing = must.filter(x => !granted.has(x)); permsOk = !missing.length
      add({ id: 'permissions', label: 'Required permissions granted', ok: permsOk, detail: permsOk ? 'All required permissions are granted' : `Missing: ${missing.join(', ')}`, fix: 'Reconnect and approve every permission. For people outside your own app team these need Meta App Review.' })
      const optional = want.filter(x => !granted.has(x)); if (optional.length) add({ id: 'permissions_optional', label: 'Optional permissions (campaign controls)', ok: false, required: false, detail: `Not granted: ${optional.join(', ')}. Campaign pause/budget controls may be refused by Meta.`, fix: 'Reconnect and approve them if you want campaign controls.' })
      for (const pg of (assets?.pages ?? []) as { id: string; name: string }[]) {
        const subs = await graph(`/${pg.id}/subscribed_apps`, { token: MOCK() ? 'mock' : await pageToken(pg.id) }).catch((e: Error) => ({ error: e.message }))
        const fields = ((subs as any).data ?? []).flatMap((a: any) => a.subscribed_fields ?? [])
        add({ id: `page_${pg.id}`, label: `Page “${pg.name}” sends leads to this app`, ok: fields.includes('leadgen'), detail: (subs as any).error ? `Could not check: ${(subs as any).error}` : fields.includes('leadgen') ? 'Subscribed to leadgen' : 'Page is not subscribed to leadgen', fix: 'Reconnect Meta (it subscribes your Pages), and make sure the connecting person is an admin of the Page.' })
      }
      if (!isPlaceholder(appId) && !isPlaceholder(secret)) {
        const sub = await graph(`/${appId}/subscriptions`, { token: `${appId}|${secret}` }).catch((e: Error) => ({ error: e.message }))
        const mine = ((sub as any).data ?? []).find((x: any) => x.object === 'page')
        const hasLead = (mine?.fields ?? []).some((f: any) => f.name === 'leadgen'), cbOk = mine?.callback_url === expectedWebhookUrl()
        add({ id: 'app_webhook', label: 'Meta webhook points at this app (Page → leadgen)', ok: !!mine?.active && hasLead && cbOk, detail: (sub as any).error ? `Could not check: ${(sub as any).error}` : !mine ? 'No Page webhook is configured in your Meta app' : `${cbOk ? 'Callback URL correct' : `Callback is ${mine.callback_url}, expected ${expectedWebhookUrl()}`}; leadgen ${hasLead ? 'subscribed' : 'NOT subscribed'}`, fix: `In your Meta app → Webhooks → Page: callback ${expectedWebhookUrl()}, your verify token, subscribe to leadgen.` })
      }
    } catch (e: any) {
      if (isAuthError(e)) await markReauth(e.message)
      add({ id: 'token', label: 'Access token accepted by Meta', ok: false, detail: `Meta rejected the token: ${String(e.message).slice(0, 160)}`, fix: 'Press "Reconnect Meta".' })
    }
  }
  const [lastEvent, lastLead, anyLead] = await Promise.all([db.collection('metaWebhookEvents').orderBy('receivedAt', 'desc').limit(1).get(), db.collection('metaLeads').orderBy('createdAt', 'desc').limit(1).get(), db.collection('metaLeads').where('status', '!=', 'new').limit(1).get()])
  const ingestionVerified = !anyLead.empty
  const ms = (d?: FirebaseFirestore.QueryDocumentSnapshot, f = 'receivedAt') => d?.data()?.[f]?.toMillis?.() ?? null
  const required = checks.filter(c => c.required !== false)
  const overall = !configured ? 'not_configured' : !connected ? 'not_connected' : required.every(c => c.ok) ? 'ready' : 'needs_attention'
  return { overall, ingestionVerified, lastWebhookAt: ms(lastEvent.docs[0]), lastLeadAt: ms(lastLead.docs[0], 'createdAt'), checks,
    notes: ['While your Meta app is in Development mode, Meta only delivers test webhooks sent from its dashboard; real lead webhooks start after the app is published. Until then use Meta’s Lead Ads Testing Tool, then press “Check for missed leads”.',
      ingestionVerified ? 'At least one lead has been imported, so the import path has worked end to end.' : 'No lead has been imported yet, so lead import is NOT verified, even if every check above passes.'] }
})
