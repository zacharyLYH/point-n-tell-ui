import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  PRESETS,
  type CaptureResult,
  type Coordinates,
  type Point,
  type ReviewContext,
  type SessionState,
  type SubmissionResult,
  type ViewportSpec,
} from './types.js';

type SessionApi = {
  getState: () => SessionState;
  /** Resolves any capture artifact (selection images and recording cuts). */
  imagePath: (id: string) => string | undefined;
  applyViewport: (viewport: ViewportSpec) => Promise<void>;
  captureSelection: (input: { coordinates: Coordinates; replaceId?: string }) => Promise<CaptureResult>;
  updateSelectionComment: (selectionId: string, comment: string) => Promise<SessionState>;
  deleteSelection: (selectionId: string) => Promise<SessionState>;
  startRecording: () => Promise<SessionState>;
  stopRecording: () => Promise<SessionState>;
  processRecording: () => Promise<CaptureResult>;
  saveRecordingDraft: (comment: string) => Promise<SessionState>;
  deleteRecordingDraft: () => Promise<SessionState>;
  updateRecordingComment: (recordingId: string, comment: string) => Promise<SessionState>;
  deleteRecording: (recordingId: string) => Promise<SessionState>;
  openReview: () => Promise<{ state: SessionState; context: ReviewContext }>;
  closeReview: () => Promise<SessionState>;
  submit: (options: { redactCredentials: boolean }) => Promise<SubmissionResult>;
  discard: () => Promise<{ discarded: true }>;
  endSession: () => void;
};

function send(res: ServerResponse, status: number, body: unknown, after?: () => void): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body), after);
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
  const named = typeof preset === 'string' && preset in PRESETS;
  const w = Number(width);
  const h = Number(height);

  if (preset !== 'custom' && !named) {
    throw new Error('preset must be desktop, tablet, mobile, or custom');
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error('width and height must be positive integers');
  }
  // A named preset records the size the window could actually show, which can
  // be smaller than the preset when the display is short.
  return { preset: preset as ViewportSpec['preset'], width: w, height: h };
}

function parseComment(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 5000) {
    throw new Error('Comment must contain 1–5000 characters');
  }
  return value.trim();
}

function parseCoordinates(value: unknown): Coordinates {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error('Selection must have four rectangle corners');
  }
  const points = value.map((corner): Point => {
    const { x, y } = (corner ?? {}) as Record<string, unknown>;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Selection coordinates must be finite numbers');
    }
    return { x, y } as Point;
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
  return points;
}

export async function startServer(
  api: SessionApi,
  assertOpen: () => void,
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
      if (req.method !== 'GET') assertOpen();
      const body = req.method === 'GET' ? {} : await readJson(req);
      const url = req.url ?? '';

      switch (`${req.method} ${url}`) {
        case 'GET /state':
          return send(res, 200, api.getState());
        case 'POST /viewport':
          await api.applyViewport(parseViewport(body));
          return send(res, 200, api.getState());
        case 'POST /selection': {
          const replaceId = typeof body.replaceId === 'string' ? body.replaceId : undefined;
          return send(res, 200, await api.captureSelection({ coordinates: parseCoordinates(body.coordinates), replaceId }));
        }
        case 'POST /recording/start':
          return send(res, 200, await api.startRecording());
        case 'POST /recording/stop':
          return send(res, 200, await api.stopRecording());
        case 'POST /recording/process':
          return send(res, 200, await api.processRecording());
        case 'POST /recording/save':
          return send(res, 200, await api.saveRecordingDraft(parseComment(body.comment)));
        case 'DELETE /recording/draft':
          return send(res, 200, await api.deleteRecordingDraft());
        case 'POST /review/open':
          return send(res, 200, await api.openReview());
        case 'POST /review/close':
          return send(res, 200, await api.closeReview());
        case 'POST /submit':
          return send(
            res,
            200,
            await api.submit({ redactCredentials: body.redactCredentials !== false }),
            api.endSession,
          );
        case 'POST /discard':
          return send(res, 200, await api.discard(), api.endSession);
      }

      const imageId = url.match(/^\/image\/([\w-]+)$/)?.[1];
      if (imageId) {
        const path = api.imagePath(imageId);
        if (!path) {
          throw new Error('Image not found');
        }
        res.writeHead(200, {
          'content-type': path.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
          'cache-control': 'no-store',
        });
        res.end(await readFile(path));
        return;
      }

      const item = url.match(/^\/(selection|recording)\/([\w-]+)$/);
      if (item) {
        const [, kind, id] = item;
        if (req.method === 'PATCH') {
          const comment = parseComment(body.comment);
          return send(
            res,
            200,
            kind === 'selection'
              ? await api.updateSelectionComment(id, comment)
              : await api.updateRecordingComment(id, comment),
          );
        }
        if (req.method === 'DELETE') {
          return send(
            res,
            200,
            kind === 'selection' ? await api.deleteSelection(id) : await api.deleteRecording(id),
          );
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
