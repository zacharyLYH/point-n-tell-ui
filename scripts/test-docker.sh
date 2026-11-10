#!/bin/sh
# Runs the e2e suite in a container: headed Chromium under Xvfb, same as CI.
# Screenshots and traces are bind-mounted, so runs update the repo.
set -eu

PROJECT_ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
IMAGE=point-n-tell-ui-tests

cd "$PROJECT_ROOT"

if [ "${PNT_SKIP_BUILD:-0}" != "1" ]; then
  docker build -f Dockerfile.test -t "$IMAGE" .
fi

mkdir -p "$PROJECT_ROOT/test-results"

if [ "$#" -eq 0 ]; then
  set -- npm run test:run
else
  set -- npm run test:run -- "$@"
fi

exec docker run --rm --init --shm-size=1g \
  -v "$PROJECT_ROOT/tests/screenshots:/app/tests/screenshots" \
  -v "$PROJECT_ROOT/test-results:/app/test-results" \
  "$IMAGE" "$@"
