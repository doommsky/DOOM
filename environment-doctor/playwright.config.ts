import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PW_PORT ?? 4173);

/** Screen/flow layer (Handoff test plan): the renderer against the mock orchestrator, AC-01…AC-26. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: PORT === 4173 ? 'npm run build:renderer && npm run preview' : `npx vite build --outDir /tmp/ed-dist-${PORT} && npx vite preview --outDir /tmp/ed-dist-${PORT} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 180_000,
  },
});
