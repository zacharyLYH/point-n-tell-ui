import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './support/paths.js';
import { freePort } from './support/fixtures.js';

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Demo session cookie missing');
  }
  return setCookie.split(';')[0];
}

async function waitForDemo(base: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${base}/__pnt_demo_health`)).ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Demo server did not start');
}

test('demo carts and orders are scoped per session', async () => {
  test.setTimeout(60_000);

  const port = await freePort();
  const stateDir = await mkdtemp(join(tmpdir(), 'pnt-demo-test-'));
  const child: ChildProcess = spawn(
    process.execPath,
    [join(ROOT, 'demo', 'server.mjs'), String(port)],
    {
      env: { ...process.env, PNT_DEMO_DB: join(stateDir, 'demo.sqlite') },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const base = `http://127.0.0.1:${port}`;

  try {
    await waitForDemo(base);

    const firstResponse = await fetch(`${base}/api/cart`);
    const firstCookie = cookieFrom(firstResponse);
    const firstCart = (await firstResponse.json()) as {
      items: { id: string; quantity: number }[];
    };
    expect(firstCart.items).toHaveLength(2);

    const secondResponse = await fetch(`${base}/api/cart`);
    const secondCookie = cookieFrom(secondResponse);
    const secondCart = (await secondResponse.json()) as {
      items: { id: string; quantity: number }[];
    };
    expect(secondCart.items).toHaveLength(2);
    expect(secondCart.items.map((item) => item.id)).not.toEqual(
      firstCart.items.map((item) => item.id),
    );

    const patched = await fetch(`${base}/api/cart/${firstCart.items[0].id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: firstCookie },
      body: JSON.stringify({ quantity: 5 }),
    });
    expect(patched.ok).toBe(true);

    const secondAgain = (await (
      await fetch(`${base}/api/cart`, { headers: { cookie: secondCookie } })
    ).json()) as { items: { id: string; quantity: number }[] };
    expect(secondAgain.items.find((item) => item.id === secondCart.items[0].id)?.quantity).toBe(1);

    const placed = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: firstCookie },
      body: JSON.stringify({ note: 'Leave with the concierge' }),
    });
    expect(placed.ok).toBe(true);
    const order = (await placed.json()) as { note: string; itemCount: number };
    expect(order.note).toBe('Leave with the concierge');
    expect(order.itemCount).toBe(2);

    const firstAfter = (await (
      await fetch(`${base}/api/cart`, { headers: { cookie: firstCookie } })
    ).json()) as { items: unknown[] };
    expect(firstAfter.items).toHaveLength(0);
    const secondAfter = (await (
      await fetch(`${base}/api/cart`, { headers: { cookie: secondCookie } })
    ).json()) as { items: unknown[] };
    expect(secondAfter.items).toHaveLength(2);
  } finally {
    if (child.exitCode === null) {
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      });
    }
    await rm(stateDir, { recursive: true, force: true });
  }
});
