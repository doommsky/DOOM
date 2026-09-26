/** In-process host for the browser build and tests: demo data only, state in sessionStorage. */
import type { Streams } from '../../shared/contracts';
import type { Host } from '../../engine/engine';

type Listener = (data: unknown) => void;

function storage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function speedFactor(): number {
  try {
    const q = new URLSearchParams(window.location.search).get('speed');
    const v = q ?? window.localStorage.getItem('envdoctor.speed');
    const n = v ? Number(v) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch { return 1; }
}

export function createBrowserHost() {
  const listeners = new Map<string, Set<Listener>>();
  const mem = new Map<string, string>();
  const get = (k: string) => storage()?.getItem('envdoctor.' + k) ?? mem.get(k) ?? null;
  const set = (k: string, v: string) => { mem.set(k, v); try { storage()?.setItem('envdoctor.' + k, v); } catch { /* quota or disabled */ } };
  if (!get('boot')) set('boot', 'boot-' + Math.random().toString(36).slice(2, 8));
  const host: Host & { on(stream: string, cb: Listener): () => void } = {
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms / speedFactor()))),
    now: () => Date.now(),
    bootId: async () => get('boot')!,
    simulateReboot: async () => { set('boot', 'boot-' + Math.random().toString(36).slice(2, 8)); },
    load: async (key) => { const v = get(key); return v ? { value: JSON.parse(v) } : null; },
    save: async (key, value) => { set(key, JSON.stringify(value)); },
    emit: <S extends keyof Streams>(stream: S, data: Streams[S]) => { listeners.get(stream)?.forEach((cb) => cb(data)); },
    online: async () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    on(stream, cb) {
      if (!listeners.has(stream)) listeners.set(stream, new Set());
      listeners.get(stream)!.add(cb);
      return () => { listeners.get(stream)?.delete(cb); };
    },
  };
  return host;
}
