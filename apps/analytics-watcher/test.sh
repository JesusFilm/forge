#!/bin/sh
set -eu

# Keep browser prerequisites with this package so the shared CI matrix can run it.
if [ "${CI:-}" = "true" ]; then
  pnpm exec playwright install --with-deps chromium
fi

exec pnpm exec vitest run "$@"
