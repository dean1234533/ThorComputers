# Marketplace upgrade: audit and implementation record

The upgrade extends the existing React + Firebase + Cloudflare app. Nothing was rebuilt: the same collections, auth flow, claims model, dashboards, branding, PWA and WordPress plugin are kept and extended. `repairRequests` stays the single source of truth for jobs (no separate `repairJobs`).

Legend: **Existed** = already in the app before this upgrade · **Extended** = existing feature completed/extended · **New** = added · **Not done** = deliberately not implemented, with the reason.

## 1. Audit of the app before the upgrade
| Area | State found |
|---|---|
| Auth & roles | Email/password + Google, `completeRegistration`, custom claims (`role`, `perms`, `engineerApproved`, `specs`, `suspended`), per-call account freshness check, admin TOTP MFA (off/warn/enforce) |
| Customer marketplace | 6-step request wizard, photos, private address subdocument, quote comparison (cards + table), atomic accept with concurrent-accept protection |
| Engineers | Application with qualifications upload, admin approval, public profile, availability editor |
| Booking | 30-minute slot locks in transactions, reschedule/cancel, reminders |
| Chat | Real-time Firestore chat, unread counters, read receipts, image attachments, reporting, audited admin access |
| Reviews | Two-way, moderation, 48-hour single edit |
| Admin | Overview stats, approvals, users, jobs, quotes, appointments, reviews, reports, settings, security |
| PWA | Install banner with back-off, iOS steps, push (FCM, data-only, lock-screen safe), offline page, update prompt |
| WordPress | Plugin with `[thor_app_download]`, `[thor_app_banner]`, floating button, signed Contact Form 7 intake → `enquiries` → confirm link |
| Payments, Meta, chatbot, finance, disputes, support tickets | **Not present** (README: "No payments in v1") |
| Bugs found during the audit | Engineer service radius was never copied to the public profile (the field had been swallowed by a comment), so radius matching always used 15 miles: **fixed** |

## 2. Requirements → implementation
| # | Requirement | Status | Where |
|---|---|---|---|
| 2 | Super admin / admin / support roles, server-enforced | Extended | `core.ts` `ADMIN_DEFAULTS`, `requirePerm`, `requireSuperAdmin`; rules `can()` |
| 2 | Real-time dashboard stats (customers … ad revenue), charts, date filters, CSV | Extended | `admin.ts adminStats` (permission-scoped sections), `AdminPages.tsx AdminOverview` |
| 3 | Customer search/filter/profile/history/bookings/payments/reviews/suspend/delete | Extended | `adminSearchUsers`, `adminDeleteAccount`, `requestAccountDeletion`, `UserDetail` sheet |
| 3 | Customer settings (registration, verification, categories, review, cancellation, booking, notification defaults) | Extended | Platform Settings: marketplace rules, booking rules, categories, payment/cancellation policy. Email verification is **always required** (security control, not configurable) |
| 4 | Engineer statuses incl. *Under review* and *Additional information required* | Extended | `reviewEngineerApplication` (`start_review`) |
| 4 | Admin engineer controls: categories, coverage, restriction, payout status, history | New | `adminUpdateEngineer`, `UserDetail` |
| 4 | Stripe Connect onboarding for engineers | New | `stripeOnboardingLink`, `/engineer/payouts` |
| 5 | Repair categories, request form, methods, urgency, budget | Existed/Extended | Method labels aligned to the brief; **optional budget field not added** (engineers quote independently; can be added to `RequestInput` if wanted) |
| 5 | `THOR-2026-000125` references | New | `nextJobRef()` (per-year counter in a transaction). Old jobs keep `THR-` |
| 5 | Job statuses incl. awaiting verification / awaiting payment | Extended | `domain.ts TRANSITIONS`; "Open for bidding" vs "Receiving quotations" is derived from the quote count |
| 6 | Quote form: labour, parts estimate, call-out, diagnostic, duration, earliest appointment, warranty, included/excluded, notes | Extended | `submitQuote`, `EngineerJobs.tsx` |
| 6 | Bidding rules: approved only, not own job, max bids, expiry, single acceptance, close competitors | Existed/Extended | `submitQuote`, `acceptQuote` (transaction) |
| 7 | Stripe Connect, 15% commission, webhooks, refunds, disputes, payouts, receipts, history | New | `payments.ts`, `jobEvents.ts`; see DEPLOYMENT §7 for the charge-type decision |
| 7 | Payment timing policies + deposit commission rule | New | `full_before` / `deposit_before` / `after_completion`; commission on the combined total via `applicationFeeFor` |
| 7 | Commission only changeable by super admin, stored per transaction, history kept | New | `savePaymentSettings`, `commissionHistory`, `commissionBps` on quote/job/transaction |
| 7 | Financial dashboard from confirmed Stripe events | New | `financeReport`, `/admin/finance` |
| 8 | Engineer comparison interface | Extended | `QuoteCompare` (qualifications, verification, specialisations, areas, earliest appointment, included/excluded) |
| 9 | Verified reviews with the five criteria, moderation, engineer feedback | Existed | unchanged |
| 10 | Real-time chat | Existed | Push for messages existed; pre-acceptance questions existed |
| 11 | AI assistant with server-side key, limits, no privileged actions, escalation, admin settings | New | `assistant.ts`, `AssistantWidget`, Platform Settings → AI assistant |
| 12–13 | Meta account connection via OAuth, encrypted tokens, pages/IG/ad accounts | New | `meta.ts` (`metaAuthStart`, `metaOAuthCallback`, `syncAssets`) |
| 14 | Lead Ads webhook: verify, fetch, validate, dedupe, map, save, workflow, retries, reconciliation | New | `metaWebhook`, `leads.ts processLeadEvent`, `metaReconcile`, `retryMetaEvent` |
| 15 | Automatic lead → job conversion; incomplete/unconsented leads stay pending | New | `advanceLead`, `convertLeadToJob`, enquiry link flow reused from WordPress |
| 16 | Admin field mapping + required fields + clarification | New | `saveLeadMapping`, Marketing → Lead forms |
| 17 | Incoming Leads dashboard, statuses, actions, audit | New | `/admin/leads`, `adminLeadAction` |
| 18 | Campaigns, ad sets, insights, pause/resume/budget within limits, marketplace feed selection | New | `syncCampaigns`, `metaUpdateCampaign`, `metaListChildren`. Budget edits only for campaign-level (CBO) budgets; ad-set budgets are shown, edited in Ads Manager |
| 19 | Campaign-to-job routing; engineer matching by category + service area | New/Extended | `routeLead`, `notifyMatchingEngineers` (no alerts without a service location) |
| 20 | Advertising ROI and attribution | New | Marketing → Performance & ROI; attribution on lead, job, transaction |
| 21–23 | Engineer/customer notifications and follow-ups (push + email + in-app) | Extended | New copy per brief; review invitation and unpaid reminders (`dailyFollowUps`). **SMS not added** (no provider configured) |
| 24–25 | Booking and progress tracking | Existed/Extended | Tracker shows the payment step when applicable |
| 26 | WordPress: quotes/request/find/track/app buttons, native form, one central database | Extended | Plugin 1.1.0: `[thor_app_button action=…]`, `[thor_repair_form]`; `/request`, `/track`, `/find-engineer`, `/engineer-signup` routes |
| 27 | PWA install banner copy, standalone detection, dismissal back-off, push categories | Existed/Extended | Copy updated; payments/support notification categories |
| 28 | Platform settings: marketplace, payments, advertising, chatbot, notifications, branding | Extended | Settings sections. Email *template* editing is **not** in the admin UI (templates are in `functions/src/email.ts`, sharing the Thor layout) |
| 29 | Data model and relationships | Extended | See below |
| 30 | Security | Extended | Rules for every new collection, tokens unreadable, webhooks signed, idempotent handlers, audit log. MFA applies to admin **actions**; rules do not yet require a second factor for admin **reads** (existing known gap) |
| 31 | Transaction rules (integer pence, revisions, refunds, disputes) | New | `proposeQuoteRevision`/`respondQuoteRevision`, `resolveDispute`, auto-refund on cancellation (minus configured charge) |
| 32 | Automation and idempotency | New | Event-id/lead-id keyed documents, dead-letter + admin retry |

## 3. Collections added
`payments`, `transactions`, `commissionRecords`, `commissionHistory`, `refunds`, `paymentDisputes`, `payouts`, `stripeConnectedAccounts`, `stripeEvents`, `disputes`, `supportTickets/{id}/messages`, `deletionRequests`, `metaConnections`, `metaSecrets` (encrypted, no client access), `metaOAuthStates`, `metaAdAccounts`, `metaCampaigns`, `metaInsightsDaily`, `metaLeadForms`, `metaLeads`, `metaLeadRaw`, `metaWebhookEvents`, `leadMappings`, `leadConversionEvents`, `integrationHealth`, `chatbotStats`, `chatbotUsage`, `counters`. Platform settings live in `platformSettings/public` (non-secret rules incl. commission rate), `/marketing` and `/chatbot`.

Relationships: lead → (`jobId`) job → (`attribution.leadId/campaignId`) → quote (`jobId`, `engineerId`) → payment (`jobId`, `quoteId` via job) → transaction (`paymentId`, `attribution`) → commission record (`transactionId` = Stripe PaymentIntent id). Reviews are keyed `jobId_direction` and require a completed job.

## 4. What needs real credentials or approvals (cannot be verified here)
Live/test Stripe account and webhooks, Meta app + App Review + Business Verification + Page leads access, Gemini API key, Resend email, FCM on real devices, WordPress staging. Steps: `docs/DEPLOYMENT.md` §7–10. Test status: `docs/TESTING.md`.
