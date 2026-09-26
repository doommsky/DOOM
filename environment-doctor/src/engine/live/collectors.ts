/**
 * Read-only collectors for the live engine (spec §16 L0–L2, §36 MVP scope).
 * Nothing here changes the machine. Secret values are never read: only names/presence (spec §11).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ErrorCode } from '../../shared/contracts';
import { firstLine, powershell, run, version } from './exec';

export type Collected<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; note: string };
const okv = <T>(value: T): Collected<T> => ({ ok: true, value });
const bad = (code: ErrorCode, note: string): Collected<never> => ({ ok: false, code, note });

export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

// ───────────────────────────── redaction ─────────────────────────────

const USER = (() => { try { return os.userInfo().username; } catch { return ''; } })();
const HOST = os.hostname();
const HOME = os.homedir();

/** Replace machine/user identifiers before anything is stored as evidence (spec §11). */
export function redact(s: string): string {
  let out = s;
  if (HOME) out = out.split(HOME).join(isWin ? '%USERPROFILE%' : '~');
  if (USER && USER.length > 2) out = out.replace(new RegExp(`\\b${escapeRe(USER)}\\b`, 'gi'), '<user>');
  if (HOST && HOST.length > 2) out = out.replace(new RegExp(`\\b${escapeRe(HOST)}\\b`, 'gi'), '<machine>');
  return out.replace(/(gh[pousr]_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9-_]{12,}|AKIA[0-9A-Z]{12,}|xox[abpr]-[A-Za-z0-9-]{8,})/g, '[secret removed]');
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE|CREDENTIAL|AUTH|SESSION|COOKIE|CONN(ECTION)?_?STR)/i;
export function secretEnvNames(): string[] {
  return Object.keys(process.env).filter((k) => SECRET_NAME.test(k)).sort();
}

// ───────────────────────────── OS ─────────────────────────────

export interface OsFacts { label: string; build: string; arch: string; cpu: string; ramGb: number; hostname: string; uptimeH: number }

export function osFacts(): OsFacts {
  const rel = os.release();
  let label = `${os.type()} ${rel}`;
  if (isWin) {
    const build = Number(rel.split('.')[2] ?? 0);
    label = `${build >= 22000 ? 'Windows 11' : 'Windows 10'} · build ${build}`;
  } else if (isMac) label = `macOS · Darwin ${rel}`;
  else label = `Linux ${rel}`;
  return { label, build: rel, arch: os.arch(), cpu: os.cpus()[0]?.model?.trim() ?? 'CPU', ramGb: Math.round(os.totalmem() / 1024 ** 3), hostname: os.hostname(), uptimeH: Math.round(os.uptime() / 3600) };
}

// ───────────────────────────── Windows bundle (one PowerShell call) ─────────────────────────────

export interface WinBundle {
  disks?: { name: string; freeGb: number; sizeGb: number }[];
  display?: { name: string; version: string; date: string; signed: boolean; signer: string }[];
  unsignedDrivers?: number;
  events?: { t: string; id: number; p: string; lvl: number; msg: string }[];
  whea?: number;
  startup?: number;
  hotfix?: string;
  pathUser?: string;
  pathUserType?: string;
  pathMachine?: string;
  ps?: string;
  errors?: Record<string, string>;
}

const WIN_SCRIPT = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$o = [ordered]@{ errors = @{} }
function Try-It($name, [scriptblock]$sb) { try { $o[$name] = & $sb } catch { $o.errors[$name] = $_.Exception.Message } }
Try-It 'disks' { @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { [ordered]@{ name = $_.DeviceID; freeGb = [math]::Round($_.FreeSpace/1GB,1); sizeGb = [math]::Round($_.Size/1GB,1) } }) }
Try-It 'display' { @(Get-CimInstance Win32_PnPSignedDriver -Filter "DeviceClass='DISPLAY'" | Where-Object { $_.DeviceName } | ForEach-Object { [ordered]@{ name = $_.DeviceName; version = $_.DriverVersion; date = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' }; signed = [bool]$_.IsSigned; signer = [string]$_.Signer } }) }
Try-It 'unsignedDrivers' { @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.IsSigned -eq $false }).Count }
Try-It 'events' { @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1,2; StartTime = (Get-Date).AddDays(-7) } -MaxEvents 300 -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ t = $_.TimeCreated.ToString('o'); id = $_.Id; p = $_.ProviderName; lvl = $_.Level; msg = (($_.Message -split "\r?\n")[0]) } }) }
Try-It 'whea' { @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; StartTime = (Get-Date).AddDays(-30) } -MaxEvents 50 -ErrorAction SilentlyContinue).Count }
Try-It 'startup' { @(Get-CimInstance Win32_StartupCommand).Count }
Try-It 'hotfix' { $h = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1; if ($h) { $h.InstalledOn.ToString('yyyy-MM-dd') } else { '' } }
Try-It 'pathUser' { $k = Get-Item 'HKCU:\Environment'; [string]$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames') }
Try-It 'pathUserType' { [string](Get-Item 'HKCU:\Environment').GetValueKind('Path') }
Try-It 'pathMachine' { [string](Get-Item 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames') }
Try-It 'ps' { $PSVersionTable.PSVersion.ToString() }
$o | ConvertTo-Json -Depth 5 -Compress
`;

export async function winBundle(): Promise<Collected<WinBundle>> {
  if (!isWin) return bad('E_COLLECTION_UNSUPPORTED', 'Windows only');
  const r = await powershell(WIN_SCRIPT, 60000);
  if (r.missing) return bad('E_COLLECTION_UNSUPPORTED', 'PowerShell not found');
  if (r.timedOut) return bad('E_COLLECTION_TIMEOUT', 'Windows checks took longer than 60 s');
  try {
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() ?? '{}') as WinBundle;
    const arr = <T>(x: T[] | T | undefined): T[] | undefined => (x === undefined || x === null ? undefined : Array.isArray(x) ? x : [x]);
    j.disks = arr(j.disks); j.display = arr(j.display); j.events = arr(j.events);
    return okv(j);
  } catch {
    return bad('E_COLLECTION_FAILED', 'Couldn’t read the Windows checks (' + firstLine(r.stderr).slice(0, 120) + ')');
  }
}

export async function unixDisks(): Promise<Collected<{ name: string; freeGb: number; sizeGb: number }[]>> {
  const r = await run('df', ['-kP']);
  if (!r.ok) return bad(r.missing ? 'E_COLLECTION_UNSUPPORTED' : 'E_COLLECTION_FAILED', 'df unavailable');
  const rows = r.stdout.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 6 && (c[5] === '/' || c[5].startsWith('/home') || c[5] === '/System/Volumes/Data'));
  return okv(rows.map((c) => ({ name: c[5], sizeGb: Math.round(Number(c[1]) / 1024 ** 2), freeGb: Math.round((Number(c[3]) / 1024 ** 2) * 10) / 10 })));
}

// ───────────────────────────── PATH ─────────────────────────────

export interface PathEntry { dir: string; expanded: string; exists: boolean; dup: boolean; scope: 'user' | 'machine' | 'process' }

export function expandWin(s: string) {
  return s.replace(/%([^%]+)%/g, (m, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? m);
}

export function splitPath(raw: string): string[] {
  return raw.split(isWin ? ';' : ':').map((x) => x.trim()).filter(Boolean);
}

export function analysePath(entries: { dir: string; scope: PathEntry['scope'] }[]): PathEntry[] {
  const seen = new Set<string>();
  return entries.map(({ dir, scope }) => {
    const expanded = isWin ? expandWin(dir) : dir.replace(/^~(?=\/|$)/, HOME);
    const key = (isWin ? expanded.toLowerCase() : expanded).replace(/[\\/]+$/, '');
    const dup = seen.has(key);
    seen.add(key);
    let exists = false;
    try { exists = !/%[^%]+%/.test(expanded) ? fs.statSync(expanded).isDirectory() : true; } catch { exists = false; }
    return { dir, expanded, exists, dup, scope };
  });
}

// ───────────────────────────── dev tools ─────────────────────────────

export interface Tool { found: boolean; version?: string; path?: string; note?: string; code?: ErrorCode }

async function which(bin: string): Promise<string | undefined> {
  const r = await run(isWin ? 'where.exe' : 'which', [bin], { timeoutMs: 5000 });
  return r.ok ? firstLine(r.stdout) : undefined;
}

async function tool(bin: string, args: string[], winBin?: string): Promise<Tool> {
  const b = isWin && winBin ? winBin : bin;
  const r = await run(b, args, { timeoutMs: 12000 });
  if (r.missing || (!r.ok && /not recognized|not found/i.test(r.stderr))) return { found: false, note: 'not found on PATH' };
  if (r.timedOut) return { found: true, note: 'didn’t answer in 12 s', code: 'E_COLLECTION_TIMEOUT' };
  const out = (r.stdout || r.stderr).trim();
  if (!r.ok && !out) return { found: true, note: 'found but failed to run', code: 'E_COLLECTION_FAILED' };
  return { found: true, version: version(out) || firstLine(out).slice(0, 40), path: redact((await which(bin)) ?? '') };
}

export interface DevTools {
  node: Tool; npm: Tool; pnpm: Tool; yarn: Tool; python: Tool; pip: Tool; git: Tool; docker: Tool; dockerEngine: Tool; wsl: Tool; nvm: Tool; nvidia: Tool & { driver?: string; maxCuda?: string; gpu?: string }; vsBuild: Tool;
}

export async function devTools(): Promise<DevTools> {
  const [node, npm, pnpm, yarn, python, pip, git, docker, nvm] = await Promise.all([
    tool('node', ['-v']), tool('npm', ['-v'], 'npm.cmd'), tool('pnpm', ['-v'], 'pnpm.cmd'), tool('yarn', ['-v'], 'yarn.cmd'),
    isWin ? tool('python', ['--version']).then(async (t) => (t.found && t.version ? t : await tool('py', ['--version']))) : tool('python3', ['--version']),
    isWin ? tool('pip', ['--version']) : tool('pip3', ['--version']),
    tool('git', ['--version']), tool('docker', ['--version']), isWin ? tool('nvm', ['version']) : Promise.resolve<Tool>({ found: false }),
  ]);
  // Windows Store python alias prints nothing useful — treat as not installed.
  if (python.found && !python.version) Object.assign(python, { found: false, note: 'only the Microsoft Store alias' });
  let dockerEngine: Tool = { found: false, note: docker.found ? 'engine not answering' : 'Docker not installed' };
  if (docker.found) {
    const r = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 8000 });
    dockerEngine = r.ok && r.stdout.trim() ? { found: true, version: r.stdout.trim() } : { found: false, note: 'engine off or not answering', code: 'E_COLLECTION_FAILED' };
  }
  let wsl: Tool = { found: false, note: 'Windows only' };
  if (isWin) {
    const r = await run('wsl.exe', ['--status'], { timeoutMs: 10000 });
    const txt = (r.stdout + r.stderr).replace(/\u0000/g, '');
    wsl = r.missing ? { found: false, note: 'not installed' } : r.ok ? { found: true, version: (txt.match(/version:\s*([\d.]+)/i) ?? [])[1] ?? 'ready', note: /default version:\s*2/i.test(txt) ? 'WSL 2' : 'ready' } : { found: false, note: 'not enabled' };
  }
  let nvidia: DevTools['nvidia'] = { found: false, note: 'no NVIDIA GPU driver found' };
  const smi = await run('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], { timeoutMs: 10000 });
  if (smi.ok && smi.stdout.trim()) {
    const [gpu, driver] = smi.stdout.trim().split('\n')[0].split(',').map((x) => x.trim());
    const full = await run('nvidia-smi', [], { timeoutMs: 10000 });
    const maxCuda = (full.stdout.match(/CUDA Version:\s*([\d.]+)/) ?? [])[1];
    nvidia = { found: true, version: driver, driver, maxCuda, gpu };
  }
  let vsBuild: Tool = { found: false, note: isWin ? 'C++ build tools not found' : 'n/a' };
  if (isWin) {
    const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (fs.existsSync(vswhere)) {
      const r = await run(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'catalog_productDisplayVersion'], { timeoutMs: 10000 });
      if (r.ok && r.stdout.trim()) vsBuild = { found: true, version: r.stdout.trim() };
    }
  }
  return { node, npm, pnpm, yarn, python, pip, git, docker, dockerEngine, wsl, nvm, nvidia, vsBuild };
}

// ───────────────────────────── projects ─────────────────────────────

export interface ProjectFacts {
  id: string; name: string; path: string; displayPath: string;
  node?: { engines?: string; nvmrc?: string; packageManager?: string; lock?: 'npm' | 'pnpm' | 'yarn' };
  python?: { requires?: string; pyversion?: string; venv: boolean; requirements: boolean };
  docker?: { compose: boolean; dockerfile: boolean };
  git: boolean;
  symlink: boolean;
}

const CANDIDATE_ROOTS = () => {
  const h = HOME;
  const list = ['source/repos', 'repos', 'projects', 'Projects', 'dev', 'code', 'Code', 'src', 'work', 'Documents/GitHub', 'Documents/Projects', 'Desktop'].map((p) => path.join(h, p));
  if (isWin) list.push('D:\\work', 'D:\\projects', 'D:\\dev', 'C:\\dev', 'C:\\projects', 'C:\\src');
  return list;
};

function readJson(p: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { return null; }
}
function readText(p: string, max = 64 * 1024): string | null {
  try { const b = fs.readFileSync(p); return b.subarray(0, max).toString('utf8'); } catch { return null; }
}

export function discoverProjects(extraRoots: string[] = [], limit = 12): ProjectFacts[] {
  const out: ProjectFacts[] = [];
  const seen = new Set<string>();
  const markers = ['package.json', 'pyproject.toml', 'requirements.txt', 'compose.yaml', 'docker-compose.yml', 'Dockerfile'];
  const consider = (dir: string) => {
    if (out.length >= limit || seen.has(dir)) return;
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { return; }
    if (!markers.some((m) => names.includes(m))) return;
    seen.add(dir);
    let symlink = false;
    try { symlink = fs.lstatSync(dir).isSymbolicLink(); } catch { /* ignore */ }
    const pj = names.includes('package.json') ? readJson(path.join(dir, 'package.json')) : null;
    const f: ProjectFacts = { id: 'p' + out.length, name: path.basename(dir), path: dir, displayPath: redact(dir), git: names.includes('.git'), symlink };
    if (pj) {
      const engines = (pj.engines as Record<string, string> | undefined)?.node;
      f.node = {
        engines, packageManager: typeof pj.packageManager === 'string' ? pj.packageManager : undefined,
        nvmrc: names.includes('.nvmrc') ? readText(path.join(dir, '.nvmrc'))?.trim() : names.includes('.node-version') ? readText(path.join(dir, '.node-version'))?.trim() : undefined,
        lock: names.includes('pnpm-lock.yaml') ? 'pnpm' : names.includes('yarn.lock') ? 'yarn' : names.includes('package-lock.json') ? 'npm' : undefined,
      };
    }
    if (names.includes('pyproject.toml') || names.includes('requirements.txt') || names.includes('.python-version')) {
      const py = readText(path.join(dir, 'pyproject.toml')) ?? '';
      f.python = {
        requires: (py.match(/requires-python\s*=\s*["']([^"']+)["']/) ?? [])[1],
        pyversion: names.includes('.python-version') ? readText(path.join(dir, '.python-version'))?.trim() : undefined,
        venv: names.includes('.venv') || names.includes('venv'), requirements: names.includes('requirements.txt'),
      };
    }
    if (names.includes('compose.yaml') || names.includes('docker-compose.yml') || names.includes('Dockerfile')) f.docker = { compose: names.includes('compose.yaml') || names.includes('docker-compose.yml'), dockerfile: names.includes('Dockerfile') };
    out.push(f);
  };
  for (const root of [...extraRoots, ...CANDIDATE_ROOTS()]) {
    if (out.length >= limit) break;
    let subs: fs.Dirent[];
    try { subs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    consider(root);
    for (const s of subs) {
      if (out.length >= limit) break;
      if (s.isDirectory() && !s.name.startsWith('.') && s.name !== 'node_modules') consider(path.join(root, s.name));
    }
  }
  return out;
}

/** Minimal semver range check for “>=x.y”, “^x”, “x.y.z”, “x”. Unknown forms → undefined (Unknown, not a fail). */
export function satisfies(have: string | undefined, want: string | undefined): boolean | undefined {
  if (!have || !want) return undefined;
  const h = have.replace(/^v/, '').split('.').map(Number);
  const m = want.trim().match(/^(>=|\^|~|>)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return undefined;
  const w = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
  const cmp = (a: number[], b: number[]) => { for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) - b[i]; } return 0; };
  switch (m[1]) {
    case '>=': return cmp(h, w) >= 0;
    case '>': return cmp(h, w) > 0;
    case '^': return h[0] === w[0] && cmp(h, w) >= 0;
    case '~': return h[0] === w[0] && h[1] === w[1] && cmp(h, w) >= 0;
    default: return m[3] === undefined ? h[0] === w[0] : cmp(h, w) === 0 || (m[4] === undefined && h[0] === w[0] && h[1] === w[1]);
  }
}

export function dirSizeOlderThan(dir: string, days: number, cap = 20000): { bytes: number; files: number } {
  const cutoff = Date.now() - days * 86400e3;
  let bytes = 0, files = 0, visited = 0;
  const walk = (d: string, depth: number) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (++visited > cap) return;
      const p = path.join(d, e.name);
      try {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) { if (depth < 6) walk(p, depth + 1); }
        else if (st.mtimeMs < cutoff) { bytes += st.size; files++; }
      } catch { /* in use or denied */ }
    }
  };
  walk(dir, 0);
  return { bytes, files };
}
