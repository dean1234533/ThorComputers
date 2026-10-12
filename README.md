# Thor Computer: repair marketplace

React + Firebase PWA for **app.thorcomputer.com**, plus a WordPress plugin for **thorcomputer.com**.

| Folder | What |
|---|---|
| `web/` | Vite + React + TypeScript + Tailwind v4 PWA (customer, engineer, admin) |
| `functions/` | Cloud Functions (TypeScript): every privileged write, notifications, booking, WordPress intake |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json` | Security rules and indexes |
| `wordpress-plugin/thor-computer-app-integration/` | Shortcodes, floating button, banner, Contact Form 7 intake, settings page |
| `tests/` | Rules, smoke, MFA, WordPress-plugin and browser tests (Firebase emulators; needs Java) |
| `scripts/` | Local-environment wrapper, seed, PHP lint helpers |
| `docs/` | `DEPLOYMENT.md`, `TESTING.md` |

## Architecture rules
* **Authorisation is server-side.** The browser only reads (limited by rules) and calls Cloud Functions for every state change.
* **Custom claims** (`role`, `perms`, `engineerApproved`, `specs`, `suspended`) are set only by functions.
* **Public vs private**: `repairRequests/{id}` holds approximate location only; exact address, serial and access notes live in `repairRequests/{id}/private/details` and are released to the customer, the *selected* engineer (after selection) and authorised admins.
* **Money** is stored as integer pence (GBP). Quote totals are computed on the server.
* **Idempotency**: request ids derive from a client key; quotes are `jobId_engineerId`; notifications use a dedupe key as document id; appointment slots are locked per 30-minute slot in a transaction.
* **Independent vs Thor engineers**: every profile/quote carries a `provider` (`independent` | `thor`); the UI states whose warranty applies. Policy text is admin-configurable, never hardcoded.
* **Payments**: Stripe Connect destination charges via hosted Checkout, 15% application fee computed server-side in integer pence and fixed on each quote; payment state only ever comes from signature-verified webhooks (idempotent per event id). Off until a super admin enables it (`docs/DEPLOYMENT.md` §7).
* **Leads**: Meta Lead Ads webhooks (signature-verified, one document per lead id) → mapping → confirmation/auto-publication → the same `repairRequests` as the app and WordPress. Campaign attribution follows lead → job → quote → payment (§8).
* **Assistant**: Gemini behind a callable with per-user limits; no tools, so it can only suggest a draft the customer submits (§9).
* **Admin roles**: super admin / admin / support permission sets in `functions/src/core.ts` (`ADMIN_DEFAULTS`); finance, payment configuration, integrations and assistant settings are never in the support set.

See `docs/UPGRADE_AUDIT.md` for the feature-by-feature audit of the marketplace upgrade.

## Develop (local emulators, no cloud project needed)
```bash
npm run setup                    # once
npm run emulators                # terminal 1  (Auth, Firestore, Storage, Functions on the fake project demo-thor)
npm run seed && npm run dev      # terminal 2  -> http://127.0.0.1:5173, sign in as customer@demo.test / Passw0rd!demo
npm test                         # everything: unit, rules, smoke, marketplace (payments/leads), MFA, WordPress plugin, browser, build, PHP lint
```
See `docs/LOCAL_DEVELOPMENT.md` (commands, prerequisites, limits of the emulators), `docs/DEPLOYMENT.md` to deploy and `docs/TESTING.md` for what has and hasn't been verified.
