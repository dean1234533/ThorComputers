import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getMessaging } from 'firebase-admin/messaging'
import { HttpsError, CallableRequest, onCall } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { z, ZodTypeAny } from 'zod'
import { randomBytes } from 'node:crypto'
import { resolveAppUrl, appLinks } from './app-url'
import { sendEmail } from './email'

initializeApp()
setGlobalOptions({ region: 'europe-west2', maxInstances: 20, secrets: ['WP_INTAKE_SECRET'] })
export const db = getFirestore()
export const auth = getAuth()
export const messaging = getMessaging()
export { FieldValue, Timestamp, HttpsError }

export const REGION = 'europe-west2'
const appUrl = resolveAppUrl(process.env.APP_URL)
if (!appUrl.valid || appUrl.problem) console.error(JSON.stringify({ severity: appUrl.valid ? 'WARNING' : 'ERROR', message: 'APP_URL configuration', problem: appUrl.problem, using: appUrl.url }))
export const APP_URL = appUrl.url
export const LINKS = appLinks(APP_URL)
/** The Firebase client SDK serialises `undefined` as `null`, which zod's .optional() rejects ("Expected object, received null"). Treat null as "not provided". */
export const stripNulls = (v: unknown): unknown => Array.isArray(v) ? v.map(stripNulls)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)])) : v
export const callable = <T extends ZodTypeAny, R>(schema: T, fn: (req: CallableRequest, data: z.infer<T>) => Promise<R>, opts: { secrets?: string[]; maxInstances?: number; timeoutSeconds?: number } = {}) =>
  onCall({ region: REGION, enforceAppCheck: false, cors: true, ...opts }, async (req) => {
    const parsed = schema.safeParse(stripNulls(req.data ?? {}))
    if (!parsed.success) throw new HttpsError('invalid-argument', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
    if (req.auth) await assertAccountCurrent(req)
    try { return await fn(req, parsed.data) }
    catch (e) { if (e instanceof HttpsError) throw e; throw internalError(e, process.env.K_SERVICE ?? 'callable', req.auth?.uid) }
  })

/** Anything that is not an HttpsError would reach the browser as a bare "INTERNAL". Log the real cause (never sent to the client) and give the user a reference to quote. */
export function internalError(e: unknown, where: string, uid?: string): HttpsError {
  const ref = 'E' + randomBytes(3).toString('hex').toUpperCase()
  const err = e as { code?: unknown; message?: unknown; stack?: unknown }
  console.error(JSON.stringify({ severity: 'ERROR', message: 'unexpected callable failure', ref, where, uid: uid ? uid.slice(0, 6) + '…' : null, code: err?.code ?? null, error: String(err?.message ?? e).slice(0, 400), stack: String(err?.stack ?? '').split('\n').slice(0, 6).join(' | ') }))
  return new HttpsError('internal', `Something went wrong on our side (ref ${ref}).`)
}

/** ID tokens live up to an hour, so claims alone can be stale: a suspended user or a demoted admin would keep working until the token refreshed.
 *  One cheap read per call makes suspension/demotion take effect immediately for every callable. (Firestore/Storage rules still read the token claims.) */
async function assertAccountCurrent(req: CallableRequest) {
  const u = (await db.doc(`users/${req.auth!.uid}`).get()).data()
  if (!u) return                                                       // not registered yet (completeRegistration)
  if (u.status === 'suspended' || u.status === 'deleted') throw new HttpsError('permission-denied', 'This account is suspended.')
  if (req.auth!.token.role === 'admin') {
    const same = (a: unknown, b: unknown) => JSON.stringify([...((a as string[]) ?? [])].sort()) === JSON.stringify([...((b as string[]) ?? [])].sort())
    if (u.role !== 'admin' || !same(u.perms, req.auth!.token.perms)) throw new HttpsError('permission-denied', 'Your admin access has changed. Please sign out and in again.')
  }
}

// ---------- guards (authorisation is always decided here, from the verified token + Firestore) ----------
export interface Caller { uid: string; role: string; token: Record<string, any> }
export function requireAuth(req: CallableRequest): Caller {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.')
  if (req.auth.token.suspended === true) throw new HttpsError('permission-denied', 'This account is suspended.')
  return { uid: req.auth.uid, role: String(req.auth.token.role ?? ''), token: req.auth.token }
}
/** REQUIRE_ADMIN_MFA: "true" = refuse admin actions from sessions without a second factor; "warn" = allow but log; anything else = off.
 *  Roll out as off -> warn -> true, and only flip to true once adminMfaStatus shows every admin enrolled. */
export const adminMfaMode = () => (process.env.REQUIRE_ADMIN_MFA === 'true' ? 'enforce' : process.env.REQUIRE_ADMIN_MFA === 'warn' ? 'warn' : 'off') as 'enforce' | 'warn' | 'off'
export const MFA_REQUIRED_MESSAGE = 'mfa-required: Multi-factor authentication is required for admin actions. Open Admin > Security to enrol.'
export function requireRole(req: CallableRequest, role: 'customer' | 'engineer' | 'admin', opts: { skipMfa?: boolean } = {}): Caller {
  const c = requireAuth(req)
  if (c.role !== role) throw new HttpsError('permission-denied', `Requires ${role} account.`)
  if (role === 'admin' && !opts.skipMfa && !req.auth?.token.firebase?.sign_in_second_factor) {
    const mode = adminMfaMode()
    if (mode === 'enforce') throw new HttpsError('permission-denied', MFA_REQUIRED_MESSAGE)
    if (mode === 'warn') console.warn('admin action without MFA', c.uid)
  }
  return c
}
export function requireApprovedEngineer(req: CallableRequest): Caller {
  const c = requireRole(req, 'engineer')
  if (c.token.engineerApproved !== true) throw new HttpsError('permission-denied', 'Your engineer account is not approved yet.')
  return c
}
export function requirePerm(req: CallableRequest, perm: string): Caller {
  const c = requireRole(req, 'admin')
  // A super admin holds every permission, including ones added after their token was issued.
  if (c.token.adminLevel !== 'super_admin' && !(c.token.perms as string[] | undefined)?.includes(perm)) throw new HttpsError('permission-denied', `Missing permission: ${perm}`)
  return c
}

/** Strictly the Super Administrator (commission, payments, integrations). Not satisfiable by a custom permission list. */
export function requireSuperAdmin(req: CallableRequest): Caller {
  const c = requireRole(req, 'admin')
  if (c.token.adminLevel !== 'super_admin') throw new HttpsError('permission-denied', 'Only a Super Administrator can do this.')
  return c
}

export async function audit(actorId: string, action: string, target: string, detail: Record<string, unknown> = {}) {
  await db.collection('auditLogs').add({ actorId, action, target, detail, createdAt: FieldValue.serverTimestamp() })
}

// ---------- notifications ----------
export type NotifCategory = 'quotes' | 'messages' | 'bookings' | 'status' | 'reviews' | 'admin' | 'account'
export interface NotifyInput {
  userId: string; dedupeKey: string; category: NotifCategory
  title: string; body: string           // Generic copy: shown on lock screens, so never include PII, addresses or message text.
  link: string                          // In-app deep link
  email?: { subject: string; heading: string; html: string; cta?: string }
}

/** Writes the in-app notification using dedupeKey as doc id, so retries/duplicate events can never notify twice. */
export async function notify(n: NotifyInput): Promise<boolean> {
  const id = n.dedupeKey.replace(/[\/\s]/g, '_').slice(0, 200)
  try {
    await db.collection('notifications').doc(id).create({
      userId: n.userId, category: n.category, title: n.title, body: n.body, link: n.link,
      read: false, createdAt: FieldValue.serverTimestamp(),
    })
  } catch (e: any) {
    if (e.code === 6 /* ALREADY_EXISTS */) return false
    throw e
  }
  const user = (await db.collection('users').doc(n.userId).get()).data()
  if (!user || user.status === 'deleted') return true
  const prefs = user.notificationPrefs ?? {}
  if (prefs.push?.[n.category] !== false) await pushTo(n.userId, n)
  if (n.email && prefs.email?.[n.category] !== false && user.email) {
    await sendEmail({ to: user.email, subject: n.email.subject, heading: n.email.heading, html: n.email.html, cta: n.email.cta ? { label: n.email.cta, url: APP_URL + n.link } : undefined })
      .catch(err => console.error('email failed', n.dedupeKey, err.message))
  }
  return true
}

async function pushTo(userId: string, n: NotifyInput) {
  if (process.env.FUNCTIONS_EMULATOR === 'true' || process.env.MOCK_EXTERNAL === 'true') { console.log('[mock push]', userId, n.title); return }   // never call real FCM from local runs
  const snap = await db.collection('deviceTokens').where('userId', '==', userId).get()
  if (snap.empty) return
  const tokens = snap.docs.map(d => d.data().token as string)
  const res = await messaging.sendEachForMulticast({
    tokens,
    // data-only so the service worker controls display; no sensitive content ever leaves via push
    data: { title: n.title, body: n.body, link: n.link, tag: n.dedupeKey },
    webpush: { headers: { Urgency: 'normal', TTL: '86400' }, fcmOptions: { link: APP_URL + n.link } },
  })
  const dead = res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code ?? '') ? snap.docs[i].ref : null)).filter(Boolean)
  await Promise.all(dead.map(r => r!.delete()))
}

export const notifyAdmins = async (perm: string, n: Omit<NotifyInput, 'userId'>) => {
  const admins = await db.collection('users').where('role', '==', 'admin').where('status', '==', 'active').get()
  await Promise.all(admins.docs.filter(d => (d.data().perms ?? []).includes(perm)).map(d => notify({ ...n, userId: d.id, dedupeKey: `${n.dedupeKey}:${d.id}` })))
}

// ---------- claims ----------
export async function setClaims(uid: string, claims: Record<string, unknown>) {
  const u = await auth.getUser(uid)
  await auth.setCustomUserClaims(uid, { ...(u.customClaims ?? {}), ...claims })
  await db.collection('users').doc(uid).set({ claimsUpdatedAt: FieldValue.serverTimestamp() }, { merge: true })
}

export const ref = () => 'THR-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).toUpperCase().slice(2, 5)

/** Marketplace actions need a verified email (Google sign-in is verified by default). */
export function requireVerified(c: Caller) {
  if (c.token.email_verified !== true) throw new HttpsError('failed-precondition', 'Please verify your email address first.')
}
