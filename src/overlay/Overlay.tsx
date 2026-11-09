import { useCallback, useEffect, useState } from 'react';
import { Layers2, MousePointer2 } from 'lucide-react';
import { AnnotationCanvas } from './AnnotationCanvas.js';
import { AnnotationTools } from './AnnotationTools.js';
import { useAnnotation } from './useAnnotation.js';
import { ViewportControls } from './ViewportControls.js';
import type { SessionState, ViewportPreset } from '../types.js';
import { Alert } from '../components/ui/alert.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader } from '../components/ui/card.js';
import { Separator } from '../components/ui/separator.js';
import { Tooltip } from '../components/ui/tooltip.js';

async function readSession(response: Response): Promise<SessionState> {
  const body = (await response.json()) as SessionState | { error?: string };
  if (!response.ok) {
    throw new Error('error' in body ? body.error : `Request failed (${response.status})`);
  }
  return body as SessionState;
}

export function Overlay({ apiUrl }: { apiUrl: string }) {
  const [state, setState] = useState<SessionState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [annotating, setAnnotating] = useState(false);
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
    fetch(`${apiUrl}/state`, { signal: controller.signal })
      .then(readSession)
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
      const response = await fetch(`${apiUrl}/viewport`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preset, width, height }),
      });
      setState(await readSession(response));
      setActualViewport({ width: window.innerWidth, height: window.innerHeight });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [apiUrl]);

  const resetAnnotation = useCallback(() => {
    dispatchAnnotation({ type: 'reset' });
    setAnnotating(false);
  }, [dispatchAnnotation]);

  const saveSelection = useCallback(async () => {
    if (!coordinates || !draft.comment.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${apiUrl}/selection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: draft.comment, coordinates }),
      });
      setState(await readSession(response));
      resetAnnotation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [apiUrl, coordinates, draft.comment, resetAnnotation]);

  const viewport = state?.viewport;
  const mismatched = viewport && (
    actualViewport.width !== viewport.width || actualViewport.height !== viewport.height
  );
  const setComment = useCallback((comment: string) => {
    dispatchAnnotation({ type: 'comment', value: comment });
  }, [dispatchAnnotation]);

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
              <Tooltip content="Saved selections">
                <Badge
                  variant="secondary"
                  role="status"
                  aria-label={`${state?.selections.length ?? 0} saved selections`}
                  className="flex size-9 shrink-0 items-center justify-center gap-1 p-1"
                >
                  <Layers2 aria-hidden="true" />
                  <span className="text-[10px]">{state?.selections.length ?? 0}</span>
                </Badge>
              </Tooltip>
              <Tooltip content="Annotate">
                <Button
                  type="button"
                  size="icon"
                  aria-label="Start annotation"
                  onClick={() => {
                    dispatchAnnotation({ type: 'reset' });
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
