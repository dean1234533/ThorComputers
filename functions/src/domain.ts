// Pure business rules: no Firebase imports so they can be unit-tested and reused by every callable.

export type JobStatus =
  | 'open' | 'engineer_selected' | 'appointment_scheduled' | 'on_the_way' | 'in_progress'
  | 'awaiting_parts' | 'completed' | 'closed' | 'cancelled' | 'disputed'

type Actor = 'customer' | 'engineer' | 'system' | 'admin'

/** Allowed transitions per actor. Anything not listed is rejected server-side. */
export const TRANSITIONS: Record<Actor, Partial<Record<JobStatus, JobStatus[]>>> = {
  customer: { open: ['cancelled'], engineer_selected: ['cancelled'], appointment_scheduled: ['cancelled'], completed: ['closed', 'disputed'] },
  engineer: {
    appointment_scheduled: ['on_the_way', 'in_progress'],
    on_the_way: ['in_progress'],
    in_progress: ['awaiting_parts', 'completed'],
    awaiting_parts: ['in_progress', 'completed'],
  },
  system: { open: ['engineer_selected'], engineer_selected: ['appointment_scheduled', 'open'], appointment_scheduled: ['engineer_selected'], completed: ['closed'] },
  admin: {
    open: ['cancelled'], engineer_selected: ['cancelled', 'open'], appointment_scheduled: ['cancelled'],
    on_the_way: ['cancelled'], in_progress: ['cancelled'], awaiting_parts: ['cancelled'],
    completed: ['closed', 'disputed'], disputed: ['closed', 'completed', 'cancelled'],
  },
}

export const canTransition = (actor: Actor, from: JobStatus, to: JobStatus) =>
  TRANSITIONS[actor][from]?.includes(to) ?? false

export const DEVICE_TO_SPECS: Record<string, string[]> = {
  laptop: ['laptop'], desktop: ['desktop'], gaming_pc: ['gaming_pc', 'desktop'], mac: ['mac'],
  phone: ['phone'], tablet: ['tablet'], printer: ['printer'], other: ['other', 'it_support'],
}
/** Problem keywords that widen eligibility to cross-cutting specialisations. */
export function requiredSpecsFor(device: string, issues: string[]): string[] {
  const s = new Set(DEVICE_TO_SPECS[device] ?? ['other'])
  const text = issues.join(' ').toLowerCase()
  if (text.includes('virus')) s.add('virus')
  if (text.includes('data recovery')) s.add('data_recovery')
  if (text.includes('software')) s.add('software')
  return [...s]
}

export interface QuoteMoney { repairPence: number; diagnosticPence: number; calloutPence: number }
/** Total the customer will actually pay, always computed server-side (never trusted from client). */
export const quoteTotalPence = (q: QuoteMoney) => q.repairPence + q.diagnosticPence + q.calloutPence

// ---------- availability & slots ----------
export interface DayRule { enabled: boolean; start: string; end: string; breaks: { start: string; end: string }[] } // 'HH:mm'
export interface Availability {
  weekly: Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', DayRule> // 0 = Sunday
  unavailableDates: string[]                                    // 'YYYY-MM-DD' incl. holidays
  slotMinutes: number
}
export const SLOT_MINUTES = 30
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/** Zone-aware wall-clock → Date for Europe/London (handles BST/GMT). */
export function londonDate(dateStr: string, minutes: number): Date {
  const h = Math.floor(minutes / 60), m = minutes % 60
  const guess = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(guess)
  const lh = Number(parts.find(p => p.type === 'hour')!.value) % 24, lm = Number(parts.find(p => p.type === 'minute')!.value)
  const offset = (lh * 60 + lm) - (h * 60 + m)   // minutes London is ahead of UTC at that instant
  return new Date(guess.getTime() - offset * 60000)
}

/** Free start times for a given day: inside working hours, outside breaks, not on unavailable dates, no booked slot overlap. */
export function freeStarts(a: Availability, dateStr: string, durationMin: number, bookedSlotKeys: Set<string>, now: Date, leadMinutes = 120): Date[] {
  if (a.unavailableDates.includes(dateStr)) return []
  const dow = String(new Date(`${dateStr}T12:00:00Z`).getUTCDay()) as keyof Availability['weekly']
  const rule = a.weekly[dow]
  if (!rule?.enabled) return []
  const step = a.slotMinutes || SLOT_MINUTES
  const need = Math.ceil(durationMin / step)
  const out: Date[] = []
  for (let t = toMin(rule.start); t + need * step <= toMin(rule.end); t += step) {
    let ok = true
    for (let i = 0; i < need && ok; i++) {
      const s = t + i * step
      if (rule.breaks.some(b => s < toMin(b.end) && s + step > toMin(b.start))) ok = false
      if (bookedSlotKeys.has(slotKey(londonDate(dateStr, s)))) ok = false
    }
    const start = londonDate(dateStr, t)
    if (ok && start.getTime() >= now.getTime() + leadMinutes * 60000) out.push(start)
  }
  return out
}
export const slotKey = (d: Date) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '') // YYYYMMDDHHmm (UTC)
export function slotKeysFor(start: Date, durationMin: number, step = SLOT_MINUTES): string[] {
  const n = Math.ceil(durationMin / step)
  return Array.from({ length: n }, (_, i) => slotKey(new Date(start.getTime() + i * step * 60000)))
}

// ---------- reviews ----------
export const REVIEW_EDIT_WINDOW_HOURS = 48
export const canEditReview = (createdAt: Date, now: Date, editCount: number) =>
  editCount < 1 && now.getTime() - createdAt.getTime() <= REVIEW_EDIT_WINDOW_HOURS * 3600_000

/** Crude, deliberately conservative first-pass filter; real moderation is human (admin queue). */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/
export const containsContactDetails = (t: string) => {
  if (EMAIL.test(t)) return true
  const digits = t.replace(/[\s().-]/g, '')   // "07700 900123" -> "07700900123"
  return /(?:\+?44|0)\d{9,10}/.test(digits)
}
