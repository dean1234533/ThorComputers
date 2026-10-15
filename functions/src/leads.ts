import { db, FieldValue } from './core'
import { advanceLead, LeadStatus } from './integrations-domain'

/** Moves a lead forward (never back) and records one conversion event per (lead, event) so replays cannot double count. */
export async function advanceLeadDoc(leadId: string, to: LeadStatus, event: string, extra: Record<string, unknown> = {}) {
  const ref = db.doc(`metaLeads/${leadId}`)
  const changed = await db.runTransaction(async tx => {
    const snap = await tx.get(ref); if (!snap.exists) return false
    const from = snap.data()!.status as LeadStatus, next = advanceLead(from, to)
    if (next === from && !Object.keys(extra).length) return false
    tx.update(ref, { status: next, ...extra, updatedAt: FieldValue.serverTimestamp() })
    return next !== from
  })
  if (changed) await db.doc(`leadConversionEvents/${leadId}_${event}`).create({ leadId, event, to, at: FieldValue.serverTimestamp() }).catch((e: any) => { if (e.code !== 6) throw e })
}
/** Called from job/payment paths: if the job came from a Meta lead, advance that lead. Silent no-op otherwise. */
export async function advanceLeadForJob(jobId: string, to: LeadStatus, event: string) {
  const leadId = (await db.doc(`repairRequests/${jobId}`).get()).data()?.attribution?.leadId as string | undefined
  if (leadId) await advanceLeadDoc(leadId, to, event, { jobId })
}
