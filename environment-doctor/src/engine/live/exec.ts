/**
 * Bounded subprocess runner (spec §20): timeout, stdout/stderr cap, no shell, hidden window,
 * process-tree kill on timeout, exit classification. Commands and arguments are fixed by the
 * collectors/adapters in this folder — never built from AI output or renderer input.
 */
import { execFile, spawn } from 'node:child_process';

export interface ExecResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  missing: boolean;
  denied: boolean;
}

const MAX = 2 * 1024 * 1024;

export function run(cmd: string, args: string[], opts: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ExecResult> {
  // Node refuses to spawn .cmd/.bat without a shell (CVE-2024-27980). Route those fixed shims through cmd.exe.
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) return run('cmd.exe', ['/d', '/s', '/c', cmd, ...args], opts);
  return new Promise((resolve) => {
    let child: ReturnType<typeof execFile>;
    try {
      child = execFile(cmd, args, { timeout: opts.timeoutMs ?? 15000, maxBuffer: MAX, windowsHide: true, cwd: opts.cwd, env: opts.env ?? process.env, encoding: 'utf8', killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
        const e = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        const missing = e?.code === 'ENOENT';
        const timedOut = !!e?.killed;
        const denied = e?.code === 'EACCES' || e?.code === 'EPERM' || /access is denied|permission denied/i.test(String(stderr));
        if (timedOut && child.pid && process.platform === 'win32') killTree(child.pid);
        resolve({ ok: !e, code: typeof e?.code === 'number' ? e.code : e ? 1 : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), timedOut, missing, denied });
      });
    } catch {
      resolve({ ok: false, code: null, stdout: '', stderr: '', timedOut: false, missing: true, denied: false });
    }
  });
}

function killTree(pid: number) {
  try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref(); } catch { /* best effort */ }
}

/** PowerShell with a fixed script. -NoProfile so user profiles can't inject behaviour. */
export function powershell(script: string, timeoutMs = 30000) {
  return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs });
}

export const firstLine = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).find(Boolean) ?? '';
export const version = (s: string) => (s.match(/\d+\.\d+(\.\d+)?/) ?? [''])[0];
