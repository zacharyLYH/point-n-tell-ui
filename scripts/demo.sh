#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
PORT=${PNT_DEMO_PORT:-4173}
STATE_DIR=${PNT_DEMO_STATE_DIR:-"$PROJECT_ROOT/.demo-state"}

# A demo run starts from a clean slate so stale sessions, artifacts, and the
# sample SQLite database do not leak into the next run. The directory is
# gitignored and kept after exit so the session can be inspected.
rm -rf "$STATE_DIR"
mkdir -p "$STATE_DIR"
cd "$PROJECT_ROOT"

SERVER_PID=

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
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

echo "Demo state: $STATE_DIR (gitignored, kept after exit)"

PNT_ARTIFACTS_DIR="$STATE_DIR/artifacts" \
PNT_PROFILE_DIR="$STATE_DIR/chromium-profile" \
PNT_HEADLESS=0 npm exec --no --package=. -- pnt-ui "http://127.0.0.1:$PORT" \
  --harness point-and-tell-demo \
  --chat-title sample-frontend
