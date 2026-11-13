import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { IconButton } from './IconButton.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js';

const STEPS = [
  ['Pick a viewport', 'Desktop, tablet, or mobile. The page is resized to match.'],
  ['Annotate', 'Drag a box around the problem, then Capture selection. Write the comment and Save capture.'],
  ['Record', 'Reproduce the flow, use the pen to point at things, then press Stop in the recording bar. Review the cuts and Save capture.'],
  ['Review and submit', 'The layers icon lists every capture. Fix comments, then Submit from the session panel on the left.'],
];

/** In-app onboarding. Users should not need the agent to explain the flow. */
export function Help() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        content="How this works"
        label="How this works"
        variant="ghost"
        onClick={() => setOpen(true)}
      >
        <CircleHelp aria-hidden="true" />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md gap-3 font-sans text-foreground">
          <DialogTitle className="text-sm font-semibold">How Point and Tell works</DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Nothing reaches your agent until you Submit.
          </DialogDescription>
          <ol className="space-y-2 text-xs">
            {STEPS.map(([title, body], index) => (
              <li key={title} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground"
                >
                  {index + 1}
                </span>
                <span>
                  <strong className="font-semibold">{title}.</strong> {body}
                </span>
              </li>
            ))}
          </ol>
          <p className="rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
            Do not refresh while a capture dialog is open: the pending capture is lost and the session must be
            restarted. Credentials are redacted by default.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
