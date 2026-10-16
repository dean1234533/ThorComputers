// Pure helpers that keep personal details out of PUBLIC text. A repair's description is readable by every approved engineer before a customer has chosen anyone,
// so postcodes, street addresses, phone numbers and email addresses belong only in the dedicated private fields (shared with the chosen engineer after acceptance).

export const POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g
const PHONE_RE = /(?:\+?44|\b0)[\d\s().-]{8,13}\d\b/g
const STREET_RE = /\b\d{1,4}[a-z]?\s+(?:[A-Z][a-z']+\s+){1,2}(?:Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Close|Drive|Dr|Way|Gardens|Court|Place|Crescent|Terrace|Grove|Square|Hill|Park|Rise|Mews|Walk)\b/g

/** Removes postcodes, emails, phone numbers and "12 High Street"-style addresses and tidies the punctuation left behind. */
export function stripPrivate(text: string): { text: string; removed: boolean } {
  const cleaned = text.replace(EMAIL_RE, ' ').replace(PHONE_RE, ' ').replace(STREET_RE, ' ').replace(POSTCODE_RE, ' ')
  if (cleaned === text) return { text, removed: false }
  const tidy = cleaned.replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])\s*(?=[,.;:!?])/g, '').replace(/\b(at|in|from|near|postcode|address|phone|email|call me on|on)\s*(?=[,.;:!?]|$)/gi, '').replace(/\s{2,}/g, ' ').replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '').trim()
  return { text: tidy, removed: true }
}
