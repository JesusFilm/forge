#!/usr/bin/env bash
#
# Pull the chat-eval prototype's dedicated OpenRouter key out of Doppler and
# write it to apps/mastra/.env.local (gitignored).
#
# Deliberately fetches ONE secret rather than reusing scripts/fetch-secrets.sh,
# which downloads a whole project into .env. The prototype needs exactly one
# value, and apps/mastra has no .env of its own — dumping an unrelated
# project's secrets next to a Mastra app that force-loads dotenv files would
# be a footgun.
#
#   pnpm --filter @forge/mastra proto:fetch-key
set -euo pipefail

PROJECT="forge-rag"
CONFIG="dev"
SECRET="CHAT_EVAL_OPENROUTER_API_KEY"
TARGET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/mastra/.env.local"

if ! command -v doppler >/dev/null 2>&1; then
  echo "doppler CLI not found — install it or set $SECRET manually" >&2
  exit 1
fi

value="$(doppler secrets get "$SECRET" --project "$PROJECT" --config "$CONFIG" --plain 2>/dev/null || true)"

if [ -z "$value" ]; then
  cat >&2 <<EOF
$SECRET is empty in Doppler ($PROJECT / $CONFIG).

Provision an OpenRouter key at https://openrouter.ai/settings/keys, then:

  doppler secrets set $SECRET="sk-or-v1-..." \\
    --project $PROJECT --config $CONFIG

...or paste it into the Doppler dashboard under $PROJECT / $CONFIG.
EOF
  exit 1
fi

tmp="${TARGET}.tmp"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT INT TERM

# Preserve any other local overrides; replace only this key.
if [ -f "$TARGET" ]; then
  grep -v "^${SECRET}=" "$TARGET" > "$tmp" || true
else
  : > "$tmp"
fi
printf '%s=%s\n' "$SECRET" "$value" >> "$tmp"
mv "$tmp" "$TARGET"

echo "wrote $SECRET to apps/mastra/.env.local (gitignored)"
