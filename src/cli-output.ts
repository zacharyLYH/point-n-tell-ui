import type { SessionContext, SubmissionResult } from './types.js';

export const HELP = `Point and Tell opens a real page in a persistent Chromium profile.

Usage:
  pnt-ui <url> --harness <name> --chat-title <title> [--session-id <id>]

Options:
  --harness <name>       Agent or harness name. Required.
  --chat-title <title>   Chat title used to scope this session. Required.
  --session-id <id>      Optional session ID. Generated when omitted.
  --help, -h             Show this help.

The viewport is selected in the Point and Tell overlay, not from the CLI.
Press Ctrl+C to close the session.`;

// One long rule opens and closes a report; a lighter rule separates items.
const RULE = '='.repeat(78);
const DIVIDER = '-'.repeat(78);

const field = (label: string, value: string) => ` ${label.padEnd(13)}${value}`;

function count(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`;
}

function oneLine(value: string, limit = 80): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function report(title: string, fields: [string, string][]): string[] {
  return [RULE, ` ${title}`, RULE, ...fields.map(([label, value]) => field(label, value))];
}

export function formatReady({
  session,
  appUrl,
  overlayUrl,
  artifactsDir,
}: {
  session: SessionContext;
  appUrl: string;
  overlayUrl: string;
  artifactsDir: string;
}): string {
  return [
    ...report('Point and Tell ready', [
      ['session', session.sessionRef],
      ['harness', session.harness],
      ['chat', session.chatTitle],
      ['app', appUrl],
      ['overlay', overlayUrl],
      ['artifacts', artifactsDir],
    ]),
    RULE,
    ' Next: pick a viewport, then Annotate for a screenshot or Record for a video.',
    '       Save each capture with a comment, then open the layers icon to review.',
    '       Nothing reaches the agent until Submit. Ctrl+C closes the session.',
    RULE,
  ].join('\n');
}

/**
 * Human-readable submit report: session metadata on top, then one section per
 * included capture. Full console, network, and localStorage payloads live in
 * the artifact JSON files that this report points at.
 */
export function formatSubmit(manifest: SubmissionResult): string {
  const { session, machine, context, contextArtifacts } = manifest;
  const errors = context.console.filter((entry) => entry.level === 'error').length;
  const items = manifest.selections.map((selection) =>
    [
      field('type', 'image'),
      field('comment', oneLine(selection.comment)),
      field('selection', selection.selectionId),
      field('image', selection.imagePath),
      field('page', selection.page.url),
      field(
        'viewport',
        `${selection.viewport.preset} ${selection.viewport.width}x${selection.viewport.height}`,
      ),
      field('created', selection.createdAt),
    ].join('\n'),
  );
  const recordings = manifest.recordings.map((recording) =>
    [
      field('type', 'recording'),
      field('comment', oneLine(recording.comment)),
      field('recording', recording.recordingId),
      field('cuts', `${count(recording.cuts.length, 'cut')} (${recording.durationMs} ms)`),
      field('images', recording.cuts.map((cut) => cut.imagePath).join(' ')),
      field('page', recording.page.url),
      field(
        'viewport',
        `${recording.viewport.preset} ${recording.viewport.width}x${recording.viewport.height}`,
      ),
    ].join('\n'),
  );

  return [
    ...report(`Submitted ${session.sessionRef}`, [
      ['harness', session.harness],
      ['chat', session.chatTitle],
      ['session', session.sessionRef],
      ['app', manifest.appUrl],
      ['submitted', manifest.submittedAt],
      ['machine', `${machine.hostname} ${machine.platform}/${machine.arch} node ${machine.node}`],
      ['selections', count(manifest.selectionCount, 'selection')],
      ['recordings', count(manifest.recordings.length, 'recording')],
      ['artifacts', manifest.artifactsDir],
      [
        'console',
        `${contextArtifacts.console} (${count(errors, 'error')}, ${count(context.console.length - errors, 'warning')})`,
      ],
      [
        'network',
        `${contextArtifacts.network} (${count(context.network.length, 'app call')})`,
      ],
      [
        'localStorage',
        `${contextArtifacts.localStorage} (${count(Object.keys(context.storage.localStorage).length, 'key')})`,
      ],
      [
        'a11y',
        `${contextArtifacts.accessibility} (${count(context.accessibility?.split('\n').length ?? 0, 'line')})`,
      ],
    ]),
    RULE,
    [...items, ...recordings].join(`\n${DIVIDER}\n`),
    RULE,
  ].join('\n');
}
