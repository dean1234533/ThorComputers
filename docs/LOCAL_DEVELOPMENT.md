# Local development and testing (emulators only)

Everything here runs against the **Firebase emulators** and the fake project id **`demo-thor`**. Nothing deploys, nothing touches DNS, WordPress or production, and no real secrets are used.

* `scripts/local-env.sh` wraps every emulator command. It hides your gcloud Application Default Credentials and any `firebase login` session (by pointing `HOME` at a temp dir), so a bug cannot reach a real project. The emulator log shows no "Application Default Credentials detected" warning when this works.
* Outbound services are mocked **inside the functions** when `FUNCTIONS_EMULATOR=true` (or `MOCK_EXTERNAL=true`): email (Resend) is written to the `devMailbox` collection, push (FCM) is logged, postcode lookup is a deterministic offline function. The web app skips `api.postcodes.io` when `VITE_USE_EMULATORS=true`. There are no payments in v1.

## Prerequisites
* Node 22+ (24 works), npm, the Firebase CLI (`firebase --version`).
* **Java 21+** for the Firestore/Storage emulators. macOS ships a `/usr/bin/java` *stub* that fails if no JDK is installed. `scripts/local-env.sh` finds a JDK in `~/.local/jdk/*/Contents/Home`, Homebrew or `/Library/Java`. Easiest: download Temurin 21 (`tar.gz`, aarch64/x64) from adoptium.net into `~/.local/jdk/`.
* PHP (only for the WordPress plugin): `brew install php`, or a static CLI in `~/.local/php/8.3/php` (https://dl.static-php.dev/static-php-cli/common/), or Docker. `scripts/php.sh` picks whichever exists.
* Chrome for the browser test (puppeteer's cache `~/.cache/puppeteer`, or set `CHROME_PATH`).

## Commands (run from the repo root)
| Command | What it does |
|---|---|
| `npm run setup` | Installs functions, web and tests dependencies; creates git-ignored fake config (`functions/.secret.local`, `functions/.env.local`); builds functions |
| `npm run emulators` | Starts Auth, Functions, Firestore, Storage + UI at http://127.0.0.1:4000 (leave running) |
| `npm run seed` | (second terminal) Fictional users and data: `superadmin@`, `admin@`, `support@`, `customer@`, `engineer@` (approved), `pending-engineer@` `demo.test`, all with password `Passw0rd!demo`, plus one open job with a quote and a conversation |
| `npm run dev` | Web app at http://127.0.0.1:5173 wired to the emulators (`web/.env.emulator`, `VITE_USE_EMULATORS=true`); the browser console prints `[firebase] using LOCAL EMULATORS` |
| `npm run test:functions` | Unit tests: business rules, MFA gating, null handling |
| `npm run test:rules` | 36 Firestore + Storage security-rules tests (unauthenticated, role boundaries, data protection, privilege escalation) |
| `npm run test:smoke` | 51-step signed-in journey through the real client SDK: customer, engineers, admin, support, super admin (DEPLOYMENT §7) |
| `npm run test:smoke:mfa` | Admin MFA server behaviour under `REQUIRE_ADMIN_MFA` = true, false, warn |
| `npm run test:integrations` | 67 checks (adds appointment lifecycle, full/partial refund reporting, return URLs, Meta connection check, legal publishing gate and the rules-first assistant incl. quotas/caching/failure modes): signed Meta lead webhooks, lead→job attribution, signed Stripe webhooks, the 15% commission, refunds/disputes, role boundaries, campaign controls, ROI, marketplace switches and the AI assistant guardrails (Meta/Stripe/Gemini mocked inside the functions; webhooks are signed with fake local secrets and verified by the real handlers) |
| `npm run test:wp` | Real plugin PHP + CF7 stubs posting signed requests to the real `wpIntake` function |
| `npm run test:browser` | Headless Chrome signs in through the UI as 6 roles, visits every route, runs the request wizard, checks console errors and that nothing leaves localhost. Set `SHOT_DIR=/some/dir` for screenshots |
| `npm run test:web` | Typecheck + production build |
| `npm run lint:php` | `php -l` on every plugin file |
| `npm test` | All of the above |

Each `test:*` command starts and stops its own emulators, so they do not need `npm run emulators`, but they cannot run while it is running (ports clash).

## What the emulators cannot tell you
* **Stripe, Meta and Gemini themselves**: locally they are replaced by fixtures inside the functions (`FUNCTIONS_EMULATOR`/`MOCK_EXTERNAL`). Request shapes follow the vendors’ documentation but have not been exercised against the real services. See `docs/INTEGRATIONS.md`.
* **TOTP MFA**: the Auth emulator only implements phone MFA, so TOTP enrolment and sign-in are not exercisable locally.
* **Composite indexes** are not enforced by the Firestore emulator. A query missing from `firestore.indexes.json` passes locally and fails in production until the index builds.
* **Real FCM push, real email delivery, real Google sign-in, Identity Platform, token-revocation timing, App Check, quotas, cold starts, the Pub/Sub scheduler** (`sendAppointmentReminders` is registered but never fires locally).
* Real devices, iOS/Android install flows, WordPress itself.
