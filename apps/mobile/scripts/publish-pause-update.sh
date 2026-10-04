#!/usr/bin/env bash
# Publishes an EAS Update to the pause-preview channel (iOS only). The app uses
# the fingerprint runtime policy, and `eas update` reports success even when no
# installed build has its runtime version, so this script compares them first.
set -euo pipefail

cd "$(dirname "$0")/.."

profile="pause-preview"

# Prints one field of the JSON that eas-cli writes to stdout (the first item of
# an array). eas-cli can print a log line before the JSON, so the parse starts
# at the first line that opens a JSON value.
eas_json_field() {
  node -e '
    const text = require("fs").readFileSync(0, "utf8")
    const start = text.search(/^[[{]/m)
    if (start === -1) throw new Error("eas-cli printed no JSON")
    const doc = JSON.parse(text.slice(start))
    const value = (Array.isArray(doc) ? doc[0] : doc)?.[process.argv[1]]
    process.stdout.write(typeof value === "string" ? value : "")
  ' "$1"
}

builds_json="$(eas build:list --platform ios --build-profile "$profile" \
  --status finished --limit 1 --json --non-interactive)"
build_id="$(printf '%s' "$builds_json" | eas_json_field id)"
build_runtime="$(printf '%s' "$builds_json" | eas_json_field runtimeVersion)"

if [ -z "$build_id" ] || [ -z "$build_runtime" ]; then
  echo "[update:pause] Stopped. EAS has no finished $profile iOS build with a runtime version." >&2
  echo "[update:pause] Run build:pause and install that build first. Nothing was published." >&2
  exit 1
fi

local_runtime="$(eas fingerprint:generate --platform ios --environment preview \
  --json --non-interactive | eas_json_field hash)"

if [ -z "$local_runtime" ]; then
  echo "[update:pause] Stopped. eas fingerprint:generate gave no hash. Nothing was published." >&2
  exit 1
fi

if [ "$local_runtime" != "$build_runtime" ]; then
  echo "[update:pause] Stopped. The runtime versions are different:" >&2
  echo "  local iOS runtime:        $local_runtime" >&2
  echo "  last $profile build: $build_runtime (build $build_id)" >&2
  echo "[update:pause] An update for the local runtime reaches no installed build." >&2
  echo "[update:pause] If native code or eas.json changed, run build:pause and install the new build." >&2
  echo "[update:pause] If not, run pnpm install from the repository root and try again." >&2
  echo "[update:pause] Nothing was published." >&2
  exit 1
fi

echo "[update:pause] The runtime versions agree ($local_runtime, build $build_id)."
touch src/env.ts
EXPO_NO_DOTENV=1 eas update --channel "$profile" --environment preview \
  --platform ios --message "pause preview update"
