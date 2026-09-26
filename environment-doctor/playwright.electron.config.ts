import { defineConfig } from '@playwright/test';

/** Electron smoke layer: the real main process, preload bridge, app:// protocol and live engine. Run after `npm run build`. */
export default defineConfig({ testDir: 'tests/electron', timeout: 120_000, reporter: [['list']], workers: 1 });
