/**
 * Orchestrator facade: settings, engine mode (live ↔ demo) and the typed channel dispatcher.
 * Electron main, the CLI and the browser build all talk to this one object.
 */
import {
  CHANNELS, LOCKED_SETTINGS,
  type Channel, type CommandEntry, type Req, type Res, type Result, type Settings, type EngineMode,
} from '../shared/contracts';
import type { Dataset } from './dataset';
import { Engine, EngineError, fail, toResult, type Host } from './engine';
import { clone, deepGet, deepSet } from './util';

export const DEFAULT_SETTINGS: Settings = {
  general: { launchAtLogin: false, trayIcon: true, scanOnStart: false, theme: 'dark' },
  privacy: { aiMode: 'off', cloudProvider: 'Not chosen', redactSecrets: true, sendCrashDumps: false, previewBeforeSend: true },
  diagnostics: { eventLogDays: 30, includeProjects: true, projectRoots: [], escalation: 'L3' },
  updates: { channel: 'stable', autoCheck: true, blockDuringRepair: true },
  data: { evidenceRetentionDays: 90, historyRetentionDays: 365 },
  engine: { mode: 'demo' },
};

export interface OrchestratorOptions {
  host: Host;
  /** Factory per mode; `live` is absent in the browser build. */
  datasets: Partial<Record<EngineMode, () => Dataset>>;
  defaultMode: EngineMode;
}

export class Orchestrator {
  private engines: Partial<Record<EngineMode, Engine>> = {};
  private settings: Settings = clone(DEFAULT_SETTINGS);
  private ready: Promise<void>;

  constructor(private o: OrchestratorOptions) {
    this.ready = this.init();
  }

  private async init() {
    const saved = await this.o.host.load('settings');
    const base = clone(DEFAULT_SETTINGS);
    base.engine.mode = this.o.datasets[this.o.defaultMode] ? this.o.defaultMode : 'demo';
    this.settings = saved?.value ? mergeDeep(base, saved.value as Partial<Settings>) : base;
    if (!this.o.datasets[this.settings.engine.mode]) this.settings.engine.mode = 'demo';
    // Locked settings are enforced on load too, never trusted from disk.
    this.settings.privacy.redactSecrets = true;
    this.settings.privacy.sendCrashDumps = false;
    this.settings.privacy.previewBeforeSend = true;
    this.settings.updates.blockDuringRepair = true;
  }

  get mode(): EngineMode { return this.settings.engine.mode; }

  async engine(): Promise<Engine> {
    await this.ready;
    const m = this.settings.engine.mode;
    if (!this.engines[m]) {
      const make = this.o.datasets[m] ?? fail({ code: 'E_POLICY_DENIED', headline: 'That mode isn’t available here' });
      this.engines[m] = new Engine(make!(), this.o.host, 'engine-' + m);
    }
    await this.engines[m]!.whenReady();
    return this.engines[m]!;
  }

  availableModes(): EngineMode[] { return (Object.keys(this.o.datasets) as EngineMode[]); }

  private async setSetting(path: string, value: unknown): Promise<Settings> {
    await this.ready;
    if (LOCKED_SETTINGS[path]) fail({ code: 'E_POLICY_DENIED', headline: 'This setting is always on', didNotHappen: 'Nothing changed.', detail: LOCKED_SETTINGS[path] });
    if (path === 'engine.mode') {
      if (value !== 'live' && value !== 'demo') fail({ code: 'E_INVALID_REQUEST', headline: 'Unknown mode' });
      if (!this.o.datasets[value as EngineMode]) fail({ code: 'E_POLICY_DENIED', headline: 'Live mode needs the desktop app', didNotHappen: 'Still in demo mode.', nextStep: 'Install Environment Doctor for Windows.' });
      const cur = this.engines[this.settings.engine.mode];
      if (cur && (await cur.lockGet()).held) fail({ code: 'E_MUTATION_BUSY', headline: 'A repair is running', didNotHappen: 'The mode didn’t change.', nextStep: 'Wait for it to finish.' });
    }
    const before = deepGet(this.settings, path);
    if (before === undefined) fail({ code: 'E_INVALID_REQUEST', headline: 'Unknown setting: ' + path });
    if (typeof before !== typeof value && !(Array.isArray(before) && Array.isArray(value))) fail({ code: 'E_INVALID_REQUEST', headline: 'Wrong type for ' + path });
    // Project folders only come from the native picker (desktop) — the renderer never supplies paths.
    if (path === 'diagnostics.projectRoots' && Array.isArray(value) && value.some((v) => !(before as string[]).includes(v))) fail({ code: 'E_POLICY_DENIED', headline: 'Use “Add folder” to choose a project folder', didNotHappen: 'Nothing changed.' });
    const next = clone(this.settings);
    deepSet(next as unknown as Record<string, unknown>, path, value);
    this.settings = next;
    await this.o.host.save('settings', this.settings);
    return this.settings;
  }

  private async commands(): Promise<CommandEntry[]> {
    const e = await this.engine();
    const inc = (await e.incidentsList()).filter((i) => !['verified', 'closed'].includes(i.status)).slice(0, 8);
    const go = (id: string, label: string, route: string, hint = ''): CommandEntry => ({ id, label, hint, group: 'Go to', route });
    return [
      { id: 'run-scan', label: 'Run a full scan', hint: 'Read-only · PC, dev tools, projects', group: 'Run', route: '/scan?start=1' },
      { id: 'run-describe', label: 'Describe a problem', hint: 'Start a diagnosis from your words', group: 'Run', route: '/diagnose' },
      { id: 'run-setup', label: 'Set up a project or blueprint', hint: 'Dry run first — nothing installs yet', group: 'Run', route: '/setup' },
      ...inc.map((i): CommandEntry => ({ id: 'inc-' + i.id, label: i.id + ' · ' + i.title, hint: i.status.replace('_', ' '), group: 'Incidents', route: '/incidents/' + i.id })),
      go('go-home', 'Overview', '/'), go('go-incidents', 'Incidents', '/incidents'), go('go-evidence', 'Evidence vault', '/evidence'),
      go('go-projects', 'Projects', '/projects'), go('go-actions', 'Safe actions', '/actions'), go('go-history', 'History & audit', '/history'),
      go('go-settings', 'Settings', '/settings/general'), go('go-privacy', 'Privacy & AI settings', '/settings/privacy'),
    ];
  }

  /** Typed dispatcher. Unknown channels and malformed payloads are rejected (spec §34 invalid IDs / parameter injection). */
  async handle<C extends Channel>(channel: C, req: Req<C>): Promise<Result<Res<C>>> {
    if (!(CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: { code: 'E_INVALID_REQUEST', headline: 'Unknown request' } };
    return toResult(this.route(channel, (req ?? {}) as Record<string, unknown>)) as Promise<Result<Res<C>>>;
  }

  private async route(channel: Channel, r: Record<string, unknown>): Promise<unknown> {
    const str = (k: string, max = 200) => {
      const v = r[k];
      if (typeof v !== 'string' || v.length > max) throw new EngineError({ code: 'E_INVALID_REQUEST', headline: 'Invalid ' + k });
      return v;
    };
    const e = await this.engine();
    switch (channel) {
      case 'app.info': return e.machine();
      case 'health.get': return e.health();
      case 'scan.start': {
        const scopes = Array.isArray(r.scopes) ? r.scopes.filter((s): s is 'pc' | 'dev' | 'proj' => s === 'pc' || s === 'dev' || s === 'proj') : [];
        return e.scanStart(scopes);
      }
      case 'scan.stop': return e.scanStop(str('scanId'));
      case 'scan.get': return e.scanGet();
      case 'incidents.list': return e.incidentsList();
      case 'incident.get': return e.incidentGet(str('id'));
      case 'incident.close': return e.incidentClose(str('id'));
      case 'diagnose.sources': return e.dataset.diagnosisSources();
      case 'diagnose.start': {
        const sources = Array.isArray(r.sources) ? r.sources.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
        return e.diagnose({ symptom: str('symptom', 500), when: (r.when as never) ?? 'unsure', frequency: (r.frequency as never) ?? 'random', sources });
      }
      case 'plan.get': return e.planGet(str('id'));
      case 'plan.forIncident': return e.planForIncident(str('incidentId'), { next: !!r.next, variant: typeof r.variant === 'string' ? r.variant : undefined });
      case 'approval.submit': return e.approve({ planId: str('planId'), planHash: str('planHash', 128), uiConfirmationVersion: str('uiConfirmationVersion'), acknowledged: r.acknowledged === true });
      case 'run.start': return e.runStart(str('approvalId'), str('planHash', 128));
      case 'run.get': return e.runGet(str('incidentId'));
      case 'run.decide': return e.runDecide(str('executionId'), str('decision'));
      case 'lock.get': return e.lockGet();
      case 'recovery.get': return e.recoveryGet();
      case 'recovery.recheck': return e.recoveryRecheck();
      case 'recovery.resolve': return e.recoveryResolve(r.decision === 'stop' ? 'stop' : 'continue');
      case 'evidence.list': return e.evidenceList(typeof r.incidentId === 'string' ? r.incidentId : undefined);
      case 'evidence.get': return e.evidenceGet(str('id'));
      case 'redaction.preview': return e.redaction(str('incidentId'));
      case 'blueprints.list': return e.dataset.blueprints();
      case 'setup.dryRun': {
        const os = r.os === 'macos' || r.os === 'linux' ? r.os : 'windows';
        return e.setupDryRun(str('blueprintId'), os);
      }
      case 'projects.list': return e.projectsList();
      case 'project.get': return e.projectGet(str('id'));
      case 'actions.catalog': return e.dataset.catalog();
      case 'history.list': return e.historyList();
      case 'settings.get': await this.ready; return this.settings;
      case 'settings.set': return this.setSetting(str('path'), r.value);
      case 'palette.commands': return this.commands();
      case 'projects.addRoot': return fail({ code: 'E_POLICY_DENIED', headline: 'Adding folders needs the desktop app', didNotHappen: 'Nothing changed.' });
      case 'projects.removeRoot': {
        await this.ready;
        const i = typeof r.index === 'number' ? r.index : -1;
        const roots = this.settings.diagnostics.projectRoots.filter((_, k) => k !== i);
        return this.setSetting('diagnostics.projectRoots', roots);
      }
      case 'demo.fault': return e.setFault((r.fault as never) ?? 'none');
      case 'demo.reset': return e.reset();
    }
  }

  /** Called by Electron main after the native folder picker — the only way a path enters settings. */
  async addProjectRoot(folder: string): Promise<Settings> {
    await this.ready;
    const next = clone(this.settings);
    if (!next.diagnostics.projectRoots.includes(folder)) next.diagnostics.projectRoots = [...next.diagnostics.projectRoots, folder].slice(0, 20);
    this.settings = next;
    await this.o.host.save('settings', this.settings);
    return this.settings;
  }

  /** First run is shown until the first scan finished (Handoff screen 01). */
  async needsFirstRun() { return !(await this.engine()).scanned; }
}

function mergeDeep<T>(base: T, over: Partial<T>): T {
  const out = clone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = mergeDeep(out[k], v as never);
    else if (k in out) out[k] = v;
  }
  return out as T;
}
