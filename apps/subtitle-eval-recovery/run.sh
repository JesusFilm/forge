#!/bin/sh
# Calls Manager's scheduled Subtitle Lab recovery endpoint once, then decides
# whether this cron run should be reported as a success.
#
# A 200 is NOT success on its own. The endpoint answers 200 with a list of
# per-run outcomes, and a run it failed to recover appears there rather than in
# the status code. This script reads the outcomes so a persistent recovery
# failure turns the cron red instead of looking healthy forever.
set -eu

: "${MANAGER_URL:?MANAGER_URL is required, e.g. https://manager.jesusfilm.org}"
: "${MANAGER_API_KEY:?MANAGER_API_KEY is required (the service bearer)}"

URL="${MANAGER_URL%/}/api/scheduled/subtitle-eval-recovery"
BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT

# Deadline is shorter than the 5-minute schedule so a stuck request cannot make
# Railway skip the following run.
STATUS=$(curl -sS -o "$BODY" -w '%{http_code}' \
  --max-time "${RECOVERY_TIMEOUT_SECONDS:-240}" \
  -X POST "$URL" \
  -H "Authorization: Bearer ${MANAGER_API_KEY}") || {
  echo "[subtitle-eval-recovery] event=request_failed url=${URL}" >&2
  exit 1
}

if [ "$STATUS" != "200" ]; then
  # The body can carry an auth or config reason; it holds no run evidence.
  echo "[subtitle-eval-recovery] event=http_error status=${STATUS} body=$(head -c 300 "$BODY" | tr -d '\n')" >&2
  exit 1
fi

TOTAL=$(jq '.outcomes | length' < "$BODY")
RACED=$(jq '[.outcomes[] | select(.status == "SKIPPED_OR_RACED")] | length' < "$BODY")
UNKNOWN=$(jq '[.outcomes[] | select(.status == "UNKNOWN")] | length' < "$BODY")

echo "[subtitle-eval-recovery] event=swept total=${TOTAL} raced=${RACED} unknown=${UNKNOWN}"
jq -c '.outcomes[]' < "$BODY" | while read -r line; do
  echo "[subtitle-eval-recovery] outcome=${line}"
done

# SKIPPED_OR_RACED is expected when another worker holds the lease, but the
# recovery loop also catches *every* exception into that same status -- an
# unreachable Admin is indistinguishable from a benign race. So a sweep where
# every outcome raced, repeatedly, is the signal worth alerting on. One such
# sweep is normal; sustained ones are not, which is what RECOVERY_ALERT_ALL_RACED
# lets an operator turn into a hard failure once a baseline is known.
if [ "${RECOVERY_ALERT_ALL_RACED:-false}" = "true" ] &&
   [ "$TOTAL" -gt 0 ] && [ "$RACED" -eq "$TOTAL" ]; then
  echo "[subtitle-eval-recovery] event=all_outcomes_raced total=${TOTAL}" >&2
  exit 1
fi

exit 0
