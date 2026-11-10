import { useCallback, useEffect, useState } from 'react';
import { Layers2, MousePointer2 } from 'lucide-react';
import { AnnotationCanvas } from './AnnotationCanvas.js';
import { AnnotationTools } from './AnnotationTools.js';
import { Review } from './Review.js';
import { apiRequest } from './api.js';
import { useAnnotation } from './useAnnotation.js';
import { ViewportControls } from './ViewportControls.js';
import type { ReviewContext, Selection, SessionState, ViewportPreset } from '../types.js';
import { Alert } from '../components/ui/alert.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader } from '../components/ui/card.js';
import { Separator } from '../components/ui/separator.js';
import { Tooltip } from '../components/ui/tooltip.js';

export function Overlay({ apiUrl }: { apiUrl: string }) {
  const [state, setState] = useState<SessionState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [replaceId, setReplaceId] = useState<string>();
  const [review, setReview] = useState<{ state: SessionState; context: ReviewContext }>();
  const [actualViewport, setActualViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const annotation = useAnnotation();
  const {
    state: draft,
    dispatch: dispatchAnnotation,
    coordinates,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = annotation;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<SessionState>(`${apiUrl}/state`, { signal: controller.signal })
      .then(setState)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => controller.abort();
  }, [apiUrl]);

  useEffect(() => {
    const update = () => setActualViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.removeEventListener('resize', update);
      window.clearInterval(timer);
    };
  }, []);

  const applyViewport = useCallback(async (preset: ViewportPreset, width: number, height: number) => {
    setBusy(true);
    setError(undefined);
    try {
      setState(await apiRequest<SessionState>(`${apiUrl}/viewport`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preset, width, height }),
      }));
      setActualViewport({ width: window.innerWidth, height: window.innerHeight });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [apiUrl]);

  const resetAnnotation = useCallback(() => {
    dispatchAnnotation({ type: 'reset' });
    setReplaceId(undefined);
    setAnnotating(false);
  }, [dispatchAnnotation]);

  const saveSelection = useCallback(async () => {
    if (!coordinates || !draft.comment.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      setState(await apiRequest<SessionState>(`${apiUrl}/selection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: draft.comment, coordinates, replaceId }),
      }));
      resetAnnotation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [apiUrl, coordinates, draft.comment, replaceId, resetAnnotation]);

  const openReview = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const opened = await apiRequest<{ state: SessionState; context: ReviewContext }>(
        `${apiUrl}/review/open`,
        { method: 'POST' },
      );
      setState(opened.state);
      setReview(opened);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [apiUrl]);

  const closeReview = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      setState(await apiRequest<SessionState>(`${apiUrl}/review/close`, { method: 'POST' }));
      setReview(undefined);
      setActualViewport({ width: window.innerWidth, height: window.innerHeight });
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }, [apiUrl]);

  const restoreCaptureContext = useCallback(async (selection: Selection) => {
    setState(await apiRequest<SessionState>(`${apiUrl}/viewport`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(selection.viewport),
    }));
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      if (
        Math.abs(window.innerWidth - selection.viewport.width) <= 1 &&
        Math.abs(window.innerHeight - selection.viewport.height) <= 1
      ) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    window.scrollTo(selection.scroll.x, selection.scroll.y);
    setActualViewport({ width: window.innerWidth, height: window.innerHeight });
  }, [apiUrl]);

  const replaceSelection = useCallback(async (selection: Selection) => {
    if (!(await closeReview())) return;
    setBusy(true);
    setError(undefined);
    try {
      // Recreate the capture in the viewport and scroll it was taken in, so the
      // seeded rectangle is not positioned against the current viewport.
      await restoreCaptureContext(selection);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
      return;
    }
    setBusy(false);
    setReplaceId(selection.selectionId);
    dispatchAnnotation({
      type: 'seed',
      rectangle: {
        x: selection.coordinates[0].x,
        y: selection.coordinates[0].y,
        width: selection.coordinates[2].x - selection.coordinates[0].x,
        height: selection.coordinates[2].y - selection.coordinates[0].y,
      },
      comment: selection.comment,
    });
    setError(undefined);
    setAnnotating(true);
  }, [closeReview, dispatchAnnotation, restoreCaptureContext]);

  const viewport = state?.viewport;
  const mismatched = viewport && (
    actualViewport.width !== viewport.width || actualViewport.height !== viewport.height
  );
  const setComment = useCallback((comment: string) => {
    dispatchAnnotation({ type: 'comment', value: comment });
  }, [dispatchAnnotation]);

  if (review) {
    return (
      <Review
        apiUrl={apiUrl}
        state={review.state}
        context={review.context}
        onClose={() => void closeReview()}
        onReplace={(selection) => void replaceSelection(selection)}
      />
    );
  }

  return (
    <>
      {annotating && (
        <AnnotationCanvas
          state={draft}
          width={actualViewport.width}
          height={actualViewport.height}
          selectionNumber={(state?.selections.length ?? 0) + 1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}

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
              state={draft}
              busy={busy}
              onComment={setComment}
              onTool={(tool) => dispatchAnnotation({ type: 'tool', value: tool })}
              onUndo={() => dispatchAnnotation({ type: 'undo' })}
              onRedo={() => dispatchAnnotation({ type: 'redo' })}
              onClear={() => dispatchAnnotation({ type: 'clear' })}
              onCancel={resetAnnotation}
              onSave={() => void saveSelection()}
            />
          ) : (
            <>
              <Tooltip content="Review saved selections">
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  aria-label="Open session summary"
                  disabled={busy || !state?.selections.length}
                  onClick={() => void openReview()}
                  className="gap-1"
                >
                  <Layers2 aria-hidden="true" />
                  <span
                    role="status"
                    aria-label={`${state?.selections.length ?? 0} saved selections`}
                    className="text-[10px]"
                  >
                    {state?.selections.length ?? 0}
                  </span>
                </Button>
              </Tooltip>
              <Tooltip content="Annotate">
                <Button
                  type="button"
                  size="icon"
                  aria-label="Start annotation"
                  onClick={() => {
                    resetAnnotation();
                    setError(undefined);
                    setAnnotating(true);
                  }}
                >
                  <MousePointer2 aria-hidden="true" />
                </Button>
              </Tooltip>
            </>
          )}
          </CardHeader>

          {(mismatched || error) && (
            <CardContent className="space-y-2 border-t p-2">
              {mismatched && viewport && (
                <Alert variant="warning" role="status">
                  <strong className="font-semibold">Viewport mismatch.</strong> Page reports {actualViewport.width} × {actualViewport.height}, selected {viewport.width} × {viewport.height}. Docked DevTools may be overriding it. You can keep working.
                </Alert>
              )}
              {error && <Alert variant="destructive">{error}</Alert>}
            </CardContent>
          )}
        </Card>
      </div>
    </>
  );
}
