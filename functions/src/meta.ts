// Meta (Facebook / Instagram) integration: OAuth connection, Graph/Marketing API, Lead Ads webhooks, campaign insights and controls.
// Tokens are stored AES-256-GCM encrypted in metaSecrets (no client access by rules); the key is the META_TOKEN_KEY secret.
// Nothing here is simulated: without credentials the calls fail with a clear message and the admin page shows "Not connected".
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { z } from 'zod'
import { db, callable, requirePerm, requireSuperAdmin, audit, notifyAdmins, FieldValue, Timestamp, HttpsError, APP_URL, REGION, isMock } from './core'
import { appSecretProof, decryptSecret, encryptSecret, newToken, sha256, verifyMetaSignature } from './security'
import { marketingSettings } from './settings'

export const META_SECRETS = ['META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN', 'META_TOKEN_KEY']
const opts = { secrets: META_SECRETS }
const VERSION = () => process.env.META_GRAPH_VERSION || 'v24.0'
const GRAPH = () => (isMock() && process.env.META_GRAPH_BASE) || `https://graph.facebook.com/${VERSION()}`
const APP_ID = () => process.env.META_APP_ID ?? ''
const PROJECT = () => process.env.GCLOUD_PROJECT ?? JSON.parse(process.env.FIREBASE_CONFIG ?? '{}').projectId
export const REDIRECT_URI = () => process.env.META_OAUTH_REDIRECT_URI || `https://${REGION}-${PROJECT()}.cloudfunctions.net/metaOAuthCallback`
/** Least privilege: leads + ads read/manage + page listing. Instagram lead ads are delivered through the linked Facebook Page. */
export const META_SCOPES = ['ads_read', 'ads_management', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'pages_manage_metadata', 'business_management']
export const metaConfigured = () => !!APP_ID() && !!process.env.META_APP_SECRET && !!process.env.META_TOKEN_KEY && (!isMock() || !!process.env.META_GRAPH_BASE)

export class MetaError extends Error { constructor(msg: string, public code?: number, public sub?: number, public type?: string) { super(msg) } }
/** Graph request with appsecret_proof. Maps Meta errors (expired token, missing permission) to useful messages. */
export async function graph<T = any>(path: string, token: string, params: Record<string, string | number> = {}, method: 'GET' | 'POST' | 'DELETE' = 'GET'): Promise<T> {
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), access_token: token, appsecret_proof: appSecretProof(token, process.env.META_APP_SECRET ?? '') })
  const url = `${GRAPH()}/${path.replace(/^\//, '')}`
  const r = await fetch(method === 'GET' || method === 'DELETE' ? `${url}?${qs}` : url, { method, signal: AbortSignal.timeout(15000), ...(method === 'POST' ? { body: qs, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {}) })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || j.error) {
    const e = j.error ?? {}
    if (e.code === 190) await markReauth(e.message)
    throw new MetaError(e.message ?? `Meta API error ${r.status}`, e.code, e.error_subcode, e.type)
  }
  return j as T
}
async function graphAll<T>(path: string, token: string, params: Record<string, string | number> = {}, max = 1000): Promise<T[]> {
  const out: T[] = []; let after: string | undefined
  do { const page: any = await graph(path, token, { limit: 100, ...params, ...(after ? { after } : {}) }); out.push(...(page.data ?? [])); after = page.paging?.next ? page.paging?.cursors?.after : undefined } while (after && out.length < max)
  return out
}
const friendly = (e: unknown) => e instanceof MetaError ? (e.code === 10 || e.code === 200 || (e.code ?? 0) >= 200 && (e.code ?? 0) < 300 ? `Meta did not allow this (missing permission): ${e.message}` : e.code === 190 ? 'The Meta connection has expired. Reconnect the account.' : e.message) : String((e as Error)?.message ?? e)
const fail = (e: unknown): never => { throw new HttpsError('failed-precondition', friendly(e)) }

async function markReauth(message: string) {
  await db.doc('metaConnections/default').set({ status: 'reauth_required', statusMessage: String(message).slice(0, 300), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  await db.doc('integrationHealth/meta').set({ tokenStatus: 'expired', lastError: String(message).slice(0, 300), lastErrorAt: FieldValue.serverTimestamp() }, { merge: true })
}
const key = () => { const k = process.env.META_TOKEN_KEY; if (!k) throw new HttpsError('failed-precondition', 'META_TOKEN_KEY is not configured.'); return k }
export async function userToken(): Promise<string> {
  const s = (await db.doc('metaSecrets/user').get()).data()
  if (!s?.tokenEnc) throw new HttpsError('failed-precondition', 'No Meta account is connected.')
  return decryptSecret(s.tokenEnc, key())
}
export async function pageToken(pageId: string): Promise<string | null> {
  const s = (await db.doc(`metaSecrets/page_${pageId}`).get()).data()
  return s?.tokenEnc ? decryptSecret(s.tokenEnc, key()) : null
}

// ---------- OAuth connection (no passwords ever pass through Thor Computer) ----------
export const metaAuthStart = callable(z.object({}), async (req) => {
  const c = requireSuperAdmin(req, 'marketing.manage')
  if (!metaConfigured()) throw new HttpsError('failed-precondition', 'Meta app credentials are not configured (META_APP_ID, META_APP_SECRET, META_TOKEN_KEY). See docs/DEPLOYMENT.md.')
  const state = newToken()
  await db.doc(`metaOAuthStates/${sha256(state)}`).set({ uid: c.uid, expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000) })
  const u = new URL(`https://www.facebook.com/${VERSION()}/dialog/oauth`)
  u.search = new URLSearchParams({ client_id: APP_ID(), redirect_uri: REDIRECT_URI(), state, response_type: 'code', scope: META_SCOPES.join(',') }).toString()
  return { url: u.toString() }
}, opts)

export const metaOAuthCallback = onRequest({ region: REGION, cors: false, secrets: META_SECRETS }, async (req, res) => {
  const back = (q: string) => res.redirect(302, `${APP_URL}/admin/marketing?${q}`)
  const state = String(req.query.state ?? ''), code = String(req.query.code ?? '')
  if (req.query.error) { back(`meta=denied`); return }
  const sRef = db.doc(`metaOAuthStates/${sha256(state)}`)
  const st = await db.runTransaction(async tx => { const s = await tx.get(sRef); if (s.exists) tx.delete(sRef); return s.data() })   // single use
  if (!st || st.expiresAt.toMillis() < Date.now() || !code) { back('meta=invalid_state'); return }
  try {
    const params = { client_id: APP_ID(), client_secret: process.env.META_APP_SECRET!, redirect_uri: REDIRECT_URI() }
    const short = await fetch(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ ...params, code })}`).then(r => r.json()) as any
    if (!short.access_token) throw new Error(short.error?.message ?? 'Token exchange failed')
    const long = await fetch(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: params.client_id, client_secret: params.client_secret, fb_exchange_token: short.access_token })}`).then(r => r.json()) as any
    const token = long.access_token ?? short.access_token
    await db.doc('metaSecrets/user').set({ tokenEnc: encryptSecret(token, key()), expiresAt: long.expires_in ? Timestamp.fromMillis(Date.now() + long.expires_in * 1000) : null, updatedAt: FieldValue.serverTimestamp() })
    const me = await graph<{ id: string; name: string }>('me', token, { fields: 'id,name' })
    const perms = await graph<{ data: { permission: string; status: string }[] }>('me/permissions', token)
    await db.doc('metaConnections/default').set({ status: 'connected', statusMessage: null, metaUserId: me.id, metaUserName: me.name, connectedBy: st.uid, connectedAt: FieldValue.serverTimestamp(),
      tokenExpiresAt: long.expires_in ? Timestamp.fromMillis(Date.now() + long.expires_in * 1000) : null,
      grantedScopes: perms.data.filter(p => p.status === 'granted').map(p => p.permission), declinedScopes: perms.data.filter(p => p.status !== 'granted').map(p => p.permission), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    await syncAssets(token)
    await db.doc('integrationHealth/meta').set({ tokenStatus: 'ok', lastError: null, connectedAt: FieldValue.serverTimestamp() }, { merge: true })
    await audit(st.uid, 'meta.connect', 'metaConnections/default', { metaUser: me.id })
    back('meta=connected')
  } catch (e) {
    console.error('meta oauth failed', (e as Error).message)
    await db.doc('integrationHealth/meta').set({ lastError: friendly(e).slice(0, 300), lastErrorAt: FieldValue.serverTimestamp() }, { merge: true })
    back('meta=error')
  }
})

/** Pages (+ linked Instagram business accounts), ad accounts and lead forms. Pages are subscribed to the leadgen webhook. */
export async function syncAssets(token: string) {
  const pages = await graphAll<any>('me/accounts', token, { fields: 'id,name,access_token,tasks,instagram_business_account{id,username}' })
  const pageInfo = []
  for (const pg of pages) {
    await db.doc(`metaSecrets/page_${pg.id}`).set({ tokenEnc: encryptSecret(pg.access_token, key()), updatedAt: FieldValue.serverTimestamp() })
    let subscribed = false, subscribeError: string | null = null
    try { await graph(`${pg.id}/subscribed_apps`, pg.access_token, { subscribed_fields: 'leadgen' }, 'POST'); subscribed = true } catch (e) { subscribeError = friendly(e) }
    let forms = 0
    try {
      const fs = await graphAll<any>(`${pg.id}/leadgen_forms`, pg.access_token, { fields: 'id,name,status,locale,questions,created_time' })
      forms = fs.length
      for (const f of fs) await db.doc(`metaLeadForms/${f.id}`).set({ formId: f.id, pageId: pg.id, name: f.name, status: f.status, locale: f.locale ?? null,
        questions: (f.questions ?? []).map((q: any) => ({ key: q.key, label: q.label ?? q.key, type: q.type })), createdTime: f.created_time ?? null, syncedAt: FieldValue.serverTimestamp() }, { merge: true })
    } catch (e) { subscribeError ??= friendly(e) }
    pageInfo.push({ id: pg.id, name: pg.name, instagramId: pg.instagram_business_account?.id ?? null, instagramUsername: pg.instagram_business_account?.username ?? null, subscribed, subscribeError, forms })
  }
  const ads = await graphAll<any>('me/adaccounts', token, { fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent' }).catch(e => { console.warn('adaccounts', friendly(e)); return [] })
  for (const a of ads) await db.doc(`metaAdAccounts/${a.id}`).set({ id: a.id, name: a.name, status: a.account_status, currency: a.currency, timezone: a.timezone_name ?? null, syncedAt: FieldValue.serverTimestamp() }, { merge: true })
  await db.doc('metaConnections/default').set({ pages: pageInfo, adAccounts: ads.map(a => ({ id: a.id, name: a.name, currency: a.currency })), assetsSyncedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { pages: pageInfo.length, adAccounts: ads.length }
}

export const metaSyncAssets = callable(z.object({}), async (req) => {
  const c = requirePerm(req, 'marketing.manage')
  const r = await syncAssets(await userToken()).catch(fail)
  await audit(c.uid, 'meta.sync_assets', 'metaConnections/default', r)
  return r
}, opts)

export const metaDisconnect = callable(z.object({ confirm: z.literal(true) }), async (req) => {
  const c = requireSuperAdmin(req, 'marketing.manage')
  const secrets = await db.collection('metaSecrets').get()
  const b = db.batch(); secrets.docs.forEach(d => b.delete(d.ref))
  b.set(db.doc('metaConnections/default'), { status: 'disconnected', disconnectedAt: FieldValue.serverTimestamp(), disconnectedBy: c.uid }, { merge: true }); await b.commit()
  await audit(c.uid, 'meta.disconnect', 'metaConnections/default')
  return { ok: true }
}, opts)

// ---------- campaigns & insights ----------
const LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'offsite_conversion.fb_pixel_lead']
const minor = (v?: string) => Math.round(Number(v ?? 0) * 100)
export async function syncCampaigns(days = 30) {
  const token = await userToken()
  const accounts = (await db.doc('metaConnections/default').get()).data()?.adAccounts ?? []
  let campaigns = 0, rows = 0
  for (const a of accounts as { id: string; currency: string }[]) {
    const cs = await graphAll<any>(`${a.id}/campaigns`, token, { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,updated_time' })
    for (const c of cs) {
      const ref = db.doc(`metaCampaigns/${c.id}`), prev = (await ref.get()).data()
      await ref.set({ id: c.id, adAccountId: a.id, currency: a.currency, name: c.name, status: c.status, effectiveStatus: c.effective_status, objective: c.objective,
        dailyBudgetPence: c.daily_budget ? Number(c.daily_budget) : null, lifetimeBudgetPence: c.lifetime_budget ? Number(c.lifetime_budget) : null, startTime: c.start_time ?? null, stopTime: c.stop_time ?? null,
        feedsMarketplace: prev?.feedsMarketplace ?? true, syncedAt: FieldValue.serverTimestamp() }, { merge: true })
      campaigns++
    }
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10), until = new Date().toISOString().slice(0, 10)
    const ins = await graphAll<any>(`${a.id}/insights`, token, { level: 'campaign', time_increment: 1, time_range: JSON.stringify({ since, until }), fields: 'campaign_id,campaign_name,date_start,spend,impressions,reach,clicks,actions' }, 5000)
    const b = db.bulkWriter()
    for (const r of ins) {
      const leads = (r.actions ?? []).filter((x: any) => LEAD_ACTIONS.includes(x.action_type)).reduce((n: number, x: any) => Math.max(n, Number(x.value)), 0)
      b.set(db.doc(`metaInsightsDaily/${r.campaign_id}_${r.date_start}`), { campaignId: r.campaign_id, adAccountId: a.id, currency: a.currency, date: r.date_start, spendPence: minor(r.spend), impressions: Number(r.impressions ?? 0), reach: Number(r.reach ?? 0), clicks: Number(r.clicks ?? 0), metaLeads: leads, syncedAt: FieldValue.serverTimestamp() })
      rows++
    }
    await b.close()
  }
  await db.doc('integrationHealth/meta').set({ lastCampaignSyncAt: FieldValue.serverTimestamp() }, { merge: true })
  return { campaigns, insightRows: rows }
}
export const metaSyncCampaigns = callable(z.object({ days: z.number().int().min(1).max(90).default(30) }), async (req, d) => {
  requirePerm(req, 'marketing.view')
  return syncCampaigns(d.days).catch(fail)
}, opts)
export const metaHourlySync = onSchedule({ region: REGION, schedule: 'every 60 minutes', secrets: META_SECRETS }, async () => {
  const conn = (await db.doc('metaConnections/default').get()).data()
  if (conn?.status !== 'connected' || !metaConfigured()) return
  await syncCampaigns(3).catch(e => db.doc('integrationHealth/meta').set({ lastError: friendly(e).slice(0, 300), lastErrorAt: FieldValue.serverTimestamp() }, { merge: true }))
  const exp = conn.tokenExpiresAt?.toMillis()
  if (exp && exp < Date.now() + 7 * 86400_000) await notifyAdmins('marketing.manage', { category: 'admin', dedupeKey: `meta-expiry:${new Date(exp).toISOString().slice(0, 10)}`, title: 'Meta connection expires soon', body: 'Reconnect the Meta account to keep importing leads.', link: '/admin/marketing' })
})

export const metaListChildren = callable(z.object({ parentId: z.string().regex(/^\d+$/), level: z.enum(['adsets', 'ads']) }), async (req, d) => {
  requirePerm(req, 'marketing.view')
  const fields = d.level === 'adsets' ? 'id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal' : 'id,name,status,effective_status,creative{title,thumbnail_url}'
  const rows = await graphAll<any>(`${d.parentId}/${d.level}`, await userToken(), { fields }, 200).catch(fail)
  return { rows: rows.map(r => ({ id: r.id, name: r.name, status: r.status, effectiveStatus: r.effective_status, dailyBudgetPence: r.daily_budget ? Number(r.daily_budget) : null, lifetimeBudgetPence: r.lifetime_budget ? Number(r.lifetime_budget) : null, title: r.creative?.title ?? null })) }
}, opts)

/** Financial changes need explicit confirmation, stay within configured safety limits and are audited. Nothing here runs automatically. */
export const metaUpdateCampaign = callable(z.object({
  campaignId: z.string().regex(/^\d+$/), action: z.enum(['pause', 'resume', 'set_daily_budget', 'feed_marketplace', 'stop_feeding_marketplace']),
  dailyBudgetPence: z.number().int().min(100).optional(), confirm: z.literal(true), reason: z.string().trim().min(5).max(300),
}), async (req, d) => {
  const c = requirePerm(req, 'marketing.manage')
  const ref = db.doc(`metaCampaigns/${d.campaignId}`), cur = (await ref.get()).data()
  if (!cur) throw new HttpsError('not-found', 'Sync campaigns first.')
  if (d.action === 'feed_marketplace' || d.action === 'stop_feeding_marketplace') {
    await ref.update({ feedsMarketplace: d.action === 'feed_marketplace' })
  } else {
    const token = await userToken()
    if (d.action === 'set_daily_budget') {
      const ms = await marketingSettings()
      if (!d.dailyBudgetPence) throw new HttpsError('invalid-argument', 'Enter the new daily budget.')
      if (cur.dailyBudgetPence === null || cur.dailyBudgetPence === undefined) throw new HttpsError('failed-precondition', 'This campaign has no campaign-level daily budget (budgets are set on its ad sets). Change it in Meta Ads Manager.')
      if (d.dailyBudgetPence > ms.maxDailyBudgetPence) throw new HttpsError('failed-precondition', `That is above the safety limit of £${(ms.maxDailyBudgetPence / 100).toFixed(2)} per day. A super administrator can change the limit.`)
      if (Math.abs(d.dailyBudgetPence - cur.dailyBudgetPence) > cur.dailyBudgetPence * ms.maxBudgetChangePercent / 100) throw new HttpsError('failed-precondition', `Budget changes are limited to ${ms.maxBudgetChangePercent}% at a time.`)
      await graph(d.campaignId, token, { daily_budget: d.dailyBudgetPence }, 'POST').catch(fail)
      await ref.update({ dailyBudgetPence: d.dailyBudgetPence })
    } else {
      const status = d.action === 'pause' ? 'PAUSED' : 'ACTIVE'
      await graph(d.campaignId, token, { status }, 'POST').catch(fail)
      await ref.update({ status })
    }
  }
  await audit(c.uid, `meta.campaign.${d.action}`, `metaCampaigns/${d.campaignId}`, { from: { status: cur.status, dailyBudgetPence: cur.dailyBudgetPence ?? null }, dailyBudgetPence: d.dailyBudgetPence ?? null, reason: d.reason })
  return { ok: true }
}, opts)

// ---------- Lead Ads webhook ----------
/** Verified, fast and idempotent: each leadgen id becomes one metaWebhookEvents document (create-once) and processing happens in a trigger. */
export const metaWebhook = onRequest({ region: REGION, cors: false, secrets: META_SECRETS }, async (req, res) => {
  if (req.method === 'GET') {
    const ok = req.query['hub.mode'] === 'subscribe' && !!process.env.META_WEBHOOK_VERIFY_TOKEN && req.query['hub.verify_token'] === process.env.META_WEBHOOK_VERIFY_TOKEN
    if (ok) res.status(200).send(String(req.query['hub.challenge'] ?? '')); else res.status(403).send('forbidden')
    return
  }
  if (req.method !== 'POST') { res.status(405).send('method'); return }
  if (!verifyMetaSignature(req.rawBody ?? Buffer.from(''), req.header('x-hub-signature-256'), process.env.META_APP_SECRET ?? '')) { res.status(401).send('signature'); return }
  const body = req.body ?? {}
  let accepted = 0, duplicates = 0
  if (body.object === 'page') {
    for (const entry of body.entry ?? []) for (const ch of entry.changes ?? []) {
      if (ch.field !== 'leadgen' || !ch.value?.leadgen_id) continue
      const v = ch.value
      try {
        await db.doc(`metaWebhookEvents/${String(v.leadgen_id)}`).create({ leadId: String(v.leadgen_id), pageId: String(v.page_id ?? entry.id ?? ''), formId: v.form_id ? String(v.form_id) : null, adId: v.ad_id ? String(v.ad_id) : null,
          adsetId: v.adgroup_id ? String(v.adgroup_id) : null, leadCreatedTime: v.created_time ?? null, source: 'webhook', status: 'received', attempts: 0, receivedAt: FieldValue.serverTimestamp() })
        accepted++
      } catch (e: any) { if (e.code === 6) duplicates++; else throw e }
    }
  }
  await db.doc('integrationHealth/meta').set({ lastWebhookAt: FieldValue.serverTimestamp(), webhookCount: FieldValue.increment(1) }, { merge: true })
  res.status(200).json({ accepted, duplicates })
})
