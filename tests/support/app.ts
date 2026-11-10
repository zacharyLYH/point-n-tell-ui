import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
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
}): Promise<{ child: ChildProcess; ready: Ready }> {
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
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const ready = await new Promise<Ready>((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => {
      reject(new Error(`CLI did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 30_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const line = stdout
        .split('\n')
        .find((candidate) => candidate.startsWith('{'));
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line) as Ready);
      }
    });

    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(
        new Error(`CLI exited with ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`),
      );
    });
  });

  return { child, ready };
}

export async function stopCli(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGINT');
  });
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

export async function drawSelection(
  page: Page,
  comment: string,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await page.getByRole('button', { name: 'Start annotation' }).click();
  await page.getByLabel('Selection comment').fill(comment);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 3 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save selection' }).click();
  await expect(page.getByRole('button', { name: 'Start annotation' })).toBeVisible();
}

export async function sessionState(apiUrl: string): Promise<SessionState> {
  return (await fetch(`${apiUrl}/state`)).json() as Promise<SessionState>;
}
