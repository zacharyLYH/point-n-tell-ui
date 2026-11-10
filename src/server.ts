import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  PRESETS,
  type Coordinates,
  type Point,
  type ReviewContext,
  type Selection,
  type SessionState,
  type ViewportSpec,
} from './types.js';

export type SessionApi = {
  getState: () => SessionState;
  applyViewport: (viewport: ViewportSpec) => Promise<void>;
  saveSelection: (
    selection: Pick<Selection, 'comment' | 'coordinates'>,
    replaceId?: string,
  ) => Promise<SessionState>;
  updateComment: (selectionId: string, comment: string) => Promise<SessionState>;
  deleteSelection: (selectionId: string) => Promise<SessionState>;
  openReview: () => Promise<{ state: SessionState; context: ReviewContext }>;
  closeReview: () => Promise<SessionState>;
};

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

function parseComment(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 5000) {
    throw new Error('Comment must contain 1–5000 characters');
  }
  return value.trim();
}

function parseSelection(value: unknown): Pick<Selection, 'comment' | 'coordinates'> {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid selection');
  }
  const { comment, coordinates } = value as Record<string, unknown>;
  const parsedComment = parseComment(comment);
  if (!Array.isArray(coordinates) || coordinates.length !== 4) {
    throw new Error('Selection must have four rectangle corners');
  }
  const points = coordinates.map((point): Point => {
    if (!point || typeof point !== 'object') {
      throw new Error('Invalid selection coordinate');
    }
    const { x, y } = point as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Selection coordinates must be finite numbers');
    }
    return { x, y };
  }) as Coordinates;
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  if (
    topRight.x <= topLeft.x || bottomLeft.y <= topLeft.y ||
    topLeft.y !== topRight.y || topRight.x !== bottomRight.x ||
    bottomRight.y !== bottomLeft.y || bottomLeft.x !== topLeft.x
  ) {
    throw new Error('Selection coordinates must describe a non-empty rectangle');
  }
  return { comment: parsedComment, coordinates: points };
}

export async function startServer(api: SessionApi): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    try {
      const selectionRoute = req.url?.match(/^\/selection\/([\w-]+)(\/image)?$/);
      const selectionId = selectionRoute ? decodeURIComponent(selectionRoute[1]) : undefined;

      if (req.method === 'GET' && req.url === '/state') {
        send(res, 200, api.getState());
        return;
      }

      if (req.method === 'GET' && selectionRoute && selectionRoute[2] && selectionId) {
        const selection = api.getState().selections.find((item) => item.selectionId === selectionId);
        if (!selection) {
          throw new Error('Selection not found');
        }
        const image = await readFile(selection.imagePath);
        res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'no-store' }).end(image);
        return;
      }

      if (req.method === 'POST' && req.url === '/viewport') {
        await api.applyViewport(parseViewport(JSON.parse(await readBody(req))));
        send(res, 200, api.getState());
        return;
      }

      if (req.method === 'POST' && req.url === '/selection') {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        const replaceId = typeof body.replaceId === 'string' ? body.replaceId : undefined;
        send(res, 200, await api.saveSelection(parseSelection(body), replaceId));
        return;
      }

      if (req.method === 'PATCH' && selectionRoute && selectionId && !selectionRoute[2]) {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        send(res, 200, await api.updateComment(selectionId, parseComment(body.comment)));
        return;
      }

      if (req.method === 'DELETE' && selectionRoute && selectionId && !selectionRoute[2]) {
        send(res, 200, await api.deleteSelection(selectionId));
        return;
      }

      if (req.method === 'POST' && req.url === '/review/open') {
        send(res, 200, await api.openReview());
        return;
      }

      if (req.method === 'POST' && req.url === '/review/close') {
        send(res, 200, await api.closeReview());
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
