// Pure crypto helpers (no Firebase imports) so they can be unit-tested.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

/** Meta signs webhook bodies with the app secret: header `X-Hub-Signature-256: sha256=<hex HMAC of the raw body>`. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=') || !appSecret) return false
  return safeEqual(header.slice(7), createHmac('sha256', appSecret).update(rawBody).digest('hex'))
}

/** appsecret_proof: required by Meta for server-side calls when "Require App Secret" is on, and good practice regardless. */
export const appSecretProof = (accessToken: string, appSecret: string) => createHmac('sha256', appSecret).update(accessToken).digest('hex')

/** AES-256-GCM. Third-party access tokens are stored encrypted in a rules-locked collection; the key lives in Secret Manager. */
const keyFrom = (secret: string) => createHash('sha256').update(secret).digest()
export function encryptSecret(plain: string, secret: string): string {
  if (!secret) throw new Error('Encryption key not configured')
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}
export function decryptSecret(enc: string, secret: string): string {
  const [v, iv, tag, body] = enc.split('.')
  if (v !== 'v1') throw new Error('Unknown secret format')
  const d = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8')
}

/** Opaque one-time tokens: only the hash is stored. */
export const newToken = () => randomBytes(24).toString('hex')
