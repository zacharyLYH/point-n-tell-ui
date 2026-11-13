#!/usr/bin/env node
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { arch, hostname, platform } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  artifactsRoot,
  cleanupExpiredArtifacts,
  deleteSessionArtifacts,
  profileRoot,
  shellQuote,
  writeContextArtifacts,
} from './artifacts.js';
import { closeApp, launchApp, saveAnnotatedScreenshot, startCapture } from './browser.js';
import { checkFfmpeg, generateCuts } from './recording.js';
import { RecordingController, cutsDir } from './recording-controller.js';
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

type PendingSelection = { selection: Selection; replaced?: Selection };

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
  const profileDir = profileRoot();
  const root = artifactsRoot();
  const artifactsDir = join(root, session.sessionRef);
  const overlayScript = await readFile(new URL('./overlay.js', import.meta.url), 'utf8');

  const state: SessionState = {
    session,
    viewport: { preset: 'desktop', ...PRESETS.desktop },
    selections: [],
    recordings: [],
    recording: { phase: 'idle' },
  };
  let pending: PendingSelection | undefined;
  let launched: Awaited<ReturnType<typeof launchApp>> | undefined;
  let reviewContext: ReviewContext | undefined;
  let outcome: 'submitted' | 'discarded' | undefined;
  let ownsArtifacts = false;
  let endSession = () => {};
  const ended = new Promise<void>((resolve) => {
    endSession = () => resolve();
  });

  const machineLog = (value: unknown) => {
    if (process.env.PNT_MACHINE === '1') {
      console.log(JSON.stringify(value));
    }
  };

  const ensureOpen = () => {
    if (outcome) throw new Error('Session is already submitted or discarded');
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

  const discardPending = async () => {
    if (!pending) return;
    await deleteSessionArtifacts(pending.selection.imagePath);
    pending = undefined;
  };

  const recording = new RecordingController({
    state,
    artifactsDir,
    viewport: () => state.viewport,
    pageUrl: async () => (await pageContext()).url,
    openCapture: async (framesDir) => {
      await checkFfmpeg();
      const { page, subscribeClicks } = app();
      return startCapture(page, framesDir, subscribeClicks);
    },
    process: generateCuts,
  });

  const api = await startServer({
    getState: () => state,
    imagePath: (id) => {
      const selection = [...state.selections, ...(pending ? [pending.selection] : [])].find(
        (item) => item.selectionId === id,
      );
      if (selection) return selection.imagePath;
      const draft = state.recording.phase === 'draft' ? state.recording.recording : undefined;
      const recordings = draft ? [...state.recordings, draft] : state.recordings;
      return recordings.flatMap((item) => item.cuts).find((cut) => cut.cutId === id)?.imagePath;
    },
    applyViewport: async (viewport) => {
      // Keep the preset label, record the size the window could actually show.
      state.viewport = { preset: viewport.preset, ...(await app().setViewport(viewport)) };
    },
    captureSelection: async ({ coordinates, replaceId }) => {
      if (pending) throw new Error('Finish or delete the current capture first');
      const replaced = state.selections.find((item) => item.selectionId === replaceId);
      if (replaceId && !replaced) {
        throw new Error('Selection not found');
      }
      const { page } = app();
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
        comment: replaced?.comment ?? '',
        coordinates,
        viewport: { ...state.viewport },
        scroll,
        page: { url: pageUrl },
        createdAt: new Date().toISOString(),
        imagePath,
      };
      pending = { selection, replaced };
      return { state, draft: { kind: 'selection', selection } };
    },
    updateSelectionComment: async (selectionId, comment) => {
      if (pending?.selection.selectionId === selectionId) {
        const { selection, replaced } = pending;
        const saved = { ...selection, comment };
        state.selections = replaced
          ? state.selections.map((item) => (item.selectionId === replaced.selectionId ? saved : item))
          : [...state.selections, saved];
        if (replaced) await deleteSessionArtifacts(replaced.imagePath);
        pending = undefined;
        return state;
      }
      const selection = state.selections.find((item) => item.selectionId === selectionId);
      if (!selection) {
        throw new Error('Selection not found');
      }
      selection.comment = comment;
      return state;
    },
    deleteSelection: async (selectionId) => {
      if (pending?.selection.selectionId === selectionId) {
        await discardPending();
        return state;
      }
      const selection = state.selections.find((item) => item.selectionId === selectionId);
      if (selection) await deleteSessionArtifacts(selection.imagePath);
      state.selections = state.selections.filter((item) => item.selectionId !== selectionId);
      return state;
    },
    startRecording: async () => {
      await discardPending();
      return recording.start();
    },
    stopRecording: () => recording.stop(),
    processRecording: () => recording.process(),
    saveRecordingDraft: (comment) => recording.save(comment),
    deleteRecordingDraft: () => recording.delete(),
    updateRecordingComment: async (recordingId, comment) => {
      const item = state.recordings.find((item) => item.recordingId === recordingId);
      if (!item) throw new Error('Recording not found');
      item.comment = comment;
      return state;
    },
    deleteRecording: async (recordingId) => {
      if (!state.recordings.some((item) => item.recordingId === recordingId)) {
        throw new Error('Recording not found');
      }
      await deleteSessionArtifacts(cutsDir(artifactsDir, recordingId));
      state.recordings = state.recordings.filter((item) => item.recordingId !== recordingId);
      return state;
    },
    openReview: async () => {
      // Capture the accessibility tree before the review dialog hides the app.
      reviewContext = {
        ...(await pageContext()),
        accessibility: await app().page.ariaSnapshot().catch(() => undefined),
      };
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
      await recording.dispose();
      await discardPending();
      if (state.selections.length === 0 && state.recordings.length === 0) {
        throw new Error('Add at least one capture before submitting');
      }

      const context = await app().captureContext({
        redactCredentials,
        viewport: state.viewport,
        accessibility: reviewContext?.accessibility,
      });
      const contextArtifacts = await writeContextArtifacts(artifactsDir, context);
      const selections = structuredClone(state.selections);
      const recordings = structuredClone(state.recordings);
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
        imagePaths: [
          ...selections.map((selection) => selection.imagePath),
          ...recordings.flatMap((recording) => recording.cuts.map((cut) => cut.imagePath)),
        ],
        selections,
        recordings,
        context,
        artifactsDir,
        contextArtifacts,
        retrieval: {
          artifacts: `ls ${shellQuote(artifactsDir)}`,
        },
      };

      outcome = 'submitted';
      console.log(formatSubmit(manifest));
      machineLog(manifest);
      return manifest;
    },
    discard: async () => {
      await recording.dispose();
      await discardPending();
      outcome = 'discarded';
      return { discarded: true };
    },
    endSession,
  }, ensureOpen);

  try {
    await cleanupExpiredArtifacts(root);
    await mkdir(root, { recursive: true });
    try {
      // Reserving the directory makes a duplicate ref fail atomically, before
      // any browser or server state can touch the existing session.
      await mkdir(artifactsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Session ref collision: ${session.sessionRef}`);
      }
      throw error;
    }
    ownsArtifacts = true;
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
    await recording.dispose().catch(() => undefined);
    if (ownsArtifacts && outcome !== 'submitted') {
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
