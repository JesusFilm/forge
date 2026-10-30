#!/bin/sh
set -eu
# Only the dedicated worker retains operator/push authority at runtime.
if [ "${1:-web}" = worker ]; then
  unset TYPESENSE_API_KEY TYPESENSE_SEARCH_API_KEY
fi
cd /app/apps/admin
export DD_VERSION="${DD_VERSION:-${RAILWAY_GIT_COMMIT_SHA:-}}"
export NEXT_PUBLIC_DATADOG_VERSION="${NEXT_PUBLIC_DATADOG_VERSION:-${RAILWAY_GIT_COMMIT_SHA:-}}"
export DATADOG_RELEASE_VERSION="${DATADOG_RELEASE_VERSION:-${RAILWAY_GIT_COMMIT_SHA:-}}"
export HOSTNAME=0.0.0.0
export NODE_OPTIONS='--enable-source-maps --require ./node_modules/dd-trace/init --max-old-space-size=5120'
exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
