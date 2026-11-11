import { useRef, useState } from 'react';
import { Camera, PencilLine, Send, Trash2 } from 'lucide-react';
import type { ReviewContext, Selection, SessionState, SubmissionResult } from '../types.js';
import { sendJson, useAction } from './api.js';
import { Alert } from '../components/ui/alert.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js';
import { Label } from '../components/ui/label.js';
import { Separator } from '../components/ui/separator.js';
import { Switch } from '../components/ui/switch.js';
import { Textarea } from '../components/ui/textarea.js';
import { cn } from '../lib/utils.js';

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
  const [requestedId, setRequestedId] = useState(initial.selections[0]?.selectionId);
  const [draft, setDraft] = useState<{ id?: string; text: string }>();
  const [redactCredentials, setRedactCredentials] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { busy, error, run } = useAction();
  const navRef = useRef<HTMLElement>(null);

  // Removing the last selection falls back to the first remaining one.
  const selectedId = state.selections.some((item) => item.selectionId === requestedId)
    ? requestedId
    : state.selections[0]?.selectionId;
  const index = state.selections.findIndex((item) => item.selectionId === selectedId);
  const selected = state.selections[index];
  const comment = draft?.id === selectedId ? draft.text : selected?.comment ?? '';

  const request = (path: string, body?: unknown, method?: string) =>
    run(async () => {
      setState(await sendJson<SessionState>(`${apiUrl}${path}`, body, method));
    });

  // The submit response ends the session server-side; the CLI closes the
  // browser after the manifest has been written.
  const submit = () =>
    void run(() => sendJson<SubmissionResult>(`${apiUrl}/submit`, { redactCredentials }));
  const discard = () => void run(() => sendJson(`${apiUrl}/discard`));

  const moveSelection = (delta: number) => {
    const next = state.selections[index + delta];
    if (!next) {
      return;
    }
    setRequestedId(next.selectionId);
    if (navRef.current?.contains(document.activeElement)) {
      requestAnimationFrame(() => {
        navRef.current?.querySelector<HTMLButtonElement>(`[data-selection-id="${next.selectionId}"]`)?.focus();
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
          moveSelection(event.key === 'ArrowDown' ? 1 : -1);
        }}
      >
        <DialogTitle className="sr-only">Session summary</DialogTitle>
        <DialogDescription className="sr-only">Review saved selections before submitting.</DialogDescription>
        <header className="flex flex-wrap items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{state.session.chatTitle}</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {state.selections.length} included · {state.session.sessionRef}
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
          {confirmDiscard ? (
            <>
              <span className="text-[11px] text-muted-foreground">
                Discard session and delete captures?
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmDiscard(false)}
              >
                Cancel
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={discard}>
                Confirm discard
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
                Close
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmDiscard(true)}
              >
                Discard
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || state.selections.length === 0}
                onClick={submit}
              >
                <Send aria-hidden="true" />
                Submit
              </Button>
            </>
          )}
        </header>
        <Separator />

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)_minmax(16rem,20rem)] lg:overflow-hidden">
          <nav
            ref={navRef}
            aria-label="Saved selections"
            className="flex flex-col gap-1 border-b p-2 lg:overflow-y-auto lg:border-b-0 lg:border-r"
          >
            {state.selections.map((item, itemIndex) => {
              // A capture from another page cannot be compared at all.
              const otherUrl = item.page.url !== context.url;
              const active = item.selectionId === selectedId;
              return (
                <Button
                  key={item.selectionId}
                  type="button"
                  data-selection-id={item.selectionId}
                  variant={active ? 'secondary' : 'ghost'}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setRequestedId(item.selectionId)}
                  className={cn(
                    'h-auto w-full shrink-0 justify-start gap-2 rounded-lg border p-2 text-left font-normal',
                    active && 'border-primary',
                  )}
                >
                  <img
                    src={`${apiUrl}/selection/${item.selectionId}/image`}
                    alt=""
                    className="h-14 w-16 shrink-0 rounded object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">Selection {itemIndex + 1}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{item.comment}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="secondary">Included</Badge>
                      {otherUrl && (
                        <Badge
                          variant="outline"
                          title="Can't check if context changed: this capture is from a different URL"
                        >Can't check context</Badge>
                      )}
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
                  alt={`Selection ${index + 1} screenshot`}
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
                    <h2 className="text-xs font-semibold">Selection {index + 1}</h2>
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
                      value={comment}
                      onChange={(event) => setDraft({ id: selectedId, text: event.target.value })}
                      maxLength={5000}
                      className="min-h-24 resize-y border-ring/40 bg-muted/40 text-xs leading-relaxed shadow-sm hover:border-ring"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy || !comment.trim() || comment.trim() === selected.comment}
                        onClick={() =>
                          void request(`/selection/${selected.selectionId}`, { comment: comment.trim() }, 'PATCH')
                        }
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
                    aria-label="Delete selection"
                    disabled={busy}
                    onClick={() => void request(`/selection/${selected.selectionId}`, undefined, 'DELETE')}
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
