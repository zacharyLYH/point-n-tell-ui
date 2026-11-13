# point-n-tell-ui

A CLI that lets an AI coding agent inspect UI bugs through annotated captures of a live page.

## What it does

An agent starts `pnt-ui`, which spawns or attaches to a CDP-controlled Chromium session using the same dedicated persistent profile across launches. The user annotates the page; Point and Tell returns screenshots and structured browser context for the agent to investigate.

## Try the sample frontend

Install dependencies once, then run the demo script:

```sh
npm ci
./scripts/demo.sh
```

The script builds Point and Tell, starts a local sample checkout app, then launches the CLI. The final step is a headed Chromium window showing the sample app with the Point and Tell overlay. The sample app has a small SQLite-backed cart/order API, session cookie, request headers, console events, and localStorage credentials so you can exercise capture context and redaction. Try changing viewports, annotating the order summary, applying `NORTHSTAR10`, editing the cart, or placing an order. Press **Ctrl+C** in the terminal to close Chromium and stop the sample server. Its Chromium profile and saved artifacts stay in `~/.point-n-tell-ui/demo/` (printed at startup) so you can inspect them; the sample SQLite database stays in the temporary directory. The demo state lives outside the repo and each run starts from a clean slate. Set `PNT_DEMO_PORT` to use a different local port if `4173` is occupied, or `PNT_DEMO_STATE_DIR` to move the demo state.

## Run tests

E2E tests run in a container by default: headed Chromium under Xvfb, so no windows open on your desktop. CI uses the same image and script.

```sh
npm test                       # full suite, compares against baselines
npm test -- -g 'help'          # a single test
npm run test:update            # accept current screenshots as baselines
npm run test:run               # headed run on the host
```

Baselines live in `tests/screenshots/` and are committed. Runs use Playwright's snapshot assertions (`toHaveScreenshot` / `toMatchSnapshot`); failures show a diff and write actual/diff images to `test-results/`. `npm run test:update` runs with `--update-snapshots`, regenerating baselines inside the container, so container rendering is the source of truth. CI runs the same arm64 image (`ubuntu-24.04-arm`) so its comparisons match the committed baselines. Screenshots render at 1x; the retina-only capture scaling is exercised by `npm run test:run -- -g 'saves identical previews'`.

## Core workflow

- **App mode:** use the page normally.
- **Annotate mode:**
  - Draw a rectangle and optionally sketch inside it.
  - Undo, redo, or clear strokes; cancel before capturing.
  - The page is not dimmed. Input is blocked only while annotating.
- **Capture:** the screenshot is taken as soon as you capture, then the shared capture dialog asks for a comment.
  - The image includes a deterministic marker and pen strokes, but not Point and Tell UI.
  - **Save** stores the capture with its comment; **Delete** discards it. Nothing is saved until you save.
  - The comment stays editable metadata.
- **Record:** records the app area until you stop it.
  - The toolbar is replaced by a 64px recording bar. A red **REC** pill with elapsed time sits in the band; hovering or focusing it reveals **Stop**.
  - Each frame is captured full-viewport and FFmpeg crops the band, so the recording bar never appears in the cuts. The band is reserved chrome, never app pixels.
  - Frames are sampled every 150ms. Each click captures a forced frame after a 150ms settle, and periodic sampling pauses while it settles.
  - Stopping flushes pending frames and closes CDP, then runs FFmpeg in a blocking state before the comment dialog shows the cuts in a shadcn carousel, with a thumbnail for every captured image.
  - Needs FFmpeg 4 or newer on `PATH` (or `PNT_FFMPEG` pointing at the binary). Availability is checked before recording starts.
- **Session summary:** open the summary sheet on demand to review all saved selections and recording diagnostics before submitting.
  - Each selection shows its screenshot, comment, and annotation, with **Edit** and **Delete** actions. Edit the comment directly; replace or recreate a selection to change its rectangle or strokes.
  - Recording entries show their cuts; their comments stay editable but saved recordings cannot be retaken or re-cut.
  - Captures taken on a different URL are marked **Can't check context** in the selection list. Scrolling or switching viewports does not invalidate a saved screenshot.
  - Automatically redact recognized credentials, including cookies and authorization headers. A **Redact credentials** toggle is on by default.
  - Request and response bodies are not scanned for credentials; credentials in bodies may remain visible.
- **Submit:** the summary sheet submits all included selections and session data as a batch. The manifest prints to CLI stdout; submitted images remain available until the one-month retention cleanup.

## Capture payload

Submissions contain metadata and file paths, not inline image bytes. No manifest file is written; the manifest is printed by the CLI.

- **Per selection:** `selectionId`, `comment`, `coordinates`, `viewport`, `scroll`, `page` (including URL), `createdAt`, and `imagePath`.
  - Coordinates are viewport CSS pixels in TL, TR, BR, BL order.
  - The screenshot is the source of truth; later page changes do not alter it.
- **Per recording:** `recordingId`, `comment`, `startedAt`, `endedAt`, `durationMs`, `viewport`, `page`, and an ordered `cuts` list.
  - `viewport` is the recorded app area: the selected viewport minus the 64px Point and Tell band.
  - Each cut has `cutId`, `number`, `timestamp`, `imagePath`, `diffScore`, and `tags` (`first`, `click`, `last`). `diffScore` is the fraction of pixels changed from the previous kept cut; the first cut scores `0`.
  - The first and last frame are always cuts. Every click captures its own frame as a cut, even without a pixel change; every other cut must differ from the previous kept cut by more than 10%.
  - Cut images are JPEG files inside `<artifactsDir>/rec-<recordingId>/`. No source video is kept, and image bytes are never inlined.
- **Session context:** session ref, console errors/warnings, timestamped app XHR/fetch requests/responses, ARIA accessibility snapshot, origin `localStorage`/`sessionStorage`, cookies, IndexedDB database names, and session diagnostics.
  - Static assets and bundles are excluded.
  - Recognized credential values are redacted by default, except within request and response bodies, which are not scanned.

Agents can read images from `imagePath` and request a follow-up capture through the CLI. Performance metrics may be available through a separate command.

## Session and storage

- **Session ref:** the agent must provide the harness name and chat title. A session ID is optional; Point and Tell generates one if omitted. The resulting filesystem-safe ref (e.g. `kilo__checkout-bug__abc123`) scopes API access, artifacts, and operations.
- **Root:** `~/.point-n-tell-ui/` holds `chromium-profile/` (one shared browser profile) and `artifacts/` (one directory per session). Override the root with `PNT_HOME`, or the individual locations with `PNT_PROFILE_DIR` and `PNT_ARTIFACTS_DIR`.
- **Artifacts:** one session directory holding the WebP screenshots, one directory per recording with its cut JPEGs, plus `console.json`, `network.json`, and `localstorage.json` with the full console, network, and localStorage payloads; request/response bodies included. Payloads reference local paths. Selections use WebP because Chromium encodes it natively; cuts stay JPEG because FFmpeg builds are not guaranteed to include a WebP encoder.
- **CLI output:** prints the session ref, app URL, overlay URL, and artifact directory. Set `PNT_MACHINE=1` for JSON lines an agent can parse. On submit it prints a session header, then one section per image or recording with its `type`, `comment`, image path, page, and viewport, then the full manifest as the final JSON line; the session then closes.
- **Session API:** the CLI starts an ephemeral `127.0.0.1` API, launches or attaches Chrome, and injects overlay configuration. The overlay uses the API for selection state and rehydration; it cannot access disk.
- **Open session:** persists through refresh and navigation until submit, discard, CLI exit, or browser disconnect.
- **Concurrency:** multiple sessions are supported; operations target an explicit session ref. A duplicate ref is rejected before it can modify the existing session's state or artifacts.

### Cleanup

| Outcome | Agent payload | Session artifacts |
|---|---|---|
| **Submit** | Manifest on CLI stdout | Images kept until one-month expiry |
| **Discard** | None | Deleted |
| **Browser disconnect / CLI cancel** | None | Deleted |
| **Hard kill / crash** | None | May remain until cleanup |

On CLI invocation, background cleanup removes artifacts older than one month.

### Response

The submit manifest includes the session ref, machine/session metadata, selection IDs and count, image paths, frame index, session context, paths to `console.json`, `network.json`, and `localstorage.json`, and a command that lists the artifact directory. It is printed to CLI stdout; agents read images from each `imagePath` and the full payloads from the JSON files.

## Viewport and device checks

The user selects the capture viewport in the Point and Tell toolbar, not through CLI arguments. They can switch freely between desktop, tablet, and mobile presets while a session is open. The toolbar is pinned in a 64px band at the top of the window, and the page is offset below it so the overlay never covers app content or blocks annotation. The Chrome window is resized to fit the preset and the page is emulated inside it at that exact size. If the display is shorter than the preset plus browser chrome, the viewport is reduced to what fits, because a viewport taller than the window looks complete to the page and never scrolls; each saved selection records the size actually applied, so selections in one session may differ.

## Video capture

Record real app use, keep the cuts, and never keep the video.

- **Recording:** samples the app every 150ms at the selected size, at desktop, tablet, and mobile. The page stays interactive. Point and Tell lives in a reserved 64px top band that FFmpeg crops from every frame, so the recording bar never appears in the capture. The band is chrome, not app pixels, so scrolled app content is never cut: frames are the app area below the band at every scroll position. One comment per recording.
- **Cuts:** the first and last frame are always kept. Every click is kept after a 150ms settle; other frames are kept only when they differ from the previous kept cut by more than **10%**. Periodic sampling pauses while a click settles. Stopping flushes pending frames and closes CDP before the blocking FFmpeg step, so the processing state cannot enter a cut. Cuts are ordered by timestamp.
- **Temp data:** captured frames live in a scratch directory that is deleted when FFmpeg exits, on success or failure. Nothing is saved until you save the capture.
- **Review:** the capture dialog shows one cut at a time in a shadcn carousel with previous/next, the cut's relative time and tags; saved recordings appear in the session summary with a `cuts` badge, the same carousel, and an editable comment.
- **Failure:** missing or unsupported FFmpeg is reported before recording; a failed run shows the FFmpeg error, removes partial frames and cuts, and saves nothing. The session stays usable.

## Implementation notes (draft)

- **Agent integration:** publish an agent skill for setup, CLI usage, manifests, image paths, and session-ref recovery after compaction. Provide detailed CLI help.
- **UI:** TypeScript, React, and scoped Tailwind; use shared shadcn/ui components where practical.
- **Browser:** Playwright `launchPersistentContext` with a dedicated profile reused across launches to retain auth and state.
- **Testing:** unit tests, fixture-page Playwright tests, visual snapshots for stable rendering, and minimal CDP end-to-end smoke tests.

## Open questions

- Default WebP quality for text/marker fidelity versus disk use.
- Frame-index detail needed for useful, low-cost agent selection.
- Validate the 10% diff threshold, 150ms cadence, and click settle with real interaction.
