# agent-lens

A CLI that lets an AI coding agent inspect UI bugs through annotated captures of a live page.

## What it does

An agent starts `agent-lens`, which opens a CDP-controlled Chrome session with a persistent profile. The user annotates the page; Agent Lens returns screenshots and structured browser context for the agent to investigate.

## Core workflow

- **App mode:** use the page normally.
- **Annotate mode:**
  - Draw a rectangle, add a comment, and optionally sketch inside it.
  - Undo, redo, or clear strokes; cancel or delete a selection.
  - The page is not dimmed. Input is blocked only while annotating.
- **Save selection:** captures the screenshot after annotation is complete.
  - The image includes a deterministic marker and pen strokes, but not Agent Lens UI.
  - The comment stays editable metadata.
- **Session summary:** open the summary sheet on demand to review all saved selections and recording diagnostics before submitting.
  - Each selection shows its screenshot, comment, and annotation, with **Edit** and **Delete** actions. Edit the comment directly; replace or recreate a selection to change its rectangle or strokes.
  - Warn if the current URL, viewport size, or scroll position differs from a capture.
  - Automatically redact recognized credentials, including cookies and authorization headers. A **Redact credentials** toggle is on by default.
  - Request and response bodies are not scanned for credentials; credentials in bodies may remain visible.
- **Submit:** the summary sheet submits all included selections and session data as a batch. Submitted artifacts remain available until the one-month retention cleanup.

## Capture payload

Submissions contain metadata and file paths, not inline image bytes.

- **Per selection:** `selectionId`, `comment`, `coordinates`, `viewport`, `scroll`, `page` (including URL), `createdAt`, and `imagePath`.
  - Coordinates are viewport CSS pixels in TL, TR, BR, BL order.
  - The screenshot is the source of truth; later page changes do not alter it.
- **Session context:** `harnessSessionRef` (when provided), console errors/warnings, timestamped app API requests/responses, accessibility snapshot, origin storage/SQLite metadata where practical, and session diagnostics.
  - Static assets and bundles are excluded.
  - Recognized credential values are redacted by default, except within request and response bodies, which are not scanned.

Agents can read images from `imagePath` and request a follow-up capture through the CLI. Performance metrics may be available through a separate command.

## Session and storage

- **Session ref:** the agent must provide the harness name and chat title. A session ID is optional; Agent Lens generates one if omitted. The resulting filesystem-safe ref (e.g. `kilo__checkout-bug__abc123`) scopes API access, artifacts, and operations.
- **Artifacts:** session-scoped WebP screenshots and sampled frames; payloads reference local `imagePath`s.
- **Session API:** the CLI starts an ephemeral `127.0.0.1` API, launches or attaches Chrome, and injects overlay configuration. The overlay uses the API for selection state and rehydration; it cannot access disk.
- **Open session:** persists through refresh and navigation until submit, discard, CLI exit, or browser disconnect.
- **Concurrency:** multiple sessions are supported; operations target an explicit session ref.

### Cleanup

| Outcome | Agent payload | Session artifacts |
|---|---|---|
| **Submit** | Batched manifest | Kept until one-month expiry |
| **Discard** | None | Deleted |
| **Browser disconnect / CLI cancel** | None | Deleted |
| **Hard kill / crash** | None | May remain until cleanup |

On CLI invocation, background cleanup removes artifacts older than one month.

### Response

The batch response includes the session ref, machine/session metadata, selection IDs and count, size estimate, image paths, frame index, and retrieval commands.

## Viewport and device checks

DevTools-style viewport emulation resizes the page inside the Chrome window; it does not resize the browser window. Presets include desktop, tablet, mobile, and custom dimensions.

## Sampled interaction capture

Record sampled frames during normal app use; full video is not sent.

- **Recording:** one recording-level comment; no per-frame comments.
- **Sampling:** pixel-diff threshold defaults to **1%**; minimum **500 ms** between frames; heartbeat at most **500 ms**.
  - Pixel changes and diagnostic events can request a frame.
  - Requests inside the minimum interval are coalesced, so bursts of events do not each create a screenshot.
- **Diagnostics:** timestamp console errors/warnings and app-relevant network events during recording. Use events, pixel changes, and activity peaks to identify and annotate useful frames.
- **Timeline:** playback marks diagnostic events and captured frames; preview cuts/frames to tune sensitivity and review submission.
- **Recording feedback:** show elapsed time, frame count, and estimated artifact size.
- **Payload:** recording time range, comment, sampling settings, timestamped diagnostics, and frame index are attached to the same session. Frame images are not inlined.
- **Frame index:** each entry includes `frameId`/number, `timestamp`, `imagePath`, `diffScore`, and tags such as `first`, `last`, `peak`, `console-event`, or `network-event`. Agents fetch only relevant frames.
- **Tooling:** use `ffmpeg` only when needed for diff or preview workflows, not static image compression.

## Implementation notes (draft)

- **Agent integration:** publish an agent skill for setup, CLI usage, manifests, image paths, and session-ref recovery after compaction. Provide detailed CLI help.
- **UI:** TypeScript, React, and scoped Tailwind; use shared shadcn/ui components where practical.
- **Browser:** Playwright `launchPersistentContext` with a dedicated profile to reuse auth and state.
- **Testing:** unit tests, fixture-page Playwright tests, visual snapshots for stable rendering, and minimal CDP end-to-end smoke tests.

## Open questions

- Default WebP quality for text/marker fidelity versus disk use.
- Frame-index detail needed for useful, low-cost agent selection.
- Validate the 1% diff threshold, 500 ms minimum interval, and safeguards for active screens.
