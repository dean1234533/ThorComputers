// Pure business rules: no Firebase imports so they can be unit-tested and reused by every callable.

export type JobStatus =
  | 'awaiting_verification' | 'open' | 'engineer_selected' | 'awaiting_payment' | 'appointment_scheduled' | 'on_the_way' | 'in_progress'
  | 'awaiting_parts' | 'completed' | 'closed' | 'cancelled' | 'disputed'

type Actor = 'customer' | 'engineer' | 'system' | 'admin'

/** Allowed transitions per actor. Anything not listed is rejected server-side. */
export const TRANSITIONS: Record<Actor, Partial<Record<JobStatus, JobStatus[]>>> = {
  customer: { awaiting_verification: ['cancelled'], open: ['cancelled'], engineer_selected: ['cancelled'], awaiting_payment: ['cancelled'], appointment_scheduled: ['cancelled'], completed: ['closed', 'disputed'] },
  engineer: {
    appointment_scheduled: ['on_the_way', 'in_progress'],
    on_the_way: ['in_progress'],
    in_progress: ['awaiting_parts', 'completed'],
    awaiting_parts: ['in_progress', 'completed'],
  },
  system: { awaiting_verification: ['open'], open: ['engineer_selected', 'awaiting_payment'], awaiting_payment: ['engineer_selected'], engineer_selected: ['appointment_scheduled', 'open'], appointment_scheduled: ['engineer_selected'], completed: ['closed'] },
  admin: {
    awaiting_verification: ['open', 'cancelled'], awaiting_payment: ['cancelled', 'open'],
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

// ---------- job references ----------
/** THOR-2026-000125: year + per-year sequence (allocated in a transaction by the caller). */
export const formatJobRef = (year: number, n: number) => `THOR-${year}-${String(n).padStart(6, '0')}`

// ---------- money: commission and payment schedule (integer pence, GBP) ----------
export const DEFAULT_COMMISSION_BPS = 1500                     // 15.00%
/** Round half up in integer arithmetic (no floating point on money). */
export const commissionPence = (amountPence: number, bps: number) => Math.floor((amountPence * bps + 5000) / 10000)
/** Fee for the NEXT payment on a job, so that the fees across every payment (deposit, balance, additional work) always add up to
 *  exactly commissionPence(total paid). Commission can therefore never be charged twice and rounding never drifts. */
export const applicationFeeFor = (alreadyPaidPence: number, amountPence: number, bps: number) =>
  commissionPence(alreadyPaidPence + amountPence, bps) - commissionPence(alreadyPaidPence, bps)
export const splitPayment = (amountPence: number, bps: number) => { const fee = commissionPence(amountPence, bps); return { grossPence: amountPence, commissionPence: fee, engineerSharePence: amountPence - fee } }

export type PaymentPolicy = 'full_before' | 'deposit_before' | 'after_completion'
export const STRIPE_MIN_GBP_PENCE = 30
export const depositPence = (totalPence: number, percent: number) => Math.min(totalPence, Math.max(STRIPE_MIN_GBP_PENCE, Math.round(totalPence * percent / 100)))
/** What the customer must pay now. 'pre' = before the appointment, 'post' = once the repair is completed. */
export function amountDuePence(policy: PaymentPolicy, stage: 'pre' | 'post', agreedPence: number, paidPence: number, depositPercent: number): number {
  if (stage === 'post') return Math.max(0, agreedPence - paidPence)
  if (policy === 'full_before') return Math.max(0, agreedPence - paidPence)
  if (policy === 'deposit_before') return Math.max(0, depositPence(agreedPence, depositPercent) - paidPence)
  return 0
}
/** Whether a policy requires a payment before the appointment can be booked. */
export const paysBeforeAppointment = (policy: PaymentPolicy) => policy !== 'after_completion'

// ---------- Meta lead mapping (pure) ----------
export const LEAD_FIELDS = ['fullName', 'firstName', 'lastName', 'email', 'phone', 'postcode', 'deviceType', 'manufacturer', 'model', 'problem', 'serviceMethod', 'preferredDate', 'urgency', 'consent'] as const
export type LeadField = (typeof LEAD_FIELDS)[number]
/** Sensible defaults for Meta's standard question keys; admins override per form. */
export const DEFAULT_LEAD_FIELD_MAP: Record<string, LeadField> = {
  full_name: 'fullName', first_name: 'firstName', last_name: 'lastName', email: 'email', phone_number: 'phone', phone: 'phone',
  post_code: 'postcode', postcode: 'postcode', zip_code: 'postcode', zip: 'postcode', postal_code: 'postcode',
  device: 'deviceType', device_type: 'deviceType', brand: 'manufacturer', device_brand: 'manufacturer', manufacturer: 'manufacturer', model: 'model',
  problem: 'problem', issue: 'problem', describe_the_problem: 'problem', repair_type: 'serviceMethod', service_method: 'serviceMethod',
  preferred_date: 'preferredDate', urgency: 'urgency',
}
export const DEFAULT_REQUIRED_LEAD_FIELDS: LeadField[] = ['fullName', 'email', 'postcode', 'deviceType', 'problem']
export interface LeadMappingConfig { fieldMap: Record<string, LeadField>; required: LeadField[]; consentField?: string }
export type MappedLead = Partial<Record<LeadField, string>>

export function mapLeadFields(fieldData: { name: string; values?: string[] }[], cfg: LeadMappingConfig): { values: MappedLead; unmapped: Record<string, string> } {
  const values: MappedLead = {}, unmapped: Record<string, string> = {}
  for (const f of fieldData) {
    const v = (f.values ?? []).join(', ').trim().slice(0, 2000)
    const key = cfg.fieldMap[f.name] ?? DEFAULT_LEAD_FIELD_MAP[f.name.toLowerCase()]
    if (cfg.consentField && f.name === cfg.consentField) values.consent = v
    else if (key && v) values[key] = values[key] ? `${values[key]} ${v}` : v
    else if (v) unmapped[f.name] = v
  }
  if (!values.fullName && (values.firstName || values.lastName)) values.fullName = [values.firstName, values.lastName].filter(Boolean).join(' ')
  return { values, unmapped }
}

const DEVICE_WORDS: [RegExp, string][] = [[/gaming/, 'gaming_pc'], [/mac ?book|imac|\bmac\b|apple mac/, 'mac'], [/laptop|notebook|chromebook/, 'laptop'],
  [/iphone|phone|mobile|android|samsung|pixel/, 'phone'], [/ipad|tablet/, 'tablet'], [/printer/, 'printer'], [/desktop|\bpc\b|tower|computer/, 'desktop']]
export const normaliseDevice = (t?: string) => { if (!t) return undefined; const s = t.toLowerCase(); return DEVICE_WORDS.find(([r]) => r.test(s))?.[1] ?? 'other' }
const METHOD_WORDS: [RegExp, string][] = [[/remote|online/, 'remote'], [/collect/, 'collection'], [/office|business|premises/, 'office'], [/home|house|visit/, 'home'], [/workshop|drop|shop|bring/, 'workshop']]
export const normaliseMethod = (t?: string) => { if (!t) return undefined; const s = t.toLowerCase(); return METHOD_WORDS.find(([r]) => r.test(s))?.[1] }
export const normaliseUrgency = (t?: string) => { if (!t) return undefined; const s = t.toLowerCase(); return /urgent|asap|today|emergency/.test(s) ? 'urgent' : /soon|week|few days/.test(s) ? 'soon' : 'flexible' }
export const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/
export const normalisePostcode = (t?: string) => { if (!t) return undefined; const s = t.toUpperCase().replace(/\s+/g, ''); if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(s)) return undefined; return `${s.slice(0, -3)} ${s.slice(-3)}` }
/** Consent is valid only if the form recorded an explicit affirmative answer (Meta custom disclaimer / checkbox question). */
export const consentGiven = (v?: string) => !!v && /^(yes|true|1|agree|i agree|accepted|checked)/i.test(v.trim())

export interface NormalisedLead { fullName?: string; email?: string; phone?: string; postcode?: string; deviceType?: string; manufacturer?: string; model?: string; problem?: string; serviceMethod?: string; preferredDate?: string; urgency?: string }
export function normaliseLead(v: MappedLead): NormalisedLead {
  const email = v.email?.trim().toLowerCase()
  return {
    fullName: v.fullName?.trim().slice(0, 80) || undefined, email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    phone: v.phone?.replace(/[^\d+]/g, '').slice(0, 16) || undefined, postcode: normalisePostcode(v.postcode),
    deviceType: normaliseDevice(v.deviceType ?? v.manufacturer), manufacturer: v.manufacturer?.trim().slice(0, 60) || undefined, model: v.model?.trim().slice(0, 80) || undefined,
    problem: v.problem?.trim().slice(0, 2000) || undefined, serviceMethod: normaliseMethod(v.serviceMethod), preferredDate: /^\d{4}-\d{2}-\d{2}/.test(v.preferredDate ?? '') ? v.preferredDate!.slice(0, 10) : undefined,
    urgency: normaliseUrgency(v.urgency),
  }
}
/** Required fields that are missing or invalid after normalisation. Never invents data: a missing field stays missing. */
export function missingLeadFields(n: NormalisedLead, required: LeadField[]): string[] {
  const has = (f: LeadField) => f === 'consent' ? true : f === 'firstName' || f === 'lastName' ? !!n.fullName : f === 'problem' ? (n.problem?.length ?? 0) >= 10 : !!(n as Record<string, unknown>)[f]
  return required.filter(f => !has(f))
}

// ---------- campaign-to-job routing ----------
export interface RoutingRule {
  id: string; name: string; enabled: boolean; priority: number
  match: { campaignIds?: string[]; formIds?: string[]; deviceTypes?: string[]; outcodePrefixes?: string[]; urgency?: string[] }
  set: { deviceType?: string; urgency?: string; serviceMethods?: string[] }
}
export interface RoutingContext { campaignId?: string; formId?: string; deviceType?: string; postcode?: string; urgency?: string }
const anyOf = (list: string[] | undefined, v?: string) => !list?.length || (!!v && list.includes(v))
/** First enabled rule (lowest priority number) whose every populated criterion matches. */
export function routeLead(rules: RoutingRule[], c: RoutingContext): RoutingRule | null {
  const outcode = c.postcode?.split(' ')[0]
  return [...rules].filter(r => r.enabled).sort((a, b) => a.priority - b.priority).find(r =>
    anyOf(r.match.campaignIds, c.campaignId) && anyOf(r.match.formIds, c.formId) && anyOf(r.match.deviceTypes, c.deviceType) && anyOf(r.match.urgency, c.urgency)
    && (!r.match.outcodePrefixes?.length || (!!outcode && r.match.outcodePrefixes.some(p => outcode.startsWith(p.toUpperCase()))))) ?? null
}
