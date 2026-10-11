#!/usr/bin/env bash
# Runs PHP: system `php` if present, else a static CLI build in ~/.local/php/*/php, else a Docker php image. Used for linting/testing the WordPress plugin.
if command -v php >/dev/null 2>&1; then exec php "$@"; fi
for p in "${REAL_HOME:-$HOME}"/.local/php/*/php; do [ -x "$p" ] && exec "$p" "$@"; done
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then exec docker run --rm --network host -v "$PWD:$PWD" -w "$PWD" php:8.3-cli php "$@"; fi
echo "No PHP runtime found. Install PHP 8+ (brew install php), or download a static CLI from https://dl.static-php.dev/static-php-cli/common/ into ~/.local/php/8.3/php, or start Docker." >&2; exit 1
