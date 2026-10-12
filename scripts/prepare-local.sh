#!/usr/bin/env bash
# Creates the git-ignored, fake-valued local config the emulators need. Safe to re-run. Contains NO real secrets.
set -e
cd "$(dirname "$0")/.."
# Regenerated every time (fake values only), so newly added integrations always have a local value.
cat > functions/.secret.local <<'SECRETS'
RESEND_API_KEY=demo-not-a-real-key
WP_INTAKE_SECRET=demo-wp-intake-secret-local-only
STRIPE_SECRET_KEY=sk_test_local_fake_key_not_real
STRIPE_WEBHOOK_SECRET=whsec_local_platform_endpoint_secret
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_local_connect_endpoint_secret
META_APP_SECRET=local-meta-app-secret
META_WEBHOOK_VERIFY_TOKEN=local-meta-verify-token
META_TOKEN_KEY=local-meta-token-encryption-key
GEMINI_API_KEY=demo-not-a-real-key
SECRETS
# REQUIRE_ADMIN_MFA is deliberately NOT set here so test runs can choose it: REQUIRE_ADMIN_MFA=true npm run test:smoke:mfa
# STRIPE_API_HOST / META_GRAPH_BASE point the functions at local test doubles started by tests/marketplace-smoke.mjs. They are honoured ONLY
# inside the Functions emulator (see isMock() in functions/src/core.ts); in production the real Stripe and Graph API hosts are always used.
printf 'APP_URL=http://localhost:5173\nSTRIPE_API_HOST=127.0.0.1:12111\nMETA_GRAPH_BASE=http://127.0.0.1:12112\nMETA_APP_ID=local-meta-app\n' > functions/.env.local
npm --prefix functions run build
