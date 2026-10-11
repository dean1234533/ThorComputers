import { z } from 'zod'
import { db, callable, requireAuth, requireRole, notify, FieldValue, Timestamp, HttpsError } from './core'
import { Availability, freeStarts, londonDate, slotKeysFor, SLOT_MINUTES } from './domain'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { REGION } from './core'

const DEFAULT_AVAIL: Availability = {
  slotMinutes: SLOT_MINUTES, unavailableDates: [],
  weekly: Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map(d => [d, { enabled: !['0', '6'].includes(d), start: '09:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00' }] }])) as Availability['weekly'],
}
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

async function loadAvailability(engineerId: string, tx?: FirebaseFirestore.Transaction): Promise<Availability> {
  const r = db.doc(`engineerProfiles/${engineerId}/private/availability`)
  const data = (tx ? await tx.get(r) : await r.get()).data() as Availability | undefined
  return data?.weekly ? { ...DEFAULT_AVAIL, ...data, slotMinutes: SLOT_MINUTES } : DEFAULT_AVAIL
}
const durationMin = (hours: number) => Math.max(SLOT_MINUTES, Math.ceil(hours * 60 / SLOT_MINUTES) * SLOT_MINUTES)

async function jobForBooking(uid: string, jobId: string) {
  const job = (await db.doc(`repairRequests/${jobId}`).get()).data()
  if (!job || job.customerId !== uid) throw new HttpsError('permission-denied', 'Not your job.')
  const quote = (await db.doc(`repairQuotes/${job.acceptedQuoteId}`).get()).data()
  if (!job.selectedEngineerId || !quote) throw new HttpsError('failed-precondition', 'Select an engineer first.')
  return { job, quote }
}

export const getSlots = callable(z.object({ jobId: z.string(), date: dateStr }), async (req, d) => {
  const c = requireRole(req, 'customer')
  const { job, quote } = await jobForBooking(c.uid, d.jobId)
  const avail = await loadAvailability(job.selectedEngineerId)
  const lo = slotKeysFor(londonDate(d.date, 0), SLOT_MINUTES)[0], hi = slotKeysFor(londonDate(d.date, 24 * 60 - 1), SLOT_MINUTES)[0]
  const booked = await db.collection('appointmentSlots').where('engineerId', '==', job.selectedEngineerId).where('key', '>=', lo).where('key', '<=', hi).get()
  const starts = freeStarts(avail, d.date, durationMin(quote.durationHours), new Set(booked.docs.map(x => x.data().key as string)), new Date())
  return { slots: starts.map(s => s.toISOString()), durationMinutes: durationMin(quote.durationHours) }
})

function lockSlots(tx: FirebaseFirestore.Transaction, engineerId: string, keys: string[], appointmentId: string) {
  keys.forEach(k => tx.create(db.doc(`appointmentSlots/${engineerId}_${k}`), { engineerId, key: k, appointmentId }))
}
const freeSlots = (tx: FirebaseFirestore.Transaction, engineerId: string, keys: string[]) => keys.forEach(k => tx.delete(db.doc(`appointmentSlots/${engineerId}_${k}`)))
async function assertFree(tx: FirebaseFirestore.Transaction, engineerId: string, keys: string[], ignoreAppointment?: string) {
  const snaps = await tx.getAll(...keys.map(k => db.doc(`appointmentSlots/${engineerId}_${k}`)))
  if (snaps.some(s => s.exists && s.data()!.appointmentId !== ignoreAppointment)) throw new HttpsError('already-exists', 'That time was just taken. Please choose another slot.')
}

export const bookAppointment = callable(z.object({ jobId: z.string(), startAt: z.string().datetime() }), async (req, d) => {
  const c = requireRole(req, 'customer')
  const start = new Date(d.startAt)
  const aptId = `apt_${d.jobId}`
  const out = await db.runTransaction(async tx => {
    const jRef = db.doc(`repairRequests/${d.jobId}`)
    const job = (await tx.get(jRef)).data()
    if (!job || job.customerId !== c.uid) throw new HttpsError('permission-denied', 'Not your job.')
    const existing = await tx.get(db.doc(`appointments/${aptId}`))
    if (existing.exists && ['confirmed', 'reschedule_requested'].includes(existing.data()!.status)) {
      if (existing.data()!.startAt.toMillis() === start.getTime()) return { replay: true as const }   // idempotent retry
      throw new HttpsError('failed-precondition', 'An appointment already exists. Use reschedule.')
    }
    if (job.status !== 'engineer_selected') throw new HttpsError('failed-precondition', 'Appointments can be booked after you select an engineer.')
    const quote = (await tx.get(db.doc(`repairQuotes/${job.acceptedQuoteId}`))).data()!
    if (['home', 'office'].includes(job.agreedMethod)) {
      const priv = (await tx.get(db.doc(`repairRequests/${d.jobId}/private/details`))).data()
      if (!priv?.addressLine) throw new HttpsError('failed-precondition', 'Add your address so the engineer can visit.')
    }
    const mins = durationMin(quote.durationHours), keys = slotKeysFor(start, mins)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(start)
    const avail = await loadAvailability(job.selectedEngineerId, tx)
    const ok = freeStarts(avail, day, mins, new Set(), new Date()).some(s => s.getTime() === start.getTime())
    if (!ok) throw new HttpsError('failed-precondition', 'That time is outside the engineer’s availability.')
    await assertFree(tx, job.selectedEngineerId, keys)
    lockSlots(tx, job.selectedEngineerId, keys, aptId)
    tx.set(db.doc(`appointments/${aptId}`), {
      jobId: d.jobId, reference: job.reference, customerId: c.uid, engineerId: job.selectedEngineerId, quoteId: job.acceptedQuoteId, method: job.agreedMethod, totalPence: job.agreedTotalPence,
      startAt: Timestamp.fromDate(start), endAt: Timestamp.fromMillis(start.getTime() + mins * 60000), durationMinutes: mins, slotKeys: keys, status: 'confirmed', pendingReschedule: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
    tx.update(jRef, { status: 'appointment_scheduled', statusHistory: FieldValue.arrayUnion({ status: 'appointment_scheduled', at: Timestamp.now(), by: c.uid }), updatedAt: FieldValue.serverTimestamp() })
    return { replay: false as const, engineerId: job.selectedEngineerId as string, reference: job.reference as string }
  })
  if (!out.replay) {
    const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London' }).format(start)
    await Promise.all([
      notify({ userId: out.engineerId, category: 'bookings', dedupeKey: `apt-confirmed:${aptId}:eng`, title: 'Appointment confirmed', body: `New booking for ${out.reference}.`, link: '/engineer/appointments' }),
      notify({ userId: c.uid, category: 'bookings', dedupeKey: `apt-confirmed:${aptId}:cust`, title: 'Appointment confirmed', body: `Your booking for ${out.reference} is confirmed.`, link: '/customer/appointments',
        email: { subject: 'Your appointment is confirmed', heading: 'Appointment confirmed', html: `<p>Your repair <b>${out.reference}</b> is booked for <b>${when}</b>.</p>`, cta: 'View appointment' } }),
    ])
  }
  return { appointmentId: aptId }
})

async function participantAppointment(tx: FirebaseFirestore.Transaction, uid: string, id: string) {
  const r = db.doc(`appointments/${id}`), s = await tx.get(r)
  if (!s.exists) throw new HttpsError('not-found', 'Appointment not found.')
  const a = s.data()!
  if (a.customerId !== uid && a.engineerId !== uid) throw new HttpsError('permission-denied', 'Not your appointment.')
  return { r, a, other: (a.customerId === uid ? a.engineerId : a.customerId) as string }
}

export const cancelAppointment = callable(z.object({ appointmentId: z.string(), reason: z.string().max(300).optional().default('') }), async (req, d) => {
  const c = requireAuth(req)
  const out = await db.runTransaction(async tx => {
    const { r, a, other } = await participantAppointment(tx, c.uid, d.appointmentId)
    if (!['confirmed', 'reschedule_requested'].includes(a.status)) throw new HttpsError('failed-precondition', `Appointment is already ${a.status}.`)
    if (a.startAt.toMillis() < Date.now()) throw new HttpsError('failed-precondition', 'This appointment has already started.')
    freeSlots(tx, a.engineerId, a.slotKeys)
    tx.update(r, { status: 'cancelled', cancelledBy: c.uid, cancelReason: d.reason, updatedAt: FieldValue.serverTimestamp() })
    const jr = db.doc(`repairRequests/${a.jobId}`)
    tx.update(jr, { status: 'engineer_selected', statusHistory: FieldValue.arrayUnion({ status: 'engineer_selected', at: Timestamp.now(), by: c.uid, note: 'appointment cancelled' }), updatedAt: FieldValue.serverTimestamp() })
    return { other, reference: a.reference as string, isCustomer: a.customerId === c.uid }
  })
  await notify({ userId: out.other, category: 'bookings', dedupeKey: `apt-cancel:${d.appointmentId}`, title: 'Appointment cancelled', body: `The appointment for ${out.reference} was cancelled.`, link: out.isCustomer ? '/engineer/appointments' : '/customer/appointments' })
  return { ok: true }
})

export const requestReschedule = callable(z.object({ appointmentId: z.string(), newStartAt: z.string().datetime() }), async (req, d) => {
  const c = requireAuth(req)
  const start = new Date(d.newStartAt)
  const out = await db.runTransaction(async tx => {
    const { r, a, other } = await participantAppointment(tx, c.uid, d.appointmentId)
    if (a.status !== 'confirmed') throw new HttpsError('failed-precondition', 'Only confirmed appointments can be rescheduled.')
    const keys = slotKeysFor(start, a.durationMinutes), day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(start)
    const avail = await loadAvailability(a.engineerId, tx)
    if (!freeStarts(avail, day, a.durationMinutes, new Set(), new Date()).some(s => s.getTime() === start.getTime())) throw new HttpsError('failed-precondition', 'That time is outside the engineer’s availability.')
    await assertFree(tx, a.engineerId, keys, d.appointmentId)
    tx.update(r, { status: 'reschedule_requested', pendingReschedule: { by: c.uid, startAt: Timestamp.fromDate(start) }, updatedAt: FieldValue.serverTimestamp() })
    return { other, reference: a.reference as string, toEngineer: other === a.engineerId }
  })
  await notify({ userId: out.other, category: 'bookings', dedupeKey: `apt-resched:${d.appointmentId}:${start.getTime()}`, title: 'Reschedule requested', body: `A new time was proposed for ${out.reference}.`, link: out.toEngineer ? '/engineer/appointments' : '/customer/appointments' })
  return { ok: true }
})

export const respondReschedule = callable(z.object({ appointmentId: z.string(), accept: z.boolean() }), async (req, d) => {
  const c = requireAuth(req)
  const out = await db.runTransaction(async tx => {
    const { r, a, other } = await participantAppointment(tx, c.uid, d.appointmentId)
    if (a.status !== 'reschedule_requested' || !a.pendingReschedule) throw new HttpsError('failed-precondition', 'No pending reschedule.')
    if (a.pendingReschedule.by === c.uid) throw new HttpsError('permission-denied', 'The other party must respond.')
    if (!d.accept) { tx.update(r, { status: 'confirmed', pendingReschedule: null, updatedAt: FieldValue.serverTimestamp() }); return { other, reference: a.reference as string, accepted: false, toEngineer: other === a.engineerId } }
    const start: Date = a.pendingReschedule.startAt.toDate(), keys = slotKeysFor(start, a.durationMinutes)
    await assertFree(tx, a.engineerId, keys, d.appointmentId)
    freeSlots(tx, a.engineerId, a.slotKeys); lockSlots(tx, a.engineerId, keys, d.appointmentId)
    tx.update(r, { status: 'confirmed', startAt: Timestamp.fromDate(start), endAt: Timestamp.fromMillis(start.getTime() + a.durationMinutes * 60000), slotKeys: keys, pendingReschedule: null, reminders: {}, updatedAt: FieldValue.serverTimestamp() })
    return { other, reference: a.reference as string, accepted: true, toEngineer: other === a.engineerId }
  })
  await notify({ userId: out.other, category: 'bookings', dedupeKey: `apt-resched-resp:${d.appointmentId}:${Date.now()}`, title: out.accepted ? 'Appointment rescheduled' : 'Reschedule declined', body: `Update for ${out.reference}.`, link: out.toEngineer ? '/engineer/appointments' : '/customer/appointments' })
  return { ok: true }
})

/** Reminder timing is configurable in platformSettings/public.booking.reminderHours (default 24h and 2h). */
export const sendAppointmentReminders = onSchedule({ region: REGION, schedule: 'every 15 minutes' }, async () => {
  const hours: number[] = (await db.doc('platformSettings/public').get()).data()?.booking?.reminderHours ?? [24, 2]
  const now = Date.now(), maxH = Math.max(...hours)
  const snap = await db.collection('appointments').where('status', '==', 'confirmed').where('startAt', '>', Timestamp.fromMillis(now)).where('startAt', '<=', Timestamp.fromMillis(now + maxH * 3600_000)).get()
  for (const doc of snap.docs) {
    const a = doc.data(), until = (a.startAt.toMillis() - now) / 3600_000
    const due = hours.filter(h => until <= h).sort((x, y) => x - y)[0]   // tightest window already reached
    if (due === undefined) continue
    for (const [uid, link] of [[a.customerId, '/customer/appointments'], [a.engineerId, '/engineer/appointments']] as const)
      await notify({ userId: uid, category: 'bookings', dedupeKey: `reminder:${doc.id}:${due}h:${a.startAt.toMillis()}:${uid}`, title: 'Appointment reminder', body: `You have an appointment coming up for ${a.reference}.`, link })
  }
})
