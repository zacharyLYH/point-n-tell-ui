import { useRef, useState } from 'react';
import { Camera, PencilLine, Send, Trash2 } from 'lucide-react';
import type { Recording, ReviewContext, Selection, SessionState, SubmissionResult } from '../types.js';
import { sendJson, useAction } from './api.js';
import { CutCarousel, cutImages } from './CutCarousel.js';
import { Alert } from '../components/ui/alert.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js';
import { Label } from '../components/ui/label.js';
import { Separator } from '../components/ui/separator.js';
import { Switch } from '../components/ui/switch.js';
import { Textarea } from '../components/ui/textarea.js';
import { cn } from '../lib/utils.js';

/** Screenshot selections and video recordings share one review list. */
type Item = { id: string; label: string; images: { id: string; label: string }[] } & (
  | { kind: 'selection'; capture: Selection }
  | { kind: 'recording'; capture: Recording }
);

function itemsOf(state: SessionState): Item[] {
  return [
    ...state.selections.map((selection, index) => ({
      id: selection.selectionId,
      kind: 'selection' as const,
      label: `Selection ${index + 1}`,
      images: [{ id: selection.selectionId, label: 'Screenshot' }],
      capture: selection,
    })),
    ...state.recordings.map((recording, index) => ({
      id: recording.recordingId,
      kind: 'recording' as const,
      label: `Recording ${index + 1}`,
      images: cutImages(recording),
      capture: recording,
    })),
  ];
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
  const [requestedId, setRequestedId] = useState(
    initial.selections[0]?.selectionId ?? initial.recordings[0]?.recordingId,
  );
  const [draft, setDraft] = useState<string>();
  const [redactCredentials, setRedactCredentials] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { busy, error, run } = useAction();
  const navRef = useRef<HTMLElement>(null);

  const items = itemsOf(state);
  // Removing the last item falls back to the first remaining one.
  const selected = items.find((item) => item.id === requestedId) ?? items[0];
  const selection = selected?.kind === 'selection' ? selected.capture : undefined;
  const recording = selected?.kind === 'recording' ? selected.capture : undefined;
  const selectedId = selected?.id;
  const index = selected ? items.indexOf(selected) : -1;
  const comment = draft ?? selected?.capture.comment ?? '';

  // A drafted comment belongs to the capture it was typed for.
  const select = (id: string) => {
    setRequestedId(id);
    setDraft(undefined);
  };

  const request = (path: string, body?: unknown, method?: string) =>
    run(async () => {
      setState(await sendJson<SessionState>(`${apiUrl}${path}`, body, method));
      setDraft(undefined);
    });

  // The submit response ends the session server-side; the CLI closes the
  // browser after the manifest has been written.
  const submit = () => void run(() => sendJson<SubmissionResult>(`${apiUrl}/submit`, { redactCredentials }));
  const discard = () => void run(() => sendJson(`${apiUrl}/discard`));

  const moveItem = (delta: number) => {
    const next = items[index + delta];
    if (!next) {
      return;
    }
    select(next.id);
    if (navRef.current?.contains(document.activeElement)) {
      requestAnimationFrame(() => {
        navRef.current?.querySelector<HTMLButtonElement>(`[data-capture-id="${next.id}"]`)?.focus();
      });
    }
  };

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
          moveItem(event.key === 'ArrowDown' ? 1 : -1);
        }}
      >
        <DialogTitle className="sr-only">Session summary</DialogTitle>
        <DialogDescription className="sr-only">Review saved captures before submitting.</DialogDescription>
        <header className="flex flex-wrap items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{state.session.chatTitle}</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {items.length} included · {state.session.sessionRef}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Switch
              id="pnt-redact-credentials"
              aria-label="Redact credentials"
              checked={redactCredentials}
              disabled={busy}
              onCheckedChange={setRedactCredentials}
            />
            <Label htmlFor="pnt-redact-credentials" className="text-[11px] text-muted-foreground">
              Redact credentials
            </Label>
          </div>
          {confirmDiscard && (
            <span className="text-[11px] text-muted-foreground">Discard session and delete captures?</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => (confirmDiscard ? setConfirmDiscard(false) : onClose())}
          >
            {confirmDiscard ? 'Cancel' : 'Close'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={confirmDiscard ? discard : () => setConfirmDiscard(true)}
          >
            {confirmDiscard ? 'Confirm discard' : 'Discard'}
          </Button>
          {!confirmDiscard && (
            <Button type="button" size="sm" disabled={busy || items.length === 0} onClick={submit}>
              <Send aria-hidden="true" />
              Submit
            </Button>
          )}
        </header>
        <Separator />

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)_minmax(16rem,20rem)] lg:overflow-hidden">
          <nav
            ref={navRef}
            aria-label="Saved selections"
            className="flex flex-col gap-1 border-b p-2 lg:overflow-y-auto lg:border-b-0 lg:border-r"
          >
            {items.map((item) => {
              // A capture from another page cannot be compared at all.
              const otherUrl = item.capture.page.url !== context.url;
              const active = item.id === selectedId;
              return (
                <Button
                  key={item.id}
                  type="button"
                  data-capture-id={item.id}
                  variant={active ? 'secondary' : 'ghost'}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => select(item.id)}
                  className={cn(
                    'h-auto w-full shrink-0 justify-start gap-2 rounded-lg border p-2 text-left font-normal',
                    active && 'border-primary',
                  )}
                >
                  <img
                    src={`${apiUrl}/image/${item.images[0].id}`}
                    alt=""
                    className="h-14 w-16 shrink-0 rounded object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{item.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.capture.comment}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="secondary">Included</Badge>
                      {item.kind === 'recording' && (
                        <Badge variant="outline" data-testid="cut-count">{item.images.length} cuts</Badge>
                      )}
                      {otherUrl && (
                        <Badge
                          variant="outline"
                          title="Can't check if context changed: this capture is from a different URL"
                        >
                          Can't check context
                        </Badge>
                      )}
                    </span>
                  </span>
                </Button>
              );
            })}
            {items.length === 0 && <p className="p-3 text-xs text-muted-foreground">No captures remain.</p>}
          </nav>

          <section aria-label="Capture preview" className="flex min-h-0 flex-col border-b p-3 lg:border-b-0 lg:border-r">
            {selected ? (
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-muted p-2">
                <CutCarousel key={selected.id} apiUrl={apiUrl} images={selected.images} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No capture selected.</p>
            )}
          </section>

          <aside aria-label="Capture details" className="flex min-h-0 flex-col">
            {selected && (
              <>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold">{selected.label}</h2>
                    <Badge variant="secondary" className="shrink-0 capitalize">
                      {selected.capture.viewport.preset}
                    </Badge>
                  </div>
                  {recording && (
                    <p className="text-[11px] text-muted-foreground" data-testid="recording-stats">
                      {selected.images.length} cuts · {recording.durationMs} ms
                    </p>
                  )}

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
                      aria-label="Capture comment"
                      value={comment}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={5000}
                      className="min-h-24 resize-y border-ring/40 bg-muted/40 text-xs leading-relaxed shadow-sm hover:border-ring"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy || !comment.trim() || comment.trim() === selected.capture.comment}
                        onClick={() => void request(`/${selected.kind}/${selected.id}`, { comment: comment.trim() }, 'PATCH')}
                      >
                        Save comment
                      </Button>
                    </div>
                  </div>

                  {error && <Alert variant="destructive">{error}</Alert>}
                </div>

                <Separator />
                <div className="flex items-center justify-between gap-2 p-3">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    aria-label={`Delete ${selected.kind}`}
                    disabled={busy}
                    onClick={() => void request(`/${selected.kind}/${selected.id}`, undefined, 'DELETE')}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                  {selection && (
                    <Button type="button" variant="outline" size="sm" onClick={() => onReplace(selection)}>
                      <Camera aria-hidden="true" />
                      Capture again
                    </Button>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
