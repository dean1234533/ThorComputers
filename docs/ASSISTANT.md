# The customer assistant: rules first, AI last

## How a message is handled
`functions/src/chat/engine.ts` decides, in this order, and stops at the first that applies:
1. **Safety / anger** (smoke, sparks, swollen battery; scam, solicitor…): safety advice or an apology plus the support details. Never debated, never AI.
2. **Quick-reply values and commands** (`faq:<id>`, help, start over).
3. **A pending "did you mean…?"** answered by the button or the label.
4. **An active repair intake** (below).
5. **FAQ / account intents** scored by `chat/nlu.ts` (phrases, synonyms, typo correction, weighted overlap). A clear winner is answered; two close meanings produce a clarifying question with buttons.
6. **A problem described in plain words** ("my laptop keeps switching off") starts the intake.
7. **AI**, only if: the message is a real on-topic question (12–400 characters, contains repair/booking/payment/support words), AI fallback is enabled, and the per-customer and global daily limits allow it.
8. Otherwise a **deterministic fallback** with topic buttons and the support details. This is also what customers see when the AI is disabled, over quota, slow, malformed or fails.

Greetings, thanks, repeated questions (the 2nd gets "here it is again", the 3rd adds support), vague intake answers, help and menus never use AI. `functions/src/chat.test.ts` proves it: 75+ FAQ phrases, several full intake conversations and every failure mode run with a counter that must stay at zero.

## Where to change things
| To change | Edit |
|---|---|
| Wording of an answer, or add/disable an FAQ | **Admin → Platform Settings → Assistant → Edit FAQ answers** (no code, no deploy). Built-in defaults live in `chat/faq.ts`. |
| Support email/phone/hours, notice period, coverage, categories, warranty/terms, marketplace disclaimer | **Platform Settings** (existing fields). Answers use `{{placeholders}}`; nothing business-specific is hard-coded. |
| Refund / cancellation wording | **Admin → Finance** (Super Administrator). |
| Approved knowledge the AI may restate, limits, model, timeout, cost rates | **Platform Settings → Assistant**. |
| New built-in intent, synonyms, typos | `chat/faq.ts`, `chat/nlu.ts` (CANON, TYPOS, PHRASES), then add phrases to `TABLE` in `chat.test.ts`. |
| Intake questions, device/brand lists, symptoms | `chat/intake.ts`; supported devices/methods come from `catalog.ts` (shared with request validation). |

## Pricing guidance

**Admin → Platform Settings → Pricing guidance** is optional approved wording (up to 800 characters). Saving it updates `platformSettings/public.pricingGuidance`. Common pricing questions and misspellings use the deterministic Prices FAQ first, including when AI is disabled. Its `{{pricingGuidance}}` placeholder inserts the current setting. If empty, the assistant explains quotation-based pricing; it does not invent a price list. If you override the Prices FAQ, retain the placeholder to keep using this setting. Pricing guidance is also included in the AI’s approved knowledge; it does not change accepted quotes, checkout prices or commissions.

## Request photo privacy

Request photos are readable by their customer, the selected approved engineer and unsuspended admins with `jobs.manage`. Engineers bidding on an open request see a notice, not the photos. Storage checks the selected engineer and the photo’s membership in that exact request; knowing the path or being approved is insufficient. Request creation also rejects photos belonging to a different request. The web app downloads request photos through authenticated `getBlob` and displays temporary object URLs rather than reusable Firebase download links.

## Repair intake
Deterministic: device → make/model → problem → service method (limited by device) → postcode → urgency. Several answers in one message are understood. "Change postcode", "actually it’s a Dell", "start over" work at any time; a question in the middle is answered and the pending step is repeated. The result is a **draft** that pre-fills the normal request form; the customer reviews and presses Submit. The assistant never creates a job (tested).

## Account questions
"Where is my repair / do I have quotes / when is my appointment / have I paid" read the signed-in customer's own records (`repairRequests` and `appointments` filtered by `customerId == caller`). Engineers and admins cannot use the assistant. Tested with two customers.

## AI fallback controls
Provider/model configurable (default low-cost `gemini-2.5-flash-lite`, with fallbacks if a name is retired). Input ≤ 400 characters, output ≤ 300 tokens, answer ≤ 700 characters. 8 s timeout (configurable), at most **one** retry for a transient failure (5xx or timeout), 12 s overall budget. At most 3 concurrent AI calls per instance and 5 instances. Per-customer AI limit (default 10/day), global AI limit (default 300/day: the spending safeguard), per-customer message limit (default 150/day). The prompt contains only approved knowledge and support/policy settings, never account data, passwords or card details. Answers are validated: malformed output is rejected, and any price, duration, percentage, email, phone number or link that is not in the approved text is discarded (so the AI cannot invent prices, availability or policy). Generic answers are cached for 24 h keyed by the normalised question and the current knowledge version; messages containing digits, postcodes or email addresses are never cached.

## Data kept (no raw conversations)
| Data | Contains | Retention |
|---|---|---|
| `chatMetrics/{day}` | Counters: messages, answered by rules, AI calls, cache hits, fallbacks, failures by reason, latency totals, token estimates, estimated cost, intakes started/opened, escalations | Kept (aggregate, no personal data) |
| `chatUsage/{uid}_{day}`, `chatUsage/global_{day}` | Per-user daily message and AI counts (for the limits) | `expiresAt` = 35 days. **Enable a Firestore TTL policy on `chatUsage.expiresAt`** |
| `chatCache/{hash}` | A generic question hash, the answer, knowledge version, expiry | `expiresAt` = 24 h. **Enable a TTL policy on `chatCache.expiresAt`** |
| Conversation state | Held in the browser tab only (collected repair details); sent with each message so the server stays stateless; cleared on restart/close | Not stored server-side |
Message text is never written to the database or the logs. The only place text leaves our systems is the AI request, when a question genuinely needs it.

TTL policies: Firebase console → Firestore → Time-to-live → add `chatCache` / `expiresAt` and `chatUsage` / `expiresAt` (or `gcloud firestore fields ttls update expiresAt --collection-group=chatCache --enable-ttl`).

## Troubleshooting
* "Connection to Gemini: problem" in the settings page shows the exact reason (invalid key, quota, unknown model…). Everything except open-ended questions keeps working meanwhile.
* A phrase gets the wrong answer: add it to `TABLE` in `chat.test.ts`, then tune `faq.ts`/`nlu.ts` until the table passes. Thresholds: `CONFIDENT` 0.55, `CLOSE` 0.12, `FLOOR` 0.4 in `nlu.ts`.

## Releasing the photo-access change

Deploy the backend, Storage rules and frontend together. Authenticated browser downloads require the bucket's CORS policy to allow GET from the deployed app origin; keep allowed origins explicit (see Firebase's web download documentation).

Old Firebase token links can outlive a rules change. The new UI does not request such links for request photos. Before considering the rollout complete, invalidate the old request-photo tokens using the one-time script below. It preserves the image bytes and other metadata and does not touch avatar/qualification/chat paths. It rereads metadata after each change and stops if token revocation is not confirmed; the local emulator is known to retain its separate download-token list after a GCS metadata patch, so actual link invalidation must be verified at release. Run the preview first and review its object counts. Do not run it against production as part of local QA.

```sh
node scripts/revoke-request-photo-links.mjs --project PROJECT_ID --bucket BUCKET_NAME
# At the approved release, after reviewing the preview:
node scripts/revoke-request-photo-links.mjs --project PROJECT_ID --bucket BUCKET_NAME --apply
```

An already downloaded image cannot be recalled from someone's device; revocation prevents further use of the old download link. Production deployment, CORS configuration and token revocation require a separate authorised release. Local tests do not establish their live state.

References: [Firebase authenticated SDK downloads and CORS](https://firebase.google.com/docs/storage/web/download-files#download_data_directly_from_the_sdk), [Storage rules using Firestore](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_firestore).
