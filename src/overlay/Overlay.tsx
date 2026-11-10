import { useEffect, useState } from 'react';
import { Layers2, MousePointer2 } from 'lucide-react';
import { AnnotationCanvas } from './AnnotationCanvas.js';
import { AnnotationTools } from './AnnotationTools.js';
import { IconButton } from './IconButton.js';
import { Review } from './Review.js';
import { apiRequest, errorMessage, sendJson, useAction } from './api.js';
import { useAnnotation } from './useAnnotation.js';
import { ViewportControls } from './ViewportControls.js';
import type { ReviewContext, Selection, SessionState, ViewportPreset } from '../types.js';
import { Alert } from '../components/ui/alert.js';
import { Card, CardContent, CardHeader } from '../components/ui/card.js';
import { Separator } from '../components/ui/separator.js';

type ReviewSession = { state: SessionState; context: ReviewContext };

export function Overlay({ apiUrl }: { apiUrl: string }) {
  const [state, setState] = useState<SessionState>();
  const [annotating, setAnnotating] = useState(false);
  const [replaceId, setReplaceId] = useState<string>();
  const [review, setReview] = useState<ReviewSession>();
  const [actualViewport, setActualViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const { busy, error, setError, run } = useAction();
  const annotation = useAnnotation();
  const { state: draft, dispatch, coordinates } = annotation;

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

  const reset = () => {
    dispatch({ type: 'reset' });
    setReplaceId(undefined);
    setError(undefined);
    setAnnotating(false);
  };

  const applyViewport = (preset: ViewportPreset, width: number, height: number) => {
    void run(async () => {
      setState(await sendJson(`${apiUrl}/viewport`, { preset, width, height }));
      syncViewport();
    });
  };

  const saveSelection = () => {
    if (!coordinates || !draft.comment.trim()) {
      return;
    }
    void run(async () => {
      setState(
        await sendJson(`${apiUrl}/selection`, {
          comment: draft.comment,
          coordinates,
          replaceId,
        }),
      );
      reset();
    });
  };

  const openReview = () => {
    void run(async () => {
      const opened = await sendJson<ReviewSession>(`${apiUrl}/review/open`);
      setState(opened.state);
      setReview(opened);
    });
  };

  const closeReview = () => {
    void run(async () => {
      setState(await sendJson(`${apiUrl}/review/close`));
      setReview(undefined);
      syncViewport();
    });
  };

  // Re-capture in the viewport and scroll the selection was taken in, so the
  // seeded rectangle is not positioned against the current viewport.
  const replaceSelection = (selection: Selection) => {
    void run(async () => {
      setState(await sendJson(`${apiUrl}/review/close`));
      setReview(undefined);
      setState(await sendJson(`${apiUrl}/viewport`, selection.viewport));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      window.scrollTo(selection.scroll.x, selection.scroll.y);
      syncViewport();
      setReplaceId(selection.selectionId);
      dispatch({ type: 'seed', coordinates: selection.coordinates, comment: selection.comment });
      setAnnotating(true);
    });
  };

  if (review) {
    return (
      <Review
        apiUrl={apiUrl}
        state={review.state}
        context={review.context}
        onClose={closeReview}
        onReplace={replaceSelection}
      />
    );
  }

  const count = state?.selections.length ?? 0;
  const viewport = state?.viewport;
  const mismatch =
    viewport && (actualViewport.width !== viewport.width || actualViewport.height !== viewport.height);

  return (
    <>
      {annotating && (
        <AnnotationCanvas annotation={annotation} selectionNumber={count + 1} />
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
                dispatch={dispatch}
                onCancel={reset}
                onSave={saveSelection}
              />
            ) : (
              <>
                <IconButton
                  content="Review saved selections"
                  label="Open session summary"
                  variant="secondary"
                  disabled={busy || !count}
                  onClick={openReview}
                  className="gap-1"
                >
                  <Layers2 aria-hidden="true" />
                  <span role="status" aria-label={`${count} saved selections`} className="text-[10px]">
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
    </>
  );
}
