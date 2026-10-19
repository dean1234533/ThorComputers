import { onRequest } from 'firebase-functions/v2/https'
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { db, FieldValue, Timestamp, HttpsError, callable, requireRole, LINKS, REGION } from './core'
import { sendEmail, p } from './email'
import { advanceLeadDoc } from './leads'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const Body = z.object({
  submissionId: z.string().min(6).max(80),
  consent: z.literal(true),                                   // visitor must have agreed to share the enquiry with Thor's platform
  fields: z.object({
    first_name: z.string().trim().min(1).max(80), email: z.string().trim().toLowerCase().email().max(120),
    phone: z.string().trim().max(30).optional().default(''), postal_code: z.string().trim().toUpperCase().max(10).optional().default(''),
    brand: z.string().trim().max(60).optional().default(''), model: z.string().trim().max(80).optional().default(''),
    serial_n: z.string().trim().max(60).optional().default(''), problem: z.string().trim().min(5).max(2000),
  }),
})

/** Signed server-to-server endpoint called by the WordPress plugin (never from the visitor's browser). */
export const wpIntake = onRequest({ region: REGION, cors: false }, async (req, res) => {
  const secret = process.env.WP_INTAKE_SECRET
  if (req.method !== 'POST' || !secret) { res.status(405).json({ error: 'method' }); return }
  const ts = Number(req.header('x-thor-timestamp')), sig = req.header('x-thor-signature') ?? ''
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) { res.status(401).json({ error: 'stale' }); return }
  const expected = createHmac('sha256', secret).update(`${ts}.${(req.rawBody ?? Buffer.from('')).toString('utf8')}`).digest('hex')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).json({ error: 'signature' }); return }

  const parsed = Body.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'invalid', issues: parsed.error.issues.map(i => i.path.join('.')) }); return }
  const { submissionId, fields } = parsed.data
  const id = sha(`wp:${submissionId}`).slice(0, 40)
  const ref = db.doc(`enquiries/${id}`)

  // Rate limit per visitor email (the plugin also limits per IP before calling us).
  const emailHash = sha(fields.email)
  const recent = await db.collection('enquiries').where('emailHash', '==', emailHash).where('createdAt', '>', Timestamp.fromMillis(Date.now() - 3600_000)).count().get()
  if (recent.data().count >= 5) { res.status(429).json({ error: 'rate_limited' }); return }

  const token = randomBytes(24).toString('hex')
  try {
    await ref.create({ source: 'wordpress', submissionId, status: 'awaiting_customer', fields, email: fields.email, emailHash, tokenHash: sha(token), createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 14 * 86400_000), consentAt: FieldValue.serverTimestamp() })
  } catch (e: any) {
    if (e.code === 6) { res.status(200).json({ ok: true, duplicate: true }); return }   // WordPress retried: do nothing, no second email
    throw e
  }
  await db.collection('integrationEvents').add({ type: 'wp.intake', enquiryId: id, createdAt: FieldValue.serverTimestamp() })
  const url = LINKS.continueLink(id, token)
  await sendEmail({ to: fields.email, subject: 'Confirm your Thor Computer repair request', heading: `Thanks, ${fields.first_name}`,
    html: `<p>We received your repair enquiry${fields.brand ? ` for your <b>${p(fields.brand)} ${p(fields.model)}</b>` : ''}.</p><p>Create a free account or sign in to confirm the details. Your request will then be sent to approved engineers, who will send you quotes to compare. Nothing is shared with engineers until you confirm.</p>`,
    cta: { label: 'Confirm my request', url } }).catch(e => console.error('wp intake email failed', e.message))
  res.status(200).json({ ok: true, enquiryId: id })
})

export async function verifyEnquiry(id: string, token: string, email: string) {
  const ref = db.doc(`enquiries/${id}`), snap = await ref.get(), e = snap.data()
  if (!e || e.tokenHash !== sha(token)) throw new HttpsError('permission-denied', 'This link is not valid.')
  if (e.status !== 'awaiting_customer') throw new HttpsError('failed-precondition', 'This enquiry has already been used.')
  if (e.expiresAt.toMillis() < Date.now()) throw new HttpsError('deadline-exceeded', 'This link has expired.')
  if (e.email !== email) throw new HttpsError('permission-denied', 'Sign in with the email address you used for this repair enquiry.')
  return { ref, data: e }
}

/** Lets the signed-in, email-matching customer prefill the request wizard. */
export const getEnquiry = callable(z.object({ id: z.string().max(80), token: z.string().max(80) }), async (req, d) => {
  const c = requireRole(req, 'customer')
  const { data } = await verifyEnquiry(d.id, d.token, String(c.token.email).toLowerCase())
  if (['meta', 'website'].includes(data.source) && data.metaLeadId) await advanceLeadDoc(data.metaLeadId, 'verified', 'verified')   // the customer proved they own the email address
  return { fields: data.fields, source: data.source ?? 'wordpress' }
})
