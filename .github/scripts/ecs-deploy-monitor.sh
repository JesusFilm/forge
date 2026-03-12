#!/usr/bin/env bash
#
# ecs-deploy-monitor.sh — Force a new ECS deployment, poll until healthy,
# and fail fast on crash loops with sanitized CloudWatch logs.
#
# Required env vars:
#   CLUSTER_NAME   ECS cluster name
#   SERVICE_NAME   ECS service name
#   DEPLOY_ENV     Environment slug (prod|stage) — used to derive the log group
#
# Optional env vars:
#   CRASH_THRESHOLD  Number of stopped tasks before declaring crash loop (default: 3)
#   MAX_ATTEMPTS     Poll iterations before timeout (default: 60)
#   POLL_INTERVAL    Seconds between polls (default: 10)
#
# Outputs (written to $GITHUB_OUTPUT when present):
#   task_definition_arn  ARN of the active task definition
#
set -euo pipefail

: "${CLUSTER_NAME:?}" "${SERVICE_NAME:?}" "${DEPLOY_ENV:?}"
CRASH_THRESHOLD="${CRASH_THRESHOLD:-3}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-60}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Redact values of known secret env vars and embedded credentials in URIs.
# Safe to pipe arbitrary log output through — non-matching lines pass through.
sanitize_logs() {
  perl -pe '
    s/(DATABASE_PASSWORD|APP_KEYS|ADMIN_JWT_SECRET|JWT_SECRET|API_TOKEN_SALT|TRANSFER_TOKEN_SALT|ENCRYPTION_KEY|STRAPI_INTERNAL_API_TOKEN|DATABASE_URL)\s*[=:"]+\s*\K[^\s,}"'"'"']+/***REDACTED***/gi;
    s{postgres(ql)?://[^@\s]+@}{postgres$1://***:***@}gi;
  '
}

# Pull the last 200 CloudWatch log events for each stopped task and print
# them to stdout, piped through sanitize_logs.
fetch_stopped_task_logs() {
  local log_group="/ecs/forge-cms-${DEPLOY_ENV}"
  echo ""
  echo "=== STOPPED TASK LOGS (secrets redacted) ==="
  for task_arn in "${STOPPED_TASK_ARNS[@]}"; do
    local task_id="${task_arn##*/}"
    local log_stream="cms/cms/${task_id}"
    echo "--- task ${task_id} ---"
    aws logs get-log-events \
      --log-group-name "$log_group" \
      --log-stream-name "$log_stream" \
      --limit 200 \
      --no-paginate \
      --output json 2>/dev/null \
      | jq -r '.events[].message' \
      | sanitize_logs \
    || echo "(no logs available)"
    echo "--- end task ${task_id} ---"
  done
  echo "=== END STOPPED TASK LOGS ==="
}

# Print recent ECS service events (human-readable timeline).
print_service_events() {
  local svc_json="$1" count="${2:-5}"
  echo "$svc_json" \
    | jq -r ".services[0].events[:${count}][] | \"  \\(.createdAt) \\(.message)\"" >&2
}

# ---------------------------------------------------------------------------
# Validate service exists
# ---------------------------------------------------------------------------

SERVICE_JSON=$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME")
if [ "$(echo "$SERVICE_JSON" | jq -r '.failures | length')" -gt 0 ] ||
   [ "$(echo "$SERVICE_JSON" | jq -r '.services | length')" -eq 0 ]; then
  echo "ECS service not found: $SERVICE_NAME" >&2
  exit 1
fi

TASK_DEF_ARN=$(echo "$SERVICE_JSON" | jq -r '.services[0].taskDefinition')
if [ -z "$TASK_DEF_ARN" ] || [ "$TASK_DEF_ARN" = "null" ]; then
  echo "Service has no task definition: $SERVICE_NAME" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Force new deployment
# ---------------------------------------------------------------------------

echo "Cluster=$CLUSTER_NAME Service=$SERVICE_NAME TaskDef=$TASK_DEF_ARN"
echo "Forcing new deployment (task def uses :latest; new image already pushed)."

aws ecs update-service \
  --cluster "$CLUSTER_NAME" \
  --service "$SERVICE_NAME" \
  --force-new-deployment \
  --output text --query 'service.deployments[0].rolloutState' >/dev/null || true

sleep 2
SVC=$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME")
NEW_DEPLOY_ID=$(echo "$SVC" | jq -r '.services[0].deployments[] | select(.status=="PRIMARY") | .id')
echo "Tracking deployment: $NEW_DEPLOY_ID"

# ---------------------------------------------------------------------------
# Poll rollout status
# ---------------------------------------------------------------------------

STOPPED_TASK_ARNS=()

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  SVC=$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME")
  PRIMARY=$(echo "$SVC" | jq -r '.services[0].deployments[] | select(.status=="PRIMARY")')
  STATE=$(echo "$PRIMARY" | jq -r '.rolloutState // "IN_PROGRESS"')
  REASON=$(echo "$PRIMARY" | jq -r '.rolloutStateReason // ""')
  DESIRED=$(echo "$SVC" | jq -r '.services[0].desiredCount')
  RUNNING=$(echo "$SVC" | jq -r '.services[0].runningCount')
  PENDING=$(echo "$SVC" | jq -r '.services[0].pendingCount')
  NUM_DEPLOYS=$(echo "$SVC" | jq -r '.services[0].deployments | length')

  # -- Discover newly-stopped tasks belonging to the new deployment ----------

  STOPPED_JSON=$(aws ecs list-tasks \
    --cluster "$CLUSTER_NAME" \
    --service-name "$SERVICE_NAME" \
    --desired-status STOPPED \
    --output json 2>/dev/null || echo '{"taskArns":[]}')
  NEW_STOPPED=$(echo "$STOPPED_JSON" | jq -r '.taskArns[]' 2>/dev/null || true)

  for task_arn in $NEW_STOPPED; do
    already_tracked=false
    for known in "${STOPPED_TASK_ARNS[@]+"${STOPPED_TASK_ARNS[@]}"}"; do
      if [ "$known" = "$task_arn" ]; then already_tracked=true; break; fi
    done
    if $already_tracked; then continue; fi

    TASK_DETAIL=$(aws ecs describe-tasks --cluster "$CLUSTER_NAME" --tasks "$task_arn" --output json 2>/dev/null || echo '{"tasks":[]}')
    TASK_STARTED_BY=$(echo "$TASK_DETAIL" | jq -r '.tasks[0].startedBy // ""')
    if [ "$TASK_STARTED_BY" != "$NEW_DEPLOY_ID" ]; then continue; fi

    STOPPED_TASK_ARNS+=("$task_arn")
    TASK_STOP_CODE=$(echo "$TASK_DETAIL" | jq -r '.tasks[0].stopCode // "unknown"')
    TASK_STOP_REASON=$(echo "$TASK_DETAIL" | jq -r '.tasks[0].stoppedReason // "unknown"')
    CONTAINER_EXIT=$(echo "$TASK_DETAIL" | jq -r '.tasks[0].containers[0].exitCode // "n/a"')
    task_id="${task_arn##*/}"
    echo "  STOPPED task $task_id  exit=$CONTAINER_EXIT  code=$TASK_STOP_CODE  reason=$TASK_STOP_REASON"
  done

  STOPPED_COUNT=${#STOPPED_TASK_ARNS[@]}
  echo "[$i/$MAX_ATTEMPTS] rollout=$STATE running=$RUNNING desired=$DESIRED pending=$PENDING deployments=$NUM_DEPLOYS stopped_new=$STOPPED_COUNT"

  # -- Evaluate exit conditions -----------------------------------------------

  if [ "$STATE" = "COMPLETED" ] && [ "$RUNNING" = "$DESIRED" ] && [ "$PENDING" = "0" ] && [ "$NUM_DEPLOYS" = "1" ]; then
    echo "Rollout completed."
    break
  fi

  if [ "$STATE" = "FAILED" ]; then
    echo "Rollout failed: $REASON" >&2
    print_service_events "$SVC" 5
    if [ "$STOPPED_COUNT" -gt 0 ]; then fetch_stopped_task_logs >&2; fi
    exit 1
  fi

  if [ "$STOPPED_COUNT" -ge "$CRASH_THRESHOLD" ]; then
    echo "Crash loop detected: $STOPPED_COUNT tasks from new deployment have stopped." >&2
    print_service_events "$SVC" 10
    fetch_stopped_task_logs >&2
    exit 1
  fi

  if [ "$i" = "$MAX_ATTEMPTS" ]; then
    echo "Rollout did not complete within $((MAX_ATTEMPTS * POLL_INTERVAL))s. State=$STATE" >&2
    if [ "$STOPPED_COUNT" -gt 0 ]; then fetch_stopped_task_logs >&2; fi
    exit 1
  fi

  sleep "$POLL_INTERVAL"
done

# ---------------------------------------------------------------------------
# Expose outputs for downstream steps
# ---------------------------------------------------------------------------

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "task_definition_arn=$TASK_DEF_ARN" >> "$GITHUB_OUTPUT"
fi
