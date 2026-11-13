import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TOP_BAND, type Cut, type Frame } from './types.js';

const DIFF_SIZE = 96;
const DIFF_TOLERANCE = 16;
const DIFF_THRESHOLD = 0.1;
const DIFF_FRAME_BYTES = DIFF_SIZE * DIFF_SIZE * 3;
// Kills a stuck FFmpeg child, so processing can never block a session forever.
const FFMPEG_TIMEOUT_MS = 120_000;

const bin = () => process.env.PNT_FFMPEG ?? 'ffmpeg';

type FfmpegResult = { stdout: Buffer; stderr: string };

/** Runs FFmpeg and resolves with its binary output, or rejects with its last error line. */
function runFfmpeg(args: string[]): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin(),
      args,
      { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, timeout: FFMPEG_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr: stderr.toString() });
        const detail = stderr.toString().trim().split('\n').at(-1);
        reject(
          new Error(
            error.killed
              ? 'FFmpeg timed out'
              : detail
                ? `FFmpeg failed: ${detail}`
                : 'FFmpeg could not start. Install FFmpeg 4 or newer and retry.',
          ),
        );
      },
    );
  });
}

/** Fails before recording starts when FFmpeg is missing or too old. */
export async function checkFfmpeg(): Promise<void> {
  const { stdout, stderr } = await runFfmpeg(['-version']);
  const version = /ffmpeg version (\d+)/.exec(stdout.toString() || stderr);
  if (!version || Number(version[1]) < 4) {
    throw new Error('FFmpeg 4 or newer is required to process recordings.');
  }
}

/**
 * Decodes the app area of every frame to a small RGB frame. The reserved top
 * band is removed before scaling so the recording chrome cannot cause cuts.
 */
async function diffFrames(frames: number, framesDir: string): Promise<Buffer[]> {
  const { stdout } = await runFfmpeg([
    '-hide_banner',
    '-v',
    'error',
    '-framerate',
    '1',
    '-i',
    join(framesDir, '%06d.jpg'),
    '-vf',
    `crop=iw:ih-${TOP_BAND}:0:${TOP_BAND},scale=${DIFF_SIZE}:${DIFF_SIZE}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
  if (stdout.length !== frames * DIFF_FRAME_BYTES) {
    throw new Error('FFmpeg produced an unexpected number of frames');
  }
  return Array.from({ length: frames }, (_, index) =>
    stdout.subarray(index * DIFF_FRAME_BYTES, (index + 1) * DIFF_FRAME_BYTES),
  );
}

/** Fraction of pixels whose strongest channel differs from the benchmark. */
function diffScore(candidate: Buffer, benchmark: Buffer): number {
  let changed = 0;
  for (let offset = 0; offset < candidate.length; offset += 3) {
    if (
      Math.abs(candidate[offset] - benchmark[offset]) > DIFF_TOLERANCE ||
      Math.abs(candidate[offset + 1] - benchmark[offset + 1]) > DIFF_TOLERANCE ||
      Math.abs(candidate[offset + 2] - benchmark[offset + 2]) > DIFF_TOLERANCE
    ) {
      changed += 1;
    }
  }
  return changed / (DIFF_SIZE * DIFF_SIZE);
}

/**
 * Turns captured candidates into ordered cut images. Cuts are every click, the
 * first and last candidate, and candidates that differ from the previous kept
 * cut by more than 10%. The caller owns the frames directory.
 */
export async function generateCuts(
  frames: Frame[],
  framesDir: string,
  dir: string,
): Promise<Cut[]> {
  if (frames.length === 0) {
    throw new Error('Recording produced no frames');
  }

  const pixels = await diffFrames(frames.length, framesDir);
  const selected: { index: number; score: number }[] = [];
  let benchmark = -1;
  for (const [index, frame] of frames.entries()) {
    const score = benchmark < 0 ? 0 : diffScore(pixels[index], pixels[benchmark]);
    if (index === 0 || index === frames.length - 1 || frame.click || score > DIFF_THRESHOLD) {
      selected.push({ index, score });
      benchmark = index;
    }
  }

  await mkdir(dir, { recursive: true });
  const select = selected.map(({ index }) => `eq(n\\,${index})`).join('+');
  await runFfmpeg([
    '-hide_banner',
    '-v',
    'error',
    '-framerate',
    '1',
    '-i',
    join(framesDir, '%06d.jpg'),
    '-vf',
    `crop=iw:ih-${TOP_BAND}:0:${TOP_BAND},select='${select}'`,
    '-fps_mode',
    'vfr',
    '-q:v',
    '2',
    join(dir, 'cut-%03d.jpg'),
  ]);

  return selected.map(({ index, score }, position): Cut => {
    const frame = frames[index];
    return {
      cutId: randomUUID(),
      number: position + 1,
      timestamp: frame.timestamp,
      imagePath: join(dir, `cut-${String(position + 1).padStart(3, '0')}.jpg`),
      diffScore: score,
      tags: [
        ...(index === 0 ? ['first'] : []),
        ...(frame.click ? ['click'] : []),
        ...(index === frames.length - 1 ? ['last'] : []),
      ],
    };
  });
}
