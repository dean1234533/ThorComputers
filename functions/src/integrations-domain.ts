// Pure helpers for webhook verification and Meta lead mapping. No Firebase imports: unit-tested in isolation.
import { createHmac, timingSafeEqual } from 'node:crypto'

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

/** Stripe-Signature: "t=1700000000,v1=<hex>[,v1=<hex>]"; signed payload is `${t}.${rawBody}` (HMAC-SHA256). Rejects stale timestamps (replay). */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false
  const parts = header.split(',').map(s => s.trim().split('='))
  const t = Number(parts.find(([k]) => k === 't')?.[1]), sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!t || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  return sigs.some(s => safeEq(s, expected))
}
export const signStripePayload = (rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`

/** Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw body). */
export function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false
  return safeEq(header.slice(7), createHmac('sha256', appSecret).update(rawBody).digest('hex'))
}
export const signMetaPayload = (rawBody: string, appSecret: string) => 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex')

// ---------- Meta lead mapping ----------
export const APP_LEAD_FIELDS = ['name', 'email', 'phone', 'postcode', 'device', 'brand', 'model', 'problem', 'method', 'urgency', 'date', 'consent'] as const
export type AppLeadField = typeof APP_LEAD_FIELDS[number]
export type LeadMapping = { fields: Partial<Record<AppLeadField, string[]>>; required: AppLeadField[] }

/** Defaults cover Meta's standard Instant Form fields plus the usual custom-question keys. Admins override per lead form. */
export const DEFAULT_MAPPING: LeadMapping = {
  fields: {
    name: ['full_name', 'name', 'first_name'], email: ['email', 'work_email'], phone: ['phone_number', 'phone', 'work_phone_number'],
    postcode: ['post_code', 'zip_code', 'postcode', 'postal_code', 'zip'], device: ['device_type', 'device', 'what_device_needs_repairing', 'device_to_repair'],
    brand: ['brand', 'device_brand', 'manufacturer'], model: ['model', 'device_model'],
    problem: ['problem', 'describe_the_problem', 'what_is_the_problem', 'issue', 'problem_description', 'message'],
    method: ['repair_type', 'service_method', 'preferred_repair_method', 'repair_method'], urgency: ['urgency', 'how_urgent_is_it'],
    date: ['preferred_date', 'appointment_date', 'preferred_appointment_date'], consent: ['consent', 'marketplace_consent', 'i_agree'],
  },
  required: ['name', 'email', 'postcode', 'problem'],
}

export const normaliseKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
export interface MetaFieldData { name: string; values?: string[] }

export const DEVICE_WORDS: [RegExp, string][] = [[/gaming/, 'gaming_pc'], [/laptop|notebook|macbook/, 'laptop'], [/desktop|tower|pc\b|computer/, 'desktop'], [/\bmac\b|imac/, 'mac'], [/phone|iphone|android|mobile/, 'phone'], [/tablet|ipad/, 'tablet'], [/printer/, 'printer']]
export const METHOD_WORDS: [RegExp, string][] = [[/home|house|visit/, 'home'], [/office|business|premises/, 'office'], [/remote|online/, 'remote'], [/collect|pick/, 'collection'], [/workshop|bring|drop/, 'workshop']]
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/

export const normaliseDevice = (v: string) => DEVICE_WORDS.find(([re]) => re.test(v.toLowerCase()))?.[1] ?? (v ? 'other' : '')
export const normaliseMethod = (v: string) => METHOD_WORDS.find(([re]) => re.test(v.toLowerCase()))?.[1] ?? ''
export const normalisePostcode = (v: string) => { const p = v.trim().toUpperCase().replace(/\s+/g, ' '); const c = p.replace(' ', ''); const spaced = c.length > 3 ? `${c.slice(0, -3)} ${c.slice(-3)}` : c; return UK_POSTCODE.test(spaced) ? spaced : '' }
export const isTruthyConsent = (v: string) => /^(yes|true|checked|agree|agreed|i agree|1|on)$/i.test(v.trim())

export interface MappedLead { values: Partial<Record<AppLeadField, string>>; missing: AppLeadField[]; invalid: AppLeadField[]; unmapped: string[] }

/** Maps Meta field_data onto app fields. Never invents data: anything absent or invalid is reported in `missing`/`invalid` so the lead goes to the clarification workflow. */
export function mapLead(fieldData: MetaFieldData[], mapping: LeadMapping = DEFAULT_MAPPING): MappedLead {
  const byKey = new Map(fieldData.map(f => [normaliseKey(f.name), (f.values ?? []).join(', ').trim()]))
  const used = new Set<string>(), values: MappedLead['values'] = {}
  for (const field of APP_LEAD_FIELDS) {
    for (const key of mapping.fields[field] ?? []) {
      const v = byKey.get(normaliseKey(key))
      if (v) { values[field] = v; used.add(normaliseKey(key)); break }
    }
  }
  const invalid: AppLeadField[] = []
  if (values.email) { values.email = values.email.toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) { invalid.push('email'); delete values.email } }
  if (values.postcode) { const p = normalisePostcode(values.postcode); if (p) values.postcode = p; else { invalid.push('postcode'); delete values.postcode } }
  if (values.device) values.device = normaliseDevice(values.device)
  if (values.method) { const m = normaliseMethod(values.method); if (m) values.method = m; else delete values.method }
  if (values.problem && values.problem.length < 5) { invalid.push('problem'); delete values.problem }
  const missing = mapping.required.filter(f => !values[f] && !invalid.includes(f))
  return { values, missing, invalid, unmapped: [...byKey.keys()].filter(k => !used.has(k)) }
}

/** Lead lifecycle. Forward-only except for the manual states, so late events cannot move a lead backwards. */
export const LEAD_STATUSES = ['new', 'imported', 'awaiting_information', 'awaiting_confirmation', 'verified', 'converted_to_job', 'receiving_bids', 'engineer_selected', 'converted_to_customer', 'completed', 'rejected', 'duplicate'] as const
export type LeadStatus = typeof LEAD_STATUSES[number]
const RANK: Record<LeadStatus, number> = { new: 0, imported: 1, awaiting_information: 2, awaiting_confirmation: 3, verified: 4, converted_to_job: 5, receiving_bids: 6, engineer_selected: 7, converted_to_customer: 8, completed: 9, rejected: -1, duplicate: -1 }
export const advanceLead = (from: LeadStatus, to: LeadStatus): LeadStatus => (from === 'rejected' || from === 'duplicate') ? from : (RANK[to] > RANK[from] ? to : from)
