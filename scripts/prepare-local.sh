#!/usr/bin/env bash
# Creates the git-ignored, fake-valued local config the emulators need. Safe to re-run. Contains NO real secrets.
set -e
cd "$(dirname "$0")/.."
[ -f functions/.secret.local ] || printf 'RESEND_API_KEY=demo-not-a-real-key\nWP_INTAKE_SECRET=demo-wp-intake-secret-local-only\n' > functions/.secret.local
# Regenerated every time. REQUIRE_ADMIN_MFA is deliberately NOT set here so test runs can choose it: REQUIRE_ADMIN_MFA=true npm run test:smoke:mfa
printf 'APP_URL=http://localhost:5173\n' > functions/.env.local
npm --prefix functions run build
