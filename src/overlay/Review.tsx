import { useEffect, useRef, useState } from 'react';
import { Camera, PencilLine, Trash2 } from 'lucide-react';
import type { ReviewContext, Selection, SessionState } from '../types.js';
import { apiRequest } from './api.js';
import { Alert } from '../components/ui/alert.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js';
import { Label } from '../components/ui/label.js';
import { Separator } from '../components/ui/separator.js';
import { Textarea } from '../components/ui/textarea.js';
import { cn } from '../lib/utils.js';

// A capture is judged against the viewport it was taken in, not the app's
// current one: switching presets is how the user captures a page, so a capture
// made at another preset is still faithful to its context. Only page-level
// drift (URL or scroll) invalidates it.
function changedValues(selection: Selection, context: ReviewContext): string[] {
  const changes: string[] = [];
  if (selection.page.url !== context.url) changes.push('URL');
  if (selection.scroll.x !== context.scroll.x || selection.scroll.y !== context.scroll.y) {
    changes.push('scroll position');
  }
  return changes;
}

export function Review({
  apiUrl,
  state: initial,
  context,
  onClose,
  onReplace,
}: {
  apiUrl: string;
  state: SessionState;
  context: ReviewContext;
  onClose: () => void;
  onReplace: (selection: Selection) => void;
}) {
  const [state, setState] = useState(initial);
  const [selectedId, setSelectedId] = useState(initial.selections[0]?.selectionId);
  const [draft, setDraft] = useState(initial.selections[0]?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const selected = state.selections.find((item) => item.selectionId === selectedId);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!state.selections.some((item) => item.selectionId === selectedId)) {
      setSelectedId(state.selections[0]?.selectionId);
    }
  }, [state.selections, selectedId]);

  useEffect(() => {
    setDraft(selected?.comment ?? '');
  }, [selected?.selectionId]);

  const run = async (path: string, init: RequestInit): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      setState(await apiRequest<SessionState>(`${apiUrl}${path}`, init));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const moveSelection = (delta: number): void => {
    const index = state.selections.findIndex((item) => item.selectionId === selectedId);
    const next = state.selections[index + delta];
    if (!next) {
      return;
    }
    setSelectedId(next.selectionId);
    const nav = navRef.current;
    if (nav?.contains(document.activeElement)) {
      requestAnimationFrame(() => {
        nav.querySelector<HTMLButtonElement>(`[data-selection-id="${next.selectionId}"]`)?.focus();
      });
    }
  };

  const changes = selected ? changedValues(selected, context) : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showClose={false}
        className="flex h-[calc(100dvh-1rem)] w-full max-w-7xl flex-col gap-0 overflow-hidden rounded-xl p-0 font-sans text-foreground sm:h-[calc(100dvh-2rem)]"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
            return;
          }
          if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) {
            return;
          }
          event.preventDefault();
          moveSelection(event.key === 'ArrowDown' ? 1 : -1);
        }}
      >
        <DialogTitle className="sr-only">Session summary</DialogTitle>
        <DialogDescription className="sr-only">Review saved selections before submitting.</DialogDescription>
        <header className="flex items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{state.session.chatTitle}</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {state.selections.length} included · {state.session.sessionRef}
            </p>
          </div>
          <Button type="button" size="sm" onClick={onClose}>
            Done
          </Button>
        </header>
        <Separator />

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)_minmax(16rem,20rem)] lg:overflow-hidden">
          <nav
            ref={navRef}
            aria-label="Saved selections"
            className="flex flex-col gap-1 border-b p-2 lg:overflow-y-auto lg:border-b-0 lg:border-r"
          >
            {state.selections.map((item, index) => {
              const itemChanges = changedValues(item, context);
              return (
                <Button
                  key={item.selectionId}
                  type="button"
                  data-selection-id={item.selectionId}
                  variant={item.selectionId === selectedId ? 'secondary' : 'ghost'}
                  aria-current={item.selectionId === selectedId ? 'true' : undefined}
                  onClick={() => setSelectedId(item.selectionId)}
                  className={cn(
                    'h-auto w-full shrink-0 justify-start gap-2 rounded-lg border p-2 text-left font-normal',
                    item.selectionId === selectedId && 'border-primary',
                  )}
                >
                  <img
                    src={`${apiUrl}/selection/${item.selectionId}/image`}
                    alt=""
                    className="h-14 w-16 shrink-0 rounded object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">Selection {index + 1}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{item.comment}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="secondary">Included</Badge>
                      {itemChanges.length > 0 && <Badge variant="outline">Context changed</Badge>}
                    </span>
                  </span>
                </Button>
              );
            })}
            {state.selections.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">No selections remain.</p>
            )}
          </nav>

          <section aria-label="Screenshot preview" className="flex min-h-0 flex-col border-b p-3 lg:border-b-0 lg:border-r">
            {selected ? (
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-muted p-2">
                <img
                  src={`${apiUrl}/selection/${selected.selectionId}/image`}
                  alt={`Selection ${state.selections.indexOf(selected) + 1} screenshot`}
                  className="max-h-full max-w-full rounded border object-contain shadow-sm"
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No selection selected.</p>
            )}
          </section>

          <aside aria-label="Selection details" className="flex min-h-0 flex-col">
            {selected && (
              <>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold">
                      Selection {state.selections.indexOf(selected) + 1}
                    </h2>
                    <Badge variant="secondary" className="shrink-0 capitalize">
                      {selected.viewport.preset}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="pnt-review-comment" className="text-[11px] text-muted-foreground">
                        Comment
                      </Label>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <PencilLine className="size-3" aria-hidden="true" />
                        Editable
                      </span>
                    </div>
                    <Textarea
                      id="pnt-review-comment"
                      aria-label="Selection comment"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={5000}
                      className="min-h-24 resize-y border-ring/40 bg-muted/40 text-xs leading-relaxed shadow-sm hover:border-ring"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy || !draft.trim() || draft.trim() === selected.comment}
                        onClick={() =>
                          void run(`/selection/${selected.selectionId}`, {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ comment: draft }),
                          })
                        }
                      >
                        Save comment
                      </Button>
                    </div>
                  </div>

                  {changes.length > 0 && (
                    <Alert variant="warning" role="status">
                      <strong className="font-semibold">Context changed: {changes.join(', ')}.</strong>
                      <div className="mt-1 break-all">
                        Captured {selected.viewport.preset} · {selected.viewport.width} ×{' '}
                        {selected.viewport.height}, scroll {selected.scroll.x}, {selected.scroll.y}.
                      </div>
                      <div className="break-all">
                        Current {context.url} · scroll {context.scroll.x}, {context.scroll.y}.
                      </div>
                    </Alert>
                  )}
                  {error && <Alert variant="destructive">{error}</Alert>}
                </div>

                <Separator />
                <div className="flex items-center justify-between gap-2 p-3">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    aria-label="Delete selection"
                    disabled={busy}
                    onClick={() =>
                      void run(`/selection/${selected.selectionId}`, { method: 'DELETE' })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => onReplace(selected)}>
                    <Camera aria-hidden="true" />
                    Capture again
                  </Button>
                </div>
              </>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
