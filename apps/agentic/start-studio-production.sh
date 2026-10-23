#!/bin/sh
set -eu
cd /app
export MASTRA_TELEMETRY_DISABLED=1
exec pnpm --filter @forge/agentic exec mastra studio --port "${PORT:?Railway PORT is required}" --server-host forgeagentic-stage.up.railway.app --server-port 443 --server-protocol https --server-api-prefix /api
