#!/usr/bin/env bash
# Builds the iOS pause-preview app. EAS_NO_VCS=1 makes eas-cli upload the
# working tree through the root .easignore, so the git-ignored devotional
# videos reach the build. A git-based upload can only remove files.
set -euo pipefail

cd "$(dirname "$0")/.."

# The upload is the working tree, so an uncommitted edit would ship unseen.
tree_status="$(git status --porcelain)"
if [ -n "$tree_status" ]; then
  echo "[build:pause] Stopped. The git tree is not clean:" >&2
  printf '%s\n' "$tree_status" >&2
  echo "[build:pause] Commit or remove these changes first. Nothing was built." >&2
  exit 1
fi

EAS_NO_VCS=1 eas build --platform ios --profile pause-preview
