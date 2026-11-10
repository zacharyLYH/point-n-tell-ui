# Side quest: center the app viewport and toolbar

## Problem

Point and Tell emulates the app viewport with Chromium CDP device metrics. The
emulated page renders in the top-left of the browser content area, leaving blank
space at the right and bottom. The toolbar is rendered inside that page, so it
also appears left-aligned and can become cramped or hidden on small presets.

The desired result is: the emulated app viewport and toolbar are visibly centered
in the browser content area at desktop, tablet, and custom sizes, without resizing
the browser window.

## Findings

The emulated viewport is the renderer's visible surface, not a positioned element
inside the browser window. Page CSS cannot move it into the unused window area.
Fixed-position toolbar elements are clipped to the same emulated viewport.

These CDP approaches were tested and do not visually reposition the page:

- `Emulation.setDeviceMetricsOverride.positionX/positionY`
- legacy `offsetX/offsetY`
- `fitWindow`
- `dontSetVisibleSize`
- `Page.Viewport` offsets supplied through device metrics
- moving or transforming the page body

Chromium paints the emulated viewport at the content area's top-left. Only the
window and the host frame determine where that surface appears.

## Constraints

- The browser window must not resize or move while switching presets.
- The app viewport and toolbar must both appear centered at every preset.
- Review must still use the full browser content area.
- App navigation, cookies, storage, input, and screenshots must keep working.
- Prefer the smallest change that preserves the existing architecture.

## Candidate solutions

### 1. Resize and center the browser window

Set the Chromium window bounds to the selected preset plus browser chrome, then
position the window in the screen center.

- Pros: small change; app, toolbar, screenshots, and review keep working.
- Cons: violates the no-window-resize requirement; window size changes per
  preset; small screens may not fit large presets; automation observing
  `outerWidth`/`outerHeight` sees the change.

### 2. Host the app in a centered iframe

Load a local host page in Chromium. Render an iframe at the emulated viewport
size, centered in the host's full content area. Expand or replace the host when
review opens.

- Pros: preserves the fixed browser window; iframe gets a real viewport and
  correct media queries; centering is ordinary CSS.
- Cons: large refactor. The Playwright app target becomes the iframe. Capture
  context, overlay injection, screenshots, navigation, cookies, review layout,
  and tests all need frame-aware handling. Apps with `X-Frame-Options` or CSP
  frame restrictions may not load.

### 3. Accept left alignment

Keep the current CDP emulation and document that the page is anchored top-left.

- Pros: no risk; minimal code.
- Cons: does not satisfy the side-quest success check; toolbar remains tied to
  the emulated canvas.

### 4. Revisit with a native browser surface

Use a Chromium surface or DevTools-equivalent device frame that can position the
page viewport inside the window. No supported CDP command currently provides
this behavior.

- Pros: could satisfy all constraints without iframe limits.
- Cons: not available with the current stack; would require a different host or
  significant browser integration.

## Recommendation

If "window does not resize" is non-negotiable, the iframe host is the only
practical path, but it is a Task-level refactor rather than a small fix. If
visual centering matters more than the no-resize rule, resize and center the
window as a short-term fallback. If neither tradeoff is acceptable now, defer
the side quest and keep the current top-left behavior.

## Acceptance checks

For the window-resize option:

- Switching desktop, tablet, and mobile keeps the app viewport and toolbar
  centered on screen.
- The toolbar remains visible and usable.
- `outerWidth`/`outerHeight` may change; document this exception.

For the iframe option:

- The browser window bounds stay constant across presets.
- The iframe is centered and matches the selected dimensions.
- Review fills the host content area and restores the iframe afterward.
- App interactions, screenshots, navigation, and cookies still work.
- Tests explicitly target the app frame rather than the host page.

## Out of scope

Changing the viewport preset definitions, review data model, or capture metadata.

## Decision: option 1

Option 1 (resize and center the browser window) is implemented. Switching
presets sizes the Chromium window to the selected preset plus the window chrome
and centers it on screen, so the emulated app viewport and the
toolbar fill the window and appear centered on screen. Opening review temporarily
expands the window so the workspace still uses the browser content area.

Accepted tradeoffs, as listed for option 1:

- The browser window resizes per preset; `outerWidth`/`outerHeight` change.
- The OS clamps windows to the area left by the menu bar and dock, so tall
  presets are cut at the bottom on short displays.
- Chrome enforces a minimum window width (about 500 px), so the 390 px mobile
  preset cannot fill its window; the window is still centered, but the page sits
  at the left edge of it.
