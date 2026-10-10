#!/usr/bin/env bash
set -euo pipefail

admin_command=(
  env
  "NEXT_PUBLIC_WATCH_URL=${NEXT_PUBLIC_WATCH_URL:-http://localhost:3000}"
  pnpm
  --filter
  @forge/admin
  dev
)

web_command=(
  env
  "NEXT_PUBLIC_ADMIN_GRAPHQL_URL=${NEXT_PUBLIC_ADMIN_GRAPHQL_URL:-http://localhost:3003/api/graphql}"
  "INTERNAL_ADMIN_GRAPHQL_URL=${INTERNAL_ADMIN_GRAPHQL_URL:-http://localhost:3003/api/graphql}"
  "STRAPI_PREVIEW_SECRET=${STRAPI_PREVIEW_SECRET:-local-preview}"
  "REVALIDATION_SECRET=${REVALIDATION_SECRET:-local-revalidate}"
  "NEXT_PUBLIC_CANONICAL_ORIGIN=${NEXT_PUBLIC_CANONICAL_ORIGIN:-http://localhost:3000}"
  pnpm
  --filter
  @forge/web
  dev
)

mastra_command=(
  pnpm
  --filter
  @forge/admin
  mastra:dev
)

print_command() {
  local label=$1
  shift

  printf '%s:' "$label"
  printf ' %q' "$@"
  printf '\n'
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  print_command admin "${admin_command[@]}"
  print_command web "${web_command[@]}"
  print_command mastra "${mastra_command[@]}"
  exit 0
fi

pids=()

cleanup() {
  local status=$?

  trap - EXIT INT TERM

  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi

  exit "$status"
}

start_process() {
  local label=$1
  shift

  print_command "$label" "$@"
  "$@" &
  pids+=("$!")
}

trap cleanup EXIT INT TERM

start_process admin "${admin_command[@]}"
start_process web "${web_command[@]}"
start_process mastra "${mastra_command[@]}"

wait -n "${pids[@]}"
