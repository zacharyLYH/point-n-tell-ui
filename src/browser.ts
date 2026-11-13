import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { watchPage } from './context.js';
import {
  PRESETS,
  type CaptureHandle,
  type Frame,
  type SessionSnapshot,
  type ViewportSpec,
} from './types.js';

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
  subscribeClicks: (listener: () => void) => () => void;
  captureContext: (options: {
    redactCredentials: boolean;
    viewport: ViewportSpec;
    accessibility?: string;
  }) => Promise<SessionSnapshot>;
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

  const clickListeners = new Set<() => void>();
  await context.exposeBinding('__pntRecordClick', () => {
    for (const listener of clickListeners) listener();
  });
  await context.addInitScript(() => {
    window.addEventListener(
      'click',
      (event) => {
        const path = event.composedPath();
        if (path.some((node) => node instanceof HTMLElement && node.id === 'pnt-ui-root')) {
          return;
        }
        (window as unknown as { __pntRecordClick?: () => void }).__pntRecordClick?.();
      },
      true,
    );
  });
  const subscribeClicks = (listener: () => void) => {
    clickListeners.add(listener);
    return () => {
      clickListeners.delete(listener);
    };
  };

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
  const contextWatcher = watchPage(page, options.url, options.apiUrl);
  await page.goto(options.url, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();

  return {
    context,
    page,
    setViewport,
    subscribeClicks,
    captureContext: (captureOptions) => contextWatcher.capture(captureOptions),
    expandForReview: async () => {
      // Review uses the browser content area, so give it room on small presets.
      await resizeWindow(REVIEW_CONTENT);
      await cdp.send('Emulation.clearDeviceMetricsOverride');
    },
  };
}

const SAMPLE_MS = 150;
const CLICK_SETTLE_MS = 150;
const CAPTURE_TIMEOUT_MS = 5_000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function within<T>(work: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    work,
    delay(CAPTURE_TIMEOUT_MS).then(() => {
      throw new Error(message);
    }),
  ]);
}

/**
 * Captures the app area every 150ms plus once per click. One handle owns the
 * CDP session, sampler, screenshot queue, and click subscription for exactly
 * one recording. Point and Tell's opaque 64px band is cropped out by FFmpeg.
 */
export async function startCapture(
  page: Page,
  framesDir: string,
  subscribeClicks: (listener: () => void) => () => void,
): Promise<CaptureHandle> {
  await mkdir(framesDir, { recursive: true });
  const frames: Frame[] = [];
  const cdp: CDPSession = await page.context().newCDPSession(page);
  let stopping = false;
  let closed = false;
  let failure: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  const pendingClicks = new Set<Promise<void>>();

  const capture = (click = false): Promise<void> => {
    if (closed) return Promise.resolve();
    queue = queue
      .then(async () => {
        if (closed) return;
        const timestamp = new Date().toISOString();
        // Full-viewport capture, no clip: clipping changes the emulated viewport
        // size in Chrome. FFmpeg crops the reserved Point and Tell band instead.
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
        await writeFile(
          join(framesDir, `${String(frames.length + 1).padStart(6, '0')}.jpg`),
          Buffer.from(shot.data, 'base64'),
        );
        frames.push({ timestamp, ...(click ? { click: true } : {}) });
      })
      .catch((error) => {
        failure ??= error;
      });
    return queue;
  };

  const tick = async () => {
    if (stopping) return;
    if (pendingClicks.size === 0) await capture();
    if (!stopping && !failure) timer = setTimeout(tick, SAMPLE_MS);
  };

  const unsubscribe = subscribeClicks(() => {
    if (stopping) return;
    // A click becomes a forced cut after the page settles. Periodic samples
    // pause until that capture is queued.
    const settled = delay(CLICK_SETTLE_MS).then(() => capture(true));
    pendingClicks.add(settled);
    void settled.then(() => pendingClicks.delete(settled));
  });

  let drain: Promise<Frame[]> | undefined;
  const stop = () =>
    (drain ??= (async () => {
      stopping = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
      try {
        await within(Promise.all(pendingClicks), 'Recording did not stop in time');
        await within(queue, 'Recording did not stop in time');
        if (failure) throw failure;
        return frames;
      } finally {
        closed = true;
        unsubscribe();
        await cdp.detach().catch(() => undefined);
      }
    })());

  await capture();
  if (failure) {
    await stop().catch(() => undefined);
    throw failure;
  }
  timer = setTimeout(tick, SAMPLE_MS);

  return {
    stop,
    dispose: async () => {
      await stop().catch(() => undefined);
    },
  };
}

export async function closeApp(context: BrowserContext): Promise<void> {
  await (context.browser() ?? context).close().catch(() => undefined);
}

async function setCaptureChrome(page: Page, hidden: boolean) {
  const viewport = await page.evaluate((hidden) => {
    const root = document.querySelector('#pnt-ui-root')?.shadowRoot;
    // The toolbar is absent while the review or capture dialog replaces it.
    const controls = root?.getElementById('pnt-controls');
    const chrome = [
      ...(controls ? [controls] : []),
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

type Region = { x: number; y: number; width: number; height: number };

/**
 * Writes a region in document coordinates at the emulated viewport resolution.
 * Chromium returns clip pixels at the host surface resolution, which can differ
 * from the emulated ratio, so the clip scale is probed once per capture.
 */
async function captureRegion(
  cdp: CDPSession,
  path: string,
  region: Region,
  format: 'webp' | 'jpeg',
): Promise<void> {
  const probe = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: { ...region, scale: 1 },
  });
  const clip = { ...region, scale: region.width / pngSize(Buffer.from(probe.data, 'base64')).width };
  const shot = await cdp.send('Page.captureScreenshot', {
    format,
    ...(format === 'jpeg' ? { quality: 80 } : {}),
    captureBeyondViewport: false,
    clip,
  });
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'));
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
    const cdp: CDPSession = await page.context().newCDPSession(page);
    try {
      await captureRegion(cdp, path, region, 'webp');
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } finally {
    await setCaptureChrome(page, false);
  }
}
