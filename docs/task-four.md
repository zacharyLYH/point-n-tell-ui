# Task 4 RFC: Submit or discard a session

**Status:** Proposed

**Scope:** Finish a reviewed session and return or remove its artifacts. Includes session context collection and credential redaction pulled forward from Task 5.

## Goal

Submit the reviewed selections and session context as one manifest printed to the CLI, or explicitly discard the session and its artifacts.

## Mental model

Submission freezes the included set from the summary and collects the session context at submit time into a manifest printed to the CLI. Referenced images remain available until one-month cleanup. Discard returns no payload and deletes the session directory.

```text
Session summary
  ├─ Submit: included selections + session context → manifest on CLI; images retained; session closes
  └─ Discard: no payload; session artifacts deleted
```

## User flow

1. Review selections and session data in the summary.
2. Submit the included set with the **Redact credentials** toggle (on by default), or choose **Discard** and confirm the destructive action.
3. On submit, print the manifest and context to the CLI, then end the session and close the browser. On discard, delete the artifacts and close the session.
4. Browser disconnect and CLI cancellation end an open session without submitting and delete its unsubmitted artifacts. Submitted artifacts survive later disconnect or cancellation.
5. A hard kill or crash may leave artifacts behind; the next CLI invocation removes session directories older than one month.

## Submission contract

- Print the manifest as JSON to CLI stdout in `PNT_MACHINE=1` mode. Do not persist a manifest file; images plus `console.json`, `network.json`, and `localstorage.json` stay in the session directory.
- Include the session ref, session metadata (`harness`, `chatTitle`, `sessionId`, `sessionRef`), machine metadata (`hostname`, `platform`, `arch`, `node`), `appUrl`, `submittedAt`, and `redactCredentials`.
- Include every still-included selection's full metadata and `imagePath`. Keep screenshots and sampled frame images as files; the manifest references paths rather than embedding image bytes.
- Collect session context at submit time: console errors/warnings, timestamped XHR/fetch requests and responses, an ARIA accessibility snapshot, origin `localStorage`/`sessionStorage`, cookies, IndexedDB database names, and session diagnostics. Static assets and bundles are excluded.
- Redact recognized credentials by default in headers, cookies, storage keys, and URL query parameters. Request and response bodies are not scanned for credentials; credentials placed only in bodies may remain visible.
- Recording data is not collected in this task; `frameIndex` is an empty array until Task 6.
- Return the session ref, selection IDs and count, image paths, artifact directory, context artifact paths (`console.json`, `network.json`, `localstorage.json`), frame index, context, and a retrieval command that lists the artifact directory.
- Reject submission when no selections remain included. A submitted session is final: mutating selections after submit is rejected.
- Submitted image artifacts remain readable until the one-month retention cleanup. Discarded session artifacts are deleted and produce no agent payload.
- Submission is scoped to an explicit session ref. Only selections still included in the summary are submitted.

## Lifecycle

| Outcome | Agent payload | Session artifacts |
|---|---|---|
| **Submit** | Manifest on CLI stdout | Images kept until one-month expiry |
| **Discard** | None | Deleted |
| **Browser disconnect / CLI cancel** | None | Deleted unless already submitted |
| **Hard kill / crash** | None | May remain until age-based cleanup |

Cleanup runs on CLI invocation. It removes session directories whose last-modified time is older than one month, including old submitted sessions.

## First runnable flow

Use the real CLI-to-API flow with the browser fixture. Submit a reviewed session and inspect the manifest printed by the CLI, its context, and referenced images. In a separate session, discard and verify there is no payload and the session artifacts are removed. Exercise cancellation, browser disconnect, and crash cleanup as separate lifecycle cases.

## Acceptance criteria

- A CLI-to-API integration flow submits a session and receives the documented manifest on CLI stdout with session ref, machine/session metadata, selection IDs and count, image paths, frame index, context, and a retrieval command.
- The submitted manifest includes only selections still included after review; referenced images remain readable after submission.
- Session context contains console errors/warnings, app API requests/responses, an accessibility snapshot, and origin storage; static assets and bundles are excluded.
- With redaction enabled, recognized credentials in headers, cookies, storage, and URLs are redacted, while credentials placed only in request or response bodies remain visible. Turning the toggle off changes the submitted values.
- Discard returns no agent payload and deletes the session's artifacts.
- Browser disconnect and CLI cancellation return no payload and delete unsubmitted session artifacts; submitted artifacts remain.
- A hard-kill/crash fixture verifies that leftover artifacts are removed by the documented age-based cleanup, which runs on CLI invocation.

## Out of scope

Sampled interaction capture and timeline review (Task 6), and concurrent-session recovery (Task 7).
