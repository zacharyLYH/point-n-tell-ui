# Point and Tell implementation tasks

This document breaks the product work into independently testable vertical slices. Each slice should deliver a runnable flow against a fixture page, with success judged by observable behavior across the relevant CLI, browser, API, and artifacts. Unit tests can support a slice, but do not by themselves complete it.

The order establishes shared contracts first: viewport is part of the session and capture context from the first runnable slice. Every selection is captured in a specific viewport, and that viewport travels with the screenshot through review and submission. Command names and arguments introduced in the first slice are the CLI surface to adopt and document.

## 1. Viewport and CLI session foundation

Define the viewport model and the initial Point and Tell CLI invocation together, before selection capture is built. A session has an explicit active viewport: a named desktop, tablet, or mobile preset, or custom dimensions. Launch a session with a harness name and chat title, and an optional session ID. Open a fixture app in a persistent Chrome session at the chosen viewport.

**Success criteria — tested behavior**

- An integration flow invokes the documented CLI command with the required session details and an explicit viewport choice, then opens the fixture page in Chrome.
- The resulting session ref is filesystem-safe, scopes the running session, and is returned or shown to the caller. Omitting a session ID generates one; providing one is reflected in the session ref.
- The fixture reports the dimensions selected by every named preset and a custom viewport, confirming that viewport emulation affects the page. The active viewport is available as session context before any selection is made.
- The page remains usable in app mode, and the session survives a page refresh and navigation.
- CLI help or equivalent usage output exposes the adopted invocation, required arguments, optional session ID, and viewport choices. These names and arguments are the CLI surface to adopt and document.

## 2. Annotate and save one selection

From the live fixture page, enter annotate mode, draw a rectangle, add a comment, and optionally draw strokes. Support undo, redo, clear strokes, cancel, and delete before saving. Save a screenshot with a deterministic marker and annotation, excluding Point and Tell UI.

**Success criteria — tested behavior**

- A browser integration flow draws and saves a selection at the established viewport size.
- The saved screenshot shows the fixture, marker, and strokes, without Point and Tell controls or dimming.
- The returned selection includes its ID, editable comment, viewport CSS-pixel coordinates in TL/TR/BR/BL order, the exact active viewport dimensions and preset/custom identity, scroll position, page URL, creation time, and an image path.
- The image at that path is readable, and later changes to the page do not change the saved screenshot.
- Annotation input is blocked while annotating and normal page input works in app mode.

## 3. Review and edit a session

Save multiple selections, then open the session summary on demand. Review each screenshot, comment, and annotation; edit comments; delete selections. Replace or recreate a selection to change its rectangle or strokes. Warn when current URL, viewport size, or scroll position differs from a capture.

**Success criteria — tested behavior**

- A browser integration flow saves multiple selections and opens the summary with the correct items and screenshots.
- Editing a comment updates the selection metadata without changing its screenshot or captured viewport; deleting a selection removes it from the included set.
- Replacing or recreating a selection produces an updated capture with the new rectangle or strokes.
- Changing the URL, viewport dimensions, or scroll position after capture produces a visible mismatch warning for the affected selection.
- Submitting from the summary includes only the selections still included after edits and deletions.

## 4. Submit or discard a session

Submit reviewed selections and session data as a batch. Support explicit discard. Keep submitted artifacts available until the one-month retention cleanup; delete discarded artifacts.

**Success criteria — tested behavior**

- A CLI-to-API integration flow submits a session and receives a batch response with the session ref, machine/session metadata, selection IDs and count, size estimate, image paths, frame index, and retrieval commands.
- Submitted artifacts remain readable after submission and are not removed by discard cleanup.
- A separate flow discards a session, returns no agent payload, and verifies its session artifacts are deleted.
- Browser disconnect and CLI cancellation return no payload and delete session artifacts.
- A hard-kill/crash fixture verifies that leftover artifacts can be removed by the documented age-based cleanup, which runs on CLI invocation.

## 5. Capture session context and redact credentials

Collect the supported session context alongside selections: console errors and warnings, timestamped app API requests and responses, an accessibility snapshot, origin storage/SQLite metadata where practical, and session diagnostics. Exclude static assets and bundles. Redact recognized credentials by default, with a **Redact credentials** toggle enabled by default.

**Success criteria — tested behavior**

- A fixture app generates representative console events, app API traffic, storage values, and recognized credential values; the submitted manifest contains the documented context and excludes static assets and bundles.
- With redaction enabled, recognized credentials in supported fields are redacted in the submitted payload.
- The flow verifies the documented limitation: request and response bodies are not scanned, so credentials placed only in those bodies may remain visible.
- Turning the redaction toggle off changes the submitted values as described by the UI.

## 6. Record sampled interactions and review the timeline

Record normal app use with a recording-level comment and sampled frames, not full video. Pixel changes and diagnostic events can request frames. Enforce the configured pixel-diff threshold and minimum interval, coalescing requests inside the interval. Review events and frames in a timeline, tune sensitivity, and preview cuts/frames before submission.

**Success criteria — tested behavior**

- A browser integration flow starts and stops recording while exercising a fixture page, and shows elapsed time, frame count, and estimated artifact size.
- Pixel changes and console/network diagnostic events request frames; requests inside the minimum interval coalesce, while the heartbeat captures within its maximum interval.
- The timeline shows captured frames and diagnostic markers in timestamp order; preview reflects adjusted sensitivity and selected cuts/frames.
- The submitted session includes recording time range, recording comment, sampling settings, timestamped diagnostics, and a frame index with frame ID/number, timestamp, image path, diff score, and applicable tags.
- Frame images are readable from their referenced paths and are not inlined in the payload.

## 7. Concurrent sessions and recovery paths

Exercise concurrent sessions and session behavior after browser disconnect, CLI cancellation, and hard kill/crash, including the documented cleanup outcomes.

**Success criteria — tested behavior**

- Concurrent sessions can use different viewport sizes, captures retain the viewport selected for their session, and operations against one explicit session ref do not affect the other session.
- Disconnect, cancellation, and crash scenarios produce the cleanup and retention outcomes in the README's session lifecycle table.

## Open decisions to resolve in the relevant slice

- Default WebP quality for text/marker fidelity versus disk use (slice 2).
- Frame-index detail needed for useful, low-cost agent selection (slice 6).
- Validate the 1% pixel-diff threshold, 500 ms minimum interval, and safeguards for active screens (slice 6).
