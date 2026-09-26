import { defineConfig } from '@playwright/test';

/** Screen/flow layer (Handoff test plan): the renderer against the mock orchestrator, AC-01…AC-26. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run build:renderer && npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 120_000 },
});
