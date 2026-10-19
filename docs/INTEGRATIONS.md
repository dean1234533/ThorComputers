# Payments, Meta lead generation and the AI assistant

Everything here is built and tested **locally against the Firebase emulators** (`npm run test:integrations`, 46 checks). Stripe, Meta and Gemini are mocked *inside the functions* when running locally; **nothing has been run against the real services yet**. This page lists exactly what you must configure to make each one real, in order.

## App web address
Every link the backend gives to Stripe (checkout success/cancel, onboarding return/refresh), emails, push notifications, Meta OAuth and WordPress confirmations is built from **one validated base URL**: `APP_URL` in `functions/.env`, https, origin only, falling back to the deployed app if it is missing or invalid (`functions/src/app-url.ts`). It is currently `https://thorcomputers.dbsworkouts.workers.dev`. `app.thorcomputer.com` did not resolve (DNS NXDOMAIN) and sent customers to a dead page after paying; only switch `APP_URL` to it once that domain loads the app. Redeploy functions after changing it.

## Deploy order
1. `firebase deploy --only firestore:rules,firestore:indexes` (new rules and 4 new composite indexes; indexes take a few minutes to build).
2. Set the secrets (below). A function that declares a secret cannot deploy until that secret exists, so create **all** of them first. A placeholder such as `not-set-yet` is fine for features you are not enabling yet: the feature then fails safely.
3. Create `functions/.env` with `META_APP_ID=<your Meta app id>` (public value, optional until Meta is live).
4. `firebase deploy --only functions`, then the web app (Cloudflare picks it up from GitHub).
5. Sign in as the Super Administrator **after** deploy so your token carries the new permissions (a super admin gets every permission automatically; ordinary admins need `Admin team` re-saved).

| Secret | Used by | Where to get it |
|---|---|---|
| `STRIPE_SECRET_KEY` | checkout, onboarding, refunds | Stripe → Developers → API keys (use the **restricted** or secret key; start with `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | `stripeWebhook` | Stripe → Developers → Webhooks → your endpoint → Signing secret. **Two endpoints → join both secrets with a comma** |
| `META_APP_SECRET` | OAuth, webhook signature, token encryption | developers.facebook.com → your app → Settings → Basic |
| `META_VERIFY_TOKEN` | Meta webhook handshake | You choose any long random string; paste the same into Meta |
| `GEMINI_API_KEY` | AI assistant | aistudio.google.com → API keys |
| `WP_INTAKE_SECRET` | WordPress plugin | already set |

Set each with `firebase functions:secrets:set NAME --account <you> --project thorcomputers-39d33`.

## Stripe Connect (15% commission)
**Model: destination charges.** The customer pays Thor Computer; Stripe keeps `application_fee_amount` (the commission) and transfers the rest to the engineer’s connected Express account. Consequences you should be aware of: Thor Computer is the **merchant of record**, handles refunds and chargebacks, and pays Stripe’s processing fee (so *net platform revenue = commission − commission refunded − Stripe fees*). Check this with your accountant and Stripe before launch: it affects VAT treatment, terms of service and who the customer’s contract is with.

1. Stripe Dashboard → **Connect → Get started**; choose a **platform / marketplace**, **Express** accounts, United Kingdom. Complete the Connect platform profile.
2. Webhooks → **Add endpoint** `https://europe-west2-thorcomputers-39d33.cloudfunctions.net/stripeWebhook`
   * Endpoint 1 (*Your account*): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.payment_failed`, `charge.succeeded`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `transfer.created`.
   * Endpoint 2 (*Connected accounts*, same URL): `account.updated`.
   * Put both signing secrets in `STRIPE_WEBHOOK_SECRET`, comma separated.
3. Engineers: **Settings → Payments → Set up payments with Stripe** (hosted onboarding; Thor Computer stores only the account id and status).
4. Customers: **Pay securely** on the repair page. **A payment counts only when Stripe’s signed webhook says so**; the success page is not proof.

Rules implemented and tested: commission is calculated on the server in whole pence (rounded half up), from the accepted quotation, never from the browser; the rate in force when a quote is accepted is **frozen on the job**; only the Super Administrator can change the rate (0–30% hard cap) and every change is audited; replayed or duplicate events change nothing; an amount mismatch is flagged and never marked paid; refunds are admin-only, capped at the amount paid, and the record changes only when Stripe confirms; chargebacks are recorded with a resolution log; extra work needs the customer’s approval before it can be paid and uses the job’s frozen rate.

Commission returned on a refund is derived from `charge.refunded` (proportional, matching Stripe’s `refund_application_fee`); the optional `application_fee.refunded` event, if you can subscribe to it, overrides with Stripe’s exact figure.

**Not implemented (be aware):** deposit / pay-after-completion policies (only “pay in full”, optionally required before booking, is supported); SMS; payouts schedules beyond Stripe’s own; refunds initiated by customers (admin-initiated only).

## Meta Lead Ads → repair jobs
Flow: advert → Instant Form → signed `leadgen` webhook → lead fetched through the Graph API and saved in `metaLeads` (idempotent) → mapped and validated → **awaiting_confirmation** + a single-use confirmation link → the customer opens the link, signs in with that email → the normal request form is pre-filled → submitting **publishes the job and notifies matching engineers** → bids → selection → payment → commission. Campaign, ad set, ad and form ids are kept on the lead, job and transaction (attribution).

**Why a customer confirmation step remains:** a repair job must belong to a customer account, and sharing someone’s details with engineers needs their confirmation. Complete leads therefore wait in *Awaiting confirmation* until the customer confirms; incomplete ones wait in *Awaiting information*. Nothing incomplete or unconfirmed is ever shown to engineers.

**Email is off** (no Resend key), so the link is not emailed automatically. In **Admin → Incoming Leads → open a lead → Create confirmation link** you can copy it and send it by text or call, or press *Email it* once email is enabled.

Meta setup:
1. developers.facebook.com → **Create app** (type *Business*), add **Facebook Login for Business** (or Facebook Login) and **Webhooks**. Note the App ID (`META_APP_ID`) and App Secret (`META_APP_SECRET`).
2. Facebook Login → Valid OAuth Redirect URIs: `https://europe-west2-thorcomputers-39d33.cloudfunctions.net/metaOAuthCallback`.
3. Webhooks → **Page** object → Callback URL `https://europe-west2-thorcomputers-39d33.cloudfunctions.net/metaWebhook`, Verify token = your `META_VERIFY_TOKEN`, subscribe to field **leadgen**.
4. Permissions requested: `ads_read, ads_management, leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata, pages_manage_ads, business_management`. Using them with people outside your own app’s roles needs **Meta App Review** and **business verification**. While the app is in Development mode it works for the app’s admins/developers/testers only.
5. The Page that runs the ads must be one the connecting person administers, and (Business Settings → Integrations → Leads Access) the app must be allowed to retrieve leads (CRM access).
6. In the app: **Admin → Marketing → Connection** (Super Administrator). The Overview shows campaign results and a link to Incoming Leads; technical diagnostics and webhook details are expandable under Connection. The check reads the backend-bound secrets without exposing their values. Step 1 confirms the keys above are saved. The keys only identify the app; Meta still needs the owner of the Page and ad account to grant access **once** (step 2), in either of two ways:
   * **Connect with Facebook**: sign in on Meta’s own page (Thor Computer never sees a password). The token lasts about 60 days, then the page asks you to reconnect.
   * **Paste a Business access token**: Meta Business settings → Users → **System users** → add the Page and ad account as assets → **Generate token** for this app with the permissions in step 4. Its lifetime depends on how Meta issued it; it can expire or be revoked. It is checked against Meta before it is saved.

   Either way, tokens are stored AES-256-GCM encrypted in a collection no client can read.
7. Add your Instant Form questions so the **postcode** and **problem** are captured, or map your own question names under *Lead forms & field mapping*. Lead forms need a privacy-policy link (Meta requires it); use `https://app.thorcomputer.com/privacy`.

Safety: budget changes need an explicit confirmation, a configurable daily cap (default £50) and a per-change cap (default 50%); pause/resume needs confirmation; every change is audited. Missed webhooks are recovered hourly (and on demand) by reconciliation; unconverted leads lose their personal data after 90 days. The Graph API version defaults to `v23.0` (`META_GRAPH_VERSION` overrides it): check it is still current when you go live. Campaign figures from non-GBP ad accounts are excluded from GBP totals.

## AI assistant (rules first, AI last)
Almost every message is answered by built-in rules at no cost; the AI (Gemini, key held server-side) is only a guarded last resort for open-ended on-topic questions, with per-customer and global daily limits, a short timeout, one retry, validated output and a deterministic answer on any failure. Repair intake is deterministic and only ever pre-fills the normal request form. Conversations are not stored. Full details, admin controls and retention: **`docs/ASSISTANT.md`**.

## Admin permissions added
`marketing.manage` (leads, campaigns, ROI), `finance.view` (money), `payments.manage` (refunds, disputes), `integrations.manage` (connect Meta), `ai.manage`. **Super admin**: all. **Admin**: marketing + AI. **Support admin**: none of these, and cannot read lead PII or any financial data (enforced in rules and functions, tested).

## What is NOT verified until you test with real accounts
Real Stripe API behaviour (parameter names follow Stripe’s documented Connect destination-charge API but were not exercised against Stripe); real Meta Graph responses, permissions and App Review; real Gemini output quality; email delivery; push on devices; Firestore index builds; webhook delivery from Stripe/Meta to the deployed URLs. Use Stripe **test mode** and a Meta **test lead** (developers.facebook.com/tools/lead-ads-testing) first.

## Website enquiry marketing (default)

Use **Admin → Marketing** to build an advert destination link to **`/repair-enquiry`**. Paste that URL into the Facebook/Instagram advert’s website destination. Customers can submit without an account; the server validates consent, email, UK postcode, device and problem, checks a honeypot and enforces atomic email/IP quotas. A submission ID prevents double-saving when the browser retries. This public endpoint needs no Meta app secret, token, webhook or account connection.

The enquiry appears in Incoming Leads immediately. The customer receives a continuation button and must register/sign in with the matching email, verify it and review the normal request form before publishing to engineers. The existing private-data protections and lead/job/payment lifecycle apply. Admins can also issue a confirmation link from Incoming Leads. No email is promised or required for the initial submission.

`utm_source`, `utm_medium`, `utm_campaign`, `utm_content` and `utm_term` are captured on submission and carried into the confirmed job. These are user-supplied labels, not Meta-verified attribution. Website reporting counts up to 2,000 website enquiries and linked job outcomes; it does not claim ad impressions, clicks or spend. Budgets and advertising reports remain in Meta Ads Manager.

Existing imported leads and admin follow-up endpoints remain compatible. Legacy Meta polling/synchronisation now runs only when `ENABLE_LEGACY_META=true`; retention maintenance continues regardless. Existing Meta webhooks are retained for compatibility, but are not needed by the website flow. No Meta settings, tokens or historical leads are deleted.

Rate-limit counters expire after two hours and are cleaned during maintenance. New form collection uses the existing protected lead/enquiry collections; public clients cannot read or write them directly.
