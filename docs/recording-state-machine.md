# RFC: Centralized recording state machine

**Status:** Implemented  
**Scope:** Recording capture lifecycle, from start through cuts, draft, save, delete, and cleanup.

## Problem

Recording state is spread across three independent owners:

- `src/browser.ts` owns the CDP session, sampler timer, click callback, capture queue, and pending click timers.
- `src/cli.ts` owns `active`, `stopped`, and `draft`.
- `src/overlay` owns `recording.phase`, `processing`, `capture`, and `reviewContext`.

They coordinate by call order instead of one authoritative phase. This creates races:

- `stopRecording` clears `active` before `await capture.stop()` and only sets `stopped` afterward. A `start` request can enter during that window.
- The shared `ClickRecorder` callback means a second recording can overwrite the first recording's click source.
- The UI can show the processing overlay before CDP capture has closed; a pending click frame can photograph that overlay.
- A `stopped` capture is invisible in session state. If the client disconnects before processing, the server holds frames and blocks new recordings with no recovery path.
- Pending click timers, the screenshot queue, and CDP detach have no bounded cancellation.
- Frames and cuts have several cleanup owners, so stop, process, submit, and disconnect can race.

A single controller should own the phase and all recording resources. The UI should render that phase rather than maintain a parallel lifecycle.

## Goals

- One authoritative recording phase, owned by the server-side session.
- Serialized transitions with explicit guards.
- No CDP screenshot after capture closes.
- Every click is captured, with a bounded settle wait.
- Corrupt partial work is cleaned up after any failure.
- Refresh or reconnect can observe the current recording phase.
- The UI is a projection of session state, not a second state machine.

## Non-goals

- Changing the cut-selection algorithm, pixel threshold, or 150ms cadence.
- Redesigning selection screenshots, review, comments, or submission.
- Keeping failed recordings for retry. Failures clean up and return to `idle`.

## States

```text
idle
  ↓ start
starting
  ↓ first capture ready
recording
  ↓ stop
stopping
  ↓ pending clicks settled + queue drained + CDP detached
stopped
  ↓ process
processing
  ↓ cuts written
draft
  ↓ save / delete
idle
```

`stopped` is a first-class phase: capture resources are closed, but FFmpeg has not started. It is the only safe boundary for showing the full-screen processing UI.

Failures during `starting`, `stopping`, or `processing` clean up resources and return to `idle`; the error is returned to the caller. There is no lingering `failed` phase.

## Transition table

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `start` | FFmpeg available | `starting` | Allocate recording ID and frame directory; create capture handle; set phase before awaiting |
| `starting` | capture ready | | `recording` | Start sampler and click subscription |
| `starting` | capture failed | | `idle` | Delete frame directory; dispose capture handle |
| `recording` | `stop` | | `stopping` | Stop sampler; settle pending clicks; drain screenshot queue; detach CDP |
| `stopping` | capture closed | | `stopped` | Persist immutable stopped-capture metadata |
| `stopping` | timeout / failure | | `idle` | Dispose capture handle; delete frames |
| `stopped` | `process` | | `processing` | Start FFmpeg difference and extraction work |
| `processing` | cuts ready | | `draft` | Store the recording draft |
| `processing` | failure / timeout | | `idle` | Delete cuts and frames |
| `draft` | `save` | | `idle` | Append recording to saved state |
| `draft` | `delete` | | `idle` | Delete cut artifacts |
| any | `dispose` | | `idle` | Stop active capture; delete stopped frames, cuts, and pending work |

Transitions are serialized through one queue or mutex. The phase changes before any awaited work, so concurrent events see the correct guard.

## Controller ownership

Add `RecordingController` in the CLI/session process. It must not depend on React or HTTP.

The controller owns:

- The current phase.
- One `CaptureHandle` for the active recording.
- The stopped-capture data between `stopped` and `processing`.
- The processing task and its abort/timeout state.
- Frame and cut cleanup.

`browser.ts` remains a capture adapter. A `CaptureHandle` owns one CDP session, sampler timer, screenshot queue, and click subscription. There is no shared app-level click callback: starting a capture subscribes it, and stopping or disposing it unsubscribes it.

`recording.ts` remains a pure processor: it receives frames and a destination, writes cuts, and returns metadata. It does not delete the frame directory. The controller owns that cleanup.

## Interface

```ts
type RecordingPhase =
  | { phase: 'idle' }
  | { phase: 'starting'; recordingId: string; startedAt: string }
  | { phase: 'recording'; recordingId: string; startedAt: string }
  | { phase: 'stopping'; recordingId: string; startedAt: string }
  | { phase: 'stopped'; recordingId: string; startedAt: string }
  | { phase: 'processing'; recordingId: string; startedAt: string }
  | { phase: 'draft'; recording: Recording };

type RecordingController = {
  start(): Promise<SessionState>;
  stop(): Promise<SessionState>;
  process(): Promise<CaptureResult>;
  save(comment: string): Promise<SessionState>;
  delete(): Promise<SessionState>;
  dispose(reason: string): Promise<void>;
};
```

Semantics:

- `start` rejects unless the phase is `idle`.
- `stop` during `stopping` is an idempotent no-op that returns the current state.
- `process` rejects unless the phase is `stopped`.
- `dispose` is idempotent and serialized after any in-flight transition.
- Duplicate events never create a second capture handle.

## Timeouts and cancellation

- Pending click settles get a bounded wait, for example twice the click settle interval.
- Screenshot queue drain and CDP detach get bounded waits.
- FFmpeg processing gets an explicit timeout.
- A timeout is a failure: clean up, set `idle`, and return an actionable error.
- `dispose` cancels timers and subscriptions, then performs best-effort cleanup.

## Session state and API

`SessionState.recording` carries the phase itself:

```ts
type RecordingPhase =
  | { phase: 'idle' }
  | {
      phase: 'starting' | 'recording' | 'stopping' | 'stopped' | 'processing';
      recordingId: string;
      startedAt: string;
    }
  | { phase: 'draft'; recording: Recording };
```

The UI must render from this phase. It may optimistically show `stopping` or `processing` for immediate feedback, but it must reconcile with session state and must never show processing before `stopped`.

Server routes map directly to controller events:

- `POST /recording/start`
- `POST /recording/stop`
- `POST /recording/process`
- `POST /recording/save`
- `DELETE /recording/draft`

If the client refreshes during `recording`, the overlay can show the recording bar and stop it again. If it refreshes during `stopped`, it can invoke `process` or discard the capture. If it refreshes during `processing`, it can show the processing state and wait for the draft.

## UI projection

Replace the independent `recording`, `processing`, `capture`, and review flags with a single phase switch:

- `starting`: recording bar with `Starting…`.
- `recording`: recording bar with Stop.
- `stopping`: recording bar with `Stopping…`; the bar stays in the cropped 64px band.
- `stopped`: keep the bar or show a brief transition; call `process`.
- `processing`: full-screen blocking state; CDP is already closed.
- `draft`: comment dialog.
- `idle`: toolbar.

## Invariants

- At most one `CaptureHandle` exists.
- No CDP capture or click subscription survives leaving `recording`.
- No screenshot is possible in `stopped`, `processing`, or `draft`.
- The processing overlay cannot appear in a cut.
- Every frame directory has exactly one cleanup owner: the controller.
- All transitions are serialized and guarded by phase.
- Every saved cut belongs to exactly one draft or saved recording.
- A failure leaves no partial draft, frames, cuts, or active timers.
- Refresh or reconnect can reconstruct the current phase from session state.

## Migration plan

1. Introduce `RecordingController` and the phase type behind the existing endpoints.
2. Add `SessionState.recording` and make the overlay render it.
3. Make `start`/`stop` set the phase before awaiting capture or processing.
4. Move click subscription into the per-recording capture handle and remove the shared `ClickRecorder` callback.
5. Move frame-directory cleanup out of `generateCuts` into the controller.
6. Add timeout and dispose behavior.
7. Delete `active`, `stopped`, and the overlay's separate processing state once the controller is authoritative.

## Test plan

Controller tests with fake capture and processor:

- Start during `stopping` is rejected.
- Stop during `starting` is rejected or queued according to the transition table.
- Duplicate stop is idempotent.
- Pending clicks settle before `stopped`.
- No capture call occurs after `stopping` begins.
- Process failure deletes cuts and frames.
- Dispose during stopping, stopped, and processing leaves no artifacts.
- Timeouts return to `idle`.

Integration tests:

- Click immediately before stop; no cut contains the processing overlay.
- Refresh mid-recording restores the recording phase and Stop still works.
- Disconnect after stop cleans up stopped frames.
- Processing overlay appears only after CDP has closed.
- Submit and discard during stopping or stopped leave no artifacts.
