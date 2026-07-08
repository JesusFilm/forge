#!/usr/bin/env bash
# setup-sim-env.sh <tv|mobile>
#
# Seeds apps/<app>/.env.local for a simulator run. Fresh git worktrees never
# inherit .env.local (it's gitignored), and apps/tv's file historically ships
# only EXPO_PUBLIC_GRAPHQL_URL — missing EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN, the
# consumer bearer without which admin's Query.search returns UNAUTHENTICATED
# (search silently breaks). This copies the env from the main checkout and
# guarantees the token is present. Idempotent — safe to run before every launch.
#
# tv and mobile share the SAME consumer-bearer value, so the token is sourced
# from whichever main-checkout env file has it.
#
# Restart Metro after this runs: Expo inlines EXPO_PUBLIC_* at bundler startup,
# so a change made after boot is not picked up.
set -euo pipefail

app="${1:-}"
case "$app" in
  tv | mobile) ;;
  *)
    echo "usage: scripts/setup-sim-env.sh <tv|mobile>" >&2
    exit 2
    ;;
esac

key="EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN"
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
here="$(git rev-parse --show-toplevel)"
src="$main/apps/$app/.env.local"
dst="$here/apps/$app/.env.local"

# Seed a missing worktree env from the main checkout (skip when already in main).
if [ "$src" != "$dst" ] && [ ! -f "$dst" ]; then
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "[setup-sim-env] seeded apps/$app/.env.local from the main checkout."
  else
    echo "[setup-sim-env] WARN: no $src to copy from." >&2
  fi
fi

if [ -f "$dst" ] && grep -qE "^$key=" "$dst"; then
  echo "[setup-sim-env] $key present — search will work."
  exit 0
fi

# Token missing: borrow it from the main checkout (either app's env has it).
tok_line="$(grep -hE "^$key=" "$main/apps/mobile/.env.local" "$main/apps/tv/.env.local" 2>/dev/null | head -1 || true)"
if [ -z "$tok_line" ]; then
  echo "[setup-sim-env] WARN: $key not found in the main checkout — search will 401." >&2
  echo "[setup-sim-env] Add it to $main/apps/$app/.env.local (a WEB_ADMIN_API_KEYS consumer bearer)." >&2
  exit 1
fi

[ -f "$dst" ] && [ -n "$(tail -c1 "$dst" 2>/dev/null)" ] && printf '\n' >>"$dst"
printf '%s\n' "$tok_line" >>"$dst"
echo "[setup-sim-env] added $key to apps/$app/.env.local — search will work."
