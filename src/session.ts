import { randomBytes } from 'node:crypto';
import type { SessionContext } from './types.js';

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export function createSessionContext(input: {
  harness: string;
  chatTitle: string;
  sessionId?: string;
  existingRefs?: ReadonlySet<string>;
}): SessionContext {
  const harness = input.harness.trim();
  const chatTitle = input.chatTitle.trim();
  const harnessSlug = slugify(harness);
  const chatSlug = slugify(chatTitle);

  if (!harnessSlug) {
    throw new Error('--harness must contain at least one letter or number');
  }
  if (!chatSlug) {
    throw new Error('--chat-title must contain at least one letter or number');
  }

  const sessionId = input.sessionId ? slugify(input.sessionId) : randomBytes(4).toString('hex');
  if (!sessionId) {
    throw new Error('--session-id must contain at least one letter or number');
  }

  const sessionRef = `${harnessSlug}__${chatSlug}__${sessionId}`;
  if (input.existingRefs?.has(sessionRef)) {
    throw new Error(`Session ref collision: ${sessionRef}`);
  }

  return { harness, chatTitle, sessionId, sessionRef };
}
