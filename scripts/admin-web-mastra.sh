#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

command=${1:-status}
shift || true

if [[ "${1:-}" == "--" ]]; then
  shift
fi

dry_run=false

while (($#)); do
  case "$1" in
    --dry-run)
      dry_run=true
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      printf 'Usage: %s {run|pause|resume|stop|restart|status} [--dry-run]\n' "$0" >&2
      exit 2
      ;;
  esac
  shift
done

declare -A target_groups=()
declare -A target_pids=()
declare -A target_labels=()

current_pgid=$(ps -o pgid= -p "$$" | tr -d ' ')

print_usage() {
  cat <<EOF
Usage: $0 {run|pause|resume|stop|restart|status} [--dry-run]

Commands:
  run      Start admin, web, and Mastra
  pause    Pause matching dev processes with SIGSTOP
  resume   Resume matching dev processes with SIGCONT
  stop     Stop matching dev processes
  restart  Stop, then start the stack again
  status   List matching dev processes
EOF
}

run_stack() {
  if "$dry_run"; then
    "$script_dir/dev-admin-web-mastra.sh" --dry-run
  else
    exec "$script_dir/dev-admin-web-mastra.sh"
  fi
}

add_pid() {
  local pid=$1
  local label=$2
  local pgid

  [[ -n "$pid" ]] || return 0
  [[ "$pid" == "$$" ]] && return 0
  kill -0 "$pid" 2>/dev/null || return 0

  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
  [[ -n "$pgid" ]] || return 0

  if [[ "$pgid" == "$current_pgid" ]]; then
    target_pids["$pid"]=1
    target_labels["pid:$pid"]="$label"
  else
    target_groups["$pgid"]=1
    target_labels["pgid:$pgid"]="$label"
  fi
}

collect_command_matches() {
  local pid
  local _pgid
  local args

  while read -r pid _pgid args; do
    [[ -n "${pid:-}" ]] || continue
    [[ "${args:-}" == *"admin-web-mastra.sh"* ]] && continue
    [[ "${args:-}" == *"stop-admin-web-mastra.sh"* ]] && continue
    [[ "${args:-}" == tmux\ * ]] && continue

    if [[ "$args" =~ dev-admin-web-mastra\.sh ]]; then
      add_pid "$pid" "dev wrapper"
    elif [[ "$args" =~ pnpm.*--filter[=\ ]@forge/admin[[:space:]]+dev ]]; then
      add_pid "$pid" "admin pnpm"
    elif [[ "$args" =~ pnpm.*--filter[=\ ]@forge/web[[:space:]]+dev ]]; then
      add_pid "$pid" "web pnpm"
    elif [[ "$args" =~ pnpm.*--filter[=\ ]@forge/admin[[:space:]]+mastra:dev ]]; then
      add_pid "$pid" "mastra pnpm"
    elif [[ "$args" =~ pnpm.*exec[[:space:]]+next[[:space:]]+dev.*--port[[:space:]]+3003 ]]; then
      add_pid "$pid" "admin port 3003"
    elif [[ "$args" =~ next/dist/bin/next[[:space:]]+dev.*--port[[:space:]]+3003 ]]; then
      add_pid "$pid" "admin next"
    elif [[ "$args" =~ pnpm.*exec[[:space:]]+next[[:space:]]+dev.*--port[[:space:]]+3000 ]]; then
      add_pid "$pid" "web port 3000"
    elif [[ "$args" =~ next/dist/bin/next[[:space:]]+dev.*--port[[:space:]]+3000 ]]; then
      add_pid "$pid" "web next"
    elif [[ "$args" =~ mastra[[:space:]]+dev[[:space:]]+--dir[[:space:]]+src/mastra-playground ]]; then
      add_pid "$pid" "mastra playground"
    fi
  done < <(ps -eo pid=,pgid=,args=)
}

collect_port_matches() {
  local port=$1
  local label=$2
  local pid

  while read -r pid; do
    add_pid "$pid" "$label"
  done < <(lsof -tiTCP:"$port" -sTCP:LISTEN -nP 2>/dev/null || true)
}

collect_targets() {
  collect_command_matches
  collect_port_matches 3003 "admin port 3003"
  collect_port_matches 3000 "web port 3000"
}

has_targets() {
  ((${#target_groups[@]} > 0 || ${#target_pids[@]} > 0))
}

print_targets() {
  local id

  for id in "${!target_groups[@]}"; do
    printf 'process group %s (%s)\n' "$id" "${target_labels["pgid:$id"]}"
  done

  for id in "${!target_pids[@]}"; do
    printf 'process %s (%s)\n' "$id" "${target_labels["pid:$id"]}"
  done
}

signal_targets() {
  local signal=$1
  local id

  for id in "${!target_groups[@]}"; do
    kill "-$signal" "-$id" 2>/dev/null || true
  done

  for id in "${!target_pids[@]}"; do
    kill "-$signal" "$id" 2>/dev/null || true
  done
}

action_targets() {
  local action=$1
  local signal=$2

  collect_targets

  if ! has_targets; then
    printf 'No admin/web/Mastra dev processes found.\n'
    return 0
  fi

  if "$dry_run"; then
    printf 'Would %s:\n' "$action"
    print_targets
    return 0
  fi

  printf '%s:\n' "$action"
  print_targets
  signal_targets "$signal"
}

stop_targets() {
  collect_targets

  if ! has_targets; then
    printf 'No admin/web/Mastra dev processes found.\n'
    return 0
  fi

  if "$dry_run"; then
    printf 'Would stop:\n'
    print_targets
    return 0
  fi

  printf 'Stopping:\n'
  print_targets
  signal_targets TERM
  signal_targets CONT
  sleep 2
  signal_targets KILL
  printf 'Stopped.\n'
}

status_targets() {
  collect_targets

  if ! has_targets; then
    printf 'No admin/web/Mastra dev processes found.\n'
    return 0
  fi

  printf 'Found:\n'
  print_targets
}

case "$command" in
  run | start)
    run_stack
    ;;
  pause)
    action_targets pause STOP
    ;;
  resume)
    action_targets resume CONT
    ;;
  stop)
    stop_targets
    ;;
  restart)
    stop_targets
    run_stack
    ;;
  status)
    status_targets
    ;;
  -h | --help | help)
    print_usage
    ;;
  *)
    printf 'Unknown command: %s\n' "$command" >&2
    print_usage >&2
    exit 2
    ;;
esac
