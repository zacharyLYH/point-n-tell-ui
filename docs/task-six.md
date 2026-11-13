# Task 6 RFC: Record and save a video capture

**Status:** Implemented  
**Scope:** Record full-viewport app use, generate review cuts, and save the recording with a comment.

## Goal

Let the user record a real video of the app, inspect FFmpeg-generated stills, add a comment, and save one video capture containing the video and its cut images.

## Mental model

Recording captures the full app viewport. Point and Tell hides its toolbar while recording so it is not in the video. On stop, FFmpeg immediately analyzes the recording and creates cut images using pixel difference. The temporary source video is deleted when FFmpeg exits; only the cut images survive. The user sees those images one at a time in a carousel, adds a comment in the capture modal, then saves or deletes the capture.

```text
Start recording → full-viewport video → stop
  → blocking FFmpeg processing → capture modal: cut carousel + comment
  → save video capture or delete it
```

## User flow

1. Start recording from the Point and Tell controls.
2. Use the app normally. The toolbar stays hidden; hovering over a small tab reveals the stop control.
3. Stop recording. Block interaction while FFmpeg generates the cuts. Show a distinct processing state and progress where available. Delete the source video as soon as FFmpeg exits.
4. Open the shared capture modal with the video’s cut images in a carousel, a prominent comment field, and **Save** and **Delete** actions.
5. Save the video capture with its comment, or delete it. Once saved, only the comment is editable; there is no retake or cut editing.

The screenshot flow uses the same capture-to-comment modal: capture first, add or edit the comment, then save. This replaces Task 2’s inline-comment-before-save flow and requires updating the existing selection capture UI.

## Capture and data contract

- Record the complete visible app viewport at the active viewport dimensions, excluding Point and Tell controls. The recording retains the page’s normal interaction and any user drawing visible on the page.
- Always include the first and last frame as cuts, even when pixel difference is below threshold. Every click captures its own frame as a cut after a short settle; other candidates become cuts only when they differ from the previous kept cut by more than 10%.
- Store a video capture as one record with its comment, capture context, and an ordered list of cut images. Each cut has an ID/number, timestamp, image path, diff score, and applicable tags. Image bytes remain artifacts, not inline payload data.
- Keep generated images immutable after save. The source video is temporary and must not survive FFmpeg processing, whether processing succeeds or fails. Deleting the capture removes its cut artifacts; editing its comment changes metadata only.
- Include saved video captures and their cut images in the existing session submission. Never include or retain the source video.

## Recording controls and processing state

The toolbar is hidden during recording. Its reserved 64px top band becomes a recording bar: a compact REC pill with elapsed time that reveals **Stop** on hover or focus. Frames are captured full-viewport and FFmpeg crops the band, so the recording bar never appears in a cut. Because the band is chrome and never app pixels, the app is not cropped at any scroll position. During FFmpeg processing, show a distinct blocking state that prevents app and Point and Tell interaction until processing completes or fails.

## Dependency and code impact

Add **FFmpeg** as a runtime dependency for pixel-diff cut generation and preview preparation. Check availability and supported version before recording begins, provide an actionable error when unavailable, and report processing failure without silently saving an incomplete capture. Delete the temporary source video immediately after FFmpeg exits on both success and failure paths.

Extend the browser recording and screenshot capture paths, shared capture/comment modal, session and submission data types, artifact lifecycle, API, and review UI. The new video data shape must support many image artifacts per video capture. Update Task 2’s existing selection flow to use the shared capture-to-comment modal. Scope recording processes and artifacts to the session ref, and release browser capture, timers, and FFmpeg processes on stop, delete, submit, discard, cancellation, or disconnect.

## Failure cases

- Recording cannot start, produces no usable video, or stops during navigation, refresh, browser disconnect, or CLI cancellation.
- FFmpeg is missing, has an unsupported version, stalls, exits with an error, or produces invalid cuts; remove the temporary source when processing ends even on failure.
- First/last frame extraction fails; timestamps or image ordering are invalid; disk space runs out during video or image writes.
- The user stops or deletes while processing, or attempts another action during the blocking state.
- A processing failure leaves partial files; cleanup must remove orphaned artifacts and preserve unrelated saved selections and captures.

Show a clear recoverable error, release recording/processing resources, and leave the session in a consistent state. Never present a failed or partial result as saved.

## First runnable flow

Use the real CLI and fixture app to record full-viewport interaction, including visible drawing, then stop and observe the blocking FFmpeg state. Verify first and last cuts, pixel-diff cuts, carousel navigation, comment save/edit, deletion, and the submitted video record with readable artifact paths. Exercise missing FFmpeg and interrupted/failed processing. Also verify the screenshot capture modal uses the same comment-and-save flow.

## Acceptance criteria

- Recording captures the full app viewport with Point and Tell’s toolbar hidden; hovering over a small tab reveals the stop control without obstructing app use.
- Stop immediately starts FFmpeg processing and displays a distinct blocking state until success or failure.
- Every recording includes first and last cut images regardless of diff score. Clicks are forced cuts after a short settle; every other intermediate cut differs from the previous kept cut by more than 10%. Cuts are ordered by timestamp.
- The post-record capture modal shows one cut at a time in a carousel, prompts for a comment, and offers save or delete. Saved video captures have no retake or cut-edit action; comments remain editable.
- Video data stores one capture with multiple cut-image artifacts and is included in session submission without inline media bytes or a source video.
- The temporary source video is deleted when FFmpeg exits on success or failure. Cut artifacts are readable after save, removed on delete, and cleaned up with the session lifecycle. Failures do not corrupt other session artifacts.
- Screenshot selection capture uses the same capture-to-comment-and-save modal.

