import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { RecordingController } from '../src/recording-controller.js';
import type { CaptureHandle, Cut, Frame, SessionState } from '../src/types.js';

const frames: Frame[] = [
  { timestamp: new Date(Date.now() + 500).toISOString() },
  { timestamp: new Date(Date.now() + 1500).toISOString(), click: true },
];

const temps: string[] = [];

test.afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(
  options: {
    stop?: () => Promise<Frame[]>;
    open?: (dir: string) => Promise<CaptureHandle>;
    process?: (dir: string) => Promise<Cut[]>;
  } = {},
) {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'pnt-controller-'));
  temps.push(artifactsDir);
  const state: SessionState = {
    session: { harness: 'test', chatTitle: 'test', sessionId: 'test', sessionRef: 'test' },
    viewport: { preset: 'desktop', width: 1440, height: 900 },
    selections: [],
    recordings: [],
    recording: { phase: 'idle' },
  };
  let framesDir = '';
  const controller = new RecordingController({
    state,
    artifactsDir,
    viewport: () => state.viewport,
    pageUrl: async () => 'https://example.test',
    openCapture: async (dir) => {
      framesDir = dir;
      if (options.open) return options.open(dir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, '000001.jpg'), 'frame');
      return { stop: options.stop ?? (async () => frames) };
    },
    process: async (_frames, _framesDir, dir) => {
      if (options.process) return options.process(dir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'cut-001.jpg'), 'cut');
      return [
        {
          cutId: 'cut-1',
          number: 1,
          timestamp: frames[0].timestamp,
          imagePath: join(dir, 'cut-001.jpg'),
          diffScore: 0,
          tags: ['first'],
        },
      ];
    },
  });
  return { artifactsDir, state, controller, framesDir: () => framesDir };
}

const missing = (path: string) => stat(path).catch(() => null);
const cutsDir = (artifactsDir: string, framesDir: string) =>
  join(artifactsDir, `rec-${basename(framesDir).slice('.frames-'.length)}`);

test('runs idle to recording to stopped to draft to saved', async () => {
  const { artifactsDir, state, controller, framesDir } = await setup();

  await controller.start();
  expect(state.recording).toMatchObject({ phase: 'recording', startedAt: expect.any(String) });
  await controller.stop();
  expect(state.recording.phase).toBe('stopped');

  const result = await controller.process();
  expect(result.draft.kind).toBe('recording');
  if (result.draft.kind !== 'recording') throw new Error('Expected a recording draft');
  expect(state.recording).toEqual({ phase: 'draft', recording: result.draft.recording });
  expect((await stat(cutsDir(artifactsDir, framesDir()))).isDirectory()).toBe(true);
  expect(await missing(framesDir())).toBeNull();

  await controller.save('note');
  expect(state.recordings[0].comment).toBe('note');
  expect(state.recording).toEqual({ phase: 'idle' });
});

test('duplicate stop is idempotent', async () => {
  const { controller } = await setup();
  await controller.start();

  const [first, second] = await Promise.all([controller.stop(), controller.stop()]);

  expect(first.recording.phase).toBe('stopped');
  expect(second.recording.phase).toBe('stopped');
});

test('start during stopping is rejected', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { controller } = await setup({ stop: () => gate.then(() => frames) });
  await controller.start();

  const stopping = controller.stop();
  await expect(controller.start()).rejects.toThrow(/already in progress/);
  release();
  await stopping;
});

test('a failed start leaves no frames and returns to idle', async () => {
  const { state, controller, framesDir } = await setup({
    open: async (dir) => {
      await mkdir(dir, { recursive: true });
      throw new Error('FFmpeg missing');
    },
  });

  await expect(controller.start()).rejects.toThrow('FFmpeg missing');

  expect(state.recording).toEqual({ phase: 'idle' });
  expect(await missing(framesDir())).toBeNull();
});

test('process failure deletes frames and cuts and returns to idle', async () => {
  const { artifactsDir, state, controller, framesDir } = await setup({
    process: async (dir) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'partial.jpg'), 'partial');
      throw new Error('FFmpeg failed');
    },
  });
  await controller.start();
  await controller.stop();
  const dir = cutsDir(artifactsDir, framesDir());

  await expect(controller.process()).rejects.toThrow('FFmpeg failed');

  expect(state.recording).toEqual({ phase: 'idle' });
  expect(await missing(framesDir())).toBeNull();
  expect(await missing(dir)).toBeNull();
});

test('dispose during stopped deletes the stopped frames', async () => {
  const { state, controller, framesDir } = await setup();
  await controller.start();
  await controller.stop();

  await controller.dispose();

  expect(state.recording).toEqual({ phase: 'idle' });
  expect(await missing(framesDir())).toBeNull();
});

test('dispose during processing waits, then deletes the draft cuts', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const processingStarted = new Promise<void>((resolve) => (started = resolve));
  const { artifactsDir, state, controller, framesDir } = await setup({
    process: async (dir) => {
      await mkdir(dir, { recursive: true });
      started();
      await gate;
      await writeFile(join(dir, 'cut-001.jpg'), 'cut');
      return [];
    },
  });
  await controller.start();
  await controller.stop();
  const dir = cutsDir(artifactsDir, framesDir());

  const processing = controller.process();
  const disposing = controller.dispose();
  await processingStarted;
  expect(state.recording.phase).toBe('processing');
  release();
  await processing;
  await disposing;

  expect(state.recording).toEqual({ phase: 'idle' });
  expect(await missing(framesDir())).toBeNull();
  expect(await missing(dir)).toBeNull();
});
