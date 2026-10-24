#!/usr/bin/env bash
set -euo pipefail

# Print the contents of the gitignored local secrets file so future-you can
# stop forgetting the admin/web/Mastra login. Optionally narrow to a section
# heading match (case-insensitive).
#
# Usage:
#   scripts/show-local-secrets.sh            # print whole file
#   scripts/show-local-secrets.sh admin      # print only sections matching "admin"
#   scripts/show-local-secrets.sh web mastra # multiple matches OK

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
secrets_file="$repo_root/.claude/secrets.local.md"

if [[ ! -f "$secrets_file" ]]; then
  printf 'No local secrets file found at:\n  %s\n\n' "$secrets_file" >&2
  printf 'Ask Claude to set one up (it will create the gitignored template).\n' >&2
  exit 1
fi

if (($# == 0)); then
  cat "$secrets_file"
  exit 0
fi

awk -v patterns="$*" '
  BEGIN {
    n = split(tolower(patterns), arr, /[[:space:]]+/)
    in_section = 0
  }
  /^## / {
    in_section = 0
    header = tolower($0)
    for (i = 1; i <= n; i++) {
      if (index(header, arr[i])) {
        in_section = 1
        break
      }
    }
  }
  in_section { print }
' "$secrets_file"
