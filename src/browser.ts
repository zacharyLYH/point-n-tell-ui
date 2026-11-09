import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { PRESETS } from './types.js';

export async function launchApp(options: {
  url: string;
  profileDir: string;
  overlayScript: string;
  apiUrl: string;
  cdpPort?: string;
}): Promise<{
  context: BrowserContext;
  page: Page;
  setViewport: (viewport: { width: number; height: number }) => Promise<void>;
}> {
  await mkdir(options.profileDir, { recursive: true });

  const args = ['--no-first-run', '--no-default-browser-check'];
  if (options.cdpPort) {
    args.push(`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${options.cdpPort}`);
  }

  const context = await chromium.launchPersistentContext(options.profileDir, {
    headless: process.env.PNT_HEADLESS === '1',
    viewport: PRESETS.desktop,
    args,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  const [first, ...extra] = context.pages();
  const page = first ?? (await context.newPage());
  await Promise.all(extra.map((extraPage) => extraPage.close()));
  const cdp: CDPSession = await context.newCDPSession(page);

  await context.addInitScript({
    content: `window.__PNT_CONFIG__ = ${JSON.stringify({ apiUrl: options.apiUrl })};\n${options.overlayScript}`,
  });

  await page.goto(options.url, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  const screen = await page.evaluate(() => ({
    width: window.screen.width,
    height: window.screen.height,
    x: window.screenX,
    y: window.screenY,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
  }));

  return {
    context,
    page,
    setViewport: async ({ width, height }) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: screen.width,
        screenHeight: screen.height,
        positionX: Math.max(0, Math.round(screen.x + (screen.outerWidth - width) / 2)),
        positionY: Math.max(0, Math.round(screen.y + (screen.outerHeight - height) / 2)),
      });
    },
  };
}

export async function closeApp(context: BrowserContext): Promise<void> {
  const browser = context.browser();
  if (browser) {
    await browser.close().catch(() => undefined);
  } else {
    await context.close().catch(() => undefined);
  }
}

export async function saveAnnotatedScreenshot(page: Page, path: string): Promise<void> {
  await page.evaluate(() => {
    const element = document.querySelector('#pnt-ui-root')?.shadowRoot?.getElementById('pnt-controls');
    if (!element) {
      throw new Error('Point and Tell controls are unavailable');
    }
    element.style.visibility = 'hidden';
  });
  try {
    await page.screenshot({ path: resolve(path), type: 'webp', animations: 'disabled' });
  } finally {
    await page.evaluate(() => {
      const element = document.querySelector('#pnt-ui-root')?.shadowRoot?.getElementById('pnt-controls');
      if (element) element.style.visibility = '';
    });
  }
}
