// The ONE base URL of the web app. Every link that leaves the backend (Stripe checkout/onboarding returns, emails, push deep links, Meta OAuth return,
// WordPress confirmation links) is built from it. Pure module (no Firebase imports) so it is unit-tested.

/** The currently deployed, resolvable app. Replace via APP_URL once a custom domain actually resolves; app.thorcomputer.com did not (DNS NXDOMAIN) and sent customers to a dead page after paying. */
export const DEFAULT_APP_URL = 'https://thorcomputers.dbsworkouts.workers.dev'

export interface AppUrlResult { url: string; valid: boolean; problem: string }
const LOCAL = new Set(['localhost', '127.0.0.1'])

/** Accepts an origin only: https (http only for localhost/127.0.0.1 during local development). Paths, queries, hashes and a trailing slash are removed; credentials are refused. */
export function resolveAppUrl(raw: string | undefined, fallback = DEFAULT_APP_URL): AppUrlResult {
  const bad = (problem: string): AppUrlResult => ({ url: fallback, valid: false, problem })
  const v = (raw ?? '').trim()
  if (!v) return { url: fallback, valid: true, problem: '' }                       // unset: use the default deployed app
  let u: URL
  try { u = new URL(v) } catch { return bad(`APP_URL "${v.slice(0, 60)}" is not a valid URL`) }
  const local = LOCAL.has(u.hostname)
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return bad('APP_URL must use https')
  if (u.username || u.password) return bad('APP_URL must not contain credentials')
  if (!local && !u.hostname.includes('.')) return bad('APP_URL needs a full hostname')
  return { url: u.origin, valid: true, problem: u.pathname !== '/' || u.search || u.hash ? 'APP_URL path/query ignored: only the origin is used' : '' }
}

/** Every URL the backend hands to Stripe, Meta or a customer, built from one validated base. */
export const appLinks = (base: string) => ({
  checkoutSuccess: (jobId: string) => `${base}/customer/repairs/${encodeURIComponent(jobId)}?paid=1`,
  checkoutCancel: (jobId: string) => `${base}/customer/repairs/${encodeURIComponent(jobId)}?paid=0`,
  onboardingReturn: () => `${base}/settings?stripe=return`,
  onboardingRefresh: () => `${base}/settings?stripe=refresh`,
  metaReturn: (query: string) => `${base}/admin/marketing?${query}`,
  continueLink: (enquiryId: string, token: string) => `${base}/continue?e=${enquiryId}&t=${token}`,
})
