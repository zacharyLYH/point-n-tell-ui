import { Eraser, PenLine, Redo2, Save, Square, Undo2, X } from 'lucide-react';
import type { AnnotationState, Tool } from './useAnnotation.js';
import { Button } from '../components/ui/button.js';
import { Separator } from '../components/ui/separator.js';
import { Textarea } from '../components/ui/textarea.js';
import { Tooltip } from '../components/ui/tooltip.js';

export function AnnotationTools({
  state,
  busy,
  onComment,
  onTool,
  onUndo,
  onRedo,
  onClear,
  onCancel,
  onSave,
}: {
  state: AnnotationState;
  busy: boolean;
  onComment: (comment: string) => void;
  onTool: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const rectangle = state.rectangle;
  const canSave = Boolean(rectangle && rectangle.width >= 4 && rectangle.height >= 4 && state.comment.trim());

  return (
    <div className="flex w-max shrink-0 items-center gap-1.5">
      <Tooltip content="Rectangle">
        <Button type="button" size="icon" variant={state.tool === 'rectangle' ? 'secondary' : 'ghost'} aria-label="Rectangle tool" aria-pressed={state.tool === 'rectangle'} onClick={() => onTool('rectangle')}>
          <Square aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Pen">
        <Button type="button" size="icon" variant={state.tool === 'pen' ? 'secondary' : 'ghost'} aria-label="Pen tool" disabled={!rectangle} aria-pressed={state.tool === 'pen'} onClick={() => onTool('pen')}>
          <PenLine aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Undo">
        <Button type="button" size="icon" variant="ghost" aria-label="Undo" disabled={!state.strokes.length} onClick={onUndo}>
          <Undo2 aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Redo">
        <Button type="button" size="icon" variant="ghost" aria-label="Redo" disabled={!state.redoStrokes.length} onClick={onRedo}>
          <Redo2 aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Clear strokes">
        <Button type="button" size="icon" variant="ghost" aria-label="Clear strokes" disabled={!state.strokes.length && !state.redoStrokes.length} onClick={onClear}>
          <Eraser aria-hidden="true" />
        </Button>
      </Tooltip>
      <Separator orientation="vertical" className="mx-1 h-7" />
      <Textarea
        aria-label="Selection comment"
        value={state.comment}
        onChange={(event) => onComment(event.target.value)}
        maxLength={5000}
        placeholder="Add a note…"
        className="h-9 min-h-9 w-48 resize-none bg-background py-2 text-xs"
      />
      <Tooltip content="Cancel">
        <Button type="button" size="icon" variant="ghost" aria-label="Cancel annotation" onClick={onCancel}>
          <X aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Save selection">
        <Button type="button" size="icon" aria-label="Save selection" disabled={busy || !canSave} onClick={onSave}>
          <Save aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}
