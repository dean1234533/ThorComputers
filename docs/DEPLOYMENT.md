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
```
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

## 5. Frontend on Cloudflare Pages
Build settings: root `web`, command `npm ci && npm run build`, output `dist`. Add the `VITE_FIREBASE_*` variables and `VITE_FIREBASE_VAPID_KEY` (these are public client keys).
```bash
cd web && npm run build && npx wrangler pages deploy dist --project-name thor-computer-app
```
Custom domain **(needs approval)**: Pages → Custom domains → `app.thorcomputer.com`. If `thorcomputer.com` DNS is on Cloudflare this adds a CNAME automatically; otherwise add `CNAME app → <project>.pages.dev` at the current DNS host. The WordPress site at the apex is untouched. HTTPS is automatic.

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

## 7. Post-deploy smoke test
Register customer → verify email → post request → register engineer, upload credential → approve as admin → quote → accept → book → message → complete → review. Then `docs/TESTING.md`.
