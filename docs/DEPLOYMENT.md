# Deployment guide

Nothing here changes the live WordPress site or DNS by itself. Steps marked **(needs approval)** touch live systems.

## 1. Firebase
1. Create a project (Blaze plan, required for Cloud Functions and outbound calls). Choose **europe-west2 (London)** for Firestore and Storage.
2. **Authentication**: enable Email/Password and Google. Add `app.thorcomputer.com` (and the Pages preview domain) to *Authorized domains*. Upgrade to Identity Platform and enable **TOTP MFA** (Authentication → Sign-in method → Multi-factor authentication). Enabling it only *allows* MFA: the console cannot enrol another person's second factor. Each admin enrols themselves in the app (see §4a).
3. **Firestore**: create the database in production mode. **Storage**: create the default bucket.
4. **Cloud Messaging**: Project settings → Cloud Messaging → Web configuration → generate a key pair → this is `VITE_FIREBASE_VAPID_KEY`.
5. Enable APIs: Cloud Functions, Cloud Run, Cloud Scheduler, Secret Manager, Artifact Registry.
6. Storage rules read Firestore (`firestore.get`). When first deploying, accept the prompt that grants Storage access to Firestore.
7. `cp .firebaserc.example .firebaserc` and set your project id.

## 2. Secrets and config
```bash
cp functions/.env.example functions/.env           # APP_URL, EMAIL_FROM, REQUIRE_ADMIN_MFA
firebase functions:secrets:set RESEND_API_KEY       # transactional email provider key
firebase functions:secrets:set WP_INTAKE_SECRET     # long random string, shared with WordPress wp-config.php
# Marketplace upgrade (every declared secret must exist before `firebase deploy --only functions`, even if that integration is not live yet;
# use a placeholder such as "unused" until you have the real value, then set it again and redeploy):
firebase functions:secrets:set STRIPE_SECRET_KEY              # §7  sk_live_... / sk_test_... (or a restricted rk_ key)
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET          # §7  whsec_... of the platform ("Your account") endpoint
firebase functions:secrets:set STRIPE_CONNECT_WEBHOOK_SECRET  # §7  whsec_... of the Connect ("Connected accounts") endpoint
firebase functions:secrets:set META_APP_SECRET                # §8  Meta app secret
firebase functions:secrets:set META_WEBHOOK_VERIFY_TOKEN      # §8  any long random string, also typed into the Meta webhook settings
firebase functions:secrets:set META_TOKEN_KEY                 # §8  long random string; encrypts stored Meta access tokens (rotate = reconnect)
firebase functions:secrets:set GEMINI_API_KEY                 # §9  Google AI Studio / Gemini API key
```
Set `META_APP_ID` in `functions/.env` (non-secret).
Email: verify `thorcomputer.com` in Resend and add its SPF/DKIM DNS records **(needs approval)**. Any provider works; only `functions/src/email.ts` changes.

## 3. Deploy backend
```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only functions
```
Index builds take a few minutes. Queries fail with a console link until they finish.

## 4. First super admin
Register normally in the app, verify the email, then:
```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/service-account.json
node scripts-grant-super-admin.mjs you@thorcomputer.com
```
Sign out and in again. Add other admins from **Platform Settings → Admin team**.

## 4a. Admin two-step verification (TOTP)
Enrolment is **in the app**: **Admin → Security → Set up authenticator app** (password re-check, QR code, 6-digit code). Afterwards the admin signs out and in; the login screen then asks for a code. The page also shows, to super admins, which admins are enrolled.

`REQUIRE_ADMIN_MFA` (in `functions/.env`) has three modes; roll out in order:
1. `false` (default): optional.
2. `warn`: admins see a reminder banner; admin actions still work; the function logs `admin action without MFA`.
3. `true`: admin actions are refused without a second factor. **Only switch when Admin → Security → "Admin team readiness" says all admins are enrolled.**

Lockout safety: `adminMfaStatus` and the Security page deliberately need no second factor, so an unenrolled admin is redirected there rather than stranded, and can enrol. An enrolled admin whose session predates enrolment just signs in again. Break-glass: set `REQUIRE_ADMIN_MFA=false` and redeploy functions, or remove an admin's factor with the Admin SDK (`updateUser` with `multiFactor.enrolledFactors: null`; not exercised locally).

Known gap: enforcement is in Cloud Functions. Firestore rules read the same token but do not check for a second factor, so a password-only admin session could still read data that rules allow (users, jobs, audit log). Treat MFA as protecting actions, not reads, until rules are extended.

## 5. Frontend on Cloudflare
Connected to GitHub (root directory `web`, build command `npm ci && npm run build`, deploy command `npx wrangler deploy`), Cloudflare builds on every push. `web/wrangler.jsonc` serves `dist` as a single-page app (unknown paths fall back to `index.html`; `public/_headers` still applies). Add the `VITE_FIREBASE_*` variables and `VITE_FIREBASE_VAPID_KEY` as **build variables** (public client keys); they are baked in at build time, so redeploy after changing them. Manual deploy: `cd web && npm run build && npx wrangler deploy`.

Custom domain **(needs approval)**: the project's Settings → Domains & Routes → `app.thorcomputer.com`. If `thorcomputer.com` DNS is on Cloudflare this adds a CNAME automatically; otherwise add `CNAME app → <project>.pages.dev` at the current DNS host. The WordPress site at the apex is untouched. HTTPS is automatic.

`web/public/_headers` ships the CSP as **Report-Only**. Exercise sign-in (Google popup), uploads and push in staging, fix any reported violations, then rename it to `Content-Security-Policy`.

## 6. WordPress plugin **(needs approval; do on staging first)**
1. Zip `wordpress-plugin/thor-computer-app-integration/` and upload via Plugins → Add New.
2. Add to `wp-config.php` (outside the web root's version control):
   ```php
   define('THOR_APP_API_SECRET', '<same value as WP_INTAKE_SECRET>');
   define('THOR_APP_INTAKE_URL', 'https://europe-west2-<project>.cloudfunctions.net/wpIntake');
   ```
3. Edit Contact Form 7 form **2682** and add a consent field: `[acceptance thor-consent] I agree to Thor Computer sharing my enquiry with approved engineers on the Thor Computer app. [/acceptance]`. Existing field names (`first_name email phone postal_code brand model serial_n problem`) are used as-is.
4. Settings → Thor Computer App: set the URL, tick *Forward Contact Form 7 quote submissions*, enable button/banner as wanted, then submit a test enquiry and check **Integration status**.
5. Add the button anywhere with `[thor_app_download]`, the promo section with `[thor_app_banner]`.

## 6a. Before you deploy: run the local suite
`npm test` (see `docs/LOCAL_DEVELOPMENT.md`). It does **not** replace the staging smoke test below: composite indexes, TOTP, real email/push and real devices are only testable against a real project.

## 7. Stripe Connect payments (15% commission) **(needs approval: live money)**
**Architecture (decided after checking merchant-of-record, refunds/disputes and payout timing):** destination charges created by Stripe-hosted Checkout, with `application_fee_amount` = commission and `transfer_data.destination` = the engineer's Express account. Thor Computer Ltd is the merchant of record: customers pay Thor, Thor handles refunds and card disputes centrally (matching the admin dispute process), and Stripe's processing fee is taken from the platform balance. The engineer's 85% is transferred at payment and paid out on their Stripe payout schedule. Refunds use `reverse_transfer` and, if "Refund the commission proportionally" is on, `refund_application_fee`. No wallet, no stored card or bank data.
Commission maths (integer pence, half-up): the rate is fixed on each quotation when it is sent; each payment's fee is `round(total paid incl. this payment × rate) − round(total paid before × rate)`, so deposit + balance + approved extra work always total exactly 15% of everything paid, and can't be charged twice.
1. Stripe Dashboard → **Connect** → set up as a *platform/marketplace*, **Express** accounts, country UK. Complete the platform profile and branding (Thor Computer logo/colours).
2. Developers → API keys → set `STRIPE_SECRET_KEY` (start with test mode `sk_test_`).
3. Developers → Webhooks → **Add endpoint** `https://europe-west2-<project>.cloudfunctions.net/stripeWebhook`, *Events on your account*: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`, `refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`. Copy its signing secret → `STRIPE_WEBHOOK_SECRET`.
4. Add a second endpoint (same URL), *Events on Connected accounts*: `account.updated`, `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`. Signing secret → `STRIPE_CONNECT_WEBHOOK_SECRET`.
5. Settings → Payment methods: enable what you'll offer (card at minimum). Settings → Emails: enable "Successful payments" receipts.
6. Redeploy functions. In the app: **Admin → Finance** should show "Stripe configured (test mode)".
7. Each engineer: **Payouts → Set up payouts** (Stripe-hosted onboarding). They cannot quote while payments are on until Stripe reports `transfers` active.
8. A super admin turns payments on in **Platform Settings → Payments & commission** (default 15%, policy *full payment before appointment*; alternatives: deposit then balance, or pay after completion). Payments are **off by default** so the app keeps working until this is done.
9. Test mode end-to-end with card `4242 4242 4242 4242`, then a refund and a test dispute (`4000 0000 0000 0259`). Switch keys/endpoints to live only after that.

## 8. Meta (Facebook/Instagram) Ads + Lead Ads **(needs approval; Meta App Review)**
1. developers.facebook.com → create a **Business** app owned by Thor Computer's Business Manager. Add products: *Facebook Login for Business*, *Marketing API*, *Webhooks*.
2. Facebook Login → Valid OAuth redirect URI: `https://europe-west2-<project>.cloudfunctions.net/metaOAuthCallback` (or set `META_OAUTH_REDIRECT_URI`). App domains: `app.thorcomputer.com`.
3. Permissions requested by the app: `ads_read`, `ads_management`, `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `pages_manage_metadata` (to subscribe the Page to lead webhooks), `business_management`. For use by people other than app admins/testers, submit these for **App Review** and complete **Business Verification**. Until then only app roles (admins/developers/testers) can connect.
4. Webhooks → **Page** object → subscribe field `leadgen`. Callback URL `https://europe-west2-<project>.cloudfunctions.net/metaWebhook`, verify token = `META_WEBHOOK_VERIFY_TOKEN`. Payloads are verified with `X-Hub-Signature-256` (app secret).
5. Set `META_APP_ID` (functions/.env), secrets `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_TOKEN_KEY`; redeploy.
6. In the app, a super admin opens **Marketing & Lead Generation → Connect Meta Account** (Meta's own login; no password is ever typed into Thor's app). Pages are subscribed to `leadgen` automatically; lead forms, ad accounts and Instagram business accounts are listed. In Meta Business Settings → Integrations → *Leads Access*, make sure the app (CRM) has access to the Page's leads.
7. In each Instant Form add a **custom disclaimer** with a checkbox (or a question you map as *consent*) such as: "I agree to Thor Computer sharing my repair enquiry with approved independent engineers so they can send me quotes." Leads without it are never published automatically.
8. **Lead forms** tab: map form questions to Thor fields and choose required fields. **Conversion & routing**: pick *confirm* (default; customer confirms via a secure link), *auto* (publish complete consented leads immediately, creating the customer's account and emailing them a set-password link) or *review*. Add routing rules per campaign/form/postcode area.
9. Use Meta's **Lead Ads Testing Tool** to send a test lead and watch **Webhook activity** and **Incoming Leads**. Missed webhooks are recovered every 30 minutes from the forms' lead lists.
10. Campaign changes (pause/resume/daily budget) need confirmation, are limited by **budget safety limits** (only super admins can raise them) and are audit-logged. Nothing changes budgets automatically.

## 9. AI assistant (Gemini)
Create a key in Google AI Studio (restrict it to the Generative Language API) → `GEMINI_API_KEY`; redeploy. Turn the assistant on in **Platform Settings → AI assistant**, add approved knowledge (hours, policies, FAQs — no prices) and a daily per-user limit. The model has no tools: it can only suggest a draft request that the customer reviews and submits. Conversation text is not stored; only daily counters. To use another provider, change `callGemini()` in `functions/src/assistant.ts`.

## 10. Upgrading an existing deployment
1. `firebase deploy --only firestore:rules,firestore:indexes` first and wait for the new indexes to build.
2. Set every new secret (§2, placeholders are fine), then deploy functions and the web app.
3. **Existing admins keep their old permission set** (claims are not changed by a deploy). A super admin re-applies each admin's level in **Platform Settings → Admin team** to grant the new permissions (finance, marketing, leads, disputes, support, assistant). For the first super admin run `node scripts-grant-super-admin.mjs you@thorcomputer.com` again (it now grants all permissions), then sign out and in.
4. Existing jobs keep their `THR-` references; new jobs get `THOR-YYYY-NNNNNN`. Existing jobs have no `payment` block and continue without payment collection.
5. Update the WordPress plugin to 1.1.0 (new shortcodes and `[thor_repair_form]`; existing `[thor_app_download]` and Contact Form 7 intake unchanged).

## 11. Post-deploy smoke test
Register customer → verify email → post request → register engineer, upload credential, set up payouts → approve as admin → quote → accept → pay (Stripe test card) → book → message → complete → review. Then a Meta test lead (Lead Ads Testing Tool) through to a quote. Then `docs/TESTING.md`.
