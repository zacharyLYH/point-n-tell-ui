import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { freePort } from './fixtures.js';
import { ROOT } from './paths.js';
import type { SessionState } from '../../src/types.js';

export type Ready = {
  sessionRef: string;
  apiUrl: string;
  cdpUrl: string;
};

export async function launchCli(options: {
  url: string;
  profileDir: string;
  sessionId: string;
  cdpPort: number;
  env?: Record<string, string>;
}): Promise<{ child: ChildProcess; ready: Ready; output: () => string }> {
  const child = spawn(
    process.execPath,
    [
      join(ROOT, 'dist', 'cli.js'),
      options.url,
      '--harness',
      'Kilo',
      '--chat-title',
      'Checkout Bug',
      '--session-id',
      options.sessionId,
    ],
    {
      env: {
        ...process.env,
        PNT_PROFILE_DIR: options.profileDir,
        PNT_ARTIFACTS_DIR: join(options.profileDir, 'artifacts'),
        PNT_HEADLESS: '0',
        PNT_CDP_PORT: String(options.cdpPort),
        PNT_MACHINE: '1',
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const ready = await new Promise<Ready>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`CLI did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 30_000);

    const poll = setInterval(() => {
      const line = stdout
        .split('\n')
        .find((candidate) => candidate.startsWith('{'));
      if (!line) {
        return;
      }
      clearTimeout(timer);
      clearInterval(poll);
      try {
        resolve(JSON.parse(line) as Ready);
      } catch (error) {
        reject(error);
      }
    }, 25);

    child.once('exit', (code) => {
      clearTimeout(timer);
      clearInterval(poll);
      reject(
        new Error(`CLI exited with ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`),
      );
    });
  });

  return { child, ready, output: () => stdout };
}

export async function stopCli(child: ChildProcess): Promise<void> {
  // Listen before signalling so an immediate exit cannot be missed.
  const exited = waitForExit(child);
  child.kill('SIGINT');
  await exited;
}

export async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Tracks a session's browsers and CLI children, then tears everything down. */
export function trackSession(fixture: { url: string; close: () => Promise<void> }, profileDir: string) {
  const children: ChildProcess[] = [];
  const browsers: Browser[] = [];
  const dirs = new Set([profileDir]);
  return {
    children,
    browsers,
    /** Launches the CLI and connects to its app page, tracked for cleanup. */
    async launch(options: {
      sessionId: string;
      url?: string;
      env?: Record<string, string>;
      profileDir?: string;
    }) {
      const url = options.url ?? fixture.url;
      const dir = options.profileDir ?? profileDir;
      dirs.add(dir);
      const cli = await launchCli({
        url,
        profileDir: dir,
        sessionId: options.sessionId,
        cdpPort: await freePort(),
        env: options.env,
      });
      children.push(cli.child);
      const browser = await connect(cli.ready.cdpUrl);
      browsers.push(browser);
      const page = await appPage(browser, url);
      return {
        cli,
        browser,
        page,
        artifactsDir: join(dir, 'artifacts', cli.ready.sessionRef),
      };
    },
    async cleanup(): Promise<void> {
      for (const browser of browsers) await browser.close().catch(() => undefined);
      for (const child of children) await stopCli(child).catch(() => undefined);
      await fixture.close();
      for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function connect(cdpUrl: string): Promise<Browser> {
  return chromium.connectOverCDP(cdpUrl);
}

export async function appPage(browser: Browser, fixtureUrl: string): Promise<Page> {
  const context = browser.contexts()[0];
  const page = context.pages().find((candidate) => candidate.url().startsWith(fixtureUrl));
  if (!page) {
    throw new Error(`App page not found. Open pages: ${context.pages().map((p) => p.url()).join(', ')}`);
  }
  return page;
}

export async function expectCenteredWindow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    x: window.screenX,
    y: window.screenY,
    width: window.outerWidth,
    height: window.outerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  }));
  const left = Math.max(
    0,
    Math.round((metrics.screenWidth - Math.min(metrics.width, metrics.screenWidth)) / 2),
  );
  expect(Math.abs(metrics.x - left)).toBeLessThanOrEqual(2);
  // The window manager may keep the title bar below the menu bar, so compare
  // vertical centers with room for that offset.
  expect(Math.abs(metrics.y + metrics.height / 2 - metrics.screenHeight / 2)).toBeLessThanOrEqual(40);
}

/** Captures the drawn rectangle and saves it through the shared capture dialog. */
export async function captureSelection(page: Page, comment?: string): Promise<void> {
  const capture = page.getByRole('button', { name: 'Capture selection' });
  // Fails fast when no rectangle was drawn instead of retrying a disabled click.
  await expect(capture).toBeEnabled();
  await capture.click();
  const dialog = page.getByRole('dialog', { name: 'Save screenshot capture' });
  await expect(dialog).toBeVisible();
  if (comment !== undefined) {
    await dialog.getByLabel('Capture comment').fill(comment);
  }
  await dialog.getByRole('button', { name: 'Save capture' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start annotation' })).toBeVisible();
}

export async function drawSelection(
  page: Page,
  comment: string,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await page.getByRole('button', { name: 'Start annotation' }).click();
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 3 });
  await page.mouse.up();
  await captureSelection(page, comment);
}

export async function sessionState(apiUrl: string): Promise<SessionState> {
  return (await fetch(`${apiUrl}/state`)).json() as Promise<SessionState>;
}
