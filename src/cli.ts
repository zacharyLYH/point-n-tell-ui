#!/usr/bin/env node
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { arch, homedir, hostname, platform } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  artifactsRoot,
  cleanupExpiredArtifacts,
  deleteSessionArtifacts,
  shellQuote,
  writeContextArtifacts,
} from './artifacts.js';
import { closeApp, launchApp, saveAnnotatedScreenshot } from './browser.js';
import { startServer } from './server.js';
import { createSessionContext } from './session.js';
import {
  PRESETS,
  type ReviewContext,
  type Selection,
  type SessionState,
  type SubmissionResult,
} from './types.js';
import { HELP, formatReady, formatSubmit } from './cli-output.js';

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
  const root = artifactsRoot();
  const artifactsDir = join(root, session.sessionRef);
  const overlayScript = await readFile(new URL('./overlay.js', import.meta.url), 'utf8');

  const state: SessionState = {
    session,
    viewport: { preset: 'desktop', ...PRESETS.desktop },
    selections: [],
  };
  let launched: Awaited<ReturnType<typeof launchApp>> | undefined;
  let reviewContext: ReviewContext | undefined;
  let submitted = false;
  let finalized = false;
  let endSession = () => {};
  const ended = new Promise<void>((resolve) => {
    endSession = resolve;
  });
  const machineLog = (value: unknown) => {
    if (process.env.PNT_MACHINE === '1') {
      console.log(JSON.stringify(value));
    }
  };

  const ensureOpen = () => {
    if (finalized) throw new Error('Session is already submitted or discarded');
  };

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
      ensureOpen();
      // Keep the preset label, record the size the window could actually show.
      state.viewport = { preset: viewport.preset, ...(await app().setViewport(viewport)) };
    },
    saveSelection: async ({ comment, coordinates }, replaceId) => {
      ensureOpen();
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
      const replaced = replaceId
        ? state.selections.find((item) => item.selectionId === replaceId)
        : undefined;
      state.selections = replaceId
        ? state.selections.map((item) => (item.selectionId === replaceId ? selection : item))
        : [...state.selections, selection];
      if (replaced) await deleteSessionArtifacts(replaced.imagePath);
      return state;
    },
    updateComment: async (selectionId, comment) => {
      ensureOpen();
      const selection = state.selections.find((item) => item.selectionId === selectionId);
      if (!selection) {
        throw new Error('Selection not found');
      }
      selection.comment = comment;
      return state;
    },
    deleteSelection: async (selectionId) => {
      ensureOpen();
      const selection = state.selections.find((item) => item.selectionId === selectionId);
      if (selection) await deleteSessionArtifacts(selection.imagePath);
      state.selections = state.selections.filter((item) => item.selectionId !== selectionId);
      return state;
    },
    openReview: async () => {
      ensureOpen();
      const context = await pageContext();
      // Capture the accessibility tree before the review dialog hides the app.
      const accessibility = await app().page.ariaSnapshot().catch(() => undefined);
      reviewContext = { ...context, accessibility };
      await app().expandForReview();
      return { state, context: reviewContext };
    },
    closeReview: async () => {
      await app().setViewport(state.viewport);
      if (reviewContext) {
        await app().page.evaluate(({ x, y }) => window.scrollTo(x, y), reviewContext.scroll);
      }
      reviewContext = undefined;
      return state;
    },
    submit: async ({ redactCredentials }) => {
      ensureOpen();
      if (state.selections.length === 0) {
        throw new Error('Add at least one selection before submitting');
      }

      const context = await app().captureContext({
        redactCredentials,
        viewport: state.viewport,
        accessibility: reviewContext?.accessibility,
      });
      const contextArtifacts = await writeContextArtifacts(artifactsDir, context);
      const selections = structuredClone(state.selections);
      const manifest: SubmissionResult = {
        session,
        machine: {
          hostname: hostname(),
          platform: platform(),
          arch: arch(),
          node: process.version,
        },
        submittedAt: new Date().toISOString(),
        appUrl: url.href,
        selectionIds: selections.map((selection) => selection.selectionId),
        selectionCount: selections.length,
        imagePaths: selections.map((selection) => selection.imagePath),
        frameIndex: [],
        selections,
        context,
        artifactsDir,
        contextArtifacts,
        retrieval: {
          artifacts: `ls ${shellQuote(artifactsDir)}`,
        },
      };

      submitted = true;
      finalized = true;
      console.log(formatSubmit(manifest));
      machineLog(manifest);
      return manifest;
    },
    discard: async () => {
      ensureOpen();
      await deleteSessionArtifacts(artifactsDir);
      finalized = true;
      return { discarded: true };
    },
    endSession,
  });

  try {
    await cleanupExpiredArtifacts(root);
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
      formatReady({
        session,
        appUrl: url.href,
        overlayUrl: api.url,
        artifactsDir,
      }),
    );
    const { context, page } = launched;
    machineLog({
      ...session,
      appUrl: url.href,
      apiUrl: api.url,
      cdpUrl: process.env.PNT_CDP_PORT ? `http://127.0.0.1:${process.env.PNT_CDP_PORT}` : undefined,
    });

    const exit = new Promise<void>((resolve) => {
      const finish = () => resolve();
      process.once('SIGINT', finish);
      process.once('SIGTERM', finish);
      context.once('close', finish);
      page.once('close', finish);
    });
    await Promise.race([ended, exit]);
  } finally {
    if (!submitted) {
      await deleteSessionArtifacts(artifactsDir).catch(() => undefined);
    }
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
