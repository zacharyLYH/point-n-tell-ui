import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { PRESETS } from './types.js';

export async function launchApp(options: {
  url: string;
  profileDir: string;
  overlayScript: string;
  apiUrl: string;
  cdpPort?: string;
}): Promise<{ context: BrowserContext; page: Page }> {
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

  await context.addInitScript({
    content: `window.__PNT_CONFIG__ = ${JSON.stringify({ apiUrl: options.apiUrl })};`,
  });
  await context.addInitScript({ content: options.overlayScript });

  await page.goto(options.url, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();

  return { context, page };
}

export async function closeApp(context: BrowserContext): Promise<void> {
  const browser = context.browser();
  if (browser) {
    await browser.close().catch(() => undefined);
  } else {
    await context.close().catch(() => undefined);
  }
}
