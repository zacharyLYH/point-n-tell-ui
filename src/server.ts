import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PRESETS, type SessionState, type ViewportSpec } from './types.js';

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) {
      throw new Error('Request body too large');
    }
  }
  return body;
}

export function parseViewport(value: unknown): ViewportSpec {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid viewport');
  }

  const { preset, width, height } = value as Record<string, unknown>;
  const validPreset = preset === 'custom' || (typeof preset === 'string' && preset in PRESETS);
  const w = Number(width);
  const h = Number(height);

  if (!validPreset) {
    throw new Error('preset must be desktop, tablet, mobile, or custom');
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error('width and height must be positive integers');
  }
  if (preset !== 'custom') {
    const expected = PRESETS[preset as keyof typeof PRESETS];
    if (expected.width !== w || expected.height !== h) {
      throw new Error(`${preset} must be ${expected.width}x${expected.height}`);
    }
  }

  return { preset: preset as ViewportSpec['preset'], width: w, height: h };
}

export async function startServer(
  getState: () => SessionState,
  applyViewport: (viewport: ViewportSpec) => Promise<void>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    try {
      if (req.method === 'GET' && req.url === '/state') {
        send(res, 200, getState());
        return;
      }

      if (req.method === 'POST' && req.url === '/viewport') {
        const viewport = parseViewport(JSON.parse(await readBody(req)));
        await applyViewport(viewport);
        send(res, 200, getState());
        return;
      }

      send(res, 404, { error: 'Not found' });
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : 'Bad request' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind API server');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
