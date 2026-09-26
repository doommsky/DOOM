/**
 * Electron main = broker, not administrator (spec §2, §25): window + navigation control,
 * sender-validated IPC to the user-level orchestrator, tray, lifecycle. Runs asInvoker.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, session, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CHANNELS, type Channel, type Streams } from '../shared/contracts';
import { Orchestrator } from '../engine/orchestrator';
import { DemoDataset } from '../engine/demo/fixtures';
import { LiveDataset } from '../engine/live/dataset';
import { createNodeHost } from '../engine/live/nodeHost';

const SCHEME = 'app';
const RENDERER_DIR = path.join(__dirname, '..', '..', 'dist');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();
// Sandbox every renderer. (Linux CI as root must pass --no-sandbox; the per-window sandbox below still applies.)
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let orchestrator: Orchestrator;
let projectRoots: string[] = [];

function emit<S extends keyof Streams>(stream: S, data: Streams[S]) {
  if (win && !win.isDestroyed()) win.webContents.send('ed:stream', stream, data);
  if (stream === 'run.progress') updateTray();
}

function createOrchestrator() {
  const host = createNodeHost(path.join(app.getPath('userData'), 'state'), emit, async () => net.isOnline());
  const o = new Orchestrator({
    host,
    defaultMode: 'live',
    datasets: {
      live: () => new LiveDataset({ sleep: host.sleep, appVersion: app.getVersion(), projectRoots: () => projectRoots }),
      demo: () => new DemoDataset({ sleep: host.sleep }),
    },
  });
  return o;
}

/** Serve the renderer from app:// (not file://), with path traversal blocked and CSP headers. */
function registerProtocol() {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(RENDERER_DIR, rel));
    if (!file.startsWith(RENDERER_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { 'content-type': mime(file), 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function mime(f: string) {
  const ext = path.extname(f).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

function isTrustedSender(frame: Electron.WebFrameMain | null | undefined, sender: Electron.WebContents) {
  if (!frame || !win || sender.id !== win.webContents.id) return false;
  try { return new URL(frame.url).protocol === SCHEME + ':'; } catch { return false; }
}

function registerIpc() {
  const allowed = new Set<string>(CHANNELS);
  ipcMain.handle('ed:invoke', async (e, channel: unknown, req: unknown) => {
    // Sender validation on every call (spec §25, §34 “IPC sender spoofing”): unknown senders get no response.
    if (!isTrustedSender(e.senderFrame, e.sender)) return undefined;
    if (typeof channel !== 'string' || !allowed.has(channel)) return { ok: false, error: { code: 'E_INVALID_REQUEST', headline: 'Unknown request' } };
    if (channel === 'projects.addRoot') {
      const pick = await dialog.showOpenDialog(win!, { title: 'Add a project folder', properties: ['openDirectory'] });
      if (pick.canceled || !pick.filePaths[0]) return orchestrator.handle('settings.get', undefined);
      const s = await orchestrator.addProjectRoot(pick.filePaths[0]);
      applySettings(s);
      return { ok: true, data: s };
    }
    if (channel === 'settings.set' || channel === 'projects.removeRoot') {
      const r = await orchestrator.handle(channel, req as never);
      if (r.ok) applySettings(r.data);
      return r;
    }
    return orchestrator.handle(channel as Channel, req as never);
  });
}

function applySettings(s: { general: { launchAtLogin: boolean; trayIcon: boolean }; diagnostics: { projectRoots: string[] } }) {
  projectRoots = s.diagnostics.projectRoots.filter((r) => typeof r === 'string' && path.isAbsolute(r));
  try { app.setLoginItemSettings({ openAtLogin: s.general.launchAtLogin }); } catch { /* unsupported platform */ }
  if (s.general.trayIcon && !tray) createTray();
  if (!s.general.trayIcon && tray) { tray.destroy(); tray = null; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1024, minHeight: 700, show: false, backgroundColor: '#0A0B0E', title: 'Environment Doctor',
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false,
      experimentalFeatures: false, spellcheck: false, devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only well-known documentation links open externally; everything else is denied.
    if (/^https:\/\/(learn\.microsoft\.com|support\.microsoft\.com|github\.com)\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(SCHEME + '://')) e.preventDefault(); });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.on('close', async (e) => {
    // Quit is blocked while a repair runs or waits for restart (spec §28).
    const lock = await orchestrator.handle('lock.get', undefined);
    if (lock.ok && lock.data.held && !forceQuit) {
      e.preventDefault();
      void dialog.showMessageBox(win!, { type: 'warning', title: 'A repair is in progress', message: `A repair for ${lock.data.incidentId} is running or waiting for a restart.`, detail: 'Closing now could leave your PC half-changed. The window will stay open until the repair finishes — its progress is saved either way.', buttons: ['Keep open'] });
    }
  });
  void win.loadURL(`${SCHEME}://app/index.html`);
}

let forceQuit = false;

function iconPath() {
  const p = path.join(__dirname, '..', '..', 'build', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

function createTray() {
  const ip = iconPath();
  const img = ip ? nativeImage.createFromPath(ip).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Environment Doctor');
  tray.on('click', () => { win?.show(); win?.focus(); });
  updateTray();
}

function go(route: string) {
  if (!win) createWindow();
  win!.show();
  win!.focus();
  void win!.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + route)}`);
}

async function updateTray() {
  if (!tray) return;
  const lock = await orchestrator.handle('lock.get', undefined);
  const busy = lock.ok && lock.data.held;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: busy ? `Repairing ${lock.ok ? lock.data.incidentId : ''}…` : 'Environment Doctor', enabled: false },
    { type: 'separator' },
    { label: 'Open', click: () => go('/') },
    { label: 'Run a scan', click: () => go('/scan?start=1'), enabled: !busy },
    { label: 'Describe a problem', click: () => go('/diagnose') },
    { type: 'separator' },
    { label: busy ? 'Quit (blocked during repair)' : 'Quit', enabled: !busy, click: () => { forceQuit = true; app.quit(); } },
  ]));
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (ev, url) => { if (!url.startsWith(SCHEME + '://')) ev.preventDefault(); });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  orchestrator = createOrchestrator();
  registerProtocol();
  registerIpc();
  const s = await orchestrator.handle('settings.get', undefined);
  if (s.ok) applySettings(s.data);
  createWindow();
});

app.on('before-quit', async (e) => {
  if (forceQuit) return;
  const lock = await orchestrator?.handle('lock.get', undefined);
  if (lock?.ok && lock.data.held) e.preventDefault();
});

app.on('window-all-closed', () => { app.quit(); });
