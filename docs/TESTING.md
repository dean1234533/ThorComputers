# Test status (honest record)

## Contact list and work-progress run (2026-10-12)
`npm test` exit 0: functions 24/24, rules 39/39 (incl. storage), smoke 51/51, marketplace 40/40 (new section 7: trigger-maintained contact summaries with money kept off the customer-readable user document, staff notes/tags hidden from customer and engineer, author-only note edits, audited export with support limited to basic fields, overdue task count, engineer progress update + customer notification + access control, invalid board moves and missing reasons refused, SLA settings permission), MFA 7/7, WordPress 12/12, browser 88/88 (incl. /admin/contacts and /admin/progress), build and PHP lint clean. `scripts/backfill-contact-summaries.mjs` run against seeded emulator data. Not verified: hourly overdue-task reminder schedule firing, progress photo upload from a real phone, composite indexes in production.

## Marketplace upgrade run (2026-10-12, Linux, Node 22, JDK 21, PHP 8.3, headless Chromium)
All against the Firebase emulators on `demo-thor`. Stripe and the Meta Graph API were replaced by local test doubles (`tests/marketplace-smoke.mjs`); webhooks were genuinely signed and verified by the real handlers. **No live or test-mode Stripe account, Meta app, Gemini key or WordPress site was used.**
| Suite | Result | Covers |
|---|---|---|
| `npm run test:functions` | 24/24 | Incl. commission £100→£15/£85, £200→£30/£170, £500→£75/£425, £750→£112.50, half-up rounding, deposit+balance+extra never double-charge, payment policies, THOR refs, new transitions, Meta field mapping/normalising/consent, routing, Meta signature check, token encryption |
| `npm run test:rules` | 36/36 | Incl. payments/transactions/commission (parties + finance only, no client writes), support never sees finance, Meta tokens unreadable by everyone, leads for lead managers only, tickets/disputes parties only, held jobs hidden from engineers, support cannot read addresses |
| `npm run test:smoke` | 51/51 | Original journey: unchanged behaviour after the upgrade |
| `npm run test:marketplace` (new) | 34/34 | Roles (only super admin changes commission), Stripe Express onboarding + Connect webhook, quote gating on payouts, 15% fixed on quote, awaiting-payment gating, Checkout with application fee + destination, payment confirmed only by webhook, replay idempotency, amount-mismatch rejected, failed payment, revision + balance (£18 total commission on £120), dispute → refund with reverse transfer, cumulative refund sync, finance report, Meta verify handshake, unsigned webhook refused, lead import/dedupe, incomplete lead pending, secure confirmation link → job with campaign attribution, engineer area notification, lead status sync, auto mode with account creation, no auto-publish without consent, routing rule, lead reject audit, assistant limits, support tickets |
| `npm run test:smoke:mfa` | 7/7 (3 modes) | unchanged |
| `npm run test:wp` | 12/12 | Contact Form 7 path after the intake refactor. The new `[thor_repair_form]` handler is linted only (needs real WordPress) |
| `npm run test:browser` | 86/86 | Every route incl. Leads, Marketing (all tabs), Finance, Disputes, Support, Payouts |
| `npm run test:web`, `npm run lint:php` | clean | |

Bugs found and fixed during this run: engineer service radius was never copied to public profiles (matching always used 15 mi); audit entries with an optional field crashed admin lead actions (`undefined` in Firestore); invalid DOM nesting on Finance stat tiles; the notification prompt covered the request wizard's Continue button on phones.

**Sandbox note:** the Firebase CLI sends its localhost emulator calls through `HTTPS_PROXY` and ignores `NO_PROXY`; in the sandbox used for this run that proxy blocks localhost, so the suites were run with proxy variables removed from that process only. On a normal machine `npm test` needs nothing special.

### Not verified (needs real accounts/devices)
Stripe test/live mode (Checkout page, Express onboarding UI, real webhooks, payouts, receipts, disputes), Meta OAuth/App Review/Business Verification/real Lead Ads webhooks/Marketing API campaign edits (incl. CBO vs ad-set budgets), Gemini responses and JSON adherence, Firestore composite indexes (emulator does not enforce; 39 new ones added), email delivery of the new templates, push on devices, WordPress rendering of the new shortcodes/form, scheduled jobs (`metaReconcile`, `metaHourlySync`, `dailyFollowUps`) firing on schedule.

---

## Previous run

Last run: 2026-10-11, macOS arm64, Node 24, JDK 21, PHP 8.3.32 (static build), headless Chrome. `npm test` exited 0. **Everything below ran against the Firebase emulators on the fake project `demo-thor`.** Emulator results are not evidence about production, real devices or real third-party services. Commands: `docs/LOCAL_DEVELOPMENT.md`.

## Verified (actually executed, passing)
| Area | Command | Result | What it proves / what it does not |
|---|---|---|---|
| Business rules, MFA gating, null handling | `npm run test:functions` | 14/14 | State machine, totals, slots, reviews, contact-detail filter; `requireRole`/MFA modes with and without a second-factor claim; `stripNulls` |
| Firestore + Storage rules | `npm run test:rules` | 32/32 | Rules compile. Unauthenticated denied everywhere (except `platformSettings/public`, public by design); role and permission boundaries; private address/serial release; no self-escalation; immutable qualification evidence; chat/photo access |
| Signed-in journey through the real client SDK | `npm run test:smoke` | 51/51 | Registration + email-link verification, engineer onboarding, admin approval, request, quotes, concurrent accept race, booking, reschedule, messaging triggers, completion, two-way reviews and moderation, suspension, GDPR export/delete, WordPress claim flow, rate limit. Roles: customer, engineer ×3, support admin, super admin |
| Admin MFA server behaviour | `npm run test:smoke:mfa` | 7/7 (3 modes) | Enforce refuses admin actions without a second factor yet lets `adminMfaStatus` through; warn/off never block. **A real second factor was never present (see blockers)** |
| WordPress plugin intake | `npm run test:wp` | 12/12 | Real plugin PHP + CF7/WordPress *stubs* posting PHP-signed requests to the real `wpIntake`: consent, rate limit, sanitising, duplicate, bad secret, API down |
| Web UI in a real browser | `npm run test:browser` | 72/72 | UI sign-in as 6 roles, every route renders, role redirects, request wizard end-to-end, MFA guard (status response simulated), console clean, no traffic leaves localhost except web fonts. Mobile 390px and desktop 1280px |
| Type safety and build | `npm run test:web` | clean | Build success only |
| PHP syntax | `npm run lint:php` | clean on 8.3 | Syntax only. **Not run on 7.4**, though the plugin declares 7.4+ and uses no 8-only syntax |

## Bugs found and fixed by this pass (all would have hit production)
1. `reviewEngineerApplication` (approve): Firestore transaction read after write → every approval failed with INTERNAL.
2. `editReview` and `moderateReview`: same read-after-write error.
3. Web app sent `undefined` as `null` (SDK behaviour) → **every repair request from the UI was rejected** (`enquiry: Expected object, received null`). Fixed centrally in the `callable` wrapper (`stripNulls`); also covered by smoke.
4. Page refresh sent signed-in users to `/setup`: `AuthProvider` treated a stale "profile ready" flag from the signed-out phase as "no profile".
5. Suspended users and demoted admins kept working for up to an hour on their existing token. Callables now check the user document on every call.
6. Storage `create` rules did not stop an owner overwriting an uploaded qualification file in the emulator; added `resource == null`.
7. Emulator isolation: Functions would have used the machine's Google credentials; now hidden by `scripts/local-env.sh`, and FCM/Resend/postcodes are mocked locally.
8. The documented MFA step ("enrol admins in the console") is not how Firebase works; replaced with an in-app enrolment flow and a three-mode rollout (see `DEPLOYMENT.md` §4a).

## NOT verified: remaining blockers and untested flows
| Area | Why | What to do |
|---|---|---|
| **TOTP enrolment and TOTP sign-in** | The Auth emulator only supports phone MFA (`Missing phoneEnrollmentInfo`). The new Security page and login challenge are type-checked, built and rendered, but never executed against a TOTP-capable backend | On a staging project with Identity Platform + TOTP enabled: enrol, sign out/in with a code, wrong code, remove factor, then enforce |
| Firestore **composite indexes** | The emulator does not enforce them | Staging run of every list screen; watch for "requires an index" errors |
| MFA in **Firestore rules** | Enforcement is Cloud Functions only; a password-only admin session can still read what rules allow | Extend rules or accept the gap |
| Token revocation timing, real Google sign-in, Identity Platform | Not emulated (`setAdminRole` revokes refresh tokens; the emulator appeared not to enforce that, so only the new per-call check is tested) | Staging |
| Push notifications (FCM, service worker, deep links, iOS PWA) | Needs VAPID key, real devices. Locally push is only logged | Real Android/iOS/desktop on staging HTTPS |
| Real email (Resend) and DNS (SPF/DKIM) | Mocked locally into `devMailbox`; templates were not rendered in mail clients | Send each template to a test inbox |
| iOS "Add to Home Screen", `beforeinstallprompt` | Needs devices | Real devices |
| Scheduled reminders | Pub/Sub emulator not run, `sendAppointmentReminders` never fired | Staging (or add the pubsub emulator) |
| WordPress itself | No WordPress here: shortcodes, floating button, banner, settings screen, real Contact Form 7 and the `wp_remote_post` transport are linted/stubbed, not run | Staging WordPress |
| PHP 7.4 | Only 8.3 available | Lint on 7.4 |
| CSP Report-Only → enforcing, Google popup flow, uploads under CSP | Dev server does not apply `_headers` | Staging |
| Accessibility audit, Lighthouse/performance, manual screen-reader pass | Not run | axe + Lighthouse on staging |
| Cross-browser (Safari/Firefox), 5xx/offline error paths, load | Chrome only | Manual |
| Cloud deploy, quotas, cold starts, App Check | Out of scope (nothing was deployed) | Staging |

## Known limitations / follow-ups (unchanged)
* Rescheduling uses `datetime-local`, interpreted in the browser's timezone (labelled "UK time").
* Distance filtering uses postcodes.io from the browser; if unreachable the filter is disabled.
* Open-job listing relies on the UI query's specialisation filter; rules allow any approved engineer to list open jobs (no PII there) and `submitQuote` enforces specialisation server-side.
* The seeded engineer's avatar URL is a dummy, so the avatar shows a broken-image placeholder locally.
* Logo source is 300px, so the 512px PWA icon is upscaled. Privacy policy text is a draft for legal review. Payments are out of scope for v1.
