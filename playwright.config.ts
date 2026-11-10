import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
