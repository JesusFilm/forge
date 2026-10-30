#!/bin/sh
set -eu
cd /app/apps/mastra-gateway
pnpm exec prisma migrate deploy
export HOSTNAME=0.0.0.0
exec node /app/apps/mastra-gateway/.next/standalone/apps/mastra-gateway/server.js
