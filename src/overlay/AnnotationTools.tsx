import type { Dispatch } from 'react';
import { Eraser, PenLine, Redo2, Save, Square, Undo2, X } from 'lucide-react';
import type { AnnotationAction, AnnotationState } from './useAnnotation.js';
import { IconButton } from './IconButton.js';
import { Separator } from '../components/ui/separator.js';
import { Textarea } from '../components/ui/textarea.js';

export function AnnotationTools({
  state,
  busy,
  dispatch,
  onCancel,
  onSave,
}: {
  state: AnnotationState;
  busy: boolean;
  dispatch: Dispatch<AnnotationAction>;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { rectangle, tool, strokes, redoStrokes, comment } = state;
  const canSave = Boolean(rectangle && rectangle.width >= 4 && rectangle.height >= 4 && comment.trim());

  return (
    <div className="flex w-max shrink-0 items-center gap-1.5">
      <IconButton content="Rectangle" label="Rectangle tool" variant={tool === 'rectangle' ? 'secondary' : 'ghost'} aria-pressed={tool === 'rectangle'} onClick={() => dispatch({ type: 'tool', value: 'rectangle' })}>
        <Square aria-hidden="true" />
      </IconButton>
      <IconButton content="Pen" label="Pen tool" variant={tool === 'pen' ? 'secondary' : 'ghost'} disabled={!rectangle} aria-pressed={tool === 'pen'} onClick={() => dispatch({ type: 'tool', value: 'pen' })}>
        <PenLine aria-hidden="true" />
      </IconButton>
      <IconButton content="Undo" label="Undo" variant="ghost" disabled={!strokes.length} onClick={() => dispatch({ type: 'undo' })}>
        <Undo2 aria-hidden="true" />
      </IconButton>
      <IconButton content="Redo" label="Redo" variant="ghost" disabled={!redoStrokes.length} onClick={() => dispatch({ type: 'redo' })}>
        <Redo2 aria-hidden="true" />
      </IconButton>
      <IconButton content="Clear strokes" label="Clear strokes" variant="ghost" disabled={!strokes.length && !redoStrokes.length} onClick={() => dispatch({ type: 'clear' })}>
        <Eraser aria-hidden="true" />
      </IconButton>
      <Separator orientation="vertical" className="mx-1 h-7" />
      <Textarea
        aria-label="Selection comment"
        value={comment}
        onChange={(event) => dispatch({ type: 'comment', value: event.target.value })}
        maxLength={5000}
        placeholder="Add a note…"
        className="h-9 min-h-9 w-48 resize-none bg-background py-2 text-xs"
      />
      <IconButton content="Cancel" label="Cancel annotation" variant="ghost" onClick={onCancel}>
        <X aria-hidden="true" />
      </IconButton>
      <IconButton content="Save selection" label="Save selection" disabled={busy || !canSave} onClick={onSave}>
        <Save aria-hidden="true" />
      </IconButton>
    </div>
  );
}
