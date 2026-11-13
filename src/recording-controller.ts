import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { deleteSessionArtifacts } from './artifacts.js';
import {
  TOP_BAND,
  type CaptureHandle,
  type CaptureResult,
  type Cut,
  type Frame,
  type Recording,
  type RecordingPhase,
  type SessionState,
  type ViewportSpec,
} from './types.js';

type Deps = {
  state: SessionState;
  artifactsDir: string;
  viewport: () => ViewportSpec;
  pageUrl: () => Promise<string>;
  openCapture: (framesDir: string) => Promise<CaptureHandle>;
  process: (frames: Frame[], framesDir: string, dir: string) => Promise<Cut[]>;
};

/** One directory per recording holds its cut images, so deleting it is one call. */
export function cutsDir(artifactsDir: string, recordingId: string): string {
  return join(artifactsDir, `rec-${recordingId}`);
}

/** Owns the one recording phase, its capture handle, and frames/cuts. */
export class RecordingController {
  private handle?: CaptureHandle;
  private frames?: Frame[];
  private pageUrl = '';
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private get current(): RecordingPhase {
    return this.deps.state.recording;
  }

  start(): Promise<SessionState> {
    if (this.current.phase !== 'idle') {
      return Promise.reject(new Error('Recording is already in progress'));
    }
    return this.serial(() => this.doStart());
  }

  stop(): Promise<SessionState> {
    return this.serial(() => this.doStop());
  }

  process(): Promise<CaptureResult> {
    return this.serial(() => this.doProcess());
  }

  save(comment: string): Promise<SessionState> {
    return this.serial(async () => {
      if (this.current.phase !== 'draft') throw new Error('No recording draft to save');
      this.deps.state.recordings = [
        ...this.deps.state.recordings,
        { ...this.current.recording, comment },
      ];
      this.set({ phase: 'idle' });
      return this.deps.state;
    });
  }

  async delete(): Promise<SessionState> {
    if (this.current.phase !== 'draft') throw new Error('No recording draft to delete');
    await this.dispose();
    return this.deps.state;
  }

  dispose(): Promise<void> {
    return this.serial(async () => {
      await this.cleanup();
      this.set({ phase: 'idle' });
    });
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private set(phase: RecordingPhase): void {
    this.deps.state.recording = phase;
  }

  private async doStart(): Promise<SessionState> {
    if (this.current.phase !== 'idle') throw new Error('Recording is already in progress');
    const recordingId = randomUUID();
    const startedAt = new Date().toISOString();
    this.set({ phase: 'starting', recordingId, startedAt });
    try {
      this.pageUrl = await this.deps.pageUrl();
      this.handle = await this.deps.openCapture(this.framesDir(recordingId));
      this.set({ phase: 'recording', recordingId, startedAt });
      return this.deps.state;
    } catch (error) {
      await this.cleanup();
      this.set({ phase: 'idle' });
      throw error;
    }
  }

  private async doStop(): Promise<SessionState> {
    // A duplicate stop queued behind the first one is a no-op.
    if (this.current.phase === 'stopping' || this.current.phase === 'stopped') {
      return this.deps.state;
    }
    if (this.current.phase !== 'recording' || !this.handle) {
      throw new Error('No recording is in progress');
    }
    const { recordingId, startedAt } = this.current;
    const handle = this.handle;
    this.handle = undefined;
    this.set({ phase: 'stopping', recordingId, startedAt });
    try {
      this.frames = await handle.stop();
      if (!this.frames.length) throw new Error('Recording captured no frames');
      this.set({ phase: 'stopped', recordingId, startedAt });
      return this.deps.state;
    } catch (error) {
      await this.cleanup();
      this.set({ phase: 'idle' });
      throw error;
    }
  }

  private async doProcess(): Promise<CaptureResult> {
    if (this.current.phase !== 'stopped' || !this.frames) {
      throw new Error('No stopped recording to process');
    }
    const { recordingId, startedAt } = this.current;
    const frames = this.frames;
    this.frames = undefined;
    this.set({ phase: 'processing', recordingId, startedAt });
    try {
      const viewport = this.deps.viewport();
      const endedAt = frames[frames.length - 1].timestamp;
      const recording: Recording = {
        recordingId,
        comment: '',
        startedAt,
        endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        viewport: { ...viewport, height: Math.max(1, viewport.height - TOP_BAND) },
        page: { url: this.pageUrl },
        cuts: await this.deps.process(
          frames,
          this.framesDir(recordingId),
          cutsDir(this.deps.artifactsDir, recordingId),
        ),
      };
      await deleteSessionArtifacts(this.framesDir(recordingId));
      this.set({ phase: 'draft', recording });
      return { state: this.deps.state, draft: { kind: 'recording', recording } };
    } catch (error) {
      await this.cleanup();
      this.set({ phase: 'idle' });
      throw error;
    }
  }

  /** Best effort: every artifact and handle this controller owns is released. */
  private async cleanup(): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    this.frames = undefined;
    if (handle) await handle.stop().catch(() => undefined);
    const recordingId = this.recordingId();
    if (!recordingId) return;
    await deleteSessionArtifacts(this.framesDir(recordingId)).catch(() => undefined);
    await deleteSessionArtifacts(cutsDir(this.deps.artifactsDir, recordingId)).catch(() => undefined);
  }

  private recordingId(): string | undefined {
    if (this.current.phase === 'draft') return this.current.recording.recordingId;
    return 'recordingId' in this.current ? this.current.recordingId : undefined;
  }

  private framesDir(recordingId: string): string {
    return join(this.deps.artifactsDir, `.frames-${recordingId}`);
  }
}
