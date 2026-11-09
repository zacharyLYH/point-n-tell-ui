# Point and Tell implementation tasks

This document breaks the product work into independently testable vertical slices. Each slice should deliver a runnable flow against a fixture page, with success judged by observable behavior across the relevant CLI, browser, API, and artifacts. Unit tests can support a slice, but do not by themselves complete it.

The order establishes shared contracts first: viewport is selected in the Point and Tell UI and is part of capture context from the first runnable slice. Users can switch viewports freely during a session. Every selection records the viewport active when it was captured, and that viewport travels with the screenshot through review and submission. Command names and arguments introduced in the first slice are the CLI surface to adopt and document.

## 1. Viewport and CLI session foundation

Define the viewport model and initial Point and Tell CLI invocation before selection capture is built. Launch a session with a harness name and chat title, and an optional session ID. Spawn or attach to Chromium with a dedicated persistent profile that is reused across launches, then open the requested real app. The Point and Tell UI lets the user select desktop, tablet, or mobile and switch freely between them during the session.

**Success criteria — tested behavior**

- An integration flow invokes the documented CLI command with the required session details, spawns or attaches to Chromium, and displays the requested real app in the browser.
- After closing and relaunching Point and Tell, Chromium uses the same dedicated profile; a real app's existing authenticated state remains available.
- The resulting session ref is filesystem-safe, scopes the running session, and is returned or shown to the caller. Omitting a session ID generates one; providing one is reflected in the session ref.
- A centered, rounded sticky toolbar exposes icon-only desktop, tablet, mobile, and annotation controls with tooltips. It reserves space above page content, stays in one row at narrow viewport widths, and keeps the emulated page centered in the browser window as its viewport changes.
- If docked Chromium DevTools changes the page's actual viewport away from the selected capture viewport, Point and Tell shows a clear warning and still lets the user inspect and continue.
- The real app remains usable in app mode, and the session survives a page refresh and navigation.
- CLI help or equivalent usage output exposes the adopted invocation, required arguments, and optional session ID. These names and arguments are the CLI surface to adopt and document; viewport selection belongs to the UI.

## 2. Annotate and save one selection

From the live fixture page, enter annotate mode, draw a rectangle, add a comment, and optionally draw strokes. Support undo, redo, clear strokes, cancel, and delete before saving. Save a screenshot with a deterministic marker and annotation, excluding Point and Tell UI.

**Success criteria — tested behavior**

- A browser integration flow switches viewport in the UI, draws and saves a selection, then switches to another viewport and saves another selection.
- The saved screenshot shows the fixture, marker, and strokes, without Point and Tell controls or dimming.
- Each returned selection includes its ID, editable comment, viewport CSS-pixel coordinates in TL/TR/BR/BL order, the exact viewport dimensions and preset/custom identity active at capture time, scroll position, page URL, creation time, and an image path. Selections from the same session may have different viewports.
- The image at that path is readable, and later changes to the page do not change the saved screenshot.
- Annotation input is blocked while annotating and normal page input works in app mode.

## 3. Review and edit a session

Save multiple selections, then open the session summary on demand. Review each screenshot, comment, and annotation; edit comments; delete selections. Replace or recreate a selection to change its rectangle or strokes. When the summary opens, compare the current URL, viewport size, and scroll position with each capture and warn about mismatches.

**Success criteria — tested behavior**

- A browser integration flow saves multiple selections and opens the summary with the correct items and screenshots.
- Editing a comment updates the selection metadata without changing its screenshot or captured viewport; deleting a selection removes it from the included set.
- Replacing or recreating a selection produces an updated capture with the new rectangle or strokes.
- Opening the summary after changing the URL, viewport dimensions, or scroll position produces a visible mismatch warning for each affected selection.
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

Collect the supported session context alongside selections: console errors and warnings, timestamped app API requests and responses, an accessibility snapshot, origin storage/SQLite metadata where practical, and session diagnostics. Point and Tell attaches its own browser event listeners before navigating to the app, so collection does not depend on the visible DevTools Network or Console panels being open. Exclude static assets and bundles. Redact recognized credentials by default, with a **Redact credentials** toggle enabled by default.

**Success criteria — tested behavior**

- A fixture app generates representative console events, app API traffic, storage values, and recognized credential values; the submitted manifest contains the documented context and excludes static assets and bundles.
- With Chromium DevTools closed, a fixture flow generates app API requests/responses and console errors/warnings after navigation; Point and Tell captures them, demonstrating that collection starts independently of the visible DevTools panels.
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
