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
  const overlayScript = await readFile(new URL('./overlay.js', import.meta.url), 'utf8');

  let state: SessionState = {
    session,
    viewport: { preset: 'desktop', ...PRESETS.desktop },
    presets: PRESETS,
    selections: [],
  };
  let page: Awaited<ReturnType<typeof launchApp>>['page'] | undefined;
  let launched: Awaited<ReturnType<typeof launchApp>> | undefined;
  let reviewContext: ReviewContext | undefined;

  const readPageContext = async (): Promise<ReviewContext> => {
    if (!page) {
      throw new Error('App page is not ready');
    }
    return page.evaluate(() => ({
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
    }));
  };

  const api = await startServer({
    getState: () => state,
    applyViewport: async (viewport) => {
      if (!launched) {
        throw new Error('App page is not ready');
      }
      await launched.setViewport(viewport);
      state = { ...state, viewport };
    },
    saveSelection: async ({ comment, coordinates }, replaceId) => {
      if (!page || !launched) {
        throw new Error('App page is not ready');
      }
      const app = launched;
      if (replaceId && !state.selections.some((item) => item.selectionId === replaceId)) {
        throw new Error('Selection not found');
      }
      const selectionId = randomUUID();
      const artifactDir = join(
        process.env.PNT_ARTIFACTS_DIR ?? join(homedir(), '.point-n-tell', 'artifacts'),
        session.sessionRef,
      );
      await mkdir(artifactDir, { recursive: true });
      const imagePath = join(artifactDir, `${selectionId}.webp`);
      const pageContext = await page.evaluate(() => ({
        url: location.href,
        scroll: { x: scrollX, y: scrollY },
      }));
      const topLeft = coordinates[0];
      const bottomRight = coordinates[2];
      await saveAnnotatedScreenshot(page, imagePath, {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      });
      await app.clearViewport();
      await app.setViewport(state.viewport);
      const selection: Selection = {
        selectionId,
        comment,
        coordinates,
        viewport: { ...state.viewport },
        scroll: pageContext.scroll,
        page: { url: pageContext.url },
        createdAt: new Date().toISOString(),
        imagePath,
      };
      state = {
        ...state,
        selections: replaceId
          ? state.selections.map((item) => (item.selectionId === replaceId ? selection : item))
          : [...state.selections, selection],
      };
      return state;
    },
    updateComment: async (selectionId, comment) => {
      if (!state.selections.some((item) => item.selectionId === selectionId)) {
        throw new Error('Selection not found');
      }
      state = {
        ...state,
        selections: state.selections.map((item) =>
          item.selectionId === selectionId ? { ...item, comment } : item,
        ),
      };
      return state;
    },
    deleteSelection: async (selectionId) => {
      state = {
        ...state,
        selections: state.selections.filter((item) => item.selectionId !== selectionId),
      };
      return state;
    },
    openReview: async () => {
      if (!launched) {
        throw new Error('App page is not ready');
      }
      reviewContext = await readPageContext();
      await launched.expandForReview();
      return { state, context: reviewContext };
    },
    closeReview: async () => {
      if (!launched) {
        throw new Error('App page is not ready');
      }
      const context = reviewContext;
      reviewContext = undefined;
      await launched.setViewport(state.viewport);
      if (context) {
        await page?.evaluate((scroll) => window.scrollTo(scroll.x, scroll.y), context.scroll);
      }
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
    });
    page = launched.page;

    console.log(
      [
        'Point and Tell ready',
        `  sessionRef: ${session.sessionRef}`,
        `  app:        ${url.href}`,
        `  overlay:    ${api.url}`,
        `  profile:    ${profileDir}`,
        '',
        'Press Ctrl+C to close.',
      ].join('\n'),
    );
    console.log(
      `PNT_UI_READY ${JSON.stringify({
        ...session,
        appUrl: url.href,
        apiUrl: api.url,
        cdpUrl: process.env.PNT_CDP_PORT
          ? `http://127.0.0.1:${process.env.PNT_CDP_PORT}`
          : undefined,
      })}`,
    );

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        resolve();
      };

      process.once('SIGINT', finish);
      process.once('SIGTERM', finish);
      launched?.context.once('close', finish);
      launched?.page.once('close', finish);
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
