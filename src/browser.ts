import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { PRESETS } from './types.js';

const REVIEW_CONTENT = { width: 1280, height: 800 };

export async function launchApp(options: {
  url: string;
  profileDir: string;
  overlayScript: string;
  apiUrl: string;
  cdpPort?: string;
  onViewport?: (viewport: { width: number; height: number }) => void;
}): Promise<{
  context: BrowserContext;
  page: Page;
  setViewport: (viewport: { width: number; height: number }) => Promise<{ width: number; height: number }>;
  expandForReview: () => Promise<void>;
}> {
  await mkdir(options.profileDir, { recursive: true });

  const args = ['--no-first-run', '--no-default-browser-check'];
  if (options.cdpPort) {
    args.push(`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${options.cdpPort}`);
  }

  const context = await chromium.launchPersistentContext(options.profileDir, {
    headless: process.env.PNT_HEADLESS === '1',
    // Viewport emulation is applied per preset, after the window chrome has
    // been measured from the real (unemulated) content area.
    viewport: null,
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

  // The chrome is measured on the blank page so the first navigation already
  // happens at the emulated viewport. Preset windows are sized so that their
  // content area matches the emulated viewport; the window chrome is the gap
  // between the real outer and inner sizes before emulation is applied.
  const { chrome, screen } = await page.evaluate(() => ({
    chrome: {
      width: window.outerWidth - window.innerWidth,
      height: window.outerHeight - window.innerHeight,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
  }));

  const centered = (width: number, height: number) => ({
    left: Math.max(0, Math.round((screen.width - width) / 2)),
    top: Math.max(0, Math.round((screen.height - height) / 2)),
  });

  const setBounds = (windowId: number, width: number, height: number) =>
    cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal', ...centered(width, height), width, height },
    });

  // Returns the content area the window actually has, or undefined when there is
  // no window (headless), where emulation is not limited by the screen.
  const resizeWindow = async (
    content: { width: number; height: number },
  ): Promise<{ width: number; height: number } | undefined> => {
    if (process.env.PNT_HEADLESS === '1') {
      return undefined;
    }
    const width = Math.min(content.width + chrome.width, screen.width);
    const height = Math.min(content.height + chrome.height, screen.height);
    const { windowId } = await cdp.send('Browser.getWindowForTarget', {});
    await setBounds(windowId, width, height);
    // The window manager can clamp the requested size (window minimums, screen
    // limits), so center again using the size it actually applied.
    const applied = (await cdp.send('Browser.getWindowBounds', { windowId })).bounds;
    const appliedWidth = applied.width ?? width;
    const appliedHeight = applied.height ?? height;
    if (appliedWidth !== width || appliedHeight !== height) {
      await setBounds(windowId, appliedWidth, appliedHeight);
    }
    return {
      width: Math.max(1, appliedWidth - chrome.width),
      height: Math.max(1, appliedHeight - chrome.height),
    };
  };

  const setViewport = async (requested: {
    width: number;
    height: number;
  }): Promise<{ width: number; height: number }> => {
    const fitted = await resizeWindow(requested);
    // A viewport taller than the window is never fully visible: the page thinks
    // it fits, so it does not scroll, and the bottom band is unreachable.
    const applied = {
      width: Math.min(requested.width, fitted?.width ?? requested.width),
      height: Math.min(requested.height, fitted?.height ?? requested.height),
    };
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      ...applied,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: screen.width,
      screenHeight: screen.height,
    });
    return applied;
  };

  const viewport = await setViewport(PRESETS.desktop);
  options.onViewport?.(viewport);
  await page.goto(options.url, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();

  return {
    context,
    page,
    setViewport,
    expandForReview: async () => {
      // Review uses the browser content area, so give it room on small presets.
      await resizeWindow(REVIEW_CONTENT);
      await cdp.send('Emulation.clearDeviceMetricsOverride');
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

async function setCaptureChrome(page: Page, hidden: boolean) {
  const viewport = await page.evaluate((hidden) => {
    const root = document.querySelector('#pnt-ui-root')?.shadowRoot;
    const controls = root?.getElementById('pnt-controls');
    if (!controls) {
      throw new Error('Point and Tell controls are unavailable');
    }
    const chrome = [
      controls,
      ...Array.from(root?.querySelectorAll('[data-pnt-selection-badge]') ?? []),
    ];
    for (const element of chrome) {
      (element as HTMLElement).style.visibility = hidden ? 'hidden' : '';
    }
    return {
      width: innerWidth,
      height: innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  }, hidden);
  if (hidden) {
    // Let the browser paint the hidden chrome before the capture.
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
    );
  }
  return viewport;
}

function pngSize(data: Buffer): { width: number; height: number } {
  if (data.length < 24 || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Unexpected screenshot format');
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/**
 * Captures the pixels the user sees inside the rectangle.
 *
 * The rectangle arrives in client coordinates of the emulated viewport, so the
 * clip is translated into document coordinates and captured from the emulated
 * surface. Playwright's page.screenshot reports the host window surface while
 * device emulation is active, which saved the wrong region for tablet and
 * mobile viewports.
 */
export async function saveAnnotatedScreenshot(
  page: Page,
  path: string,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const viewport = await setCaptureChrome(page, true);
  try {
    const x = Math.max(0, Math.min(Math.round(clip?.x ?? 0), viewport.width - 1));
    const y = Math.max(0, Math.min(Math.round(clip?.y ?? 0), viewport.height - 1));
    const width = Math.max(1, Math.round(Math.min(clip?.width ?? viewport.width, viewport.width - x)));
    const height = Math.max(1, Math.round(Math.min(clip?.height ?? viewport.height, viewport.height - y)));
    const region = {
      x: viewport.scrollX + x,
      y: viewport.scrollY + y,
      width,
      height,
    };
    const cdp = await page.context().newCDPSession(page);
    try {
      // Chromium returns clip pixels at the host surface resolution, which can
      // differ from the emulated viewport ratio. Probe once so the saved image
      // always lands on the emulated resolution instead of the host's.
      const probe = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: { ...region, scale: 1 },
      });
      const probeSize = pngSize(Buffer.from(probe.data, 'base64'));
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'webp',
        captureBeyondViewport: false,
        clip: { ...region, scale: width / probeSize.width },
      });
      await writeFile(resolve(path), Buffer.from(shot.data, 'base64'));
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } finally {
    await setCaptureChrome(page, false);
  }
}
