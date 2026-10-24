#!/bin/sh
set -eu
: "${RAILWAY_VOLUME_MOUNT_PATH:?Attach the watcher volume at /data}"
if [ "$RAILWAY_VOLUME_MOUNT_PATH" != /data ]; then
  echo 'The watcher requires its dedicated volume at /data.' >&2
  exit 1
fi
export STATE_PATH=/data/analytics-watcher/state.json
mkdir -p /data/analytics-watcher
# Lock is released by the kernel on exit. A hard deadline prevents a stuck
# browser/auth request from causing Railway to skip all subsequent cron runs.
exec flock -n -E 75 /data/analytics-watcher/run.lock \
  timeout --kill-after=10s 240s node apps/analytics-watcher/dist/index.js
