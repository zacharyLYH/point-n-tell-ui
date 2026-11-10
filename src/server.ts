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

type SessionApi = {
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
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) {
      throw new Error('Request body too large');
    }
  }
  return JSON.parse(body || '{}') as Record<string, unknown>;
}

export function parseViewport(value: unknown): ViewportSpec {
  const { preset, width, height } = (value ?? {}) as Record<string, unknown>;
  const named =
    typeof preset === 'string' && preset in PRESETS ? (preset as keyof typeof PRESETS) : undefined;
  const w = Number(width);
  const h = Number(height);

  if (preset !== 'custom' && !named) {
    throw new Error('preset must be desktop, tablet, mobile, or custom');
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error('width and height must be positive integers');
  }
  if (named && (PRESETS[named].width !== w || PRESETS[named].height !== h)) {
    throw new Error(`${named} must be ${PRESETS[named].width}x${PRESETS[named].height}`);
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
  const { comment, coordinates } = (value ?? {}) as Record<string, unknown>;
  const parsedComment = parseComment(comment);
  if (!Array.isArray(coordinates) || coordinates.length !== 4) {
    throw new Error('Selection must have four rectangle corners');
  }
  const points = coordinates.map((corner): Point => {
    const { x, y } = (corner ?? {}) as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Selection coordinates must be finite numbers');
    }
    return { x, y };
  }) as Coordinates;
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const axisAligned =
    topLeft.y === topRight.y &&
    topRight.x === bottomRight.x &&
    bottomRight.y === bottomLeft.y &&
    bottomLeft.x === topLeft.x &&
    topRight.x > topLeft.x &&
    bottomLeft.y > topLeft.y;
  if (!axisAligned) {
    throw new Error('Selection coordinates must describe a non-empty rectangle');
  }
  return { comment: parsedComment, coordinates: points };
}

export async function startServer(
  api: SessionApi,
): Promise<{ url: string; close: () => Promise<void> }> {
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
      const body = req.method === 'GET' ? {} : await readJson(req);
      const [, selectionId, image] = req.url?.match(/^\/selection\/([\w-]+)(\/image)?$/) ?? [];

      switch (`${req.method} ${req.url}`) {
        case 'GET /state':
          return send(res, 200, api.getState());
        case 'POST /viewport':
          await api.applyViewport(parseViewport(body));
          return send(res, 200, api.getState());
        case 'POST /selection': {
          const selection = parseSelection(body);
          const replaceId = typeof body.replaceId === 'string' ? body.replaceId : undefined;
          return send(res, 200, await api.saveSelection(selection, replaceId));
        }
        case 'POST /review/open':
          return send(res, 200, await api.openReview());
        case 'POST /review/close':
          return send(res, 200, await api.closeReview());
      }

      if (selectionId) {
        if (req.method === 'GET' && image) {
          const selection = api.getState().selections.find((item) => item.selectionId === selectionId);
          if (!selection) {
            throw new Error('Selection not found');
          }
          res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'no-store' });
          res.end(await readFile(selection.imagePath));
          return;
        }
        if (req.method === 'PATCH') {
          return send(res, 200, await api.updateComment(selectionId, parseComment(body.comment)));
        }
        if (req.method === 'DELETE') {
          return send(res, 200, await api.deleteSelection(selectionId));
        }
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
