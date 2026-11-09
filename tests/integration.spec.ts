import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

type Ready = {
  harness: string;
  chatTitle: string;
  sessionId: string;
  sessionRef: string;
  appUrl: string;
  apiUrl: string;
  cdpUrl: string;
};

const FIXTURE = `<!doctype html>
<html>
  <head><title>PNT Fixture</title></head>
  <body style="margin:0;padding:24px;font:14px system-ui">
    <h1>PNT Fixture</h1>
    <p>Page viewport: <strong id="dims"></strong></p>
    <button id="app-button" onclick="document.body.dataset.clicked='yes'">App button</button>
    <p id="path"></p>
    <script>
      const render = () => {
        document.getElementById('dims').textContent = innerWidth + ' x ' + innerHeight;
        document.getElementById('path').textContent = location.pathname;
      };
      render();
      addEventListener('resize', render);
      if (!localStorage.getItem('pnt-initialized')) {
        document.cookie = 'pnt-auth=seeded; path=/; max-age=31536000';
        localStorage.setItem('pnt-initialized', 'yes');
      }
    </script>
  </body>
</html>`;

async function freePort(): Promise<number> {
  const server = createPortServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function startFixture(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(FIXTURE);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fixture server failed to start');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function launchCli(options: {
  url: string;
  profileDir: string;
  sessionId: string;
  cdpPort: number;
}): Promise<{ child: ChildProcess; ready: Ready; stderr: () => string }> {
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
        PNT_HEADLESS: '0',
        PNT_CDP_PORT: String(options.cdpPort),
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
        .find((candidate) => candidate.startsWith('PNT_UI_READY '));
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice('PNT_UI_READY '.length)) as Ready);
      }
    });

    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(
        new Error(`CLI exited with ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`),
      );
    });
  });

  return { child, ready, stderr: () => stderr };
}

async function stopCli(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGINT');
  });
}

async function connect(cdpUrl: string): Promise<Browser> {
  return chromium.connectOverCDP(cdpUrl);
}

async function appPage(browser: Browser, fixtureUrl: string) {
  const context = browser.contexts()[0];
  const page = context.pages().find((candidate) => candidate.url().startsWith(fixtureUrl));
  if (!page) {
    throw new Error(`App page not found. Open pages: ${context.pages().map((p) => p.url()).join(', ')}`);
  }
  return page;
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(name);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

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

    await expect(page.getByText('Point and Tell', { exact: true })).toBeVisible();
    await expect(page.getByText(first.ready.sessionRef)).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).toContain('pnt-auth=seeded');
    expect(await page.evaluate(() => localStorage.getItem('pnt-initialized'))).toBe('yes');
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([1440, 900]);
    await saveScreenshot(page, 'viewport-desktop.png');

    await page.getByRole('button', { name: /Tablet/ }).click();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([768, 1024]);
    await expect(page.getByText(/tablet 768 × 1024/)).toBeVisible();
    await saveScreenshot(page, 'viewport-tablet.png');

    await page.getByRole('button', { name: /Mobile/ }).click();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([390, 844]);
    await expect(page.getByText(/mobile 390 × 844/)).toBeVisible();
    await saveScreenshot(page, 'viewport-mobile.png');

    await page.getByLabel('Custom width').fill('1280');
    await page.getByLabel('Custom height').fill('720');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([1280, 720]);
    await expect(page.getByText(/custom 1280 × 720/)).toBeVisible();
    await saveScreenshot(page, 'viewport-custom.png');

    await page.locator('#app-button').click();
    await expect(page.locator('body')).toHaveAttribute('data-clicked', 'yes');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Point and Tell', { exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([1280, 720]);
    await expect(page.getByText(first.ready.sessionRef)).toBeVisible();

    await page.goto(`${fixture.url}/other`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Point and Tell', { exact: true })).toBeVisible();
    await expect(page.getByText(first.ready.sessionRef)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([1280, 720]);

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

    await expect(secondPage.getByText('Point and Tell', { exact: true })).toBeVisible();
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
