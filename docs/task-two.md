# Task 2 RFC: Annotate and save a selection

**Status:** Proposed  
**Scope:** A user marks a live app page and saves one durable capture.

## Goal

Let the user select a region, explain it with a comment, optionally sketch on it, and save a screenshot that an agent can inspect. The screenshot and capture context are immutable; the comment remains editable metadata.

## Mental model

The page stays visible and undimmed. App mode leaves the page fully usable. Annotate mode temporarily takes input for drawing; it does not change the selected viewport. Capture freezes the page image and annotation at the current URL, scroll position, and viewport, then a shared capture modal collects the comment before save.

```text
Live page + active viewport
  └─ Annotate: rectangle + optional strokes
       ├─ Edit: undo / redo / clear / cancel
       └─ Capture → comment modal → Save immutable screenshot + metadata
```

## User flow

1. Enter annotate mode and draw one rectangle around the issue; optionally sketch within it.
2. Undo, redo, or clear strokes; cancel the selection if needed.
3. Capture the selection to open the shared capture modal.
4. Add a comment and save, or cancel. The user can then return to app mode and continue using the page.

## Design direction

Take interaction and visual cues from Excalidraw: a compact floating tool palette, clear active-tool state, quick access to undo/redo, and a restrained neutral canvas with a small, vivid annotation palette. Keep controls easy to scan and the page itself visually dominant. Use playful, hand-drawn character in the annotation marks; keep comments and controls highly readable. Treat Excalidraw as inspiration for layout, typography, and color, not as a pixel-for-pixel template.

## Capture contract

- Rectangle coordinates are viewport CSS pixels, ordered top-left, top-right, bottom-right, bottom-left. The captured viewport is copied from the active UI viewport at save time.
- The screenshot represents the page at save time and includes a deterministic selection marker and pen strokes. It excludes all Point and Tell controls and the page is not dimmed.
- The capture modal asks for a comment before saving. The comment is editable metadata; editing it later does not change the saved screenshot.
- Save records the page URL, viewport, scroll position, creation time, and screenshot path with the selection.
- Later page changes, viewport changes, or navigation do not alter the saved screenshot or its capture metadata.

### Selection data shape

```ts
type Point = { x: number; y: number }; // viewport CSS pixels
type Coordinates = [Point, Point, Point, Point]; // TL, TR, BR, BL

type Selection = {
  selectionId: string;
  comment: string;
  coordinates: Coordinates;
  viewport: ViewportSpec; // preset/custom identity and dimensions at capture
  scroll: { x: number; y: number };
  page: { url: string };
  createdAt: string;
  imagePath: string;
};
```

The screenshot is the source of truth for marker and stroke appearance. The saved image must be independently readable from `imagePath`; image bytes are not embedded in the selection metadata.

## First runnable flow

Run the real CLI against the browser fixture. Switch the viewport in the Point and Tell UI, annotate and save a selection, switch to another viewport, then save a second selection. Inspect both images and metadata, change the page, and confirm the saved captures remain unchanged.

## Acceptance criteria

- A Playwright integration flow draws a rectangle, adds strokes, undoes and redoes a stroke, captures, enters a comment in the shared modal, and saves the selection.
- The saved screenshot shows the fixture page, rectangle marker, and strokes, with no Point and Tell controls or dimming; the screenshot can be opened from its `imagePath`.
- Returned metadata matches the rectangle in viewport CSS pixels and includes the viewport active at save time, scroll position, page URL, timestamp, comment, selection ID, and image path.
- A second selection saved after switching viewport carries the new viewport; the first selection's image and metadata remain unchanged.
- App mode allows normal page interaction. Annotate mode captures drawing input without dimming the page; cancel discards an unsaved selection, and clear removes strokes without removing the rectangle or comment.
- Integration coverage runs the real CLI and Chromium against the fixture. Unit tests alone do not complete the task.

## Out of scope

Session summary, editing a saved comment, deleting a saved selection, submission, session diagnostics, and sampled recording. These consume saved selections in later tasks.

When the user opens the summary, Task 3 compares the current URL, viewport, and scroll position with each saved capture and warns about mismatches. Task 2 records those capture values so Task 3 can make that comparison.
