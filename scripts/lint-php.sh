#!/usr/bin/env bash
# Syntax-lints every PHP file of the WordPress plugin (php -l). Runtime from scripts/php.sh (system php, static build or Docker).
# NOTE: only the runtime found is exercised; the plugin declares PHP 7.4+, so also lint under 7.4 where you can.
cd "$(dirname "$0")/.."
bash scripts/php.sh -v | head -1 || exit 1
fail=0
while IFS= read -r f; do bash scripts/php.sh -d display_errors=1 -l "$f" || fail=1; done < <(find wordpress-plugin -name '*.php' | sort)
exit $fail
