import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ContextArtifacts, SessionSnapshot } from './types.js';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function pointAndTellRoot(env = process.env): string {
  return env.PNT_HOME ?? join(homedir(), '.point-n-tell-ui');
}

export function artifactsRoot(env = process.env): string {
  return env.PNT_ARTIFACTS_DIR ?? join(pointAndTellRoot(env), 'artifacts');
}

export function profileRoot(env = process.env): string {
  return env.PNT_PROFILE_DIR ?? join(pointAndTellRoot(env), 'chromium-profile');
}

export function retentionMs(): number {
  const configured = Number(process.env.PNT_RETENTION_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : MONTH_MS;
}

export async function cleanupExpiredArtifacts(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - retentionMs();
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = join(root, entry.name);
    try {
      const info = await stat(path);
      if (info.mtimeMs < cutoff) {
        await rm(path, { recursive: true, force: true });
        removed.push(path);
      }
    } catch {
      // A concurrent CLI may have removed it already.
    }
  }
  return removed;
}

/**
 * Persists the full console, network, and localStorage payloads next to the
 * captured images. These files keep data that is too noisy for CLI output.
 */
export async function writeContextArtifacts(
  dir: string,
  context: Pick<SessionSnapshot, 'console' | 'network' | 'storage'>,
): Promise<ContextArtifacts> {
  const paths = {
    console: join(dir, 'console.json'),
    network: join(dir, 'network.json'),
    localStorage: join(dir, 'localstorage.json'),
  };
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(paths.console, JSON.stringify(context.console, null, 2)),
    writeFile(paths.network, JSON.stringify(context.network, null, 2)),
    writeFile(paths.localStorage, JSON.stringify(context.storage.localStorage, null, 2)),
  ]);
  return paths;
}

export async function deleteSessionArtifacts(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
