/**
 * Narrow contextBridge (spec §25): two functions, a channel allowlist, no raw ipcRenderer.
 * Sandboxed preload — only `electron` may be required here.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS, STREAMS } from '../shared/contracts';

const allowed = new Set<string>(CHANNELS);
const streams = new Set<string>(STREAMS);

contextBridge.exposeInMainWorld('envDoctor', {
  platform: 'electron',
  invoke: (channel: string, req: unknown) => {
    if (!allowed.has(channel)) return Promise.resolve({ ok: false, error: { code: 'E_INVALID_REQUEST', headline: 'Unknown request' } });
    return ipcRenderer.invoke('ed:invoke', channel, req);
  },
  subscribe: (stream: string, cb: (data: unknown) => void) => {
    if (!streams.has(stream)) return () => undefined;
    const h = (_e: IpcRendererEvent, s: string, data: unknown) => { if (s === stream) cb(data); };
    ipcRenderer.on('ed:stream', h);
    return () => { ipcRenderer.removeListener('ed:stream', h); };
  },
});
