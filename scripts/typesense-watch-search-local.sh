#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RUNTIME_DIR=${TYPESENSE_LOCAL_RUNTIME_DIR:-"$ROOT_DIR/.tmp/typesense-watch-search"}
VERSION=${TYPESENSE_VERSION:-30.2}
PORT=${TYPESENSE_PORT:-8108}
API_KEY=${TYPESENSE_API_KEY:-forge-typesense-local-key}
PID_FILE="$RUNTIME_DIR/typesense.pid"
BIN_FILE="$RUNTIME_DIR/bin/typesense-server"

architecture() {
  case "$(uname -m)" in
    aarch64 | arm64) printf 'arm64\n' ;;
    x86_64 | amd64) printf 'amd64\n' ;;
    *)
      printf 'Unsupported Typesense architecture: %s\n' "$(uname -m)" >&2
      exit 1
      ;;
  esac
}

install_typesense() {
  if [[ -x "$BIN_FILE" ]]; then
    printf 'Typesense %s is already installed at %s\n' "$VERSION" "$BIN_FILE"
    return
  fi
  local arch archive
  arch=$(architecture)
  archive="$RUNTIME_DIR/typesense-server.tar.gz"
  mkdir -p "$RUNTIME_DIR/bin"
  curl -fL --retry 3 \
    "https://dl.typesense.org/releases/$VERSION/typesense-server-$VERSION-linux-$arch.tar.gz" \
    -o "$archive"
  tar -xzf "$archive" -C "$RUNTIME_DIR/bin"
  chmod +x "$BIN_FILE"
  printf 'Installed Typesense %s for %s\n' "$VERSION" "$arch"
}

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start_typesense() {
  install_typesense
  if is_running; then
    printf 'Typesense is already running (pid %s)\n' "$(cat "$PID_FILE")"
    return
  fi
  mkdir -p "$RUNTIME_DIR/data" "$RUNTIME_DIR/logs"
  nohup "$BIN_FILE" \
    --data-dir="$RUNTIME_DIR/data" \
    --api-key="$API_KEY" \
    --api-address=127.0.0.1 \
    --api-port="$PORT" \
    --log-dir="$RUNTIME_DIR/logs" \
    --enable-cors=false \
    >"$RUNTIME_DIR/typesense.stdout.log" 2>&1 &
  printf '%s\n' "$!" >"$PID_FILE"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
      printf 'Typesense is ready at http://127.0.0.1:%s\n' "$PORT"
      return
    fi
    sleep 1
  done
  printf 'Typesense did not become healthy; see %s\n' "$RUNTIME_DIR/typesense.stdout.log" >&2
  exit 1
}

stop_typesense() {
  if ! is_running; then
    rm -f "$PID_FILE"
    printf 'Typesense is not running\n'
    return
  fi
  local pid
  pid=$(cat "$PID_FILE")
  kill "$pid"
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  rm -f "$PID_FILE"
  printf 'Stopped Typesense pid %s\n' "$pid"
}

status_typesense() {
  if curl -fsS "http://127.0.0.1:$PORT/health"; then
    printf '\nTypesense is healthy at http://127.0.0.1:%s\n' "$PORT"
  else
    printf 'Typesense is not healthy at http://127.0.0.1:%s\n' "$PORT" >&2
    exit 1
  fi
}

case "${1:-}" in
  install) install_typesense ;;
  start) start_typesense ;;
  stop) stop_typesense ;;
  restart) stop_typesense; start_typesense ;;
  status) status_typesense ;;
  *)
    printf 'Usage: %s {install|start|stop|restart|status}\n' "$0" >&2
    exit 1
    ;;
esac
