#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { closeApp, launchApp } from './browser.js';
import { startServer } from './server.js';
import { createSessionContext } from './session.js';
import { PRESETS, type SessionState } from './types.js';

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
  };
  let page: Awaited<ReturnType<typeof launchApp>>['page'] | undefined;

  const api = await startServer(
    () => state,
    async (viewport) => {
      if (!page) {
        throw new Error('App page is not ready');
      }
      await page.setViewportSize(viewport);
      state = { ...state, viewport };
    },
  );

  let launched: Awaited<ReturnType<typeof launchApp>> | undefined;

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
