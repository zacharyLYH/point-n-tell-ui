import { useEffect, useState } from 'react';
import { Layers2, Loader2, MousePointer2, Video } from 'lucide-react';
import { AnnotationCanvas } from './AnnotationCanvas.js';
import { AnnotationTools } from './AnnotationTools.js';
import { CommentDialog } from './CommentDialog.js';
import { IconButton } from './IconButton.js';
import { Review } from './Review.js';
import { apiRequest, errorMessage, sendJson, useAction } from './api.js';
import { useAnnotation } from './useAnnotation.js';
import { ViewportControls } from './ViewportControls.js';
import type {
  CaptureResult,
  ReviewContext,
  Selection,
  SessionState,
  ViewportPreset,
} from '../types.js';
import { Alert } from '../components/ui/alert.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader } from '../components/ui/card.js';
import { Separator } from '../components/ui/separator.js';

type ReviewSession = { state: SessionState; context: ReviewContext };
type ActivePhase = 'starting' | 'recording' | 'stopping';

/** Elapsed recording time. */
function Elapsed({ since }: { since: number }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const update = () => setSeconds(Math.floor((Date.now() - since) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  return (
    <span role="status" aria-label="Recording in progress">
      {`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
    </span>
  );
}

function RecordingBar({
  since,
  phase,
  onStop,
}: {
  since: number;
  phase: ActivePhase;
  onStop: () => void;
}) {
  return (
    <div
      data-pnt-recording-tab
      role="region"
      aria-label="Recording controls"
      data-state={phase}
      className="pointer-events-auto fixed inset-x-0 top-0 z-10 flex h-16 items-center justify-center gap-3 border-b-2 border-destructive/40 bg-red-50"
    >
      <div
        tabIndex={0}
        className="group flex items-center gap-2 rounded-full border border-destructive/40 bg-card py-1 pr-1 pl-3 text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1.5 font-semibold tracking-wide text-destructive uppercase">
          <span aria-hidden="true" className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
          </span>
          Rec
        </span>
        <Elapsed since={since} />
        {phase === 'recording' ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            aria-label="Stop recording"
            className="hidden h-6 rounded-full px-2.5 group-focus-within:flex group-hover:flex"
            onClick={onStop}
          >
            Stop
          </Button>
        ) : (
          <span className="pr-1.5 text-[11px] text-muted-foreground">
            {phase === 'stopping' ? 'Stopping…' : 'Starting…'}
          </span>
        )}
      </div>
    </div>
  );
}

export function Overlay({ apiUrl }: { apiUrl: string }) {
  const [state, setState] = useState<SessionState>();
  const [annotating, setAnnotating] = useState(false);
  const [replaceId, setReplaceId] = useState<string>();
  const [selection, setSelection] = useState<Selection>();
  const [reviewContext, setReviewContext] = useState<ReviewContext>();
  const [actualViewport, setActualViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const { busy, error, setError, run } = useAction();
  const annotation = useAnnotation();
  const { state: annotationState, dispatch, coordinates } = annotation;

  const recording = state?.recording ?? { phase: 'idle' };
  const phase = recording.phase;
  const draft = recording.phase === 'draft' ? recording.recording : undefined;
  const active =
    recording.phase === 'starting' ||
    recording.phase === 'recording' ||
    recording.phase === 'stopping'
      ? recording
      : undefined;
  const processing = phase === 'stopped' || phase === 'processing';

  const syncViewport = () =>
    setActualViewport({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<SessionState>(`${apiUrl}/state`, { signal: controller.signal })
      .then(setState)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(reason));
        }
      });
    return () => controller.abort();
  }, [apiUrl, setError]);

  // Polling catches viewport overrides (e.g. docked DevTools) that fire no resize event.
  useEffect(() => {
    syncViewport();
    window.addEventListener('resize', syncViewport);
    const timer = window.setInterval(syncViewport, 1000);
    return () => {
      window.removeEventListener('resize', syncViewport);
      window.clearInterval(timer);
    };
  }, []);

  // A refreshed client rejoins transitions it did not initiate (e.g. processing).
  useEffect(() => {
    if (phase !== 'starting' && phase !== 'stopping' && phase !== 'processing') return;
    const timer = window.setInterval(() => {
      apiRequest<SessionState>(`${apiUrl}/state`)
        .then(setState)
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [apiUrl, phase]);

  // `stopped` is the only safe boundary for FFmpeg: CDP is already closed.
  useEffect(() => {
    if (phase !== 'stopped') return;
    void run(async () => {
      try {
        setState((await sendJson<CaptureResult>(`${apiUrl}/recording/process`)).state);
      } catch (reason) {
        setState(await apiRequest<SessionState>(`${apiUrl}/state`));
        throw reason;
      }
    });
  }, [phase]);

  const request = (path: string, body?: unknown) =>
    sendJson<SessionState>(`${apiUrl}${path}`, body);

  const reset = () => {
    dispatch({ type: 'reset' });
    setReplaceId(undefined);
    setError(undefined);
    setAnnotating(false);
  };

  const send = (path: string, body?: unknown) =>
    run(async () => {
      setState(await request(path, body));
    });

  const applyViewport = async (preset: ViewportPreset, width: number, height: number) => {
    await send('/viewport', { preset, width, height });
    syncViewport();
  };

  // Capture first, comment after: the CLI writes the image and opens the
  // capture dialog with the pending capture.
  const captureSelection = () => {
    if (!coordinates) return;
    void run(async () => {
      const captured = await sendJson<CaptureResult>(`${apiUrl}/selection`, {
        coordinates,
        replaceId,
      });
      setState(captured.state);
      setSelection(captured.draft.kind === 'selection' ? captured.draft.selection : undefined);
      reset();
    });
  };

  const startRecording = () => void send('/recording/start');
  const stopRecording = () => void send('/recording/stop');

  const openReview = () => {
    void run(async () => {
      const opened = await sendJson<ReviewSession>(`${apiUrl}/review/open`);
      setState(opened.state);
      setReviewContext(opened.context);
    });
  };

  const closeReview = () =>
    void send('/review/close').then(() => {
      setReviewContext(undefined);
      syncViewport();
    });

  // Re-capture in the viewport and scroll the selection was taken in, so the
  // seeded rectangle is not positioned against the current viewport.
  const replaceSelection = (target: Selection) => {
    void run(async () => {
      setReviewContext(undefined);
      setState(await request('/review/close'));
      setState(await request('/viewport', target.viewport));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      window.scrollTo(target.scroll.x, target.scroll.y);
      syncViewport();
      setReplaceId(target.selectionId);
      dispatch({ type: 'seed', coordinates: target.coordinates });
      setAnnotating(true);
    });
  };

  if (state && reviewContext) {
    return (
      <Review
        apiUrl={apiUrl}
        state={state}
        context={reviewContext}
        onClose={closeReview}
        onReplace={replaceSelection}
      />
    );
  }

  const count = (state?.selections.length ?? 0) + (state?.recordings.length ?? 0);
  const viewport = state?.viewport;
  const mismatch =
    viewport && (actualViewport.width !== viewport.width || actualViewport.height !== viewport.height);

  return (
    <>
      {annotating && phase === 'idle' && (
        <AnnotationCanvas annotation={annotation} selectionNumber={count + 1} />
      )}

      {processing && (
        <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-background">
          <Card
            role="status"
            aria-live="polite"
            aria-label="Processing recording with FFmpeg"
            className="items-center gap-3 p-6 text-center"
          >
            <Loader2 aria-hidden="true" className="size-6 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">Processing recording</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                FFmpeg is generating the cut images. The app is blocked until they are ready.
              </p>
            </div>
          </Card>
        </div>
      )}

      {active ? (
        <RecordingBar
          phase={active.phase}
          since={Date.parse(active.startedAt)}
          onStop={stopRecording}
        />
      ) : phase === 'idle' && !selection ? (
        <div className="pnt-toolbar-anchor">
          <Card
            id="pnt-controls"
            role="region"
            aria-label="Point and Tell toolbar"
            className="pnt-toolbar pointer-events-auto font-sans text-card-foreground"
          >
            <CardHeader className="pnt-toolbar-content">
              <ViewportControls viewport={viewport} busy={busy} onApply={applyViewport} />
              <Separator orientation="vertical" className="h-7 shrink-0" />
              {annotating ? (
                <AnnotationTools
                  state={annotationState}
                  busy={busy}
                  dispatch={dispatch}
                  onCancel={reset}
                  onSave={captureSelection}
                />
              ) : (
                <>
                  <IconButton
                    content="Review saved captures"
                    label="Open session summary"
                    variant="secondary"
                    disabled={busy || !count}
                    onClick={openReview}
                    className="gap-1"
                  >
                    <Layers2 aria-hidden="true" />
                    <span role="status" aria-label={`${count} saved captures`} className="text-[10px]">
                      {count}
                    </span>
                  </IconButton>
                  <IconButton
                    content="Annotate"
                    label="Start annotation"
                    onClick={() => {
                      reset();
                      setAnnotating(true);
                    }}
                  >
                    <MousePointer2 aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    content="Record the viewport"
                    label="Start recording"
                    variant="secondary"
                    disabled={busy}
                    onClick={startRecording}
                  >
                    <Video aria-hidden="true" />
                  </IconButton>
                </>
              )}
            </CardHeader>

            {(mismatch || error) && (
              <CardContent className="space-y-2 border-t p-2">
                {mismatch && viewport && (
                  <Alert variant="warning" role="status">
                    <strong className="font-semibold">Viewport mismatch.</strong> Page reports {actualViewport.width} ×{' '}
                    {actualViewport.height}, selected {viewport.width} × {viewport.height}. Docked DevTools may be
                    overriding it. You can keep working.
                  </Alert>
                )}
                {error && <Alert variant="destructive">{error}</Alert>}
              </CardContent>
            )}
          </Card>
        </div>
      ) : null}

      {draft && (
        <CommentDialog
          apiUrl={apiUrl}
          draft={{ kind: 'recording', recording: draft }}
          onDone={setState}
        />
      )}

      {selection && (
        <CommentDialog
          apiUrl={apiUrl}
          draft={{ kind: 'selection', selection }}
          onDone={(next) => {
            setState(next);
            setSelection(undefined);
          }}
        />
      )}
    </>
  );
}
