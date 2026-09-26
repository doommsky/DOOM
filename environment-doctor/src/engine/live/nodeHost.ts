/**
 * Node host for Electron main and the CLI: durable JSON state with atomic writes and a
 * rolling backup (spec §13: tested restore; corrupt main file → restore from backup + banner).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Streams } from '../../shared/contracts';
import type { Host } from '../engine';

export function createNodeHost(dir: string, emit: <S extends keyof Streams>(s: S, d: Streams[S]) => void, online: () => Promise<boolean> = async () => true): Host {
  fs.mkdirSync(dir, { recursive: true });
  const file = (k: string) => path.join(dir, k.replace(/[^a-z0-9._-]/gi, '_') + '.json');
  // Boot session = machine boot time (minute precision). A restart changes it; app restarts don't.
  const bootId = 'boot-' + Math.round((Date.now() - os.uptime() * 1000) / 60000).toString(36);
  const writing = new Map<string, Promise<void>>();
  return {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    bootId: async () => bootId,
    load: async (key) => {
      const f = file(key);
      for (const [p, restored] of [[f, false], [f + '.bak', true]] as const) {
        try {
          const txt = fs.readFileSync(p, 'utf8');
          return { value: JSON.parse(txt), restored };
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !restored) continue;
        }
      }
      return null;
    },
    save: async (key, value) => {
      const prev = writing.get(key) ?? Promise.resolve();
      const next = prev.then(() => {
        const f = file(key);
        const tmp = f + '.tmp';
        const data = JSON.stringify(value);
        const fd = fs.openSync(tmp, 'w');
        try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        try { if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak'); } catch { /* backup best effort */ }
        fs.renameSync(tmp, f);
      });
      writing.set(key, next.catch(() => undefined));
      await next;
    },
    emit,
    online,
  };
}
