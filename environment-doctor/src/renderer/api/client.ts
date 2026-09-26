/**
 * The renderer's only door to the orchestrator. In Electron this is the preload's narrow
 * contextBridge (`window.envDoctor`); in a plain browser (dev server, tests) it is an
 * in-process demo orchestrator with the same contract.
 */
import type { Channel, EnvDoctorBridge, Fault, Req, Res, Result, Stream, Streams } from '../../shared/contracts';
import { Orchestrator } from '../../engine/orchestrator';
import { DemoDataset } from '../../engine/demo/fixtures';
import { createBrowserHost } from './browserHost';

declare global {
  interface Window {
    envDoctor?: EnvDoctorBridge;
    /** Test hook, browser build only. */
    __envDoctorDemo?: { fault(f: Fault): Promise<unknown>; reset(): Promise<unknown>; orchestrator: Orchestrator };
  }
}

let bridge: EnvDoctorBridge | null = null;

function createInProcessBridge(): EnvDoctorBridge {
  const host = createBrowserHost();
  const orch = new Orchestrator({ host, datasets: { demo: () => new DemoDataset({ sleep: host.sleep }) }, defaultMode: 'demo' });
  window.__envDoctorDemo = {
    orchestrator: orch,
    fault: (fault) => orch.handle('demo.fault', { fault }),
    reset: async () => { const r = await orch.handle('demo.reset', undefined); try { sessionStorage.clear(); } catch { /* ignore */ } return r; },
  };
  return {
    platform: 'browser',
    // Structured-clone both ways, exactly like Electron IPC, so the UI can never hold live engine objects.
    invoke: async (channel, req) => structuredClone(await orch.handle(channel, req === undefined ? req : structuredClone(req))),
    subscribe: (stream, cb) => host.on(stream, cb as (d: unknown) => void),
  };
}

export function getBridge(): EnvDoctorBridge {
  if (!bridge) {
    // Inside the desktop app a missing bridge is a hard error — never silently fall back to demo data.
    if (!window.envDoctor && window.location.protocol === 'app:') throw new Error('The secure bridge to the Environment Doctor engine did not load.');
    bridge = window.envDoctor ?? createInProcessBridge();
  }
  return bridge;
}

/** Test seam. */
export function setBridge(b: EnvDoctorBridge | null) { bridge = b; }

export async function call<C extends Channel>(channel: C, ...req: Req<C> extends void ? [] : [Req<C>]): Promise<Result<Res<C>>> {
  return getBridge().invoke(channel, (req[0] ?? undefined) as Req<C>);
}

export function subscribe<S extends Stream>(stream: S, cb: (data: Streams[S]) => void) {
  return getBridge().subscribe(stream, cb);
}
