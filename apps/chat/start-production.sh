#!/bin/sh
set -eu
cd /app/apps/chat
exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-3200}"
