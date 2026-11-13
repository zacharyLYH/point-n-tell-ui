# point-n-tell-ui

CLI that lets an AI coding agent inspect UI bugs through annotated captures of a live page.

`pnt-ui` opens the page in a CDP-controlled Chromium with a persistent profile. The user annotates or records; the CLI prints image paths plus console, network, storage, and accessibility context.

## Try it

```sh
npm ci
./scripts/demo.sh
```

Builds, starts a sample checkout app (SQLite cart API, session cookie, console events, seeded credentials), then opens the overlay on it. Try viewports, annotating the order summary, `NORTHSTAR10`, editing the cart, placing an order, then opening `/receipt` — a different URL that keeps the same session and captures. Ctrl+C stops everything. Profile and artifacts stay in `~/.point-n-tell-ui/demo/`; demo state starts clean each run. `PNT_DEMO_PORT` and `PNT_DEMO_STATE_DIR` relocate them.

## First run

The toolbar's **?** button repeats this in-app.

1. Pick a viewport if the bug is size-specific.
2. **Annotate** (cursor icon) drags a box and saves a screenshot; **Record** (camera icon) captures a flow as cuts.
3. A comment is required. Save keeps the capture; Delete or X discards it.
4. Layers icon: review comments, delete, capture again, redaction toggle.
5. **Submit** once. The report prints in the terminal and the session ends.

## Tests

```sh
npm test                # container run, compares committed baselines
npm test -- -g 'help'   # single test
npm run test:update     # accept new baselines in the container
npm run test:run        # headed on the host
```

Baselines live in `tests/screenshots/`. Container rendering is the source of truth; CI uses the same image. Failures write diffs to `test-results/`.

## Flow

| Step | Behavior |
|---|---|
| Viewport | desktop, tablet, or mobile; window resized, page emulated at that size |
| Annotate | rectangle plus optional pen; page not dimmed; input blocked only while annotating |
| Capture dialog | comment required; Save keeps, Delete/X discards; image excludes Point and Tell chrome |
| Record | 150ms samples plus one frame per click; Stop and a pen toggle sit in the red recording bar |
| Review | edit comments, delete, capture again, redaction on by default |
| Submit | report on stdout; images retained for one month |

## Output

No manifest file. The report and the artifacts directory carry everything.

- Selection: `selectionId`, `comment`, `coordinates` (TL, TR, BR, BL viewport CSS px), `viewport`, `scroll`, `page.url`, `createdAt`, `imagePath`.
- Recording: `recordingId`, `comment`, `startedAt`, `endedAt`, `durationMs`, `viewport` (band-cropped), `page.url`, ordered `cuts`.
- Cut: `cutId`, `number`, `timestamp`, `imagePath`, `diffScore`, `tags` (`first`, `click`, `last`).
- Context: console errors/warnings, app XHR/fetch, ARIA snapshot, localStorage and sessionStorage, cookies, IndexedDB names, diagnostics. Static assets excluded.

Artifacts under `~/.point-n-tell-ui/artifacts/<sessionRef>/`: WebP screenshots, `rec-<id>/` JPEG cuts, `console.json`, `network.json`, `localstorage.json`, `a11y.yml`.

## Recording

- Frames are full-viewport; FFmpeg crops the 64px band, so the bar never appears in a cut and scrolled content is never clipped.
- First and last frames are always kept. Clicks always keep a frame after a 150ms settle. Other frames need more than 10% pixel change from the previous kept cut.
- Frames are temporary; only cuts survive. A failure shows the FFmpeg error and saves nothing.
- FFmpeg 4 or newer on `PATH`, or point `PNT_FFMPEG` at the binary.

## Session and storage

- Ref is `harness__chat-title__session-id`, filesystem-safe. A duplicate live ref is rejected.
- Root `~/.point-n-tell-ui/` holds `chromium-profile/` and `artifacts/`. Override with `PNT_HOME`, `PNT_PROFILE_DIR`, or `PNT_ARTIFACTS_DIR`.
- Sessions run concurrently; every operation targets an explicit ref.
- One tracked tab: navigation to any URL keeps the session, but captures always come from the tab the CLI opened. Navigate in that window, not a new tab.
- The CLI serves an ephemeral `127.0.0.1` API to the overlay. The overlay never touches disk.

## Lifecycle

| Outcome | Payload | Artifacts |
|---|---|---|
| Submit | report on stdout | kept until one-month expiry |
| Discard | none | deleted |
| Browser disconnect / Ctrl+C | none | deleted unless submitted |
| Crash | none | removed by the next run's cleanup |

## Implementation notes

- React + Tailwind overlay in a shadow DOM; reserves a 64px top band via body padding.
- Playwright persistent profile, CDP screenshots, FFmpeg cuts.
- Specs in `docs/`, agent skill in `skills/point-n-tell-ui/`.
