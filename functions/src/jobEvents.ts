// Reacts to repair-request changes. Every action is idempotent (dedupe keys / absolute values), because Firestore triggers can re-run.
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { db, notify, FieldValue, Timestamp, REGION } from './core'
import { paymentSettings } from './settings'
import { dueNow, issueRefund, STRIPE_SECRETS, stripeConfigured } from './payments'
import { p } from './email'

/** Lead status as the job moves through the marketplace (Lead -> Job -> Quote -> Payment -> Completed). */
export function leadStatusFor(j: FirebaseFirestore.DocumentData): string {
  if (['completed', 'closed'].includes(j.status)) return 'completed'
  if ((j.payment?.paidPence ?? 0) > 0) return 'converted_to_customer'
  if (['engineer_selected', 'awaiting_payment', 'appointment_scheduled', 'on_the_way', 'in_progress', 'awaiting_parts'].includes(j.status)) return 'engineer_selected'
  if (j.status === 'cancelled') return 'cancelled'
  if (j.status === 'open' && (j.quoteCount ?? 0) > 0) return 'receiving_bids'
  return 'converted_to_job'
}

export const onRepairRequestUpdated = onDocumentUpdated({ document: 'repairRequests/{id}', region: REGION, secrets: STRIPE_SECRETS }, async (event) => {
  const before = event.data?.before.data(), after = event.data?.after.data()
  if (!before || !after) return
  const id = event.params.id

  const leadId = after.attribution?.leadId
  if (leadId) {
    const next = leadStatusFor(after)
    const upd = { status: next, jobStatus: after.status, quoteCount: after.quoteCount ?? 0, selectedEngineerId: after.selectedEngineerId ?? null, transactionStatus: after.payment?.status ?? null,
      paidPence: after.payment?.paidPence ?? 0, updatedAt: FieldValue.serverTimestamp() }
    await db.doc(`metaLeads/${leadId}`).set(upd, { merge: true }).catch(e => console.error('lead sync', leadId, e.message))
    if (next !== leadStatusFor(before)) await db.collection('leadConversionEvents').doc(`${leadId}_${next}`).set({ leadId, jobId: id, status: next, campaignId: after.attribution?.campaignId ?? null, at: FieldValue.serverTimestamp() })
  }

  if (before.status !== 'completed' && after.status === 'completed') {
    const due = dueNow(after)
    if (due.amount > 0) await notify({ userId: after.customerId, category: 'payments', dedupeKey: `balance-due:${id}`, title: 'Repair completed: payment due', body: `Please check the work on ${after.reference} and pay the balance.`, link: `/customer/repairs/${id}`,
      email: { subject: `Payment due for ${after.reference}`, heading: 'Your repair is complete', html: `<p>Your engineer has completed <b>${p(after.reference)}</b>. Please check the work, then pay the remaining <b>£${(due.amount / 100).toFixed(2)}</b> securely through the app.</p>`, cta: 'Pay now' } })
    await db.doc(`repairRequests/${id}`).update({ reviewInviteDueAt: Timestamp.fromMillis(Date.now() + 24 * 3600_000) })
  }

  // Customer cancelled a job they had already paid for: refund automatically, minus the configured cancellation charge.
  if (before.status !== 'cancelled' && after.status === 'cancelled' && (after.payment?.paidPence ?? 0) > (after.payment?.refundedPence ?? 0) && stripeConfigured()) {
    const ps = await paymentSettings()
    const pays = await db.collection('payments').where('jobId', '==', id).where('status', '==', 'paid').get()
    let keep = ps.cancellationFeePence
    for (const pay of pays.docs) {
      const amt = pay.data().amountPence - (pay.data().refundedPence ?? 0) - Math.min(keep, pay.data().amountPence)
      keep = Math.max(0, keep - pay.data().amountPence)
      if (amt > 0) await issueRefund(pay.id, amt, 'system', 'Repair cancelled', `cancel-${id}`).catch(e => console.error('auto refund failed', pay.id, e.message))
    }
  }
})

/** Daily: review invitations for completed repairs, and reminders for unpaid accepted quotes. */
export const dailyFollowUps = onSchedule({ region: REGION, schedule: 'every day 10:00', timeZone: 'Europe/London' }, async () => {
  const due = await db.collection('repairRequests').where('reviewInviteDueAt', '<=', Timestamp.now()).limit(300).get()
  for (const d of due.docs) {
    const j = d.data()
    const reviewed = (await db.doc(`reviews/${d.id}_customer_to_engineer`).get()).exists
    if (!reviewed && ['completed', 'closed'].includes(j.status)) await notify({ userId: j.customerId, category: 'reviews', dedupeKey: `review-invite:${d.id}`, title: 'How did your repair go?', body: `Leave a review for ${j.reference}.`, link: `/customer/repairs/${d.id}`,
      email: { subject: 'How did your repair go?', heading: 'Tell us how it went', html: `<p>Your review of <b>${p(j.reference)}</b> helps other customers choose with confidence. It takes a minute.</p>`, cta: 'Leave a review' } })
    await d.ref.update({ reviewInviteDueAt: FieldValue.delete() })
  }
  const unpaid = await db.collection('repairRequests').where('status', '==', 'awaiting_payment').where('updatedAt', '<=', Timestamp.fromMillis(Date.now() - 24 * 3600_000)).where('updatedAt', '>=', Timestamp.fromMillis(Date.now() - 4 * 86400_000)).limit(300).get()
  for (const d of unpaid.docs) await notify({ userId: d.data().customerId, category: 'payments', dedupeKey: `pay-reminder:${d.id}:${new Date().toISOString().slice(0, 10)}`, title: 'Complete your payment', body: `Pay for ${d.data().reference} to book your appointment.`, link: `/customer/repairs/${d.id}` })
})
