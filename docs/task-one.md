# Task 1 RFC: UI viewport and CLI session foundation

**Status:** Proposed  
**Scope:** First runnable Point and Tell flow

## Goal

Launch Point and Tell against a real app in Chromium, establish a session identity, and let the user choose and switch the page viewport in the UI. Chromium uses a dedicated persistent profile reused across launches. This slice establishes the CLI, browser, profile, and viewport contracts before selection capture is built.

## Mental model

Point and Tell launches or attaches to Chromium with a dedicated profile that retains browser state across launches. There is one running session, attached to one page, with one active viewport at a time. The user selects and changes that viewport in the Point and Tell UI, freely switching between desktop, tablet, and mobile (and custom dimensions). The viewport describes the page's emulated content area in CSS pixels; it does not describe the outer browser window. A later selection copies the viewport active at capture time into its own immutable metadata.

```text
CLI invocation
  └─ Chromium (dedicated persistent profile)
       └─ Session (sessionRef)
            └─ UI viewport selector ──> active viewport
                 └─ Real app page (URL, emulated CSS-pixel dimensions)
                      └─ Capture stores viewport active at capture time
```

## CLI contract

Proposed initial invocation:

```text
pnt-ui <url> \
  --harness <name> \
  --chat-title <title> \
  [--session-id <id>]
```

After launch, the Point and Tell UI exposes the viewport selector. `--session-id` is optional; if omitted, Point and Tell generates a unique ID. The command spawns or attaches to Chromium using its dedicated persistent profile, loads the URL, and keeps the session active through page refresh and navigation. Later launches reuse that profile so browser state, including app authentication, remains available.

The CLI help must describe the URL, required harness and chat title, and optional session ID. The UI must expose viewport selection and available presets. `pnt-ui` follows the invocation already named in the README; the option names above are proposed for adoption.

## UI viewport contract

The user selects the active viewport in the Point and Tell UI and can switch freely between presets while the session is open. Each selection captures the viewport active at that moment. All dimensions are integer CSS pixels for the emulated page viewport, excluding browser chrome. Preset dimensions below are proposed initial values and must be treated as named, stable values once adopted:

| Preset | Width | Height |
|---|---:|---:|
| `desktop` | 1440 | 900 |
| `tablet` | 768 | 1024 |
| `mobile` | 390 | 844 |

Custom form is `WIDTHxHEIGHT`, for example `1280x720`; both dimensions must be positive integers. Device scale factor is 1 for this slice so CSS-pixel dimensions map predictably to screenshots. The emulation resizes the page inside Chrome, not the browser window.

### Data shape

```ts
type ViewportSpec = {
  preset: "desktop" | "tablet" | "mobile" | "custom";
  width: number;  // CSS pixels
  height: number; // CSS pixels
};

type SessionContext = {
  harness: string;
  chatTitle: string;
  sessionId: string;
  sessionRef: string;
};

type CaptureViewport = ViewportSpec; // immutable copy stored with each capture
```

For custom dimensions, `preset` is `custom`. A session ref is the filesystem-safe scope key assembled from harness, chat title, and session ID, in that order, separated by `__` (for example, `kilo__checkout-bug__abc123`). The same ref scopes session operations and artifacts. Slug normalization must be deterministic; distinct inputs that normalize to the same ref must be rejected rather than silently sharing a session.

The active viewport is UI/session state. Each capture copies it into `CaptureViewport`; review must use that stored value and must not infer the screenshot's viewport from the page size when the summary is opened. A session may therefore contain captures with different viewport values.

## First runnable flow

Run the CLI against a real app URL. Verify that the app is visible and usable in the spawned Chromium window. In the UI, select each named preset and one custom size in turn; verify that the app observes each change. Use the app normally, refresh it, and navigate while the session remains active. Close the session and launch Point and Tell again; verify that it reuses the same Chromium profile and the app's saved/authenticated state. Verify that a second session remains independently addressable by its session ref.

## Acceptance criteria

- CLI invocation and help expose the URL, required harness and chat title, and optional session ID; the launched UI provides viewport selection.
- Point and Tell spawns or attaches to Chromium and displays the requested real app, which remains interactive in app mode.
- A later Point and Tell launch reuses the same dedicated persistent profile, preserving app cookies and browser state.
- The UI exposes all named presets and custom dimensions; selecting a viewport changes the exact emulated CSS-pixel dimensions, and switching remains available throughout the session.
- If docked Chromium DevTools changes the page's actual viewport from the selected viewport, Point and Tell shows a warning and still lets the user inspect and continue.
- The UI exposes the active viewport before any selection exists; each later capture can retain its own viewport value.
- Session ref generation is filesystem-safe, deterministic for provided inputs, unique when the session ID is generated, and isolated across sessions.
- The page is usable in app mode, and refresh/navigation do not lose the open session.
- Integration coverage exercises the real CLI, spawned or attached Chromium, real app page, reused profile across launches, viewport UI, and session context. Unit tests alone do not satisfy this task.

## Out of scope

Selection drawing or screenshots, annotation UI, summary/review, submission, recording, credential redaction, and the agent skill. Those slices consume the CLI, session identity, and UI viewport contract established here.
