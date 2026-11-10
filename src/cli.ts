#!/usr/bin/env node
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { closeApp, launchApp, saveAnnotatedScreenshot } from './browser.js';
import { startServer } from './server.js';
import { createSessionContext } from './session.js';
import { PRESETS, type ReviewContext, type Selection, type SessionState } from './types.js';

const HELP = `Point and Tell opens a real page in a persistent Chromium profile.

Usage:
  pnt-ui <url> --harness <name> --chat-title <title> [--session-id <id>]

Options:
  --harness <name>       Agent or harness name. Required.
  --chat-title <title>   Chat title used to scope this session. Required.
  --session-id <id>      Optional session ID. Generated when omitted.
  --help, -h             Show this help.

The viewport is selected in the Point and Tell overlay, not from the CLI.
Press Ctrl+C to close the session.`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      harness: { type: 'string' },
      'chat-title': { type: 'string' },
      'session-id': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  if (positionals.length !== 1) {
    throw new Error('Provide exactly one URL.');
  }
  if (!values.harness) {
    throw new Error('--harness is required');
  }
  if (!values['chat-title']) {
    throw new Error('--chat-title is required');
  }

  const url = new URL(positionals[0]);
  const session = createSessionContext({
    harness: values.harness,
    chatTitle: values['chat-title'],
    sessionId: values['session-id'],
  });
  const profileDir =
    process.env.PNT_PROFILE_DIR ?? join(homedir(), '.point-n-tell', 'chromium-profile');
  const artifactsDir = join(
    process.env.PNT_ARTIFACTS_DIR ?? join(homedir(), '.point-n-tell', 'artifacts'),
    session.sessionRef,
  );
  const overlayScript = await readFile(new URL('./overlay.js', import.meta.url), 'utf8');

  const state: SessionState = {
    session,
    viewport: { preset: 'desktop', ...PRESETS.desktop },
    selections: [],
  };
  let launched: Awaited<ReturnType<typeof launchApp>> | undefined;
  let reviewContext: ReviewContext | undefined;

  const app = () => {
    if (!launched) {
      throw new Error('App page is not ready');
    }
    return launched;
  };
  const pageContext = () =>
    app().page.evaluate(() => ({
      url: location.href,
      scroll: { x: scrollX, y: scrollY },
    }));

  const api = await startServer({
    getState: () => state,
    applyViewport: async (viewport) => {
      // Keep the preset label, record the size the window could actually show.
      state.viewport = { preset: viewport.preset, ...(await app().setViewport(viewport)) };
    },
    saveSelection: async ({ comment, coordinates }, replaceId) => {
      const { page } = app();
      if (replaceId && !state.selections.some((item) => item.selectionId === replaceId)) {
        throw new Error('Selection not found');
      }
      await mkdir(artifactsDir, { recursive: true });
      const selectionId = randomUUID();
      const imagePath = join(artifactsDir, `${selectionId}.webp`);
      const [topLeft, , bottomRight] = coordinates;
      await saveAnnotatedScreenshot(page, imagePath, {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      });
      const { url: pageUrl, scroll } = await pageContext();
      const selection: Selection = {
        selectionId,
        comment,
        coordinates,
        viewport: { ...state.viewport },
        scroll,
        page: { url: pageUrl },
        createdAt: new Date().toISOString(),
        imagePath,
      };
      state.selections = replaceId
        ? state.selections.map((item) => (item.selectionId === replaceId ? selection : item))
        : [...state.selections, selection];
      return state;
    },
    updateComment: async (selectionId, comment) => {
      const selection = state.selections.find((item) => item.selectionId === selectionId);
      if (!selection) {
        throw new Error('Selection not found');
      }
      selection.comment = comment;
      return state;
    },
    deleteSelection: async (selectionId) => {
      state.selections = state.selections.filter((item) => item.selectionId !== selectionId);
      return state;
    },
    openReview: async () => {
      const context = await pageContext();
      reviewContext = context;
      await app().expandForReview();
      return { state, context };
    },
    closeReview: async () => {
      await app().setViewport(state.viewport);
      if (reviewContext) {
        await app().page.evaluate(({ x, y }) => window.scrollTo(x, y), reviewContext.scroll);
      }
      reviewContext = undefined;
      return state;
    },
  });

  try {
    launched = await launchApp({
      url: url.href,
      profileDir,
      overlayScript,
      apiUrl: api.url,
      cdpPort: process.env.PNT_CDP_PORT,
      onViewport: (viewport) => {
        state.viewport = { preset: 'desktop', ...viewport };
      },
    });

    console.log(
      [
        'Point and Tell ready',
        `  sessionRef:  ${session.sessionRef}`,
        `  app:         ${url.href}`,
        `  overlay:     ${api.url}`,
        `  screenshots: ${artifactsDir}`,
        '',
        'Press Ctrl+C to close.',
      ].join('\n'),
    );
    if (process.env.PNT_MACHINE === '1') {
      console.log(
        JSON.stringify({
          ...session,
          appUrl: url.href,
          apiUrl: api.url,
          cdpUrl: process.env.PNT_CDP_PORT
            ? `http://127.0.0.1:${process.env.PNT_CDP_PORT}`
            : undefined,
        }),
      );
    }

    const { context, page } = launched;
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      process.once('SIGINT', finish);
      process.once('SIGTERM', finish);
      context.once('close', finish);
      page.once('close', finish);
    });
  } finally {
    await api.close().catch(() => undefined);
    if (launched) {
      await closeApp(launched.context);
    }
  }
}

main().catch((error: unknown) => {
  console.error(`pnt-ui: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
