// Stripe Connect marketplace payments.
//
// Charge type: DESTINATION CHARGES with application_fee_amount, created through Stripe-hosted Checkout.
//  * Thor Computer Ltd is the merchant of record: the customer pays Thor, sees Thor on their statement, and Thor handles refunds and
//    card disputes centrally (matching the admin dispute process). Stripe processing fees are charged to the platform balance.
//  * The engineer's share (total minus the 15% application fee) is transferred automatically to their Express connected account and
//    paid out on the account's Stripe payout schedule. Engineers' bank details and identity checks live only in Stripe.
//  * Refunds use reverse_transfer (pull the engineer's share back) and, per policy, refund_application_fee.
//  * Payment is ONLY ever confirmed by verified webhooks. The success page in the browser is informational.
// Commission: the rate is fixed on the quotation; each payment's fee is applicationFeeFor(paid so far, amount, rate) so the fees across a
// deposit + balance + additional work always sum to exactly round(total x rate) and are never charged twice.
import Stripe from 'stripe'
import { onRequest } from 'firebase-functions/v2/https'
import { z } from 'zod'
import { db, callable, requireRole, requirePerm, requireVerified, notify, notifyAdmins, audit, FieldValue, Timestamp, HttpsError, APP_URL, REGION, isMock } from './core'
import { amountDuePence, applicationFeeFor, STRIPE_MIN_GBP_PENCE } from './domain'
import { paymentSettings } from './settings'
import { p } from './email'

export const STRIPE_SECRETS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET']
const opts = { secrets: STRIPE_SECRETS }

export const stripeConfigured = () => { const k = process.env.STRIPE_SECRET_KEY ?? ''; return /^(sk|rk)_(test|live)_/.test(k) || (isMock() && !!process.env.STRIPE_API_HOST) }
let client: Stripe | null = null
export function stripe(): Stripe {
  if (!stripeConfigured()) throw new HttpsError('failed-precondition', 'Payments are not configured yet. Please contact Thor Computer support.')
  if (client) return client
  // Tests only: the emulator suite points the SDK at a local fake Stripe API. Never honoured outside the emulator.
  const host = isMock() ? process.env.STRIPE_API_HOST : undefined
  client = new Stripe(process.env.STRIPE_SECRET_KEY!, host ? { host: host.split(':')[0], port: Number(host.split(':')[1]), protocol: 'http' } : {})
  return client
}

// ---------- engineer onboarding (Express accounts) ----------
const accountStatus = (a: Stripe.Account) => ({
  accountId: a.id, chargesEnabled: a.charges_enabled, payoutsEnabled: a.payouts_enabled, detailsSubmitted: a.details_submitted,
  transfersActive: a.capabilities?.transfers === 'active', requirementsDue: a.requirements?.currently_due ?? [], disabledReason: a.requirements?.disabled_reason ?? null,
  updatedAt: FieldValue.serverTimestamp(),
})

export const stripeOnboardingLink = callable(z.object({}), async (req) => {
  const c = requireRole(req, 'engineer'); requireVerified(c)
  const ref = db.doc(`stripeConnectedAccounts/${c.uid}`)
  let accountId = (await ref.get()).data()?.accountId as string | undefined
  if (!accountId) {
    const user = (await db.doc(`users/${c.uid}`).get()).data()
    const acct = await stripe().accounts.create({
      type: 'express', country: 'GB', email: user?.email ?? undefined, capabilities: { transfers: { requested: true } },
      business_profile: { product_description: 'Computer and technology repairs booked through Thor Computer', url: APP_URL }, metadata: { uid: c.uid },
    }, { idempotencyKey: `acct-create:${c.uid}` })    // a retry can never create a second account
    accountId = acct.id
    await ref.set({ engineerId: c.uid, ...accountStatus(acct), createdAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  const link = await stripe().accountLinks.create({ account: accountId, type: 'account_onboarding', refresh_url: `${APP_URL}/engineer/payouts?stripe=refresh`, return_url: `${APP_URL}/engineer/payouts?stripe=return` })
  return { url: link.url }
}, opts)

export const stripeRefreshAccount = callable(z.object({}), async (req) => {
  const c = requireRole(req, 'engineer')
  const ref = db.doc(`stripeConnectedAccounts/${c.uid}`), id = (await ref.get()).data()?.accountId
  if (!id) return { connected: false }
  const a = await stripe().accounts.retrieve(id)
  const st = accountStatus(a); await ref.set(st, { merge: true })
  return { connected: true, transfersActive: st.transfersActive, payoutsEnabled: st.payoutsEnabled, requirementsDue: st.requirementsDue }
}, opts)

export const stripeDashboardLink = callable(z.object({}), async (req) => {
  const c = requireRole(req, 'engineer')
  const id = (await db.doc(`stripeConnectedAccounts/${c.uid}`).get()).data()?.accountId
  if (!id) throw new HttpsError('failed-precondition', 'Set up payouts first.')
  return { url: (await stripe().accounts.createLoginLink(id)).url }
}, opts)

// ---------- customer checkout ----------
/** Works out what the customer owes right now for a job, per the payment policy fixed on the job at acceptance. */
export function dueNow(j: FirebaseFirestore.DocumentData): { amount: number; kind: 'full' | 'deposit' | 'balance' } {
  const pay = j.payment
  if (!pay?.required) return { amount: 0, kind: 'full' }
  const paid = pay.paidPence ?? 0, total = j.agreedTotalPence ?? 0
  const stage = ['completed', 'closed', 'disputed'].includes(j.status) ? 'post' : j.status === 'awaiting_payment' ? 'pre' : null
  if (!stage) return { amount: 0, kind: 'full' }
  const amount = amountDuePence(pay.policy, stage, total, paid, pay.depositPercent ?? 20)
  return { amount, kind: stage === 'pre' && pay.policy === 'deposit_before' && amount < total ? 'deposit' : paid > 0 ? 'balance' : 'full' }
}

export const createCheckout = callable(z.object({ jobId: z.string() }), async (req, d) => {
  const c = requireRole(req, 'customer'); requireVerified(c)
  const ps = await paymentSettings()
  const jRef = db.doc(`repairRequests/${d.jobId}`), j = (await jRef.get()).data()
  if (!j || j.customerId !== c.uid) throw new HttpsError('permission-denied', 'Not your job.')
  const { amount, kind } = dueNow(j)
  if (amount <= 0) throw new HttpsError('failed-precondition', 'Nothing is due on this repair right now.')
  if (amount < STRIPE_MIN_GBP_PENCE) throw new HttpsError('failed-precondition', 'The amount due is below the minimum card payment.')
  const acct = (await db.doc(`stripeConnectedAccounts/${j.selectedEngineerId}`).get()).data()
  if (!acct?.transfersActive) throw new HttpsError('failed-precondition', 'Your engineer cannot receive payments yet. Please contact support.')
  const fee = applicationFeeFor(j.payment.paidPence ?? 0, amount, j.commissionBps)
  // One checkout per job/stage/amount: re-opening the pay screen reuses the open session instead of creating another.
  const paymentId = `${d.jobId}_${kind}_${j.payment.paidPence ?? 0}_${amount}`
  const pRef = db.doc(`payments/${paymentId}`), existing = (await pRef.get()).data()
  if (existing?.status === 'paid') throw new HttpsError('failed-precondition', 'This payment has already been received.')
  if (existing?.status === 'open' && existing.expiresAt?.toMillis() > Date.now() + 60_000) return { url: existing.checkoutUrl as string, paymentId }
  const user = (await db.doc(`users/${c.uid}`).get()).data()
  const attempt = (existing?.attempts ?? 0) + 1
  await pRef.set({ jobId: d.jobId, reference: j.reference, customerId: c.uid, engineerId: j.selectedEngineerId, kind, amountPence: amount, applicationFeePence: fee, engineerSharePence: amount - fee,
    commissionBps: j.commissionBps, currency: 'GBP', status: 'creating', attempts: attempt, createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  const label = { full: 'Repair payment', deposit: 'Repair deposit', balance: 'Repair balance' }[kind]
  const session = await stripe().checkout.sessions.create({
    mode: 'payment', client_reference_id: paymentId, customer_email: user?.email ?? undefined, payment_method_types: ps.methods as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
    line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: amount, product_data: { name: `${label} · ${j.reference}`, description: `${j.device?.manufacturer ?? ''} ${j.device?.model ?? ''}`.trim() || undefined } } }],
    payment_intent_data: { application_fee_amount: fee, transfer_data: { destination: acct.accountId }, transfer_group: d.jobId, receipt_email: user?.email ?? undefined,
      description: `${label} ${j.reference}`, metadata: { paymentId, jobId: d.jobId, kind } },
    metadata: { paymentId, jobId: d.jobId, kind }, expires_at: Math.floor(Date.now() / 1000) + 3600,
    success_url: `${APP_URL}/customer/repairs/${d.jobId}?payment=processing`, cancel_url: `${APP_URL}/customer/repairs/${d.jobId}?payment=cancelled`,
  }, { idempotencyKey: `checkout:${paymentId}:${attempt}` })
  await pRef.update({ status: 'open', checkoutSessionId: session.id, checkoutUrl: session.url, expiresAt: Timestamp.fromMillis((session.expires_at ?? 0) * 1000), updatedAt: FieldValue.serverTimestamp() })
  return { url: session.url as string, paymentId }
}, opts)

// ---------- refunds (admin) ----------
export async function issueRefund(paymentId: string, amountPence: number | undefined, actor: string, reason: string, key: string) {
  const pay = (await db.doc(`payments/${paymentId}`).get()).data()
  if (!pay || pay.status !== 'paid' && pay.status !== 'partially_refunded') throw new HttpsError('failed-precondition', 'Only received payments can be refunded.')
  const remaining = pay.amountPence - (pay.refundedPence ?? 0)
  const amount = amountPence ?? remaining
  if (amount <= 0 || amount > remaining) throw new HttpsError('invalid-argument', `You can refund up to £${(remaining / 100).toFixed(2)}.`)
  const ps = await paymentSettings()
  const r = await stripe().refunds.create({ payment_intent: pay.paymentIntentId, amount, reverse_transfer: true, refund_application_fee: ps.refundApplicationFee, reason: 'requested_by_customer',
    metadata: { paymentId, jobId: pay.jobId, actor, reason: reason.slice(0, 400) } }, { idempotencyKey: `refund:${paymentId}:${key}` })
  // Recorded as pending; the charge.refunded / refund.updated webhooks are the source of truth for the final amounts.
  await db.doc(`refunds/${r.id}`).set({ paymentId, jobId: pay.jobId, paymentIntentId: pay.paymentIntentId, amountPence: amount, status: r.status, reason, requestedBy: actor, commissionRefunded: ps.refundApplicationFee, createdAt: FieldValue.serverTimestamp() }, { merge: true })
  return r
}
export const refundPayment = callable(z.object({ paymentId: z.string(), amountPence: z.number().int().min(1).optional(), reason: z.string().trim().min(5).max(500), requestKey: z.string().min(8).max(64) }), async (req, d) => {
  const c = requirePerm(req, 'payments.manage')
  const r = await issueRefund(d.paymentId, d.amountPence, c.uid, d.reason, d.requestKey)
  await audit(c.uid, 'payment.refund', `payments/${d.paymentId}`, { refundId: r.id, amountPence: r.amount, reason: d.reason })
  return { refundId: r.id, status: r.status }
}, opts)

// ---------- webhook ----------
export const stripeWebhook = onRequest({ region: REGION, cors: false, secrets: STRIPE_SECRETS }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('method'); return }
  const sig = req.header('stripe-signature') ?? ''
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((x): x is string => !!x && x.startsWith('whsec_'))
  const verifier = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_unused_for_signature_checks')
  let event: Stripe.Event | null = null
  for (const s of secrets) { try { event = verifier.webhooks.constructEvent(req.rawBody, sig, s); break } catch { /* try the next endpoint secret */ } }
  if (!event) { res.status(400).send('signature'); return }

  const evRef = db.doc(`stripeEvents/${event.id}`)
  const claimed = await db.runTransaction(async tx => {
    const s = await tx.get(evRef)
    if (s.exists && ['processed', 'processing'].includes(s.data()!.status) && !(s.data()!.status === 'processing' && s.data()!.at.toMillis() < Date.now() - 120_000)) return false
    tx.set(evRef, { type: event!.type, account: event!.account ?? null, livemode: event!.livemode, status: 'processing', at: Timestamp.now(), attempts: (s.data()?.attempts ?? 0) + 1 }, { merge: true })
    return true
  })
  if (!claimed) { res.status(200).json({ received: true, duplicate: true }); return }   // replayed event: never processed twice
  try {
    await handleStripeEvent(event)
    await evRef.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() })
    res.status(200).json({ received: true })
  } catch (e: any) {
    console.error('stripe event failed', event.id, event.type, e?.message)
    await evRef.update({ status: 'failed', error: String(e?.message ?? e).slice(0, 500) })
    await db.doc('integrationHealth/stripe').set({ lastErrorAt: FieldValue.serverTimestamp(), lastError: String(e?.message ?? e).slice(0, 300) }, { merge: true })
    res.status(500).send('retry')   // Stripe retries with backoff for up to 3 days
  }
})

export async function handleStripeEvent(event: Stripe.Event) {
  await db.doc('integrationHealth/stripe').set({ lastEventAt: FieldValue.serverTimestamp(), lastEventType: event.type, livemode: event.livemode }, { merge: true })
  const o: any = event.data.object
  switch (event.type) {
    case 'checkout.session.completed': case 'checkout.session.async_payment_succeeded':
      if (o.payment_status === 'paid') return markPaid(o as Stripe.Checkout.Session, event)
      return setPaymentStatus(o.metadata?.paymentId, 'processing')
    case 'checkout.session.async_payment_failed': return markFailed(o.metadata?.paymentId, 'The payment did not complete.')
    case 'checkout.session.expired': return setPaymentStatus(o.metadata?.paymentId, 'expired', ['open', 'creating'])
    case 'payment_intent.payment_failed': return markFailed(o.metadata?.paymentId, o.last_payment_error?.message ?? 'Payment failed.')
    case 'charge.refunded': return syncRefunds(o as Stripe.Charge)
    case 'refund.created': case 'refund.updated': case 'charge.refund.updated': {
      const r = o as Stripe.Refund
      return void await db.doc(`refunds/${r.id}`).set({ paymentIntentId: typeof r.payment_intent === 'string' ? r.payment_intent : r.payment_intent?.id ?? null, chargeId: typeof r.charge === 'string' ? r.charge : r.charge?.id ?? null,
        amountPence: r.amount, status: r.status, stripeReason: r.reason ?? null, updatedAt: FieldValue.serverTimestamp(), ...(r.metadata?.paymentId ? { paymentId: r.metadata.paymentId, jobId: r.metadata.jobId } : {}) }, { merge: true })
    }
    case 'charge.dispute.created': case 'charge.dispute.updated': case 'charge.dispute.closed': case 'charge.dispute.funds_withdrawn': case 'charge.dispute.funds_reinstated': return syncDispute(o as Stripe.Dispute, event.type)
    case 'account.updated': {
      const a = o as Stripe.Account, uid = a.metadata?.uid
      const ref = uid ? db.doc(`stripeConnectedAccounts/${uid}`) : (await db.collection('stripeConnectedAccounts').where('accountId', '==', a.id).limit(1).get()).docs[0]?.ref
      if (ref) await ref.set(accountStatus(a), { merge: true })
      return
    }
    case 'payout.created': case 'payout.updated': case 'payout.paid': case 'payout.failed': case 'payout.canceled': {
      if (!event.account) return          // platform payouts are not engineer payouts
      const po = o as Stripe.Payout
      const acc = (await db.collection('stripeConnectedAccounts').where('accountId', '==', event.account).limit(1).get()).docs[0]
      await db.doc(`payouts/${po.id}`).set({ accountId: event.account, engineerId: acc?.id ?? null, amountPence: po.amount, currency: po.currency, status: po.status, arrivalDate: Timestamp.fromMillis(po.arrival_date * 1000),
        failureMessage: po.failure_message ?? null, createdAt: Timestamp.fromMillis(po.created * 1000), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return
    }
    default: return
  }
}

async function setPaymentStatus(paymentId: string | undefined, status: string, onlyFrom?: string[]) {
  if (!paymentId) return
  const ref = db.doc(`payments/${paymentId}`)
  await db.runTransaction(async tx => { const s = await tx.get(ref); if (!s.exists || s.data()!.status === 'paid' || (onlyFrom && !onlyFrom.includes(s.data()!.status))) return; tx.update(ref, { status, updatedAt: FieldValue.serverTimestamp() }) })
}
async function markFailed(paymentId: string | undefined, message: string) {
  if (!paymentId) return
  const s = (await db.doc(`payments/${paymentId}`).get()).data(); if (!s || s.status === 'paid') return
  await db.doc(`payments/${paymentId}`).update({ status: 'failed', failureMessage: message.slice(0, 300), updatedAt: FieldValue.serverTimestamp() })
  await notify({ userId: s.customerId, category: 'payments', dedupeKey: `pay-failed:${paymentId}:${s.attempts ?? 1}`, title: 'Payment not completed', body: `Your payment for ${s.reference} didn’t go through. You can try again.`, link: `/customer/repairs/${s.jobId}` })
}

async function markPaid(session: Stripe.Checkout.Session, event: Stripe.Event) {
  const paymentId = session.metadata?.paymentId
  if (!paymentId) return
  const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  if (!piId) throw new Error('paid session without payment intent')
  // Fee and receipt details come from Stripe itself, never from the browser.
  const pi = await stripe().paymentIntents.retrieve(piId, { expand: ['latest_charge.balance_transaction'] })
  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  const bt = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null
  const pRef = db.doc(`payments/${paymentId}`)
  const out = await db.runTransaction(async tx => {
    const pay = (await tx.get(pRef)).data()
    if (!pay) throw new Error(`unknown payment ${paymentId}`)
    if (pay.status === 'paid') return null                           // already applied (idempotent)
    if (session.amount_total !== pay.amountPence || session.currency !== 'gbp') throw new Error(`amount mismatch on ${paymentId}`)
    if ((pi.application_fee_amount ?? 0) !== pay.applicationFeePence) throw new Error(`application fee mismatch on ${paymentId}`)
    const jRef = db.doc(`repairRequests/${pay.jobId}`), j = (await tx.get(jRef)).data()!
    const paid = (j.payment?.paidPence ?? 0) + pay.amountPence, total = j.agreedTotalPence ?? 0
    const at = Timestamp.fromMillis(event.created * 1000)
    tx.update(pRef, { status: 'paid', paymentIntentId: pi.id, chargeId: charge?.id ?? null, receiptUrl: charge?.receipt_url ?? null, paidAt: at, refundedPence: 0, updatedAt: FieldValue.serverTimestamp() })
    const txn = { jobId: pay.jobId, reference: pay.reference, paymentId, kind: pay.kind, customerId: pay.customerId, engineerId: pay.engineerId, currency: 'GBP',
      grossPence: pay.amountPence, commissionPence: pay.applicationFeePence, engineerSharePence: pay.amountPence - pay.applicationFeePence, commissionBps: pay.commissionBps,
      stripeFeePence: bt?.fee ?? null, refundedPence: 0, commissionRefundedPence: 0, status: 'succeeded', paymentIntentId: pi.id, chargeId: charge?.id ?? null,
      attribution: j.attribution ?? null, source: j.source ?? 'app', createdAt: at, livemode: event.livemode }
    tx.create(db.doc(`transactions/${pi.id}`), txn)
    tx.create(db.doc(`commissionRecords/${pi.id}`), { transactionId: pi.id, jobId: pay.jobId, engineerId: pay.engineerId, amountPence: pay.applicationFeePence, bps: pay.commissionBps, refundedPence: 0, status: 'earned', createdAt: at, attribution: j.attribution ?? null })
    const due = amountDuePence(j.payment.policy, 'pre', total, paid, j.payment.depositPercent ?? 20)
    const status = paid >= total ? 'paid' : j.payment.policy === 'deposit_before' && paid > 0 && j.status === 'awaiting_payment' ? 'deposit_paid' : 'part_paid'
    const upd: Record<string, unknown> = { 'payment.paidPence': paid, 'payment.status': status, 'payment.lastPaidAt': at, updatedAt: FieldValue.serverTimestamp() }
    if (j.status === 'awaiting_payment' && due === 0) { upd.status = 'engineer_selected'; upd.statusHistory = FieldValue.arrayUnion({ status: 'payment_confirmed', at: Timestamp.now(), by: 'stripe' }) }
    tx.update(jRef, upd)
    return { j, pay, unlocked: upd.status === 'engineer_selected' }
  })
  if (!out) return
  const amt = `£${(out.pay.amountPence / 100).toFixed(2)}`
  await notify({ userId: out.pay.customerId, category: 'payments', dedupeKey: `paid:${paymentId}`, title: 'Payment confirmed', body: out.unlocked ? `Now book your appointment for ${out.j.reference}.` : `We received ${amt} for ${out.j.reference}.`, link: `/customer/repairs/${out.pay.jobId}`,
    email: { subject: `Payment received for ${out.j.reference}`, heading: 'Payment confirmed', html: `<p>We received your payment of <b>${amt}</b> for repair <b>${p(out.j.reference)}</b>. Stripe will email your card receipt.</p>${out.unlocked ? '<p>You can now book your appointment.</p>' : ''}`, cta: out.unlocked ? 'Book appointment' : 'View repair' } })
  await notify({ userId: out.pay.engineerId, category: 'payments', dedupeKey: `paid-eng:${paymentId}`, title: 'Customer payment received', body: `Payment received for ${out.j.reference}.`, link: `/engineer/my-jobs/${out.pay.jobId}` })
}

/** charge.refunded carries cumulative totals, so applying it twice is harmless. The application-fee refund comes from Stripe, not from assumptions. */
async function syncRefunds(ch: Stripe.Charge) {
  const piId = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id
  if (!piId) return
  const tRef = db.doc(`transactions/${piId}`), t = (await tRef.get()).data()
  if (!t) return
  let commissionRefunded = t.commissionRefundedPence ?? 0
  const feeId = typeof ch.application_fee === 'string' ? ch.application_fee : ch.application_fee?.id
  if (feeId) commissionRefunded = (await stripe().applicationFees.retrieve(feeId)).amount_refunded
  await db.runTransaction(async tx => {
    const cur = (await tx.get(tRef)).data()!, jRef = db.doc(`repairRequests/${cur.jobId}`), j = (await tx.get(jRef)).data()
    const delta = ch.amount_refunded - (cur.refundedPence ?? 0)
    tx.update(tRef, { refundedPence: ch.amount_refunded, commissionRefundedPence: commissionRefunded, status: ch.amount_refunded >= cur.grossPence ? 'refunded' : 'partially_refunded', updatedAt: FieldValue.serverTimestamp() })
    tx.update(db.doc(`commissionRecords/${piId}`), { refundedPence: commissionRefunded, status: commissionRefunded >= cur.commissionPence ? 'refunded' : commissionRefunded > 0 ? 'partially_refunded' : 'earned' })
    tx.update(db.doc(`payments/${cur.paymentId}`), { refundedPence: ch.amount_refunded, status: ch.amount_refunded >= cur.grossPence ? 'refunded' : 'partially_refunded', updatedAt: FieldValue.serverTimestamp() })
    if (j && delta) tx.update(jRef, { 'payment.refundedPence': FieldValue.increment(delta) })
  })
  if (ch.amount_refunded > (t.refundedPence ?? 0)) await notify({ userId: t.customerId, category: 'payments', dedupeKey: `refund:${piId}:${ch.amount_refunded}`, title: 'Refund issued', body: `A refund for ${t.reference} is on its way to your card.`, link: `/customer/repairs/${t.jobId}` })
}

async function syncDispute(dp: Stripe.Dispute, type: string) {
  const piId = typeof dp.payment_intent === 'string' ? dp.payment_intent : dp.payment_intent?.id ?? null
  const t = piId ? (await db.doc(`transactions/${piId}`).get()).data() : undefined
  await db.doc(`paymentDisputes/${dp.id}`).set({ paymentIntentId: piId, chargeId: typeof dp.charge === 'string' ? dp.charge : dp.charge.id, jobId: t?.jobId ?? null, reference: t?.reference ?? null,
    amountPence: dp.amount, reason: dp.reason, status: dp.status, evidenceDueBy: dp.evidence_details?.due_by ? Timestamp.fromMillis(dp.evidence_details.due_by * 1000) : null,
    createdAt: Timestamp.fromMillis(dp.created * 1000), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  if (t?.jobId) await db.doc(`repairRequests/${t.jobId}`).update({ paymentDisputed: dp.status !== 'won' && dp.status !== 'warning_closed', updatedAt: FieldValue.serverTimestamp() })
  if (piId) await db.doc(`transactions/${piId}`).set({ disputeStatus: dp.status, disputedPence: dp.amount }, { merge: true })
  if (type === 'charge.dispute.created') await notifyAdmins('finance.view', { category: 'admin', dedupeKey: `chargeback:${dp.id}`, title: 'Card dispute opened', body: `A customer disputed a payment${t?.reference ? ` for ${t.reference}` : ''}. Respond in Stripe before the deadline.`, link: '/admin/finance' })
}

// ---------- finance report (super admins / finance.view) ----------
export const financeReport = callable(z.object({ from: z.string().datetime(), to: z.string().datetime() }), async (req, d) => {
  requirePerm(req, 'finance.view')
  const from = Timestamp.fromDate(new Date(d.from)), to = Timestamp.fromDate(new Date(d.to))
  const [txs, payouts, disputes, open] = await Promise.all([
    db.collection('transactions').where('createdAt', '>=', from).where('createdAt', '<=', to).limit(5000).get(),
    db.collection('payouts').where('createdAt', '>=', from).where('createdAt', '<=', to).limit(5000).get(),
    db.collection('paymentDisputes').where('createdAt', '>=', from).where('createdAt', '<=', to).limit(1000).get(),
    db.collection('payments').where('status', 'in', ['open', 'processing', 'failed']).limit(1000).get(),
  ])
  const sum = (xs: FirebaseFirestore.DocumentData[], k: string) => xs.reduce((n, x) => n + (Number(x[k]) || 0), 0)
  const t = txs.docs.map(x => x.data()), po = payouts.docs.map(x => x.data()), dp = disputes.docs.map(x => x.data())
  const gross = sum(t, 'grossPence'), commission = sum(t, 'commissionPence'), commissionRefunded = sum(t, 'commissionRefundedPence'), refunded = sum(t, 'refundedPence')
  const fees = sum(t, 'stripeFeePence'), lost = sum(dp.filter(x => x.status === 'lost'), 'amountPence')
  const perDay: Record<string, { gross: number; commission: number }> = {}
  t.forEach(x => { const k = x.createdAt.toDate().toISOString().slice(0, 10); perDay[k] ??= { gross: 0, commission: 0 }; perDay[k].gross += x.grossPence; perDay[k].commission += x.commissionPence })
  return {
    currency: 'GBP', transactions: t.length, grossPence: gross, commissionPence: commission, engineerSharePence: sum(t, 'engineerSharePence'), stripeFeesPence: fees, feesUnknown: t.filter(x => x.stripeFeePence === null).length,
    refundsPence: refunded, commissionRefundedPence: commissionRefunded, disputes: dp.length, disputedPence: sum(dp, 'amountPence'), disputesLostPence: lost,
    // Net platform revenue = commission kept - Stripe processing fees (paid by the platform on destination charges) - lost chargebacks. Not profit: excludes ad spend, operating costs and tax.
    netPlatformRevenuePence: commission - commissionRefunded - fees - lost,
    payoutsPaidPence: sum(po.filter(x => x.status === 'paid'), 'amountPence'), payoutsPendingPence: sum(po.filter(x => ['pending', 'in_transit'].includes(x.status)), 'amountPence'),
    outstandingPayments: open.size, outstandingPence: sum(open.docs.map(x => x.data()), 'amountPence'), perDay,
    rows: t.slice(0, 1000).map(x => ({ date: x.createdAt.toDate().toISOString(), reference: x.reference, kind: x.kind, gross: x.grossPence, commission: x.commissionPence, engineer: x.engineerSharePence, stripeFee: x.stripeFeePence, refunded: x.refundedPence, status: x.status, source: x.source, campaignId: x.attribution?.campaignId ?? '' })),
  }
})

export const paymentsStatus = callable(z.object({}), async (req) => {
  requirePerm(req, 'finance.view')
  const [ps, health] = await Promise.all([paymentSettings(), db.doc('integrationHealth/stripe').get()])
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  return { configured: stripeConfigured(), mode: key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : key ? 'test' : 'none', webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'),
    connectWebhookSecret: !!process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.startsWith('whsec_'), enabled: ps.enabled, lastEventAt: health.data()?.lastEventAt?.toMillis() ?? null, lastError: health.data()?.lastError ?? null }
}, opts)
