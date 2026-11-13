import { expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * Captures a baseline image. Mask locators cover values that change per run;
 * `maxDiffPixels` absorbs the few pixels by which a mask box can shift when
 * the masked value changes length.
 */
export async function saveScreenshot(
  page: Page,
  name: string,
  options: { mask?: Locator[]; maxDiffPixels?: number } = {},
): Promise<void> {
  await expect(page).toHaveScreenshot(name, options);
}

export async function retainScreenshot(source: string, name: string): Promise<void> {
  expect(await readFile(source)).toMatchSnapshot(name);
}

export async function previewSignature(page: Page, path: string) {
  const base64 = (await readFile(path)).toString('base64');
  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/webp;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3);
    return {
      width: canvas.width,
      height: canvas.height,
      hash: Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(''),
      left: sample(Math.floor(canvas.width * 0.35), Math.floor(canvas.height / 2)),
      right: sample(Math.floor(canvas.width * 0.8), Math.floor(canvas.height / 2)),
    };
  }, base64);
}

export async function composePreviewStrip(
  page: Page,
  images: { path: string; label: string }[],
  name: string,
): Promise<void> {
  const payload = await Promise.all(
    images.map(async ({ path, label }) => ({
      label,
      base64: (await readFile(path)).toString('base64'),
    })),
  );
  const dataUrl = await page.evaluate(async (items) => {
    const scale = 2;
    const gap = 20;
    const labelHeight = 22;
    const decoded = await Promise.all(
      items.map(async (item) => {
        const image = new Image();
        image.src = `data:image/webp;base64,${item.base64}`;
        await image.decode();
        return image;
      }),
    );
    const cellWidth = Math.max(...decoded.map((image) => image.naturalWidth)) * scale;
    const cellHeight = Math.max(...decoded.map((image) => image.naturalHeight)) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = decoded.length * cellWidth + (decoded.length + 1) * gap;
    canvas.height = cellHeight + labelHeight + gap * 2;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111827';
    context.font = '600 14px system-ui';
    decoded.forEach((image, index) => {
      const x = gap + index * (cellWidth + gap);
      context.fillText(items[index].label, x, gap + 14);
      context.drawImage(image, x, gap + labelHeight, cellWidth, cellHeight);
      context.strokeStyle = '#d1d5db';
      context.strokeRect(x - 0.5, gap + labelHeight - 0.5, cellWidth + 1, cellHeight + 1);
    });
    return canvas.toDataURL('image/png');
  }, payload);
  expect(Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')).toMatchSnapshot(name);
}
