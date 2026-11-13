import { expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackSession } from './support/app.js';
import { startFixture } from './support/fixtures.js';
import { saveScreenshot } from './support/screenshots.js';

/**
 * Visual baselines for the recording flow: the recording bar (idle and
 * hovered), the FFmpeg blocking state, both comment dialogs, and the summary
 * carousel. Only elapsed/cut text moves between runs, so a small pixel
 * tolerance covers it.
 */
test('shows the recording bar, FFmpeg processing, and both comment dialogs', async () => {
  test.setTimeout(180_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(
    fixture,
    await mkdtemp(join(tmpdir(), 'pnt-record-visual-')),
  );

  try {
    const { page } = await launch({ url: fixture.url, sessionId: 'recording-visual' });
    const tab = page.getByRole('region', { name: 'Recording controls' });
    const stop = page.getByRole('button', { name: 'Stop recording' });

    // 1. The FFmpeg blocking state. The processing request is held so the state
    // can be captured, then that gated capture is deleted.
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute('data-state', 'recording');
    // Recording owns the top band: the toolbar is replaced by the recording bar.
    await expect(page.getByRole('region', { name: 'Point and Tell toolbar' })).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('64px');
    let releaseProcess!: () => void;
    const processGate = new Promise<void>((resolve) => {
      releaseProcess = resolve;
    });
    await page.route('**/recording/process', async (route) => {
      await processGate;
      await route.continue();
    });
    await tab.hover();
    await stop.click();
    await expect(page.getByRole('status', { name: /FFmpeg/ })).toBeVisible();
    await saveScreenshot(page, 'ffmpeg-processing.png', { maxDiffPixels: 600 });
    releaseProcess();
    const gated = page.getByRole('dialog', { name: 'Save video capture' });
    await expect(gated).toBeVisible();
    await gated.getByRole('button', { name: 'Delete' }).click();
    await expect(gated).toHaveCount(0);

    // 2. The recording bar, idle and with the stop control revealed on hover.
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute('data-state', 'recording');
    await page.mouse.move(40, 400);
    await expect(tab.getByRole('status', { name: 'Recording in progress' })).toBeVisible();
    await expect(stop).toBeHidden();
    await saveScreenshot(page, 'recording-in-progress.png', { maxDiffPixels: 600 });
    await tab.hover();
    await expect(stop).toBeVisible();
    await saveScreenshot(page, 'recording-stop-hover.png', { maxDiffPixels: 600 });

    const box = (css: string) =>
      page.evaluate((style) => {
        const marker = document.getElementById('record-marker') ?? document.createElement('div');
        marker.id = 'record-marker';
        marker.style.cssText = style;
        document.body.append(marker);
      }, css);

    await box('position:fixed;top:180px;left:120px;width:420px;height:300px;background:rgb(16,185,129)');
    await page.waitForTimeout(500);
    await box('position:fixed;top:180px;left:200px;width:420px;height:300px;background:rgb(220,38,38)');
    await page.waitForTimeout(500);
    await page.evaluate(() => document.getElementById('record-marker')?.remove());
    await page.waitForTimeout(400);

    await stop.click();
    const videoDialog = page.getByRole('dialog', { name: 'Save video capture' });
    await expect(videoDialog).toBeVisible();
    await expect(videoDialog.getByTestId('ffmpeg-status')).toHaveText('FFmpeg ✓');
    await videoDialog.getByLabel('Capture comment').fill('Checkout jump');
    await videoDialog.getByRole('button', { name: 'Save capture' }).focus();
    await saveScreenshot(page, 'comment-dialog-recording.png', { maxDiffPixels: 3000 });
    // The carousel holds every FFmpeg cut, one at a time.
    const position = videoDialog.getByTestId('cut-position');
    await expect(position).toHaveText(/^1 \/ [2-9]$/);
    await videoDialog.getByRole('button', { name: 'Next cut' }).click();
    await expect(position).toHaveText(/^2 \/ [2-9]$/);
    await expect(videoDialog.getByRole('img', { name: /Cut 2/ })).toBeVisible();
    await saveScreenshot(page, 'comment-dialog-recording-cut2.png', { maxDiffPixels: 3000 });
    await videoDialog.getByRole('button', { name: 'Save capture' }).click();
    await expect(videoDialog).toHaveCount(0);

    // 3. The same comment dialog for a screenshot capture.
    await page.getByRole('button', { name: 'Start annotation' }).click();
    await page.mouse.move(16, 84);
    await page.mouse.down();
    await page.mouse.move(320, 220, { steps: 4 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Capture selection' }).click();
    const shotDialog = page.getByRole('dialog', { name: 'Save screenshot capture' });
    await expect(shotDialog).toBeVisible();
    await shotDialog.getByLabel('Capture comment').fill('Checkout layout');
    await shotDialog.getByRole('button', { name: 'Save capture' }).focus();
    await saveScreenshot(page, 'comment-dialog-screenshot.png', { maxDiffPixels: 3000 });
    await shotDialog.getByRole('button', { name: 'Save capture' }).click();
    await expect(shotDialog).toHaveCount(0);

    // 4. The summary: capture list plus the recording's cut carousel.
    await page.getByRole('button', { name: 'Open session summary' }).click();
    const summary = page.getByRole('dialog', { name: 'Session summary' });
    await expect(summary).toBeVisible();
    await summary.getByRole('button', { name: /Recording 1/ }).click();
    await saveScreenshot(page, 'review-recordings.png', { maxDiffPixels: 3000 });
  } finally {
    await cleanup();
  }
});
