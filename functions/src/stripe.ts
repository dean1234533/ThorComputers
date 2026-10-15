import { onRequest } from 'firebase-functions/v2/https'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { db, callable, requireRole, requireApprovedEngineer, requireVerified, requirePerm, requireSuperAdmin, notify, notifyAdmins, audit, FieldValue, Timestamp, HttpsError, APP_URL, LINKS, REGION } from './core'
import { MOCK, formEncode, getFinanceSettings, health } from './external'
import { commissionSplit, commissionRefund, MAX_COMMISSION_BPS } from './money'
import { verifyStripeSignature } from './integrations-domain'
import { advanceLeadForJob } from './leads'
import { p } from './email'

/** Charge model: DESTINATION CHARGES. Thor Computer is the merchant of record: the customer pays the platform, Stripe transfers the engineer's share to their
 *  Connect account and keeps `application_fee_amount` (our commission) on the platform. Consequences, all deliberate:
 *   - Thor handles refunds and chargebacks (refunds use reverse_transfer + refund_application_fee, so the engineer's share and our commission are returned proportionally);
 *   - Stripe's processing fee is paid by the platform, so net platform revenue = commission - commission refunded - Stripe fees;
 *   - the engineer's money moves to their connected account on payment; Stripe pays it out to their bank on their own schedule. */
const STRIPE_SECRETS = ['STRIPE_SECRET_KEY']
type Params = Record<string, unknown>

/** What the engineer is still owed after refunds. A refund returns Thor's commission proportionally (commissionRefundedPence) and the rest comes out of the engineer's share. */
export const engineerRefundedPence = (t: { engineerSharePence: number; refundedPence?: number; commissionRefundedPence?: number }) =>
  Math.min(t.engineerSharePence, Math.max(0, (t.refundedPence ?? 0) - (t.commissionRefundedPence ?? 0)))
export const engineerRemainingPence = (t: { engineerSharePence: number; refundedPence?: number; commissionRefundedPence?: number }) => t.engineerSharePence - engineerRefundedPence(t)
/** Human label for the payout column: a fully reversed transaction is never "pending". */
export function payoutState(t: { status: string; payoutStatus?: string; engineerSharePence: number; refundedPence?: number; commissionRefundedPence?: number }): string {
  const left = engineerRemainingPence(t), reduced = engineerRefundedPence(t) > 0
  if (t.status === 'refunded' || left === 0) return 'reversed'
  if (t.payoutStatus === 'transferred') return reduced ? 'transferred (reduced)' : 'transferred'
  return reduced ? 'pending (reduced)' : 'pending'
}

const mockId = (prefix: string, seed: string) => `${prefix}_mock_${createHash('sha256').update(seed).digest('hex').slice(0, 14)}`
function mockStripe(method: string, path: string, params: Params): any {
  if (path === '/accounts' && method === 'POST') return { id: mockId('acct', JSON.stringify(params.metadata ?? randomBytes(4))) }
  if (path === '/account_links') return { url: `${APP_URL}/settings?stripe=onboarding-mock` }
  if (/^\/accounts\//.test(path)) return { id: path.split('/')[2], charges_enabled: true, payouts_enabled: true, details_submitted: true }
  if (path === '/checkout/sessions') { const m = (params.metadata ?? {}) as Params; return { id: mockId('cs', randomBytes(6).toString('hex')), url: `${APP_URL}/customer/repairs/${m.jobId}?checkout=mock`, payment_intent: mockId('pi', randomBytes(6).toString('hex')) } }
  if (path === '/refunds') return { id: mockId('re', randomBytes(6).toString('hex')), status: 'pending', amount: params.amount }
  if (/^\/balance_transactions\//.test(path)) return { fee: 30 }
  throw new Error(`mock stripe: unhandled ${method} ${path}`)
}

export async function stripeApi<T = any>(method: 'GET' | 'POST', path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
  if (MOCK()) return mockStripe(method, path, params)
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new HttpsError('failed-precondition', 'Payments are not configured yet.')
  const qs = method === 'GET' && Object.keys(params).length ? `?${formEncode(params)}` : ''
  const r = await fetch(`https://api.stripe.com/v1${path}${qs}`, {
    method, headers: { Authorization: `Bearer ${key}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: method === 'POST' ? formEncode(params) : undefined,
  })
  const body: any = await r.json().catch(() => ({}))
  if (!r.ok) { console.error('stripe error', r.status, body?.error?.type, body?.error?.code); await health('stripe', false, `${r.status} ${body?.error?.code ?? ''}`); throw new HttpsError('internal', 'The payment provider rejected the request.') }
  await health('stripe', true)
  return body as T
}

// ---------- engineer onboarding (Stripe-hosted; we never see bank details) ----------
export const stripeConnectOnboard = callable(z.object({}), async (req) => {
  const c = requireApprovedEngineer(req)
  const aRef = db.doc(`stripeAccounts/${c.uid}`), existing = (await aRef.get()).data()
  let accountId = existing?.accountId as string | undefined
  if (!accountId) {
    const acct = await stripeApi('POST', '/accounts', { type: 'express', country: 'GB', email: String(c.token.email ?? ''), business_type: 'individual',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } }, metadata: { engineerId: c.uid } }, `acct:${c.uid}`)
    accountId = acct.id as string
    await aRef.set({ engineerId: c.uid, accountId, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, createdAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  const urls = { refresh_url: LINKS.onboardingRefresh(), return_url: LINKS.onboardingReturn() }
  const link = await stripeApi('POST', '/account_links', { account: accountId, type: 'account_onboarding', ...urls })
  await aRef.set({ lastOnboardingUrls: urls }, { merge: true })
  return { url: link.url as string }
}, { secrets: STRIPE_SECRETS })

/** Re-reads the account from Stripe (the account.updated webhook also does this automatically). */
export const stripeConnectRefresh = callable(z.object({}), async (req) => {
  const c = requireApprovedEngineer(req)
  const aRef = db.doc(`stripeAccounts/${c.uid}`), a = (await aRef.get()).data()
  if (!a?.accountId) return { connected: false, chargesEnabled: false, payoutsEnabled: false }
  const acct = await stripeApi('GET', `/accounts/${a.accountId}`)
  const upd = { chargesEnabled: !!acct.charges_enabled, payoutsEnabled: !!acct.payouts_enabled, detailsSubmitted: !!acct.details_submitted, updatedAt: FieldValue.serverTimestamp() }
  await aRef.set(upd, { merge: true })
  return { connected: true, chargesEnabled: upd.chargesEnabled, payoutsEnabled: upd.payoutsEnabled }
}, { secrets: STRIPE_SECRETS })

// ---------- checkout ----------
const txId = (jobId: string, additionalId?: string) => additionalId ? `${jobId}__add_${additionalId}` : jobId

export const createCheckout = callable(z.object({ jobId: z.string(), additionalChargeId: z.string().max(40).optional() }), async (req, d) => {
  const c = requireRole(req, 'customer'); requireVerified(c)
  const jobRef = db.doc(`repairRequests/${d.jobId}`), job = (await jobRef.get()).data()
  if (!job || job.customerId !== c.uid) throw new HttpsError('permission-denied', 'Not your job.')
  if (!job.acceptedQuoteId || !job.selectedEngineerId) throw new HttpsError('failed-precondition', 'Choose an engineer’s quotation first.')
  if (['cancelled', 'closed'].includes(job.status)) throw new HttpsError('failed-precondition', 'This job is finished.')

  let totalPence: number, bps: number, label: string
  if (d.additionalChargeId) {
    const ch = (await db.doc(`additionalCharges/${d.additionalChargeId}`).get()).data()
    if (!ch || ch.jobId !== d.jobId || ch.customerId !== c.uid) throw new HttpsError('not-found', 'Charge not found.')
    if (ch.status !== 'accepted') throw new HttpsError('failed-precondition', ch.status === 'paid' ? 'Already paid.' : 'Approve the extra charge first.')
    totalPence = ch.amountPence; bps = ch.commissionBps; label = `Additional work ${job.reference}`
  } else {
    const q = (await db.doc(`repairQuotes/${job.acceptedQuoteId}`).get()).data()
    if (!q || q.engineerId !== job.selectedEngineerId || q.status !== 'accepted') throw new HttpsError('failed-precondition', 'The accepted quotation is no longer valid.')
    totalPence = q.totalPence as number                                   // authoritative: the accepted quote, never a client value
    bps = (job.commissionBps as number | undefined) ?? (await getFinanceSettings()).commissionBps   // rate frozen when the quote was accepted
    label = `Repair ${job.reference}`
  }
  const id = txId(d.jobId, d.additionalChargeId), tRef = db.doc(`transactions/${id}`)
  const existing = (await tRef.get()).data()
  if (existing && ['paid', 'partially_refunded', 'refunded', 'disputed'].includes(existing.status)) return { alreadyPaid: true, url: null as string | null }
  const acct = (await db.doc(`stripeAccounts/${job.selectedEngineerId}`).get()).data()
  if (!acct?.accountId || !acct.chargesEnabled) throw new HttpsError('failed-precondition', 'This engineer has not finished payment setup yet. Please contact support or message the engineer.')

  const { commissionPence, engineerSharePence } = commissionSplit(totalPence, bps)
  const meta = { transactionId: id, jobId: d.jobId, reference: job.reference, customerId: c.uid, engineerId: job.selectedEngineerId, quoteId: job.acceptedQuoteId, commissionBps: String(bps), commissionPence: String(commissionPence) }
  const session = await stripeApi('POST', '/checkout/sessions', {
    mode: 'payment', client_reference_id: id, customer_email: String(c.token.email ?? ''), metadata: meta,
    line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: totalPence, product_data: { name: label } } }],
    payment_intent_data: { ...(commissionPence > 0 ? { application_fee_amount: commissionPence } : {}), transfer_data: { destination: acct.accountId }, metadata: meta, receipt_email: String(c.token.email ?? ''), description: label },
    success_url: LINKS.checkoutSuccess(d.jobId), cancel_url: LINKS.checkoutCancel(d.jobId),
  })
  const returnUrls = { successUrl: LINKS.checkoutSuccess(d.jobId), cancelUrl: LINKS.checkoutCancel(d.jobId) }
  await tRef.set({
    jobId: d.jobId, reference: job.reference, customerId: c.uid, engineerId: job.selectedEngineerId, quoteId: job.acceptedQuoteId, additionalChargeId: d.additionalChargeId ?? null,
    currency: 'GBP', totalPence, commissionBps: bps, commissionPence, engineerSharePence, status: 'checkout_created', refundedPence: 0, commissionRefundedPence: 0, stripeFeePence: null,
    payoutStatus: 'pending', stripe: { checkoutSessionId: session.id, paymentIntentId: session.payment_intent ?? null, ...returnUrls }, attribution: job.attribution ?? null,
    createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { alreadyPaid: false, url: session.url as string }
}, { secrets: STRIPE_SECRETS })

// ---------- additional work ----------
export const proposeAdditionalCharge = callable(z.object({ jobId: z.string(), amountPence: z.number().int().min(100).max(500_000), description: z.string().trim().min(5).max(500) }), async (req, d) => {
  const c = requireApprovedEngineer(req)
  const job = (await db.doc(`repairRequests/${d.jobId}`).get()).data()
  if (!job || job.selectedEngineerId !== c.uid) throw new HttpsError('permission-denied', 'Not your job.')
  if (!['appointment_scheduled', 'on_the_way', 'in_progress', 'awaiting_parts'].includes(job.status)) throw new HttpsError('failed-precondition', 'Extra work can only be proposed while the repair is under way.')
  const bps = (job.commissionBps as number | undefined) ?? (await getFinanceSettings()).commissionBps
  const ref = await db.collection('additionalCharges').add({ jobId: d.jobId, customerId: job.customerId, engineerId: c.uid, amountPence: d.amountPence, description: d.description, commissionBps: bps, status: 'proposed', createdAt: FieldValue.serverTimestamp() })
  await notify({ userId: job.customerId, category: 'quotes', dedupeKey: `add-charge:${ref.id}`, title: 'Extra work needs your approval', body: `Open ${job.reference} to review the additional charge.`, link: `/customer/repairs/${d.jobId}` })
  return { id: ref.id }
})
export const respondAdditionalCharge = callable(z.object({ id: z.string(), accept: z.boolean() }), async (req, d) => {
  const c = requireRole(req, 'customer')
  const ref = db.doc(`additionalCharges/${d.id}`), ch = (await ref.get()).data()
  if (!ch || ch.customerId !== c.uid) throw new HttpsError('permission-denied', 'Not your charge.')
  if (ch.status !== 'proposed') throw new HttpsError('failed-precondition', 'Already answered.')
  await ref.update({ status: d.accept ? 'accepted' : 'declined', respondedAt: FieldValue.serverTimestamp() })
  await notify({ userId: ch.engineerId, category: 'quotes', dedupeKey: `add-charge-resp:${d.id}`, title: d.accept ? 'Extra work approved' : 'Extra work declined', body: 'Open the job for details.', link: `/engineer/my-jobs/${ch.jobId}` })
  return { ok: true }
})

// ---------- refunds & disputes (admin) ----------
export const refundTransaction = callable(z.object({ transactionId: z.string(), amountPence: z.number().int().min(1), reason: z.string().trim().min(5).max(300) }), async (req, d) => {
  const c = requirePerm(req, 'payments.manage')
  const tRef = db.doc(`transactions/${d.transactionId}`), t = (await tRef.get()).data()
  if (!t || !['paid', 'partially_refunded'].includes(t.status)) throw new HttpsError('failed-precondition', 'Only paid transactions can be refunded.')
  const remaining = t.totalPence - t.refundedPence - (t.pendingRefundPence ?? 0)
  if (d.amountPence > remaining) throw new HttpsError('invalid-argument', `At most £${(remaining / 100).toFixed(2)} can still be refunded.`)
  const pi = t.stripe?.paymentIntentId
  if (!pi) throw new HttpsError('failed-precondition', 'No payment is recorded for this transaction.')
  const key = `refund:${d.transactionId}:${t.refundedPence + (t.pendingRefundPence ?? 0)}:${d.amountPence}`
  const rf = await stripeApi('POST', '/refunds', { payment_intent: pi, amount: d.amountPence, reverse_transfer: true, refund_application_fee: true, metadata: { transactionId: d.transactionId, by: c.uid } }, key)
  await db.doc(`refunds/${rf.id}`).set({ transactionId: d.transactionId, jobId: t.jobId, amountPence: d.amountPence, reason: d.reason, requestedBy: c.uid, status: rf.status ?? 'pending', createdAt: FieldValue.serverTimestamp() })
  await tRef.update({ pendingRefundPence: FieldValue.increment(d.amountPence), updatedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'payment.refund', `transactions/${d.transactionId}`, { amountPence: d.amountPence, refundId: rf.id })
  return { refundId: rf.id as string }
}, { secrets: STRIPE_SECRETS })

export const resolvePaymentDispute = callable(z.object({ disputeId: z.string(), resolution: z.enum(['won', 'lost', 'refunded', 'withdrawn']), note: z.string().trim().min(5).max(1000), customerComplaint: z.string().max(1000).optional().default(''), engineerResponse: z.string().max(1000).optional().default('') }), async (req, d) => {
  const c = requirePerm(req, 'payments.manage')
  const ref = db.doc(`paymentDisputes/${d.disputeId}`); if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Dispute not found.')
  await ref.update({ resolution: d.resolution, resolutionNote: d.note, customerComplaint: d.customerComplaint, engineerResponse: d.engineerResponse, resolvedBy: c.uid, resolvedAt: FieldValue.serverTimestamp() })
  await audit(c.uid, 'payment.dispute.resolve', `paymentDisputes/${d.disputeId}`, { resolution: d.resolution })
  return { ok: true }
})

// ---------- settings (Super Administrator only) ----------
export const saveFinanceSettings = callable(z.object({
  commissionBps: z.number().int().min(0).max(MAX_COMMISSION_BPS), requirePaymentBeforeBooking: z.boolean(),
  refundPolicy: z.string().max(1500).optional(), cancellationPolicy: z.string().max(1500).optional(),
}), async (req, d) => {
  const c = requireSuperAdmin(req)
  const before = await getFinanceSettings()
  await db.doc('platformSettings/finance').set({ ...d, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid }, { merge: true })
  // Applies to quotations accepted from now on; already-accepted quotes keep the rate frozen on the job.
  await audit(c.uid, 'finance.settings', 'platformSettings/finance', { commissionBpsFrom: before.commissionBps, commissionBpsTo: d.commissionBps, requirePaymentBeforeBooking: d.requirePaymentBeforeBooking })
  return { ok: true }
})

// ---------- reporting (confirmed Stripe events only) ----------
export const adminFinanceStats = callable(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), async (req, d) => {
  requirePerm(req, 'finance.view')
  let q: FirebaseFirestore.Query = db.collection('transactions').where('paidAt', '!=', null).orderBy('paidAt', 'desc')
  if (d.from) q = q.where('paidAt', '>=', Timestamp.fromDate(new Date(`${d.from}T00:00:00Z`)))
  if (d.to) q = q.where('paidAt', '<=', Timestamp.fromDate(new Date(`${d.to}T23:59:59Z`)))
  const docs = (await q.limit(2000).get()).docs.map(x => ({ id: x.id, ...x.data() as any }))
  const sum = (f: (t: any) => number) => docs.reduce((a, t) => a + (f(t) || 0), 0)
  const gross = sum(t => t.totalPence), commission = sum(t => t.commissionPence), commissionRefunded = sum(t => t.commissionRefundedPence), fees = sum(t => t.stripeFeePence), refunds = sum(t => t.refundedPence)
  const live = docs.filter(t => ['paid', 'partially_refunded', 'disputed'].includes(t.status))
  const pendingPayouts = live.filter(t => t.payoutStatus !== 'transferred' && engineerRemainingPence(t) > 0)
  const awaiting = await db.collection('transactions').where('status', 'in', ['checkout_created', 'payment_failed']).count().get()
  const disputes = await db.collection('paymentDisputes').where('resolution', '==', null).count().get().catch(() => null)
  return {
    gross, commission, commissionRefunded, engineerShare: sum(t => t.engineerSharePence), engineerShareRefunded: sum(t => engineerRefundedPence(t)), engineerRemaining: sum(t => engineerRemainingPence(t)), stripeFees: fees, refunds,
    netPlatformRevenue: commission - commissionRefunded - fees, pendingPayoutPence: pendingPayouts.reduce((a, t) => a + engineerRemainingPence(t), 0), pendingPayoutCount: pendingPayouts.length,
    completedPayoutPence: sum(t => t.payoutStatus === 'transferred' ? engineerRemainingPence(t) : 0), outstandingPaymentCount: awaiting.data().count, openDisputes: disputes?.data().count ?? 0, count: docs.length,
    rows: docs.slice(0, 300).map(t => ({ id: t.id, reference: t.reference, paidAt: t.paidAt?.toMillis?.() ?? null, totalPence: t.totalPence, commissionPence: t.commissionPence, commissionBps: t.commissionBps, engineerSharePence: t.engineerSharePence, engineerRefundedPence: engineerRefundedPence(t), engineerRemainingPence: engineerRemainingPence(t),
      stripeFeePence: t.stripeFeePence, refundedPence: t.refundedPence, commissionRefundedPence: t.commissionRefundedPence ?? 0, status: t.status, payoutStatus: t.payoutStatus, payoutState: payoutState(t), source: t.attribution?.source ?? null, campaignId: t.attribution?.campaignId ?? null })),
  }
})

// ---------- webhook ----------
type Evt = { id: string; type: string; account?: string; data: { object: any } }

export const stripeWebhook = onRequest({ region: REGION, cors: false, secrets: ['STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY'] }, async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const raw = (req.rawBody ?? Buffer.from('')).toString('utf8')
  if (req.method !== 'POST' || !secret) { res.status(405).end(); return }
  // Stripe signs each webhook endpoint with its own secret (one for "your account", one for "connected accounts"): STRIPE_WEBHOOK_SECRET may hold several, comma separated.
  const sig = req.header('stripe-signature')
  if (!secret.split(',').map(x => x.trim()).filter(Boolean).some(x => verifyStripeSignature(raw, sig, x))) { res.status(400).json({ error: 'signature' }); return }
  const evt = JSON.parse(raw) as Evt
  const eRef = db.doc(`stripeEvents/${evt.id}`)
  try { await eRef.create({ type: evt.type, status: 'processing', receivedAt: FieldValue.serverTimestamp() }) }
  catch (e: any) { if (e.code === 6) { res.status(200).json({ ok: true, duplicate: true }); return } throw e }   // Stripe retries / replays do nothing
  try {
    await handleStripeEvent(evt)
    await eRef.update({ status: 'done', doneAt: FieldValue.serverTimestamp() })
    res.status(200).json({ ok: true })
  } catch (e: any) {
    console.error('stripe event failed', evt.id, evt.type, e.message)
    await eRef.delete().catch(() => {})   // let Stripe retry; processing is idempotent
    res.status(500).json({ error: 'handler' })
  }
})

async function findTxByPaymentIntent(pi: string) {
  const s = await db.collection('transactions').where('stripe.paymentIntentId', '==', pi).limit(1).get()
  return s.empty ? null : s.docs[0]
}

export async function handleStripeEvent(evt: Evt) {
  const o = evt.data.object
  switch (evt.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (o.payment_status !== 'paid') return
      const id = o.metadata?.transactionId as string | undefined; if (!id) return
      const out = await db.runTransaction(async tx => {
        const tRef = db.doc(`transactions/${id}`), snap = await tx.get(tRef); if (!snap.exists) throw new Error(`unknown transaction ${id}`)
        const t = snap.data()!
        if (['paid', 'partially_refunded', 'refunded', 'disputed'].includes(t.status)) {
          if (t.stripe?.paymentIntentId && o.payment_intent && t.stripe.paymentIntentId !== o.payment_intent) { tx.update(tRef, { duplicatePaymentIntents: FieldValue.arrayUnion(o.payment_intent) }); return { duplicate: true as const, t } }
          return { replay: true as const, t }
        }
        if (o.amount_total !== t.totalPence || String(o.currency).toLowerCase() !== 'gbp') { tx.update(tRef, { status: 'amount_mismatch', mismatch: { amountTotal: o.amount_total, currency: o.currency } }); return { mismatch: true as const, t } }
        tx.update(tRef, { status: 'paid', paidAt: FieldValue.serverTimestamp(), 'stripe.paymentIntentId': o.payment_intent ?? t.stripe?.paymentIntentId ?? null, updatedAt: FieldValue.serverTimestamp() })
        tx.set(db.doc(`commissionRecords/${id}`), { transactionId: id, jobId: t.jobId, commissionPence: t.commissionPence, commissionBps: t.commissionBps, engineerSharePence: t.engineerSharePence, status: 'confirmed', source: t.attribution?.source ?? null, campaignId: t.attribution?.campaignId ?? null, confirmedAt: FieldValue.serverTimestamp() })
        if (t.additionalChargeId) tx.update(db.doc(`additionalCharges/${t.additionalChargeId}`), { status: 'paid', paidAt: FieldValue.serverTimestamp() })
        else tx.update(db.doc(`repairRequests/${t.jobId}`), { paymentStatus: 'paid', paidAt: FieldValue.serverTimestamp(), paidTotalPence: t.totalPence, updatedAt: FieldValue.serverTimestamp() })
        return { paid: true as const, t }
      })
      if ('duplicate' in out) { await notifyAdmins('payments.manage', { category: 'admin', dedupeKey: `dup-pay:${evt.id}`, title: 'Duplicate payment detected', body: `A second payment arrived for ${out.t.reference}. Review and refund.`, link: '/admin/finance' }); return }
      if ('paid' in out) {
        const t = out.t
        await advanceLeadForJob(t.jobId, 'converted_to_customer', 'paid')
        await notify({ userId: t.customerId, category: 'status', dedupeKey: `paid:${evt.id}:c`, title: 'Payment received', body: `Thank you. Your payment for ${t.reference} is confirmed.`, link: `/customer/repairs/${t.jobId}`,
          email: { subject: 'Payment received', heading: 'Payment confirmed', html: `<p>We received your payment of <b>£${(t.totalPence / 100).toFixed(2)}</b> for <b>${p(t.reference)}</b>. A receipt has been sent by our payment provider.</p>`, cta: 'View repair' } })
        await notify({ userId: t.engineerId, category: 'status', dedupeKey: `paid:${evt.id}:e`, title: 'Customer has paid', body: `Payment for ${t.reference} is confirmed. You can proceed with the appointment.`, link: `/engineer/my-jobs/${t.jobId}` })
      }
      return
    }
    case 'payment_intent.payment_failed': {
      const id = o.metadata?.transactionId as string | undefined; if (!id) return
      await db.doc(`transactions/${id}`).update({ status: 'payment_failed', failure: { code: o.last_payment_error?.code ?? null }, updatedAt: FieldValue.serverTimestamp() }).catch(() => {})   // still retryable via a new checkout
      const t = (await db.doc(`transactions/${id}`).get()).data()
      if (t) await notify({ userId: t.customerId, category: 'status', dedupeKey: `payfail:${evt.id}`, title: 'Payment didn’t go through', body: `Open ${t.reference} to try again.`, link: `/customer/repairs/${t.jobId}` })
      return
    }
    case 'charge.succeeded': {
      const doc = o.payment_intent ? await findTxByPaymentIntent(o.payment_intent) : null; if (!doc) return
      let fee: number | null = null
      if (o.balance_transaction) { try { fee = (await stripeApi('GET', `/balance_transactions/${o.balance_transaction}`)).fee ?? null } catch { /* fee is best-effort; the next event or reconciliation can fill it */ } }
      await doc.ref.update({ 'stripe.chargeId': o.id, 'stripe.applicationFeeId': o.application_fee ?? null, stripeFeePence: fee, updatedAt: FieldValue.serverTimestamp() })
      return
    }
    case 'transfer.created': {
      const s = o.source_transaction ? await db.collection('transactions').where('stripe.chargeId', '==', o.source_transaction).limit(1).get() : null
      if (s && !s.empty) await s.docs[0].ref.update({ payoutStatus: 'transferred', 'stripe.transferId': o.id, transferredPence: o.amount, transferredAt: FieldValue.serverTimestamp() })
      return
    }
    case 'charge.refunded': {
      const doc = o.payment_intent ? await findTxByPaymentIntent(o.payment_intent) : null; if (!doc) return
      const t = doc.data(), refunded = Math.min(o.amount_refunded as number, t.totalPence)
      const pending = Math.max(0, (t.pendingRefundPence ?? 0) - Math.max(0, refunded - t.refundedPence))
      // Refunds are created with refund_application_fee, so Stripe returns our commission in proportion. We derive it here so reporting never depends on the optional
      // application_fee.refunded event; if that event does arrive it carries Stripe's exact figure and takes over (commissionRefundSource = 'fee_event').
      const derived = t.commissionRefundSource === 'fee_event' ? {} : { commissionRefundedPence: commissionRefund(t.totalPence, t.commissionPence, refunded), commissionRefundSource: 'derived' }
      await doc.ref.update({ refundedPence: refunded, pendingRefundPence: pending, status: refunded >= t.totalPence ? 'refunded' : 'partially_refunded', ...derived, updatedAt: FieldValue.serverTimestamp() })
      for (const r of (o.refunds?.data ?? []) as any[]) await db.doc(`refunds/${r.id}`).set({ transactionId: doc.id, jobId: t.jobId, amountPence: r.amount, status: r.status ?? 'succeeded', confirmedAt: FieldValue.serverTimestamp() }, { merge: true })
      await db.doc(`commissionRecords/${doc.id}`).set({ status: refunded >= t.totalPence ? 'reversed' : 'partially_reversed', refundedPence: refunded, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return
    }
    case 'application_fee.refunded': {
      const doc = o.charge ? (await db.collection('transactions').where('stripe.chargeId', '==', o.charge).limit(1).get()).docs[0] : null; if (!doc) return
      await doc.ref.update({ commissionRefundedPence: Math.min(o.amount_refunded as number, doc.data().commissionPence), commissionRefundSource: 'fee_event', updatedAt: FieldValue.serverTimestamp() })
      await db.doc(`commissionRecords/${doc.id}`).set({ commissionRefundedPence: o.amount_refunded }, { merge: true })
      return
    }
    case 'charge.dispute.created':
    case 'charge.dispute.closed':
    case 'charge.dispute.updated': {
      const doc = o.payment_intent ? await findTxByPaymentIntent(o.payment_intent) : null
      const t = doc?.data()
      await db.doc(`paymentDisputes/${o.id}`).set({ transactionId: doc?.id ?? null, jobId: t?.jobId ?? null, reference: t?.reference ?? null, amountPence: o.amount, reason: o.reason ?? null, status: o.status, dueBy: o.evidence_details?.due_by ?? null, resolution: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      if (doc && evt.type === 'charge.dispute.created') {
        await doc.ref.update({ status: 'disputed', disputeId: o.id, updatedAt: FieldValue.serverTimestamp() })
        await notifyAdmins('payments.manage', { category: 'admin', dedupeKey: `dispute:${o.id}`, title: 'Payment dispute opened', body: `A chargeback was raised on ${t!.reference}. Respond in Stripe before the deadline.`, link: '/admin/finance' })
      }
      if (doc && evt.type === 'charge.dispute.closed') { const r = (t?.refundedPence ?? 0); await doc.ref.update({ status: o.status === 'won' ? (r >= (t?.totalPence ?? 0) ? 'refunded' : r > 0 ? 'partially_refunded' : 'paid') : 'disputed', updatedAt: FieldValue.serverTimestamp() }) }
      return
    }
    case 'account.updated': {
      const s = await db.collection('stripeAccounts').where('accountId', '==', o.id).limit(1).get()
      if (!s.empty) await s.docs[0].ref.update({ chargesEnabled: !!o.charges_enabled, payoutsEnabled: !!o.payouts_enabled, detailsSubmitted: !!o.details_submitted, updatedAt: FieldValue.serverTimestamp() })
      return
    }
    default: return
  }
}
