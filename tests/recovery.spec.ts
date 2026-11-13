import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupExpiredArtifacts } from '../src/artifacts.js';
import type { SubmissionResult } from '../src/types.js';
import {
  drawSelection,
  pathExists,
  sessionState,
  startSession,
  stopCli,
  waitForExit,
} from './support/app.js';

const HEADLESS = { PNT_HEADLESS: '1' };

/** Decodes a saved WebP in the page so its pixel dimensions are asserted directly. */
async function imageDimensions(page: import('@playwright/test').Page, path: string): Promise<number[]> {
  const base64 = (await readFile(path)).toString('base64');
  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/webp;base64,${encoded}`;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, base64);
}

async function setViewport(
  page: import('@playwright/test').Page,
  button: RegExp,
  size: [number, number],
): Promise<void> {
  await page.getByRole('button', { name: button }).click();
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual(size);
}

test('rejects a duplicate live session ref without touching its state or artifacts', async () => {
  test.setTimeout(120_000);

  const { launch, cleanup } = await startSession('pnt-duplicate-');

  try {
    const first = await launch({ sessionId: 'duplicate ref', env: HEADLESS });
    await drawSelection(first.page, 'existing capture', [80, 120], [280, 260]);
    const beforeState = await sessionState(first.cli.ready.apiUrl);
    const beforeFiles = await readdir(first.artifactsDir);
    const beforeImage = await readFile(beforeState.selections[0].imagePath);

    await expect(launch({ sessionId: 'duplicate ref', env: HEADLESS })).rejects.toThrow(/collision/i);

    expect(await sessionState(first.cli.ready.apiUrl)).toEqual(beforeState);
    expect(await readdir(first.artifactsDir)).toEqual(beforeFiles);
    expect(await readFile(beforeState.selections[0].imagePath)).toEqual(beforeImage);
    await expect(first.page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('an expired duplicate ref is cleaned before the new session reserves it', async () => {
  test.setTimeout(120_000);

  const { profileDir, launch, cleanup } = await startSession('pnt-expired-ref-');
  const artifactsDir = join(profileDir, 'artifacts', 'kilo__checkout-bug__expired-ref');
  const stale = join(artifactsDir, 'stale.webp');
  const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

  try {
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(stale, 'stale');
    await utimes(artifactsDir, oldDate, oldDate);

    const { cli } = await launch({ sessionId: 'expired ref', env: HEADLESS });
    expect(cli.ready.sessionRef).toBe('kilo__checkout-bug__expired-ref');
    expect(await pathExists(stale)).toBe(false);
    expect(await readdir(artifactsDir)).toEqual([]);
  } finally {
    await cleanup();
  }
});

test('cleanup preserves the retention boundary and removes older sessions only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pnt-boundary-'));
  const previous = process.env.PNT_RETENTION_MS;
  const retention = 60 * 60_000;
  const now = Date.now();
  const young = join(root, 'kilo__young__session');
  const old = join(root, 'kilo__old__session');

  try {
    process.env.PNT_RETENTION_MS = String(retention);
    await mkdir(young, { recursive: true });
    await mkdir(old, { recursive: true });
    await writeFile(join(young, 'selection.webp'), 'young');
    await writeFile(join(old, 'selection.webp'), 'old');
    await utimes(young, new Date(now - 59 * 60_000), new Date(now - 59 * 60_000));
    await utimes(old, new Date(now - 61 * 60_000), new Date(now - 61 * 60_000));

    expect(await cleanupExpiredArtifacts(root)).toEqual([old]);
    expect(await pathExists(young)).toBe(true);
    expect(await pathExists(old)).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.PNT_RETENTION_MS;
    else process.env.PNT_RETENTION_MS = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('cleanup ignores malformed roots and entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pnt-malformed-'));
  const missing = join(root, 'missing');
  const notASession = join(root, 'not-a-session');
  const session = join(root, 'kilo__ok__session');

  try {
    await writeFile(notASession, 'not a directory');
    await mkdir(session, { recursive: true });

    expect(await cleanupExpiredArtifacts(missing)).toEqual([]);
    expect(await cleanupExpiredArtifacts(notASession)).toEqual([]);
    expect(await cleanupExpiredArtifacts(root)).toEqual([]);
    expect(await pathExists(notASession)).toBe(true);
    expect(await pathExists(session)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('malformed artifact entries do not block launch or cleanup of other sessions', async () => {
  test.setTimeout(120_000);

  const { profileDir, launch, cleanup } = await startSession('pnt-malformed-launch-');
  const root = join(profileDir, 'artifacts');
  const notASession = join(root, 'not-a-directory');
  const expired = join(root, 'kilo__old__session');
  const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

  try {
    await mkdir(root, { recursive: true });
    await writeFile(notASession, 'not a directory');
    await mkdir(expired, { recursive: true });
    await utimes(expired, oldDate, oldDate);

    const { cli, page } = await launch({ sessionId: 'malformed-run', env: HEADLESS });

    expect((await sessionState(cli.ready.apiUrl)).session.sessionRef).toBe(cli.ready.sessionRef);
    expect(await pathExists(notASession)).toBe(true);
    expect(await pathExists(expired)).toBe(false);
    await expect(page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('hard kill leaves artifacts while another live session keeps working', async () => {
  test.setTimeout(180_000);

  const { launch, cleanup } = await startSession('pnt-hard-kill-');

  try {
    const first = await launch({ sessionId: 'hard-kill-a', env: HEADLESS });
    const second = await launch({ sessionId: 'hard-kill-b', env: HEADLESS });
    await drawSelection(first.page, 'killed capture', [80, 120], [280, 260]);
    await drawSelection(second.page, 'surviving capture', [60, 100], [140, 180]);
    expect(await pathExists(first.artifactsDir)).toBe(true);

    first.cli.child.kill('SIGKILL');
    await waitForExit(first.cli.child);

    expect(await pathExists(first.artifactsDir)).toBe(true);
    expect((await sessionState(second.cli.ready.apiUrl)).selections).toHaveLength(1);
    await expect(second.page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();

    // Release the killed CLI's browser so its profile lock cannot outlive the test.
    const cdp = await first.browser.newBrowserCDPSession().catch(() => undefined);
    await cdp?.send('Browser.close').catch(() => undefined);

    await stopCli(second.cli.child);
    expect(await pathExists(second.artifactsDir)).toBe(false);
    expect(await pathExists(first.artifactsDir)).toBe(true);
  } finally {
    await cleanup();
  }
});

test('concurrent sessions isolate viewports, captures, edits, and lifecycle', async () => {
  test.setTimeout(180_000);

  const { profileDir, launch, cleanup } = await startSession('pnt-concurrent-');

  try {
    const first = await launch({ sessionId: 'concurrent-a', env: HEADLESS });
    const second = await launch({ sessionId: 'concurrent-b', env: HEADLESS });
    expect(first.artifactsDir).not.toBe(second.artifactsDir);
    expect(first.artifactsDir.startsWith(join(profileDir, 'artifacts'))).toBe(true);
    expect(second.artifactsDir.startsWith(join(profileDir, 'artifacts'))).toBe(true);

    await setViewport(first.page, /Tablet viewport/, [768, 1024]);
    await setViewport(second.page, /Mobile viewport/, [390, 844]);
    await drawSelection(first.page, 'first capture', [100, 150], [300, 320]);
    await drawSelection(second.page, 'second capture', [60, 100], [140, 180]);

    const firstState = await sessionState(first.cli.ready.apiUrl);
    const secondState = await sessionState(second.cli.ready.apiUrl);
    expect(firstState.selections[0].viewport).toEqual({ preset: 'tablet', width: 768, height: 1024 });
    expect(secondState.selections[0].viewport).toEqual({ preset: 'mobile', width: 390, height: 844 });
    expect(await imageDimensions(first.page, firstState.selections[0].imagePath)).toEqual([200, 170]);
    expect(await imageDimensions(second.page, secondState.selections[0].imagePath)).toEqual([80, 80]);

    const firstId = firstState.selections[0].selectionId;
    expect(
      (
        await fetch(`${first.cli.ready.apiUrl}/selection/${firstId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ comment: 'first edited' }),
        })
      ).status,
    ).toBe(200);
    expect((await sessionState(first.cli.ready.apiUrl)).selections[0].comment).toBe('first edited');
    expect((await sessionState(second.cli.ready.apiUrl)).selections[0].comment).toBe('second capture');

    expect((await fetch(`${first.cli.ready.apiUrl}/selection/${firstId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await sessionState(first.cli.ready.apiUrl)).selections).toHaveLength(0);
    expect((await sessionState(second.cli.ready.apiUrl)).selections).toHaveLength(1);

    expect(await (await fetch(`${first.cli.ready.apiUrl}/discard`, { method: 'POST' })).json()).toEqual({
      discarded: true,
    });
    await waitForExit(first.cli.child);
    expect(await pathExists(first.artifactsDir)).toBe(false);
    expect(await pathExists(second.artifactsDir)).toBe(true);
    expect((await sessionState(second.cli.ready.apiUrl)).selections).toHaveLength(1);
    await expect(second.page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();

    const manifest = (await (
      await fetch(`${second.cli.ready.apiUrl}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redactCredentials: true }),
      })
    ).json()) as SubmissionResult;
    expect(manifest.session.sessionRef).toBe(second.cli.ready.sessionRef);
    expect(manifest.selections).toHaveLength(1);
    expect(manifest.selections[0].comment).toBe('second capture');

    await waitForExit(second.cli.child);
    expect(await pathExists(second.artifactsDir)).toBe(true);
  } finally {
    await cleanup();
  }
});
