import { expect, test, type Browser } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionState } from '../src/types.js';
import {
  appPage,
  connect,
  drawSelection,
  expectCenteredWindow,
  launchCli,
  sessionState,
  stopCli,
} from './support/app.js';
import { freePort, PREVIEW_FIXTURE, startFixture } from './support/fixtures.js';
import { ROOT } from './support/paths.js';
import {
  composePreviewStrip,
  previewSignature,
  retainScreenshot,
  saveScreenshot,
} from './support/screenshots.js';

test('runs the real CLI headed, persists the profile, and switches viewports', async () => {
  test.setTimeout(120_000);

  const fixture = await startFixture();
  const profileDir = await mkdtemp(join(tmpdir(), 'pnt-profile-'));
  const children: ChildProcess[] = [];
  const browsers: Browser[] = [];

  try {
    const first = await launchCli({
      url: fixture.url,
      profileDir,
      sessionId: 'AbC 123',
      cdpPort: await freePort(),
    });
    children.push(first.child);

    expect(first.ready.sessionRef).toBe('kilo__checkout-bug__abc-123');

    const firstBrowser = await connect(first.ready.cdpUrl);
    browsers.push(firstBrowser);
    const page = await appPage(firstBrowser, fixture.url);

    await expect(page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();
    await expect(page.getByText(first.ready.sessionRef)).toHaveCount(0);
    expect(await page.evaluate(() => document.cookie)).toContain('pnt-auth=seeded');
    expect(await page.evaluate(() => localStorage.getItem('pnt-initialized'))).toBe('yes');
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([1440, 900]);
    const desktopWindow = await page.evaluate(() => [outerWidth, outerHeight]);
    await expectCenteredWindow(page);

    await page.getByRole('button', { name: /Tablet/ }).click();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([768, 1024]);
    const tabletWindow = await page.evaluate(() => [outerWidth, outerHeight]);
    expect(tabletWindow[0]).toBeLessThan(desktopWindow[0]);
    await expectCenteredWindow(page);
    await expect(page.getByRole('button', { name: /Tablet viewport/ })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /Mobile/ }).click();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([390, 844]);
    const mobileWindow = await page.evaluate(() => [outerWidth, outerHeight]);
    expect(mobileWindow[0]).toBeLessThan(tabletWindow[0]);
    expect(mobileWindow[1]).toBeGreaterThanOrEqual(844);
    await expectCenteredWindow(page);
    await expect(page.getByRole('button', { name: /Mobile viewport/ })).toHaveAttribute('aria-pressed', 'true');
    await saveScreenshot(page, 'viewport-mobile.png');

    await page.getByRole('button', { name: 'Start annotation' }).click();
    await page.getByLabel('Selection comment').fill('Button alignment issue');
    const appButtonBox = await page.locator('#app-button').boundingBox();
    expect(appButtonBox).not.toBeNull();
    await page.mouse.click(appButtonBox!.x + appButtonBox!.width / 2, appButtonBox!.y + appButtonBox!.height / 2);
    await expect(page.locator('body')).not.toHaveAttribute('data-clicked', 'yes');
    await page.mouse.move(100, 150);
    await page.mouse.down();
    await page.mouse.move(300, 320, { steps: 4 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Pen tool' }).click();
    await page.mouse.move(150, 200);
    await page.mouse.down();
    await page.mouse.move(300, 250, { steps: 4 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await page.getByRole('button', { name: 'Redo' }).click();
    await page.getByRole('button', { name: 'Save selection' }).click();
    await expect(page.getByRole('status', { name: '1 saved selections' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([390, 844]);

    const savedState = await (await fetch(`${first.ready.apiUrl}/state`)).json() as SessionState;
    expect(savedState.selections).toHaveLength(1);
    const firstSelection = savedState.selections[0];
    expect(firstSelection.comment).toBe('Button alignment issue');
    expect(firstSelection.viewport).toEqual({ preset: 'mobile', width: 390, height: 844 });
    expect(firstSelection.coordinates).toEqual([
      { x: 100, y: 150 }, { x: 300, y: 150 }, { x: 300, y: 320 }, { x: 100, y: 320 },
    ]);
    expect(firstSelection.page.url).toBe(new URL(fixture.url).href);
    expect(firstSelection.scroll).toEqual({ x: 0, y: 0 });
    expect(Number.isNaN(Date.parse(firstSelection.createdAt))).toBe(false);
    expect(firstSelection.selectionId).toBeTruthy();
    expect(firstSelection.imagePath).toContain('.webp');
    const firstImage = await readFile(firstSelection.imagePath);
    expect(firstImage.toString('ascii', 8, 12)).toBe('WEBP');
    await retainScreenshot(firstSelection.imagePath, 'selection-mobile.webp');
    const imageSize = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/webp;base64,${base64}`;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, firstImage.toString('base64'));
    expect(imageSize).toEqual([200, 170]);
    const firstImageHash = createHash('sha256').update(firstImage).digest('hex');

    await page.getByRole('button', { name: 'Start annotation' }).click();
    await page.getByLabel('Selection comment').fill('Cancel this draft');
    await page.mouse.move(100, 150);
    await page.mouse.down();
    await page.mouse.move(250, 260, { steps: 3 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Pen tool' }).click();
    await page.mouse.move(130, 180);
    await page.mouse.down();
    await page.mouse.move(200, 220, { steps: 2 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Clear strokes' }).click();
    await expect(page.getByRole('button', { name: 'Save selection' })).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel annotation' }).click();
    await expect(page.getByRole('status', { name: '1 saved selections' })).toBeVisible();

    await page.getByRole('button', { name: /Tablet/ }).click();
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([768, 1024]);
    await page.getByRole('button', { name: 'Start annotation' }).click();
    await page.getByLabel('Selection comment').fill('Second viewport capture');
    await page.mouse.move(100, 150);
    await page.mouse.down();
    await page.mouse.move(300, 280, { steps: 3 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Save selection' }).click();
    await expect(page.getByRole('status', { name: '2 saved selections' })).toBeVisible();

    const secondState = await (await fetch(`${first.ready.apiUrl}/state`)).json() as SessionState;
    expect(secondState.selections).toHaveLength(2);
    expect(secondState.selections[1].viewport).toEqual({ preset: 'tablet', width: 768, height: 1024 });
    expect(secondState.selections[0]).toEqual(firstSelection);
    expect(createHash('sha256').update(await readFile(firstSelection.imagePath)).digest('hex')).toBe(firstImageHash);

    await page.locator('#app-button').click();
    await expect(page.locator('body')).toHaveAttribute('data-clicked', 'yes');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();
    await expect(page.getByRole('status', { name: '2 saved selections' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([768, 1024]);

    await page.goto(`${fixture.url}/other`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();
    await expect(page.getByRole('status', { name: '2 saved selections' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([768, 1024]);
    expect(createHash('sha256').update(await readFile(firstSelection.imagePath)).digest('hex')).toBe(firstImageHash);

    await page.evaluate(() => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        get: () => 1000,
      });
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        get: () => 700,
      });
    });
    await expect(page.getByText(/Viewport mismatch/)).toBeVisible();
    await page.locator('#app-button').click();
    await expect(page.locator('body')).toHaveAttribute('data-clicked', 'yes');

    await stopCli(first.child);
    await firstBrowser.close().catch(() => undefined);
    browsers.pop();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const second = await launchCli({
      url: fixture.url,
      profileDir,
      sessionId: 'second-run',
      cdpPort: await freePort(),
    });
    children.push(second.child);

    expect(second.ready.sessionRef).not.toBe(first.ready.sessionRef);
    expect(second.ready.sessionRef).toBe('kilo__checkout-bug__second-run');

    const secondBrowser = await connect(second.ready.cdpUrl);
    browsers.push(secondBrowser);
    const secondPage = await appPage(secondBrowser, fixture.url);

    await expect(secondPage.getByRole('region', { name: 'Point and Tell toolbar' })).toBeVisible();
    expect(await secondPage.evaluate(() => document.cookie)).toContain(
      'pnt-auth=seeded',
    );
    expect(await secondPage.evaluate(() => localStorage.getItem('pnt-initialized'))).toBe(
      'yes',
    );
    await expect
      .poll(() => secondPage.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([1440, 900]);
  } finally {
    for (const browser of browsers) {
      await browser.close().catch(() => undefined);
    }
    for (const child of children) {
      await stopCli(child).catch(() => undefined);
    }
    await fixture.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});

test('reviews, edits, deletes, and replaces selections', async () => {
  test.setTimeout(120_000);

  const fixture = await startFixture();
  const profileDir = await mkdtemp(join(tmpdir(), 'pnt-review-'));
  const children: ChildProcess[] = [];
  const browsers: Browser[] = [];

  try {
    const cli = await launchCli({
      url: fixture.url,
      profileDir,
      sessionId: 'review-flow',
      cdpPort: await freePort(),
    });
    children.push(cli.child);

    const browser = await connect(cli.ready.cdpUrl);
    browsers.push(browser);
    const page = await appPage(browser, fixture.url);

    await drawSelection(page, 'Alpha issue', [80, 120], [260, 260]);
    await drawSelection(page, 'Beta issue', [120, 160], [320, 310]);
    await drawSelection(page, 'Gamma issue', [160, 200], [360, 360]);

    let state = await sessionState(cli.ready.apiUrl);
    expect(state.selections.map((item) => item.comment)).toEqual([
      'Alpha issue',
      'Beta issue',
      'Gamma issue',
    ]);
    const [alpha, , gamma] = state.selections;
    const alphaImage = await readFile(alpha.imagePath);
    const alphaHash = createHash('sha256').update(alphaImage).digest('hex');
    const gammaImage = await readFile(gamma.imagePath);
    const gammaHash = createHash('sha256').update(gammaImage).digest('hex');

    await page.goto(`${fixture.url}/drifted`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Mobile/ }).click();
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([390, 844]);
    await page.evaluate(() => window.scrollTo(0, 200));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(200);

    await page.getByRole('button', { name: 'Open session summary' }).click();
    const dialog = page.getByRole('dialog', { name: 'Session summary' });
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/3 included/)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Saved selections' }).getByText('Context changed')).toHaveCount(3);

    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(390);
    const dialogBox = await dialog.boundingBox();
    const browserSize = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    expect(dialogBox).not.toBeNull();
    expect(Math.abs(dialogBox!.x - (browserSize.width - dialogBox!.width) / 2)).toBeLessThan(2);
    await saveScreenshot(page, 'review-workspace.png');

    await expect(page.getByLabel('Selection comment')).toHaveValue('Alpha issue');

    // Up/Down keys walk the selection list, but not while editing a comment.
    await page.getByRole('button', { name: /Selection 1/ }).click();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByLabel('Selection comment')).toHaveValue('Beta issue');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByLabel('Selection comment')).toHaveValue('Alpha issue');
    await page.getByLabel('Selection comment').click();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByLabel('Selection comment')).toHaveValue('Alpha issue');

    await page.getByLabel('Selection comment').fill('Alpha issue edited');
    await page.getByRole('button', { name: 'Save comment' }).click();
    await expect(page.getByRole('button', { name: 'Save comment' })).toBeDisabled();

    state = await sessionState(cli.ready.apiUrl);
    const edited = state.selections.find((item) => item.selectionId === alpha.selectionId)!;
    expect(edited.comment).toBe('Alpha issue edited');
    expect(edited.viewport).toEqual(alpha.viewport);
    expect(edited.scroll).toEqual(alpha.scroll);
    expect(
      createHash('sha256').update(await readFile(edited.imagePath)).digest('hex'),
    ).toBe(alphaHash);

    await page.getByRole('button', { name: /Selection 2/ }).click();
    await page.getByRole('button', { name: 'Delete selection' }).click();
    await expect(page.getByText(/2 included/)).toBeVisible();
    await expect
      .poll(async () => (await sessionState(cli.ready.apiUrl)).selections.length)
      .toBe(2);

    await page.getByRole('button', { name: /Gamma issue/ }).click();
    await page.getByRole('button', { name: 'Capture again' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Selection comment')).toHaveValue('Gamma issue');
    // Replacing returns to the capture's own viewport and scroll position.
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 900]);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);

    await page.getByLabel('Selection comment').fill('Gamma replaced');
    await page.getByRole('button', { name: 'Save selection' }).click();
    await expect(page.getByRole('button', { name: 'Start annotation' })).toBeVisible();

    state = await sessionState(cli.ready.apiUrl);
    expect(state.selections).toHaveLength(2);
    expect(state.selections.some((item) => item.selectionId === gamma.selectionId)).toBe(false);
    const replaced = state.selections[1];
    expect(replaced.comment).toBe('Gamma replaced');
    expect(replaced.coordinates).toEqual(gamma.coordinates);
    expect(replaced.viewport).toEqual({ preset: 'desktop', width: 1440, height: 900 });
    expect(replaced.scroll).toEqual({ x: 0, y: 0 });
    expect(replaced.imagePath).not.toBe(gamma.imagePath);
    expect(
      createHash('sha256').update(await readFile(gamma.imagePath)).digest('hex'),
    ).toBe(gammaHash);
    // The replacement reuses the restored capture context and rectangle, so it
    // captures the same pixels as the original even though it is a new file.
    expect(
      createHash('sha256').update(await readFile(replaced.imagePath)).digest('hex'),
    ).toBe(gammaHash);
    expect(replaced.imagePath).not.toBe(gamma.imagePath);
    expect(state.selections[0].comment).toBe('Alpha issue edited');

    await page.getByRole('button', { name: 'Open session summary' }).click();
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/2 included/)).toBeVisible();
    const finalList = page.getByRole('navigation', { name: 'Saved selections' });
    await expect(finalList.getByText('Gamma replaced')).toBeVisible();
    await expect(finalList.getByText('Alpha issue edited')).toBeVisible();
    await expect(finalList.getByText('Beta issue')).toHaveCount(0);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 900]);
    await expect.poll(() => page.evaluate(() => [location.pathname, scrollY])).toEqual(['/drifted', 0]);
  } finally {
    for (const browser of browsers) {
      await browser.close().catch(() => undefined);
    }
    for (const child of children) {
      await stopCli(child).catch(() => undefined);
    }
    await fixture.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});

test('saves identical previews of the same element at every viewport', async () => {
  test.setTimeout(120_000);

  const fixture = await startFixture(PREVIEW_FIXTURE);
  const profileDir = await mkdtemp(join(tmpdir(), 'pnt-preview-'));
  const children: ChildProcess[] = [];
  const browsers: Browser[] = [];
  const presets = [
    { label: 'desktop', button: /Desktop viewport/, width: 1440, height: 900 },
    { label: 'tablet', button: /Tablet viewport/, width: 768, height: 1024 },
    { label: 'mobile', button: /Mobile viewport/, width: 390, height: 844 },
  ] as const;

  try {
    const cli = await launchCli({
      url: fixture.url,
      profileDir,
      sessionId: 'preview-parity',
      cdpPort: await freePort(),
    });
    children.push(cli.child);

    const browser = await connect(cli.ready.cdpUrl);
    browsers.push(browser);
    const page = await appPage(browser, fixture.url);

    for (const preset of presets) {
      await page.getByRole('button', { name: preset.button }).click();
      await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([
        preset.width,
        preset.height,
      ]);
      const box = await page.locator('#target').boundingBox();
      expect(box).not.toBeNull();
      const target = box!;

      await page.getByRole('button', { name: 'Start annotation' }).click();
      await page.getByLabel('Selection comment').fill(`${preset.label} target`);
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width, target.y + target.height, { steps: 4 });
      await page.mouse.up();
      await page.getByRole('button', { name: 'Save selection' }).click();
      await expect(page.getByRole('button', { name: 'Start annotation' })).toBeVisible();
    }

    const state = await sessionState(cli.ready.apiUrl);
    expect(state.selections.map((item) => item.viewport.preset)).toEqual(['desktop', 'tablet', 'mobile']);

    const signatures = [];
    for (const selection of state.selections) {
      const signature = await previewSignature(page, selection.imagePath);

      // The saved preview is the target element itself, at its emulated
      // resolution, for every preset.
      expect(signature.width).toBe(120);
      expect(signature.height).toBe(80);
      expect(signature.left[0]).toBeGreaterThan(200);
      expect(signature.left[1]).toBeLessThan(60);
      expect(signature.left[2]).toBeLessThan(60);
      expect(signature.right[2]).toBeGreaterThan(190);
      expect(signature.right[0]).toBeLessThan(60);
      signatures.push(signature);
    }

    expect(signatures[1]).toEqual(signatures[0]);
    expect(signatures[2]).toEqual(signatures[0]);

    await composePreviewStrip(
      page,
      presets.map((preset, index) => ({
        label: `${preset.label} · ${preset.width} × ${preset.height}`,
        path: state.selections[index].imagePath,
      })),
      'preview-parity.png',
    );

    // Captures at different presets describe the same page, so reviewing them
    // at any current preset must not report a context change.
    await page.getByRole('button', { name: 'Open session summary' }).click();
    await expect(page.getByRole('dialog', { name: 'Session summary' })).toBeVisible();
    await expect(page.getByText(/3 included/)).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Saved selections' }).getByText('Context changed'),
    ).toHaveCount(0);
  } finally {
    for (const browser of browsers) {
      await browser.close().catch(() => undefined);
    }
    for (const child of children) {
      await stopCli(child).catch(() => undefined);
    }
    await fixture.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});

test('replacing a capture restores its viewport and scroll', async () => {
  test.setTimeout(120_000);

  const fixture = await startFixture(PREVIEW_FIXTURE);
  const profileDir = await mkdtemp(join(tmpdir(), 'pnt-replace-'));
  const children: ChildProcess[] = [];
  const browsers: Browser[] = [];

  try {
    const cli = await launchCli({
      url: fixture.url,
      profileDir,
      sessionId: 'replace-context',
      cdpPort: await freePort(),
    });
    children.push(cli.child);

    const browser = await connect(cli.ready.cdpUrl);
    browsers.push(browser);
    const page = await appPage(browser, fixture.url);

    await page.getByRole('button', { name: /Tablet viewport/ }).click();
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([768, 1024]);
    await page.evaluate(() => window.scrollTo(0, 120));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(120);

    const box = await page.locator('#target').boundingBox();
    expect(box).not.toBeNull();
    const target = box!;
    await page.getByRole('button', { name: 'Start annotation' }).click();
    await page.getByLabel('Selection comment').fill('Scrolled target');
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width, target.y + target.height, { steps: 4 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Save selection' }).click();
    await expect(page.getByRole('button', { name: 'Start annotation' })).toBeVisible();

    const [original] = (await sessionState(cli.ready.apiUrl)).selections;
    expect(original.viewport).toEqual({ preset: 'tablet', width: 768, height: 1024 });
    expect(original.scroll).toEqual({ x: 0, y: 120 });
    const originalHash = createHash('sha256').update(await readFile(original.imagePath)).digest('hex');

    await page.getByRole('button', { name: /Mobile viewport/ }).click();
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([390, 844]);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(300);

    await page.getByRole('button', { name: 'Open session summary' }).click();
    const dialog = page.getByRole('dialog', { name: 'Session summary' });
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Capture again' }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([768, 1024]);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(120);

    await page.getByRole('button', { name: 'Save selection' }).click();
    await expect(page.getByRole('button', { name: 'Start annotation' })).toBeVisible();

    const state = await sessionState(cli.ready.apiUrl);
    expect(state.selections).toHaveLength(1);
    const restored = state.selections[0];
    expect(restored.coordinates).toEqual(original.coordinates);
    expect(restored.viewport).toEqual(original.viewport);
    expect(restored.scroll).toEqual(original.scroll);
    expect(
      createHash('sha256').update(await readFile(restored.imagePath)).digest('hex'),
    ).toBe(originalHash);
  } finally {
    for (const browser of browsers) {
      await browser.close().catch(() => undefined);
    }
    for (const child of children) {
      await stopCli(child).catch(() => undefined);
    }
    await fixture.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});

test('context warnings are relative to the capture viewport', async () => {
  test.setTimeout(120_000);

  const fixture = await startFixture();
  const profileDir = await mkdtemp(join(tmpdir(), 'pnt-context-'));
  const children: ChildProcess[] = [];
  const browsers: Browser[] = [];

  try {
    const cli = await launchCli({
      url: fixture.url,
      profileDir,
      sessionId: 'context-relative',
      cdpPort: await freePort(),
    });
    children.push(cli.child);

    const browser = await connect(cli.ready.cdpUrl);
    browsers.push(browser);
    const page = await appPage(browser, fixture.url);

    await drawSelection(page, 'Desktop capture', [80, 120], [260, 260]);
    await page.getByRole('button', { name: /Mobile viewport/ }).click();
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([390, 844]);
    await drawSelection(page, 'Mobile capture', [60, 120], [240, 260]);

    // Reviewing at a third preset must not flag captures taken at other presets.
    await page.getByRole('button', { name: /Tablet viewport/ }).click();
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([768, 1024]);
    await page.getByRole('button', { name: 'Open session summary' }).click();
    const dialog = page.getByRole('dialog', { name: 'Session summary' });
    const list = page.getByRole('navigation', { name: 'Saved selections' });
    await expect(dialog).toBeVisible();
    await expect(list.getByText('Context changed')).toHaveCount(0);
    await expect(dialog.getByRole('status')).toHaveCount(0);

    // Page-level drift still warns, and never reports the viewport itself.
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([768, 1024]);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(300);
    await page.getByRole('button', { name: 'Open session summary' }).click();
    await expect(dialog).toBeVisible();
    await expect(list.getByText('Context changed')).toHaveCount(2);
    const warning = dialog.getByRole('status');
    await expect(warning).toContainText('Context changed: scroll position.');
    await expect(warning).not.toContainText('viewport');
  } finally {
    for (const browser of browsers) {
      await browser.close().catch(() => undefined);
    }
    for (const child of children) {
      await stopCli(child).catch(() => undefined);
    }
    await fixture.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});

test('help documents the CLI surface', async () => {
  const child = spawn(process.execPath, [join(ROOT, 'dist', 'cli.js'), '--help'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve) =>
    child.once('exit', resolve),
  );

  expect(code).toBe(0);
  expect(stdout).toContain(
    'pnt-ui <url> --harness <name> --chat-title <title> [--session-id <id>]',
  );
  expect(stdout).toContain('--harness');
  expect(stdout).toContain('--chat-title');
  expect(stdout).toContain('--session-id');
  expect(stdout).toContain('viewport is selected in the Point and Tell overlay');
});
