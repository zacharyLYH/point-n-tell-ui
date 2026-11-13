import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { SubmissionResult } from '../src/types.js';
import {
  captureSelection,
  pathExists,
  sessionState,
  stopCli,
  trackSession,
  waitForExit,
} from './support/app.js';
import { startFixture } from './support/fixtures.js';

test('records the viewport, generates ordered cuts, and submits the video capture', async () => {
  test.setTimeout(180_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(fixture, await mkdtemp(join(tmpdir(), 'pnt-record-')));

  try {
    const { cli, page, artifactsDir } = await launch({ url: fixture.url, sessionId: 'record-flow' });

    await page.getByRole('button', { name: 'Start recording' }).click();

    // The toolbar is gone from the page, so it cannot appear in the video.
    await expect(page.getByRole('region', { name: 'Point and Tell toolbar' })).toHaveCount(0);
    const tab = page.getByRole('region', { name: 'Recording controls' });
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute('data-state', 'recording');
    await expect(tab.getByRole('status', { name: 'Recording in progress' })).toBeVisible();

    // The app stays fully interactive while recording.
    await page.locator('#app-button').click();
    await expect(page.locator('body')).toHaveAttribute('data-clicked', 'yes');

    // Visible pixel changes become intermediate cuts.
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'record-marker';
      box.style.cssText =
        'position:fixed;top:200px;left:100px;width:420px;height:320px;background:rgb(16,185,129)';
      document.body.append(box);
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const box = document.getElementById('record-marker')!;
      box.style.background = 'rgb(220,38,38)';
      box.style.left = '180px';
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => document.getElementById('record-marker')!.remove());
    await page.waitForTimeout(400);

    // Hovering the small tab reveals the stop control.
    await tab.hover();
    await page.getByRole('button', { name: 'Stop recording' }).click();

    const dialog = page.getByRole('dialog', { name: 'Save video capture' });
    await expect(dialog).toBeVisible();
    const position = dialog.getByTestId('cut-position');
    await expect(position).toHaveText(/^1 \/ \d+$/);
    const count = Number((await position.textContent())!.split('/')[1].trim());
    expect(count).toBeGreaterThanOrEqual(4);
    await expect(dialog.getByRole('img', { name: /Cut 1 · .*first/ })).toBeVisible();

    // One cut at a time, in timestamp order.
    await dialog.getByRole('button', { name: 'Next cut' }).click();
    await expect(position).toHaveText(`2 / ${count}`);
    await dialog.getByRole('button', { name: 'Previous cut' }).click();
    await expect(position).toHaveText(`1 / ${count}`);
    await expect(dialog.getByRole('button', { name: 'Next cut' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Previous cut' })).toBeDisabled();

    await dialog.getByLabel('Capture comment').fill('Checkout jump');
    await dialog.getByRole('button', { name: 'Save capture' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();
    await expect(page.getByRole('status', { name: '1 saved captures' })).toBeVisible();

    const saved = await sessionState(cli.ready.apiUrl);
    expect(saved.recordings).toHaveLength(1);
    const [recording] = saved.recordings;
    expect(recording.comment).toBe('Checkout jump');
    // The applied viewport can be clamped by the display, so compare with the
    // session's. Cuts exclude the reserved Point and Tell band.
    expect(recording.viewport).toEqual({
      ...saved.viewport,
      height: saved.viewport.height - 64,
    });
    expect(recording.viewport.preset).toBe('desktop');
    expect(recording.page.url).toBe(new URL(fixture.url).href);
    expect(recording.durationMs).toBeGreaterThan(0);
    expect(Date.parse(recording.endedAt)).toBeGreaterThanOrEqual(Date.parse(recording.startedAt));
    expect(recording.cuts.length).toBe(count);
    expect(recording.cuts.map((cut) => cut.number)).toEqual(
      recording.cuts.map((_, index) => index + 1),
    );
    expect(recording.cuts[0].tags).toContain('first');
    expect(recording.cuts.at(-1)!.tags).toContain('last');
    expect(recording.cuts.some((cut) => cut.tags.includes('click'))).toBe(true);
    expect(recording.cuts.every((cut) => cut.diffScore >= 0)).toBe(true);
    const times = recording.cuts.map((cut) => Date.parse(cut.timestamp));
    expect([...times].sort((first, second) => first - second)).toEqual(times);

    // Cut artifacts are readable, sized to the viewport, and the source video
    // and frame scratch directory are gone.
    const cutsDir = dirname(recording.cuts[0].imagePath);
    expect(dirname(cutsDir)).toBe(artifactsDir);
    expect((await readdir(cutsDir)).sort()).toEqual(
      recording.cuts.map((cut) => basename(cut.imagePath)).sort(),
    );
    const firstCut = await readFile(recording.cuts[0].imagePath);
    expect(firstCut.subarray(0, 2).toString('latin1')).toBe('\xff\xd8');
    const cutSize = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/jpeg;base64,${base64}`;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, firstCut.toString('base64'));
    expect(cutSize).toEqual([recording.viewport.width, recording.viewport.height]);
    expect((await readdir(artifactsDir)).some((name) => name.startsWith('.frames-'))).toBe(false);

    // Screenshot captures go through the same capture-to-comment modal.
    await page.getByRole('button', { name: 'Start annotation' }).click();
    await page.mouse.move(80, 220);
    await page.mouse.down();
    await page.mouse.move(300, 380, { steps: 4 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Capture selection' }).click();
    const shotDialog = page.getByRole('dialog', { name: 'Save screenshot capture' });
    await expect(shotDialog).toBeVisible();
    expect((await sessionState(cli.ready.apiUrl)).selections).toHaveLength(0);
    await shotDialog.getByLabel('Capture comment').fill('Checkout layout');
    await shotDialog.getByRole('button', { name: 'Save capture' }).click();
    await expect(shotDialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Open session summary' }).click();
    const summary = page.getByRole('dialog', { name: 'Session summary' });
    await expect(summary).toBeVisible();
    await expect(page.getByText(/2 included/)).toBeVisible();
    const list = page.getByRole('navigation', { name: 'Saved selections' });
    await expect(list.getByText('Recording 1')).toBeVisible();
    await expect(list.getByText(`${count} cuts`)).toBeVisible();
    await expect(list.getByText('Selection 1')).toBeVisible();

    // Submitting closes the session as soon as the response is flushed, so the
    // page can go away before the response is observed.
    const submitResponse = page
      .waitForResponse((response) => response.url().endsWith('/submit'))
      .catch(() => undefined);
    await page.getByRole('button', { name: 'Submit' }).click();
    await waitForExit(cli.child);
    expect((await submitResponse)?.ok() ?? true).toBe(true);
    const result = JSON.parse(
      cli.output().split('\n').filter((line) => line.startsWith('{')).at(-1)!,
    ) as SubmissionResult;

    expect(result.selectionCount).toBe(1);
    expect(result.recordings).toHaveLength(1);
    expect(result.recordings[0].comment).toBe('Checkout jump');
    expect(result.recordings[0].cuts.map((cut) => cut.imagePath)).toEqual(
      recording.cuts.map((cut) => cut.imagePath),
    );
    expect(result.imagePaths).toEqual([
      ...result.selections.map((selection) => selection.imagePath),
      ...result.recordings[0].cuts.map((cut) => cut.imagePath),
    ]);
    for (const imagePath of result.imagePaths) {
      expect(await pathExists(imagePath)).toBe(true);
    }
    // Media stays on disk: no inline bytes and no source video in the payload.
    expect(JSON.stringify(result.recordings)).not.toContain('base64');
    expect(await pathExists(join(cutsDir, 'recording.webm'))).toBe(false);
    expect(cli.output()).toContain('Checkout jump');
    expect(cli.output()).toContain(recording.cuts[0].imagePath);
  } finally {
    await cleanup();
  }
});

test('records every click as a cut even without pixel changes', async () => {
  test.setTimeout(120_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(fixture, await mkdtemp(join(tmpdir(), 'pnt-click-cuts-')));

  try {
    const { cli, page } = await launch({ url: fixture.url, sessionId: 'click-cuts' });
    const tab = page.getByRole('region', { name: 'Recording controls' });

    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(tab).toHaveAttribute('data-state', 'recording');

    // The button changes no pixels, so these cuts can only come from clicks.
    const button = page.locator('#app-button');
    await button.click();
    await button.click();
    await page.waitForTimeout(350);
    await button.click();

    await tab.hover();
    await page.getByRole('button', { name: 'Stop recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save video capture' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Capture comment').fill('Click cuts');
    await dialog.getByRole('button', { name: 'Save capture' }).click();
    await expect(dialog).toHaveCount(0);

    const [recording] = (await sessionState(cli.ready.apiUrl)).recordings;
    const clickCuts = recording.cuts.filter((cut) => cut.tags.includes('click'));
    expect(clickCuts).toHaveLength(3);
    expect(new Set(clickCuts.map((cut) => cut.cutId)).size).toBe(3);
    expect(clickCuts.map((cut) => cut.number)).toEqual(
      [...clickCuts.map((cut) => cut.number)].sort((first, second) => first - second),
    );
  } finally {
    await cleanup();
  }
});

test('only pixel changes above 10% become pixel-diff cuts', async () => {
  test.setTimeout(120_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(fixture, await mkdtemp(join(tmpdir(), 'pnt-diff-cuts-')));

  try {
    const { cli, page } = await launch({ url: fixture.url, sessionId: 'diff-cuts' });
    const tab = page.getByRole('region', { name: 'Recording controls' });

    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(tab).toHaveAttribute('data-state', 'recording');

    // Roughly 2% of the viewport: below the 10% threshold, so no cut.
    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.id = 'small-marker';
      marker.style.cssText =
        'position:fixed;top:200px;left:100px;width:180px;height:140px;background:rgb(16,185,129)';
      document.body.append(marker);
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => document.getElementById('small-marker')!.remove());
    await page.waitForTimeout(600);

    // Roughly 40% of the viewport: above the 10% threshold on add and remove.
    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.id = 'large-marker';
      marker.style.cssText =
        'position:fixed;top:200px;left:100px;width:70vw;height:60vh;background:rgb(220,38,38)';
      document.body.append(marker);
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => document.getElementById('large-marker')!.remove());
    await page.waitForTimeout(600);

    await tab.hover();
    await page.getByRole('button', { name: 'Stop recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save video capture' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Capture comment').fill('Diff cuts');
    await dialog.getByRole('button', { name: 'Save capture' }).click();
    await expect(dialog).toHaveCount(0);

    const [recording] = (await sessionState(cli.ready.apiUrl)).recordings;
    // First, large add, large remove, last. The small marker adds nothing.
    expect(recording.cuts).toHaveLength(4);
    expect(recording.cuts[0].tags).toContain('first');
    expect(recording.cuts.at(-1)!.tags).toContain('last');
    expect(recording.cuts.every((cut) => cut.tags.includes('click'))).toBe(false);
    for (const cut of recording.cuts.slice(1, -1)) {
      expect(cut.diffScore).toBeGreaterThan(0.1);
    }
  } finally {
    await cleanup();
  }
});

test('compares each candidate against the last kept cut', async () => {
  test.setTimeout(120_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(
    fixture,
    await mkdtemp(join(tmpdir(), 'pnt-benchmark-cuts-')),
  );

  try {
    const { cli, page } = await launch({ url: fixture.url, sessionId: 'benchmark-cuts' });
    const tab = page.getByRole('region', { name: 'Recording controls' });

    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(tab).toHaveAttribute('data-state', 'recording');

    // Each marker is roughly 6% of the viewport. The first is below the
    // threshold; the second clears 10% only when compared with the first cut.
    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.id = 'small-marker-a';
      marker.style.cssText =
        'position:fixed;top:200px;left:100px;width:20vw;height:30vh;background:rgb(16,185,129)';
      document.body.append(marker);
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.id = 'small-marker-b';
      marker.style.cssText =
        'position:fixed;top:520px;left:100px;width:20vw;height:30vh;background:rgb(220,38,38)';
      document.body.append(marker);
    });
    await page.waitForTimeout(700);

    await tab.hover();
    await page.getByRole('button', { name: 'Stop recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save video capture' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Capture comment').fill('Benchmark cuts');
    await dialog.getByRole('button', { name: 'Save capture' }).click();
    await expect(dialog).toHaveCount(0);

    const [recording] = (await sessionState(cli.ready.apiUrl)).recordings;
    // First, the second marker, last. The first marker adds no cut on its own.
    expect(recording.cuts).toHaveLength(3);
    expect(recording.cuts[1].diffScore).toBeGreaterThan(0.1);
  } finally {
    await cleanup();
  }
});

test('records chrome-free cuts at desktop, tablet, and mobile sizes', async () => {
  test.setTimeout(180_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(
    fixture,
    await mkdtemp(join(tmpdir(), 'pnt-record-viewports-')),
  );
  const presets = [
    { label: 'desktop', button: /Desktop viewport/, width: 1440, height: 900 },
    { label: 'tablet', button: /Tablet viewport/, width: 768, height: 1024 },
    { label: 'mobile', button: /Mobile viewport/, width: 390, height: 844 },
  ] as const;

  try {
    const { cli, page } = await launch({ url: fixture.url, sessionId: 'record-viewports' });
    const tab = page.getByRole('region', { name: 'Recording controls' });
    const stop = page.getByRole('button', { name: 'Stop recording' });

    for (const preset of presets) {
      await page.getByRole('button', { name: preset.button }).click();
      await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([
        preset.width,
        preset.height,
      ]);

      await page.getByRole('button', { name: 'Start recording' }).click();
      await expect(tab).toBeVisible();
      await expect(tab).toHaveAttribute('data-state', 'recording');
      // The stop control only surfaces on hover.
      await expect(stop).toBeHidden();
      // The 64px band stays reserved: it is chrome, never app content.
      expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('64px');

      await page.evaluate(() => {
        const marker = document.createElement('div');
        marker.id = 'record-marker';
        marker.style.cssText =
          'position:fixed;top:160px;left:40px;width:70vw;height:60vh;background:rgb(37,99,235)';
        document.body.append(marker);
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => document.getElementById('record-marker')?.remove());
      await page.waitForTimeout(400);

      await tab.hover();
      await stop.click();
      const dialog = page.getByRole('dialog', { name: 'Save video capture' });
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('64px');
      await dialog.getByLabel('Capture comment').fill(`${preset.label} recording`);
      await dialog.getByRole('button', { name: 'Save capture' }).click();
      await expect(dialog).toHaveCount(0);
    }

    const state = await sessionState(cli.ready.apiUrl);
    expect(state.recordings).toHaveLength(presets.length);
    expect(state.recordings.map((recording) => recording.viewport)).toEqual(
      presets.map((preset) => ({ preset: preset.label, width: preset.width, height: preset.height - 64 })),
    );

    for (const [index, recording] of state.recordings.entries()) {
      const preset = presets[index];
      expect(recording.cuts[0].tags).toContain('first');
      expect(recording.cuts.at(-1)!.tags).toContain('last');
      expect(recording.cuts.length).toBeGreaterThanOrEqual(3);

      for (const cut of recording.cuts) {
        const image = await readFile(cut.imagePath);
        expect(image.subarray(0, 2).toString('latin1')).toBe('\xff\xd8');
        const frame = await page.evaluate(async (base64) => {
          const decoded = new Image();
          decoded.src = `data:image/jpeg;base64,${base64}`;
          await decoded.decode();
          const canvas = document.createElement('canvas');
          canvas.width = decoded.naturalWidth;
          canvas.height = decoded.naturalHeight;
          const context = canvas.getContext('2d')!;
          context.drawImage(decoded, 0, 0);
          // The whole top strip: the toolbar band, the recording pill, and the
          // red recording ring would all land here if Point and Tell leaked in.
          const box = { x: 0, y: 0, width: canvas.width, height: 64 };
          const pixels = context.getImageData(box.x, box.y, box.width, box.height).data;
          let red = 0;
          let dark = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset] > pixels[offset + 1] + 60 && pixels[offset] > pixels[offset + 2] + 60) {
              red += 1;
            }
            if (pixels[offset] < 80 && pixels[offset + 1] < 80 && pixels[offset + 2] < 80) {
              dark += 1;
            }
          }
          const total = box.width * box.height;
          return {
            width: canvas.width,
            height: canvas.height,
            redRatio: red / total,
            darkRatio: dark / total,
          };
        }, image.toString('base64'));

        const label = `${preset.label} cut ${cut.number}/${recording.cuts.length}`;
        expect([frame.width, frame.height], label).toEqual([preset.width, preset.height - 64]);
        expect(frame.redRatio, label).toBeLessThan(0.005);
        // The app heading sits in the top strip: no empty 64px band.
        expect(frame.darkRatio, label).toBeGreaterThan(0.001);
      }
    }
  } finally {
    await cleanup();
  }
});

test('reviews, edits, and deletes a saved video capture', async () => {
  test.setTimeout(180_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(
    fixture,
    await mkdtemp(join(tmpdir(), 'pnt-record-review-')),
  );

  try {
    const { cli, page } = await launch({ url: fixture.url, sessionId: 'record-review' });

    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.locator('#app-button').click();
    await page.waitForTimeout(500);
    await page.getByRole('region', { name: 'Recording controls' }).hover();
    await page.getByRole('button', { name: 'Stop recording' }).click();
    const capture = page.getByRole('dialog', { name: 'Save video capture' });
    await expect(capture).toBeVisible();
    await capture.getByLabel('Capture comment').fill('Jump here');
    await capture.getByRole('button', { name: 'Save capture' }).click();
    await expect(capture).toHaveCount(0);

    const [recording] = (await sessionState(cli.ready.apiUrl)).recordings;
    const cutPaths = recording.cuts.map((cut) => cut.imagePath);
    const cutsDir = dirname(cutPaths[0]);

    await page.getByRole('button', { name: 'Open session summary' }).click();
    const dialog = page.getByRole('dialog', { name: 'Session summary' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Saved selections' }).getByText('Recording 1')).toBeVisible();
    await expect(dialog.getByRole('img', { name: /Cut 1 · / })).toBeVisible();
    await expect(dialog.getByLabel('Capture comment')).toHaveValue('Jump here');
    // Saved recordings can be re-commented, not retaken.
    await expect(dialog.getByRole('button', { name: 'Capture again' })).toHaveCount(0);

    await dialog.getByLabel('Capture comment').fill('Jump here, edited');
    await dialog.getByRole('button', { name: 'Save comment' }).click();
    await expect(dialog.getByRole('button', { name: 'Save comment' })).toBeDisabled();

    const edited = await sessionState(cli.ready.apiUrl);
    expect(edited.recordings[0].comment).toBe('Jump here, edited');
    expect(edited.recordings[0].cuts.map((cut) => cut.imagePath)).toEqual(cutPaths);
    for (const cutPath of cutPaths) {
      expect(await pathExists(cutPath)).toBe(true);
    }

    await dialog.getByRole('button', { name: 'Delete recording' }).click();
    await expect(dialog.getByText('No captures remain.')).toBeVisible();
    await expect.poll(async () => (await sessionState(cli.ready.apiUrl)).recordings.length).toBe(0);
    expect(await pathExists(cutsDir)).toBe(false);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('status', { name: '0 saved captures' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit' })).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('screenshot captures save or delete through the shared capture modal', async () => {
  test.setTimeout(120_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(fixture, await mkdtemp(join(tmpdir(), 'pnt-capture-modal-')));

  try {
    const { cli, page, artifactsDir } = await launch({ url: fixture.url, sessionId: 'capture-modal' });

    const draw = async () => {
      await page.getByRole('button', { name: 'Start annotation' }).click();
      await page.mouse.move(90, 200);
      await page.mouse.down();
      await page.mouse.move(280, 340, { steps: 3 });
      await page.mouse.up();
      await page.getByRole('button', { name: 'Capture selection' }).click();
    };

    await draw();
    const dialog = page.getByRole('dialog', { name: 'Save screenshot capture' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'Screenshot' })).toBeVisible();
    await expect(dialog.getByTestId('cut-position')).toHaveText('1 / 1');
    // The capture exists as a draft only; nothing is saved until the comment is.
    expect((await sessionState(cli.ready.apiUrl)).selections).toHaveLength(0);

    await dialog.getByLabel('Capture comment').fill('Modal capture');
    await dialog.getByRole('button', { name: 'Save capture' }).click();
    await expect(dialog).toHaveCount(0);

    let state = await sessionState(cli.ready.apiUrl);
    expect(state.selections.map((selection) => selection.comment)).toEqual(['Modal capture']);
    expect((await readFile(state.selections[0].imagePath)).toString('ascii', 8, 12)).toBe('WEBP');

    // Deleting from the modal removes the pending image and saves nothing.
    await draw();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog).toHaveCount(0);
    state = await sessionState(cli.ready.apiUrl);
    expect(state.selections).toHaveLength(1);
    expect((await readdir(artifactsDir)).filter((name) => name.endsWith('.webp'))).toEqual([
      basename(state.selections[0].imagePath),
    ]);
    await expect(page.getByRole('status', { name: '1 saved captures' })).toBeVisible();

    await draw();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Capture comment').fill('Second modal capture');
    await dialog.getByRole('button', { name: 'Save capture' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await sessionState(cli.ready.apiUrl)).selections).toHaveLength(2);
  } finally {
    await cleanup();
  }
});

test('deleting or dismissing an unsaved recording draft removes its cuts', async () => {
  test.setTimeout(180_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(fixture, await mkdtemp(join(tmpdir(), 'pnt-draft-delete-')));

  try {
    const { cli, page, artifactsDir } = await launch({ url: fixture.url, sessionId: 'draft-delete' });

    const record = async () => {
      await page.getByRole('button', { name: 'Start recording' }).click();
      await page.locator('#app-button').click();
      await page.waitForTimeout(450);
      await page.getByRole('region', { name: 'Recording controls' }).hover();
      await page.getByRole('button', { name: 'Stop recording' }).click();
      const dialog = page.getByRole('dialog', { name: 'Save video capture' });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const draftCutsDir = async () => {
      const state = await sessionState(cli.ready.apiUrl);
      if (state.recording.phase !== 'draft') throw new Error('Expected a recording draft');
      return dirname(state.recording.recording.cuts[0].imagePath);
    };

    const deleted = await record();
    const firstCuts = await draftCutsDir();
    expect(await pathExists(firstCuts)).toBe(true);
    await deleted.getByRole('button', { name: 'Delete' }).click();
    await expect(deleted).toHaveCount(0);

    let state = await sessionState(cli.ready.apiUrl);
    expect(state.recordings).toEqual([]);
    expect(state.recording.phase).toBe('idle');
    expect(await pathExists(firstCuts)).toBe(false);
    expect((await readdir(artifactsDir)).filter((name) => name.startsWith('rec-'))).toEqual([]);
    await expect(page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();

    const dismissed = await record();
    const secondCuts = await draftCutsDir();
    await dismissed.getByRole('button', { name: 'Close' }).click();
    await expect(dismissed).toHaveCount(0);

    state = await sessionState(cli.ready.apiUrl);
    expect(state.recordings).toEqual([]);
    expect(state.recording.phase).toBe('idle');
    expect(await pathExists(secondCuts)).toBe(false);
    expect((await readdir(artifactsDir)).filter((name) => name.startsWith('rec-'))).toEqual([]);
  } finally {
    await cleanup();
  }
});

test('disconnect or cancellation while recording removes frames and artifacts', async () => {
  test.setTimeout(180_000);

  const fixture = await startFixture();
  const { launch, cleanup } = trackSession(
    fixture,
    await mkdtemp(join(tmpdir(), 'pnt-record-abort-')),
  );

  const start = async (sessionId: string) => {
    const recording = await launch({ url: fixture.url, sessionId });
    await recording.page.getByRole('button', { name: 'Start recording' }).click();
    await expect(recording.page.getByRole('region', { name: 'Recording controls' })).toBeVisible();
    await expect
      .poll(async () => (await readdir(recording.artifactsDir)).some((name) => name.startsWith('.frames-')))
      .toBe(true);
    return recording;
  };

  try {
    const disconnected = await start('record-disconnect');
    await disconnected.page.close();
    await waitForExit(disconnected.cli.child);
    expect(await pathExists(disconnected.artifactsDir)).toBe(false);

    const cancelled = await start('record-cancel');
    await stopCli(cancelled.cli.child);
    expect(await pathExists(cancelled.artifactsDir)).toBe(false);
  } finally {
    await cleanup();
  }
});

test('recording reports FFmpeg problems and never saves a partial capture', async () => {
  test.setTimeout(180_000);

  const fixture = await startFixture();
  const profileDir = await mkdtemp(join(tmpdir(), 'pnt-ffmpeg-'));
  const failingDir = await mkdtemp(join(tmpdir(), 'pnt-ffmpeg-fail-'));
  const session = trackSession(fixture, profileDir);

  try {
    // Missing FFmpeg is reported before any recording starts.
    const missing = await session.launch({
      url: fixture.url,
      sessionId: 'ffmpeg-missing',
      env: { PNT_FFMPEG: join(profileDir, 'missing-ffmpeg') },
    });
    const missingPage = missing.page;

    await missingPage.getByRole('button', { name: 'Start recording' }).click();
    await expect(missingPage.getByRole('alert')).toContainText(/FFmpeg/);
    await expect(
      missingPage.getByRole('region', { name: 'Point and Tell toolbar' }),
    ).toBeVisible();
    await expect(missingPage.getByRole('region', { name: 'Recording controls' })).toHaveCount(0);
    expect((await sessionState(missing.cli.ready.apiUrl)).recordings).toHaveLength(0);
    await stopCli(missing.cli.child);
    await missing.browser.close().catch(() => undefined);

    // FFmpeg that passes the version check but fails while cutting must not
    // leave frames, cuts, or a saved capture behind.
    const fake = join(profileDir, 'fake-ffmpeg.sh');
    await writeFile(
      fake,
      '#!/bin/sh\nif [ "$1" = "-version" ]; then echo "ffmpeg version 7.1"; exit 0; fi\necho "fake failure" >&2\nexit 1\n',
      { mode: 0o755 },
    );

    const failing = await session.launch({
      url: fixture.url,
      profileDir: failingDir,
      sessionId: 'ffmpeg-failing',
      env: { PNT_FFMPEG: fake },
    });
    const { page, artifactsDir } = failing;

    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.locator('#app-button').click();
    await page.waitForTimeout(400);
    await page.getByRole('region', { name: 'Recording controls' }).hover();
    await page.getByRole('button', { name: 'Stop recording' }).click();

    await expect(page.getByRole('alert')).toContainText(/FFmpeg failed/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();
    const state = await sessionState(failing.cli.ready.apiUrl);
    expect(state.recordings).toEqual([]);
    expect(await pathExists(artifactsDir)).toBe(true);
    expect(await readdir(artifactsDir)).toEqual([]);

    // The session is still usable after a failed processing run.
    await page.getByRole('button', { name: 'Start annotation' }).click();
    await page.mouse.move(90, 200);
    await page.mouse.down();
    await page.mouse.move(280, 340, { steps: 3 });
    await page.mouse.up();
    await captureSelection(page, 'After failure');
    expect((await sessionState(failing.cli.ready.apiUrl)).selections).toHaveLength(1);
  } finally {
    await session.cleanup();
  }
});
