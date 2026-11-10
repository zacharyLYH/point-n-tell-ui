---
name: headed-browser-tests-docker
description: Run the headed Playwright suite in Docker via Xvfb (same as CI) without opening windows on the host. Use when tests should not disturb the desktop, or when debugging browser/window behavior inside a container.
---

# Headed browser tests in Docker

`npm test` runs `scripts/test-docker.sh`, which builds `Dockerfile.test` and runs the suite under `xvfb-run`. Chromium stays headed, so window sizing, CDP emulation, and real screenshots are still exercised. `npm run test:run` runs the same command on the host.

## Sharp edges

- **`xvfb-run` needs `xauth`.** Installing only `xvfb` fails with `xauth command not found`.
- **Root is fine.** Playwright launches Chromium with `--no-sandbox` by default (`chromiumSandbox` defaults to false), so no extra flags or users are needed.
- **Do not bind-mount the host `/tmp` over the container's `/tmp`.** Xvfb keeps sockets there. Mount elsewhere and set `TMPDIR` if you need temp artifacts on the host.
- **Baselines are committed, actuals are not.** `tests/screenshots/` holds committed baselines (Playwright's `snapshotPathTemplate` points there). Comparisons use `toHaveScreenshot` / `toMatchSnapshot`; actual and diff images land in `test-results/`. Update with `npm run test:update` (`--update-snapshots`).
- **Screenshots must be deterministic to be baselines.** `toHaveScreenshot` disables animations by default, and the fixture server binds a fixed port (`PNT_FIXTURE_PORT`, default 45123) because review warnings render the page URL.
- **Tests delete their temp profile/artifacts in `finally`.** The CLI's own artifacts live in a temp dir, so use the Playwright artifacts or the trace zip to inspect a failure.
- **`--force-device-scale-factor=2` does not reproduce retina.** CDP `Emulation.setDeviceMetricsOverride({ deviceScaleFactor: 1 })` wins for the page, and the capture surface stays 1x. Retina screenshot scaling can only be verified on a real 2x host.
- **Classic scrollbars shrink the fixed-position canvas.** On Linux, `fixed inset-0` is `clientWidth` wide (excludes the 15px scrollbar) while `innerWidth` includes it. An SVG with `viewBox="0 0 innerWidth innerHeight"` therefore scales by `clientWidth/innerWidth`, differently per viewport. Any pixel-parity assertion then drifts. Draw the annotation canvas in 1:1 CSS pixels (no `viewBox`), as `AnnotationCanvas` does.
- **`vectorEffect="non-scaling-stroke"` dashes in device space** in Skia, so dashed patterns can shift with element position. Use it only where scaling must be resisted.

## Commands

```sh
npm test                                    # full suite in the container
npm test -- -g 'help'                       # one test
npm run test:update                         # rewrite baselines from the container
npm run test:run                            # headed run on the host
PNT_SKIP_BUILD=1 sh scripts/test-docker.sh  # reuse an already-built image
```

CI builds the image with GitHub Actions cache (`docker/build-push-action`), then runs the same script with `PNT_SKIP_BUILD=1`. Baselines are committed, so CI fails on visual drift and uploads actuals from `test-results/`. CI uses `ubuntu-24.04-arm` so the container architecture matches the arm64 baselines; x64 rendering differs (verified under emulation), so keep runner and baseline architecture aligned.
