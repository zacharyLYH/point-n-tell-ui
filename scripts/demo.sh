#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
PORT=${PNT_DEMO_PORT:-4173}
ARTIFACTS_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pnt-demo-artifacts.XXXXXX")
cd "$PROJECT_ROOT"

SERVER_PID=

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$ARTIFACTS_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

npm run build
node demo/server.mjs "$PORT" &
SERVER_PID=$!

attempt=0
until curl --fail --silent "http://127.0.0.1:$PORT/__pnt_demo_health" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ] || ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Sample frontend did not start on port $PORT" >&2
    exit 1
  fi
  sleep 0.1
done

PNT_ARTIFACTS_DIR="$ARTIFACTS_DIR/artifacts" \
PNT_PROFILE_DIR="$ARTIFACTS_DIR/chromium-profile" \
PNT_HEADLESS=0 node dist/cli.js "http://127.0.0.1:$PORT" \
  --harness point-and-tell-demo \
  --chat-title sample-frontend
