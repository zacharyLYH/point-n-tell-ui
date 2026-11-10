# Task 3 RFC: Review and edit a session

**Status:** Proposed  
**Scope:** Review saved selections and decide what remains in the session.

## Goal

Let the user inspect all saved selections together, correct their comments, remove unwanted selections, and replace a capture when its marked area or strokes need changing. Show when the live page has drifted from a selection's capture context.

## Mental model

Each saved selection is an immutable capture: its screenshot and capture context describe what was seen at save time. Review edits the session's included set and editable comments. A replacement is a new capture based on the current page and viewport; it does not rewrite the original image in place.

```text
Saved selections
  └─ Session summary
       ├─ Review screenshot + comment + capture context
       ├─ Edit comment / include or delete selection
       ├─ Replace selection with a new capture
       └─ Submit the currently included selections (Task 4)
```

## User flow

1. Save multiple selections, then open the session summary from the toolbar.
2. The summary opens as a full browser-content-area modal workspace, independent of the app's emulated viewport. Before opening it, Point and Tell records the app's current URL, emulated viewport, and scroll position, then temporarily suspends viewport emulation so the review UI can use the browser's full content area. Closing review restores the selected app viewport and returns to the same page and scroll position.
3. Review each screenshot, comment, and viewport; edit comments or delete selections.
4. If the rectangle or strokes need to change, return to the live page and replace or recreate that selection.
5. Return to the summary and confirm the included set before proceeding to submission.

## Review workspace

Use a simple three-part layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Session title · included count                   Close · Next │
├───────────────┬───────────────────────────┬──────────────────┤
│ Selection list│ Screenshot preview        │ Comment + details│
│ thumbnail     │                           │ viewport, URL,   │
│ comment        │                           │ scroll, warning  │
└───────────────┴───────────────────────────┴──────────────────┘
```

The left rail lists every saved selection in capture order. Each row has a small screenshot thumbnail, a short comment excerpt, and an included/deleted state. Clicking a row selects it and loads its full screenshot in the center preview; it does not navigate away or open a second dialog. Show the complete image scaled to fit, preserving its aspect ratio, with a way to inspect it at a larger scale. The right panel shows the editable full comment, captured viewport preset and dimensions, URL, scroll position, and any mismatch warning, followed by the selection actions. The screenshot preview is the saved capture itself, including its marker and strokes, with no live-page overlay drawn over it.

The review workspace uses the browser's available content area, not the selected mobile/tablet/desktop emulation dimensions. It is centered in the browser window. The toolbar is intended to be centered against that same browser window at every app viewport size, including mobile and tablet; neither should be positioned relative to the emulated app canvas. This is Point and Tell's own review interface; the app's emulated viewport is restored when the user closes review. Capture-context mismatches are evaluated from the page state recorded immediately before emulation is suspended, so opening review does not create a false viewport warning.

Keep the header and selection actions visible while the list and detail content scroll. On narrow windows, collapse the three columns into a selection list followed by the selected screenshot and details; keep the selected item and all actions reachable. The primary action advances to Task 4 submission; closing the workspace returns to the live page without discarding edits.

## Visual direction

Borrow the review patterns, not the full visual systems: GitHub's file-by-file review and visible progress, Figma's canvas comment context and side-panel details, and Linear's compact list with a focused item preview. Keep Point and Tell's existing restrained Excalidraw-inspired palette and typography so this feels like the same tool. Avoid copying their branding or adding their product-specific controls.

## Side quest: center the page and toolbar in the browser

The current mobile/tablet emulation can leave the app viewport at the left edge of the browser, and the toolbar may follow it or become hidden. This is not intended. Investigate how to keep the app viewport centered in the visible browser area while keeping the toolbar visible and centered against the browser window, independent of the emulated app dimensions. Keep the toolbar's narrow-window behavior usable. Treat this as a separate implementation task; do not assume CSS centering inside the emulated page viewport solves browser-window centering.

**Side-quest success check:** In headed Chromium, switch through desktop, tablet, and mobile while observing the full browser window. The app viewport and toolbar are both visibly centered in the available browser area at each preset, the toolbar remains visible and usable, and the browser window itself does not resize.

## Review and mismatch contract

When the summary opens, compare each selection's captured page URL, viewport dimensions, and scroll position with the current page state. Show a clear warning on every selection whose context differs, identifying which values changed. The capture's stored viewport remains authoritative for describing its screenshot; the warning reports current-page drift and must not relabel the saved capture.

Editing a comment updates selection metadata only. Deleting removes the selection from the session's included set. Replacing or recreating updates the included selection to a newly captured image and metadata; the previous capture must not be silently modified. The summary's included set is what Task 4 submits.

## First runnable flow

Use the real CLI and browser fixture to save at least two selections. Change the page URL, viewport, and scroll position before opening the summary. Review the mismatch warnings, edit one comment, delete one selection, and replace another capture. Verify the displayed screenshots and included set, then inspect the session data to confirm the comment and replacement metadata are correct and the original capture was not mutated.

## Acceptance criteria

- A browser integration flow saves multiple selections and opens the summary with the correct screenshots and comments.
- Every test case for Task 3 captures and retains screenshots as test artifacts; integration tests run headed and capture the visible browser state at the key review steps.
- The summary uses the browser content area even when the app is emulating mobile, and closing it restores the previous app viewport, URL, and scroll position.
- The review workspace stays centered in the browser content area when the app is emulating mobile.
- The summary reports URL, viewport-dimension, and scroll-position mismatches for each affected selection, using page state recorded before review opens and retaining each capture's original viewport metadata.
- Editing a comment persists to the selection metadata without changing its screenshot or capture context.
- Deleting a selection removes it from the included set; replacing/recreating one produces a new capture with the intended rectangle or strokes.
- The summary shows the final included set that Task 4 will submit.
- Integration coverage exercises the real CLI, Chromium, capture artifacts, and summary flow; unit tests alone do not complete this task.

## Out of scope

Submitting or discarding a session, collecting diagnostics, sampled recording, and credential redaction. These are handled by later tasks.
