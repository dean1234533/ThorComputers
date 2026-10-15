#!/usr/bin/env bash
# Creates the git-ignored, fake-valued local config the emulators need. Safe to re-run. Contains NO real secrets.
set -e
cd "$(dirname "$0")/.."
# Rewritten each run so newly added secrets always exist locally.
 printf 'RESEND_API_KEY=demo-not-a-real-key\nWP_INTAKE_SECRET=demo-wp-intake-secret-local-only\nSTRIPE_SECRET_KEY=sk_test_demo_not_real\nSTRIPE_WEBHOOK_SECRET=whsec_demo_local_only\nMETA_APP_SECRET=demo-meta-app-secret-local-only\nMETA_VERIFY_TOKEN=demo-meta-verify-token\nGEMINI_API_KEY=demo-not-a-real-key\n' > functions/.secret.local
# Regenerated every time. REQUIRE_ADMIN_MFA is deliberately NOT set here so test runs can choose it: REQUIRE_ADMIN_MFA=true npm run test:smoke:mfa
printf 'APP_URL=http://localhost:5173\nMETA_APP_ID=demo-meta-app-id\n' > functions/.env.local
npm --prefix functions run build
