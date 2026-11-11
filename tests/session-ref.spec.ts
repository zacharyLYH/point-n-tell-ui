import { expect, test } from '@playwright/test';
import { parseViewport } from '../src/server.js';
import { createSessionContext, slugify } from '../src/session.js';

test('session ref is deterministic and filesystem safe', () => {
  const context = createSessionContext({
    harness: 'Kilo',
    chatTitle: 'Checkout Bug',
    sessionId: 'AbC 123',
  });

  expect(context.sessionId).toBe('abc-123');
  expect(context.sessionRef).toBe('kilo__checkout-bug__abc-123');
  expect(slugify('  Hello, World!  ')).toBe('hello-world');
  expect(slugify('Café 菜单')).toBe('cafe-菜单');
});

test('distinct inputs that normalize to the same ref are rejected', () => {
  const existingRefs = new Set(['kilo__checkout-bug__abc-123']);

  expect(() =>
    createSessionContext({
      harness: 'KILO',
      chatTitle: 'checkout bug',
      sessionId: 'ABC 123',
      existingRefs,
    }),
  ).toThrow(/collision/i);
});

test('generated session IDs are unique', () => {
  const refs = new Set<string>();
  for (let index = 0; index < 50; index += 1) {
    refs.add(
      createSessionContext({ harness: 'kilo', chatTitle: 'checkout bug' })
        .sessionRef,
    );
  }
  expect(refs.size).toBe(50);
});

test('empty session parts are rejected', () => {
  expect(() =>
    createSessionContext({ harness: '---', chatTitle: 'checkout bug' }),
  ).toThrow(/harness/);
  expect(() =>
    createSessionContext({ harness: 'kilo', chatTitle: '***' }),
  ).toThrow(/chat-title/);
  expect(() =>
    createSessionContext({ harness: 'kilo', chatTitle: 'bug', sessionId: '...' }),
  ).toThrow(/session-id/);
});

test('viewport validation accepts a preset at its applied size', () => {
  expect(parseViewport({ preset: 'desktop', width: 1440, height: 900 })).toEqual({
    preset: 'desktop',
    width: 1440,
    height: 900,
  });
  expect(parseViewport({ preset: 'custom', width: 1280, height: 720 })).toEqual({
    preset: 'custom',
    width: 1280,
    height: 720,
  });
  expect(parseViewport({ preset: 'tablet', width: 768, height: 1024 }).preset).toBe(
    'tablet',
  );
  // A short display clamps a preset; the applied size is still that preset.
  expect(parseViewport({ preset: 'desktop', width: 1440, height: 798 })).toEqual({
    preset: 'desktop',
    width: 1440,
    height: 798,
  });
  expect(() => parseViewport({ preset: 'phone', width: 400, height: 800 })).toThrow(/preset/);
  expect(() =>
    parseViewport({ preset: 'custom', width: 0, height: 720 }),
  ).toThrow(/positive integers/);
  expect(() =>
    parseViewport({ preset: 'custom', width: 10.5, height: 720 }),
  ).toThrow(/positive integers/);
});
