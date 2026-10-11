// Transactional email via Resend's HTTPS API. OPTIONAL: RESEND_API_KEY is not declared as a secret, so email is skipped and push/in-app notifications carry everything.
// To enable later: add 'RESEND_API_KEY' to the secrets list in core.ts, run firebase functions:secrets:set RESEND_API_KEY, redeploy.
const FROM = process.env.EMAIL_FROM ?? 'Thor Computer <no-reply@thorcomputer.com>'
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export function layout(heading: string, html: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#F6F8FB;font-family:Roboto,Arial,sans-serif;color:#12233D">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#225AA5;padding:20px 28px"><img src="https://thorcomputer.com/wp-content/uploads/2024/05/Company-Logo-1-300x165.jpg" alt="Thor Computer Ltd" height="56" style="display:block"></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 14px;font:600 22px 'Roboto Slab',Georgia,serif;color:#225AA5">${esc(heading)}</h1>
<div style="font-size:15px;line-height:1.6">${html}</div>
${cta ? `<p style="margin:26px 0 0"><a href="${esc(cta.url)}" style="background:#FF8F34;color:#12233D;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px;display:inline-block">${esc(cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:18px 28px;background:#F6F8FB;font-size:12px;color:#7A7A7A">Thor Computer Ltd &middot; thorcomputer.com<br>You receive this because you have an account with us. Manage email preferences in app Settings.</td></tr>
</table></td></tr></table></body></html>`
}

/** Local development (Functions emulator, or MOCK_EXTERNAL=true): never call Resend. The message is written to the `devMailbox` collection so tests can read it. */
const MOCK = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.MOCK_EXTERNAL === 'true'

export async function sendEmail(o: { to: string; subject: string; heading: string; html: string; cta?: { label: string; url: string } }) {
  if (MOCK) {
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore')
    await getFirestore().collection('devMailbox').add({ to: o.to, subject: o.subject, heading: o.heading, html: o.html, cta: o.cta ?? null, createdAt: FieldValue.serverTimestamp() })
    console.log('[mock email]', o.to, '|', o.subject)
    return
  }
  const key = process.env.RESEND_API_KEY
  if (!key) { console.warn('RESEND_API_KEY not set; email skipped:', o.subject); return }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: o.to, subject: o.subject, html: layout(o.heading, o.html, o.cta) }),
  })
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`)
}
export const p = esc
