# Test status (honest record)

Last run: 2026-10-11, macOS arm64, Node 24, JDK 21, PHP 8.3.32 (static build), headless Chrome. `npm test` exited 0. **Everything below ran against the Firebase emulators on the fake project `demo-thor`.** Emulator results are not evidence about production, real devices or real third-party services. Commands: `docs/LOCAL_DEVELOPMENT.md`.

## Verified (actually executed, passing)
| Area | Command | Result | What it proves / what it does not |
|---|---|---|---|
| Business rules, MFA gating, null handling, money maths, webhook signatures, lead mapping | `npm run test:functions` | 25/25 | State machine, totals, slots, reviews, contact-detail filter; `requireRole`/MFA modes with and without a second-factor claim; `stripNulls` |
| Firestore + Storage rules | `npm run test:rules` | 36/36 | Rules compile. Unauthenticated denied everywhere (except `platformSettings/public`, public by design); role and permission boundaries; private address/serial release; no self-escalation; immutable qualification evidence; chat/photo access |
| Signed-in journey through the real client SDK | `npm run test:smoke` | 51/51 | Registration + email-link verification, engineer onboarding, admin approval, request, quotes, concurrent accept race, booking, reschedule, messaging triggers, completion, two-way reviews and moderation, suspension, GDPR export/delete, WordPress claim flow, rate limit. Roles: customer, engineer ×3, support admin, super admin |
| Payments, Meta leads, AI assistant | `npm run test:integrations` | 46/46 | Signed Meta webhooks (bad/missing signature refused, replay idempotent, incomplete leads stay pending, duplicate detection, campaign routing, custom field mapping, reconciliation); lead→customer→job→quote→selection with attribution kept; Stripe: server-side £100 → £15 / £85, wrong-amount flagged, verified webhook marks paid, replays and second events never duplicate, fee and payout tracking, refunds (admin-only, capped, proportional commission), chargebacks, rate frozen on accepted jobs and a new rate applying to new quotes, payment-before-booking gate, extra-work approval; Super-Admin-only commission; Meta OAuth state forgery refused and tokens unreadable by clients; campaign pause/budget safety limits; ROI numbers; support/admin/customer/engineer data boundaries; AI assistant escalation, daily limit, off switch, no-action guarantee. **Third parties are mocked inside the functions.** |
| Admin MFA server behaviour | `npm run test:smoke:mfa` | 7/7 (3 modes) | Enforce refuses admin actions without a second factor yet lets `adminMfaStatus` through; warn/off never block. **A real second factor was never present (see blockers)** |
| WordPress plugin intake | `npm run test:wp` | 12/12 | Real plugin PHP + CF7/WordPress *stubs* posting PHP-signed requests to the real `wpIntake`: consent, rate limit, sanitising, duplicate, bad secret, API down |
| Web UI in a real browser | `npm run test:browser` | 77/77 | UI sign-in as 6 roles, every route renders, role redirects, request wizard end-to-end, MFA guard (status response simulated), console clean, no traffic leaves localhost except web fonts. Mobile 390px and desktop 1280px |
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
| **Real Stripe** (Connect onboarding, destination charges, webhooks, refunds, disputes) | Mocked locally. Parameters follow Stripe’s documented API but were never sent to Stripe | Stripe **test mode** end to end: onboard an engineer, pay £100, check £15 fee and transfer, partial refund, replay a webhook |
| **Real Meta** (OAuth, permissions, App Review, leadgen webhook, Graph field names, campaign insights/controls) | Mocked locally; Live use needs App Review and business verification | Meta **Lead Ads Testing Tool** → watch Admin → Incoming Leads; then a £1/day test campaign |
| **Real Gemini** output quality and guardrails | Mocked locally (rule-based) | Try normal, hostile and off-topic chats; review the prompt in `chatbot.ts` |
| Customer confirmation of Meta leads | By design a lead waits for the customer to confirm; email is off, so admins send the link | Decide: enable email, or add SMS |
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
