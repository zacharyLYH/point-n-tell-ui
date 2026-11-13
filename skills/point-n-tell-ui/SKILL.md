---
name: point-n-tell-ui
description: Launches point-n-tell-ui (pnt-ui) so a user can annotate or record a live web page, then interprets the returned screenshots, ordered recording cuts, and browser context. Use when a user wants an agent to see a visual UI bug, needs annotated screenshots or a reproduction recording, or needs console, network, cookie, and storage context from a browser. Requires a vision-capable agent and a graphical desktop.
---

# Point and Tell UI

Local CLI plus browser overlay. The user drives the browser; you get image paths and structured context.

## Before you launch

- **You must read images.** If you cannot, say so and do not fake a capture. Offer DOM/Playwright assertions, logs, or a written description instead.
- **The user needs a visible window.** Never launch a session they cannot see or draw in.

## Setup

```sh
git clone <repository-url> point-n-tell-ui
cd point-n-tell-ui && npm ci
npx playwright install chromium   # if missing
npm run build && npm link         # puts pnt-ui on PATH
```

- Node 20.11+.
- FFmpeg 4+ for recordings (`PNT_FFMPEG` to override). Screenshots work without it.
- Storage under `~/.point-n-tell-ui/` (`PNT_HOME` to relocate).

## Launch

```sh
pnt-ui http://127.0.0.1:3000 --harness claude-code --chat-title "checkout total is wrong"
```

- `--harness <name>` required; part of the session ref.
- `--chat-title <title>` required; short and specific.
- `--session-id <id>` optional.

Foreground process. Leave it running and wait for it to exit after Submit, Discard, or Ctrl+C. If it exits without a submit report, nothing was returned. Do not start a second session with the same ref while one is live.

## Coach the user

Send this when the window opens, adapted to their page:

> Point and Tell is open on `<page>`.
> 1. Pick a viewport in the top bar if the bug is size-specific.
> 2. **Annotate** (cursor icon) drags a box and saves a screenshot. **Record** (camera icon) captures a flow.
> 3. The layers icon lists captures. Open it and **Submit**; nothing reaches me until you do.
> Don't refresh while a capture dialog is open. The **?** button repeats this.

Remind at the moment it matters: a comment is required to save, and **Stop** is the button in the red recording bar.

## What the user does

1. Pick a viewport.
2. **Annotate** → drag a box → **Capture selection**.
3. **Record** → reproduce the flow → **Pen** to draw on the page → **Stop** → wait for FFmpeg.
4. Comment, then **Save capture**. X discards the pending capture.
5. Layers icon → edit comments → **Submit** or **Discard** in the session panel on the left.

## Reading the output

Two reports: a ready report (session ref, app URL, overlay URL, artifacts dir) and a submit report. The submit report has a header, then one block per capture:

```text
 type         image
 comment      Total shows $84.00; expected $75.60 after the coupon.
 selection    6f0c...
 image        .../artifacts/<sessionRef>/6f0c....webp
 page         http://127.0.0.1:3000/cart
 viewport     desktop 1440x900
 created      2026-11-13T18:22:04.120Z
```

Recording blocks replace `image` with `images` (ordered cut paths), `cuts`, and duration. The header lists the artifact paths: `console.json`, `network.json`, `localstorage.json`, `a11y.yml`.

- Read every image first. The screenshot is ground truth; the comment says what the user expected.
- `coordinates` are viewport CSS pixels, TL→TR→BR→BL. `scroll` plus `page.url` locate the rectangle.
- Recording cuts are a timeline, not separate bugs. `tags` are `first`, `last`, `click`; `diffScore` is the fraction of pixels changed from the previous kept cut. Report the earliest cut where behavior diverges.
- `a11y.yml` is the ARIA snapshot from when the user opened Review. Fastest way to name the element under a rectangle.
- Console, network, and storage are supporting evidence. Context is captured at submit time; check `capturedAt` before blaming a specific image.
- Redaction is on by default in headers, URLs, storage keys, and cookies. Bodies are not scanned. Do not ask for redaction off casually.
- No submit report means discard or cancel. Do not claim a capture exists.

## Sharp edges

- Do not refresh during a capture: the CLI keeps a pending selection the overlay loses. If it happens, restart the session.
- Recording starts instantly; FFmpeg runs only after Stop.
- The recording pen blocks page clicks until it is toggled off. Strokes are burned into the frames, not saved as data.
- A session ref names artifacts. It does not reattach to a live session.
- Discard, browser disconnect, and Ctrl+C delete unsubmitted artifacts.

## How it works

- Overlay lives in a shadow DOM and reserves a 64px top band, so app pixels are never covered or cropped.
- Cuts sample every 150ms plus one frame per click, deduped above 10% pixel change. Only cuts survive; the video is deleted.
- Screenshots are WebP, cuts are JPEG. A capture is written at capture time and deleted if the user discards it.
