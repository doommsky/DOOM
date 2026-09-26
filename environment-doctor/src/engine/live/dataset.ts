/**
 * Live dataset: real read-only collectors on this machine, deterministic rules, and a small
 * catalog of user-level actions (no admin helper in this build → admin actions are listed but
 * unavailable, and the policy removes them from plans).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ActionEntry, Blueprint, CheckStatus, Confidence, DiagnoseRequest, DiagnosisSource, EvidenceItem, HealthRow, Hypothesis, Incident,
  MachineInfo, OsKind, Pillar, PlanStep, Project, RedactionPreview, ScanFinding, ScanScope, SetupRow, TimelineEvent, VerificationCheck,
} from '../../shared/contracts';
import type { Dataset, PlanDraft, ScanOutcome, ScanScript, StepContext } from '../dataset';
import { DEMO_ACTIONS } from '../demo/fixtures';
import { sha256 } from '../util';
import {
  analysePath, devTools, dirSizeOlderThan, discoverProjects, isMac, isWin, osFacts, redact, satisfies, secretEnvNames, splitPath, unixDisks, winBundle,
  type DevTools, type PathEntry, type ProjectFacts, type WinBundle,
} from './collectors';
import { powershell, run } from './exec';

const COLLECTOR_V = '1.0';
const LIVE_ACTIONS: Record<string, OsKind[]> = {
  'env.path.user.remove_entry': ['windows'],
  'env.path.user.dedupe': ['windows'],
  'storage.temp.clean': ['windows', 'macos', 'linux'],
  'python.venv.create': ['windows', 'macos', 'linux'],
  'npm.cache.verify': ['windows', 'macos', 'linux'],
};
const THIS_OS: OsKind = isWin ? 'windows' : isMac ? 'macos' : 'linux';

const incId = (key: string) => 'INC-' + sha256(key).slice(0, 4).toUpperCase();
const evId = (key: string) => 'E-' + sha256('ev:' + key).slice(0, 4).toUpperCase();
const nowIso = () => new Date().toISOString();
const gb = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10) + ' GB';

export interface LiveDeps {
  sleep(ms: number): Promise<void>;
  projectRoots(): string[];
  appVersion: string;
}

export class LiveDataset implements Dataset {
  readonly mode = 'live' as const;
  constructor(private deps: LiveDeps) {}

  async machine(): Promise<MachineInfo> {
    const f = osFacts();
    return { hostname: f.hostname, os: THIS_OS, osLabel: `${f.label} · ${f.arch}`, arch: f.arch, appVersion: this.deps.appVersion, mode: 'live', guardsOn: true, bootId: '' };
  }

  seed() {
    return { incidents: [], evidence: [], projects: [], pillars: [], history: [{ id: 'H-0', at: nowIso(), kind: 'system' as const, title: 'Environment Doctor installed', detail: 'Live mode · read-only until you approve a fix', actor: 'engine' as const }], scanned: false };
  }

  // ───────────────────────────── scan ─────────────────────────────

  scanScript(scopes: ScanScope[]): ScanScript {
    const projects = scopes.includes('proj') ? discoverProjects(this.deps.projectRoots()) : [];
    const pcItems = [['os', 'Hardware & OS'], ['disk', 'Disk space'], ['drivers', 'Display drivers & signatures'], ['events', 'Event log · 7 days'], ['mem', 'Memory errors'], ['gpu', 'GPU & CUDA'], ['startup', 'Startup programs'], ['updates', 'Windows Update']] as const;
    const devItems = [['path', 'PATH & environment'], ['node', 'Node / npm'], ['python', 'Python / pip'], ['git', 'Git'], ['docker', 'Docker'], ['wsl', 'WSL'], ['vs', 'VS Build Tools'], ['secrets', 'Secrets (names only)']] as const;
    const items = [
      ...(scopes.includes('pc') ? pcItems.map(([id, name]) => ({ id, name, column: 'pc' as const })) : []),
      ...(scopes.includes('dev') ? devItems.map(([id, name]) => ({ id, name, column: 'dev' as const })) : []),
      ...projects.map((p) => ({ id: 'proj-' + p.id, name: p.name, column: 'proj' as const })),
    ];
    return {
      items,
      run: async (onItem, signal) => {
        items.forEach((i) => onItem(i.id, { state: 'running' }));
        const b = new Builder();
        const pcP = scopes.includes('pc') ? (isWin ? winBundle() : Promise.resolve(null)) : Promise.resolve(null);
        const diskP = !isWin && scopes.includes('pc') ? unixDisks() : Promise.resolve(null);
        const devP = scopes.includes('dev') || scopes.includes('proj') ? devTools() : Promise.resolve(null);
        const [pc, disks, dev] = await Promise.all([pcP, diskP, devP]);
        if (signal.stopped) return b.outcome();
        if (scopes.includes('pc')) this.pcRules(b, pc && pc.ok ? pc.value : null, pc && !pc.ok ? pc.note : undefined, disks && disks.ok ? disks.value : undefined, dev);
        if (scopes.includes('dev') && dev) this.devRules(b, dev, pc && pc.ok ? pc.value : null);
        if (scopes.includes('proj') && dev) this.projectRules(b, projects, dev);
        for (const it of items) {
          const r = b.itemResults[it.id];
          onItem(it.id, r ? { state: 'done', status: r.status, result: r.note } : { state: 'done', status: 'unknown', result: 'Not checked' });
        }
        return b.outcome();
      },
    };
  }

  private pcRules(b: Builder, w: WinBundle | null, err: string | undefined, unixDisk: { name: string; freeGb: number; sizeGb: number }[] | undefined, dev: DevTools | null) {
    const f = osFacts();
    b.item('os', 'ok', `${f.cpu.split(' ').slice(0, 3).join(' ')} · ${f.ramGb} GB RAM`);
    b.evidence('os', 'Hardware & OS', 'System', 'os', 'internal', [{ key: 'OS', value: f.label }, { key: 'Architecture', value: f.arch }, { key: 'CPU', value: f.cpu }, { key: 'Memory', value: f.ramGb + ' GB' }, { key: 'Uptime', value: f.uptimeH + ' h' }]);
    const unsupported = !isWin;
    const unk = (id: string, name: string, note: string) => { b.item(id, 'unknown', note); b.row('pc', { id, name, note, status: 'unknown' }); };

    // Disk
    const disks = w?.disks ?? unixDisk;
    if (disks?.length) {
      const sys = isWin ? disks.find((d) => /^C:/i.test(d.name)) ?? disks[0] : disks[0];
      const pct = sys.sizeGb ? (sys.freeGb / sys.sizeGb) * 100 : 100;
      const st: CheckStatus = pct < 5 ? 'fail' : pct < 10 ? 'warn' : 'ok';
      const eid = b.evidence('disk', 'Storage', 'Storage', 'storage', 'internal', disks.map((d) => ({ key: d.name, value: `${gb(d.freeGb)} free of ${gb(d.sizeGb)} (${Math.round((d.freeGb / Math.max(1, d.sizeGb)) * 100)}%)` })));
      b.item('disk', st, `${sys.name} ${Math.round(pct)}% free`);
      let incident: string | undefined;
      if (st !== 'ok') {
        const tmp = dirSizeOlderThan(os.tmpdir(), 7);
        const tmpEv = b.evidence('tmp', 'Old files in your temp folder', 'File system', 'fs.temp', 'internal', [{ key: 'folder', value: redact(os.tmpdir()) }, { key: 'older than 7 days', value: `${Math.round(tmp.bytes / 1024 ** 2)} MB in ${tmp.files} files` }]);
        incident = b.incident('disk.low', {
          type: 'pc', title: `Low disk space on ${sys.name}`, summary: `${sys.name} has ${Math.round(pct)}% free (${gb(sys.freeGb)}).`,
          rootCause: tmp.bytes > 300 * 1024 ** 2 ? { title: `Your temp folder holds ${Math.round(tmp.bytes / 1024 ** 2)} MB of files older than 7 days.`, detail: 'Clearing them is safe; files in use are skipped.', confidence: 'medium', evidenceIds: [tmpEv] } : undefined,
          hypotheses: [{ id: 'd1', title: 'Old temporary files', confidence: tmp.bytes > 300 * 1024 ** 2 ? 'medium' : 'low', evidenceIds: [tmpEv], detail: `${Math.round(tmp.bytes / 1024 ** 2)} MB in your temp folder is older than 7 days.` },
            { id: 'd2', title: 'Large apps, games or downloads', confidence: 'unknown', evidenceIds: [], detail: 'Not measured — Environment Doctor never scans your personal files.', test: 'Check Settings › System › Storage in Windows.' }],
          evidence: [{ id: eid, text: `${sys.name} ${Math.round(pct)}% free`, meta: 'Storage · just now', kind: 'for' }, { id: tmpEv, text: `${Math.round(tmp.bytes / 1024 ** 2)} MB old temp files`, meta: 'File system · just now', kind: 'for' }],
          rule: { key: 'disk.low', params: { tmpBytes: String(tmp.bytes), drive: sys.name } },
        });
        b.finding(`Disk ${sys.name} ${Math.round(pct)}% free`, st, incident);
      }
      b.row('pc', { id: 'disk', name: `Disk ${sys.name}`, note: `${Math.round(pct)}% free · ${gb(sys.freeGb)}`, status: st, incidentId: incident });
    } else unk('disk', 'Disk', err ?? 'Couldn’t read disks');

    if (unsupported) {
      for (const [id, name] of [['events', 'Stability'], ['drivers', 'Other drivers'], ['mem', 'Memory'], ['startup', 'Startup programs'], ['updates', 'Windows Update']] as const) unk(id, name, 'Not available on this OS yet');
    } else if (!w) {
      for (const [id, name] of [['events', 'Stability'], ['drivers', 'Drivers'], ['mem', 'Memory'], ['startup', 'Startup programs'], ['updates', 'Windows Update']] as const) unk(id, name, 'Couldn’t read: ' + (err ?? 'unknown error'));
    } else {
      // Stability — event log correlation
      const ev = w.events ?? [];
      const classify = (e: { id: number; p: string }) =>
        e.p === 'Microsoft-Windows-Kernel-Power' && e.id === 41 ? 'restart'
          : e.p === 'EventLog' && e.id === 6008 ? 'restart'
            : (e.id === 1001 && /BugCheck|WER-SystemErrorReporting/i.test(e.p)) ? 'bsod'
              : (e.p === 'Display' && e.id === 4101) || /nvlddmkm|amdkmdag|igfx/i.test(e.p) ? 'display'
                : /WHEA/i.test(e.p) ? 'hardware' : null;
      const hits = ev.map((e) => ({ ...e, kind: classify(e) })).filter((e) => e.kind);
      const counts = { restart: 0, bsod: 0, display: 0, hardware: 0 } as Record<string, number>;
      hits.forEach((h) => { counts[h.kind!]++; });
      const evEid = b.evidence('events', 'System event log · 7 days', 'Event log', 'evtlog', 'sensitive', [
        { key: 'errors & critical (7 days)', value: String(ev.length) }, { key: 'unexpected restarts', value: String(counts.restart) }, { key: 'blue screens', value: String(counts.bsod) },
        { key: 'display driver resets', value: String(counts.display) }, ...Object.entries(topProviders(ev)).map(([k, v]) => ({ key: 'top: ' + k, value: String(v) }))]);
      const total = hits.length;
      const st: CheckStatus = total >= 3 ? 'fail' : total > 0 ? 'warn' : 'ok';
      b.item('events', st, total ? `${total} crash/restart signals` : `${ev.length} errors, no crashes`);
      let incident: string | undefined;
      if (total > 0) {
        const timeline: TimelineEvent[] = hits.slice(0, 12).reverse().map((h, i) => ({
          id: 'f' + i, at: new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), label: labelFor(h.kind!) + ' ' + new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          cause: redact(`${h.p} ${h.id}: ${h.msg}`).slice(0, 200), evidenceId: evEid, severity: h.kind === 'bsod' || h.kind === 'restart' ? 'crash' : 'freeze',
        }));
        const dom = Object.entries(counts).sort((a, c) => c[1] - a[1])[0];
        const hyps: Hypothesis[] = [];
        if (counts.display) hyps.push({ id: 'h-disp', title: 'The display driver stops responding', confidence: conf(counts.display, total), evidenceIds: [evEid], detail: `${counts.display} display-driver reset(s) logged. Current driver: ${w.display?.[0] ? `${w.display[0].name} ${w.display[0].version} (${w.display[0].date})` : 'unknown'}.`, test: 'Update or roll back the display driver, then watch for 48 h.' });
        if (counts.restart) hyps.push({ id: 'h-power', title: 'Power loss or a hard hang forced a restart', confidence: conf(counts.restart, total), evidenceIds: [evEid], detail: `${counts.restart} unexpected restart(s) (Kernel-Power 41 / EventLog 6008). These are the result of a hang, not its cause.`, test: 'Note what you were doing next time; check power settings and sleep/wake.' });
        if (counts.bsod) hyps.push({ id: 'h-bsod', title: 'A blue-screen crash (bug check)', confidence: conf(counts.bsod, total), evidenceIds: [evEid], detail: `${counts.bsod} bug check(s) recorded.`, test: 'Crash dump summaries (opt-in, stays on this PC) name the failing driver.' });
        if (counts.hardware) hyps.push({ id: 'h-hw', title: 'A hardware error (WHEA)', confidence: conf(counts.hardware, total), evidenceIds: [evEid], detail: `${counts.hardware} hardware error(s) reported by Windows.`, test: 'Run Windows Memory Diagnostic.' });
        incident = b.incident('stability', {
          type: 'pc', title: `Unexpected restarts, crashes or driver resets (${total} in 7 days)`, summary: `${total} signals in the System event log in the last 7 days.`,
          rootCause: { title: hyps[0]?.title ?? 'Unclear', detail: 'Correlated from the event log. Likelihood is a label, not a calibrated percentage.', confidence: dom[1] >= 3 ? 'high' : 'medium', evidenceIds: [evEid] },
          hypotheses: hyps, timeline,
          evidence: [{ id: evEid, text: `${total} crash/restart signals in 7 days`, meta: 'Event log · just now', kind: 'for' }],
          rule: { key: 'stability', params: {} },
        });
        b.finding(`${total} crash/restart signals in 7 days`, st, incident);
      }
      b.row('pc', { id: 'stability', name: 'Stability', note: total ? `${total} crash/restart signals · 7 days` : 'No crashes in 7 days', status: st, incidentId: incident });

      // Drivers
      const disp = w.display ?? [];
      const dEid = b.evidence('drivers', 'Display drivers', 'Drivers', 'drivers', 'internal', disp.map((d) => ({ key: d.name, value: `${d.version} · ${d.date} · ${d.signed ? 'signed' : 'UNSIGNED'}${d.signer ? ' · ' + d.signer : ''}` })));
      const old = disp.find((d) => d.date && Date.now() - Date.parse(d.date) > 540 * 86400e3);
      const dst: CheckStatus = disp.some((d) => !d.signed) ? 'fail' : old ? 'warn' : disp.length ? 'ok' : 'unknown';
      b.item('drivers', dst, disp[0] ? `${disp[0].name.split(' ').slice(0, 3).join(' ')} ${disp[0].version}` : 'No display driver found');
      b.row('pc', { id: 'gpu-driver', name: 'Display driver', note: disp[0] ? `${disp[0].version} · ${disp[0].date}${old ? ' · over 18 months old' : ''}` : 'Not found', status: dst, incidentId: counts.display ? b.incidents.find((i) => i.rule?.key === 'stability')?.id : undefined });
      const unsigned = w.unsignedDrivers ?? 0;
      b.row('pc', { id: 'drivers', name: 'Other drivers', note: unsigned ? `${unsigned} unsigned` : 'All signed', status: unsigned ? 'warn' : 'ok' });
      void dEid;

      // Memory (WHEA)
      const whea = w.whea ?? 0;
      b.item('mem', whea ? 'fail' : 'ok', whea ? `${whea} hardware errors · 30 days` : 'No errors');
      b.row('pc', { id: 'mem', name: 'Memory & hardware', note: whea ? `${whea} hardware errors in 30 days` : 'No errors in 30 days', status: whea ? 'fail' : 'ok' });

      // Startup / updates
      const su = w.startup ?? 0;
      b.item('startup', su > 25 ? 'warn' : 'ok', `${su} items`);
      b.row('pc', { id: 'startup', name: 'Startup programs', note: `${su} items`, status: su > 25 ? 'warn' : 'ok' });
      const hf = w.hotfix ? Math.round((Date.now() - Date.parse(w.hotfix)) / 86400e3) : undefined;
      const ust: CheckStatus = hf === undefined ? 'unknown' : hf > 60 ? 'warn' : 'ok';
      b.item('updates', ust, hf === undefined ? 'No update history' : `Last update ${hf} days ago`);
      b.row('pc', { id: 'wu', name: 'Windows Update', note: hf === undefined ? 'Couldn’t read update history' : hf > 60 ? `Last update ${hf} days ago` : 'Up to date', status: ust });
    }

    // GPU
    if (dev) {
      const n = dev.nvidia;
      b.item('gpu', n.found ? 'ok' : 'unknown', n.found ? `${n.gpu} · CUDA ≤ ${n.maxCuda ?? '?'}` : n.note ?? 'No NVIDIA GPU');
      if (n.found) b.evidence('gpu', 'nvidia-smi', 'GPU', 'gpu', 'internal', [{ key: 'GPU', value: n.gpu ?? '' }, { key: 'driver', value: n.driver ?? '' }, { key: 'max CUDA', value: n.maxCuda ?? 'unknown' }]);
    } else b.item('gpu', 'unknown', 'Not checked');
  }

  private devRules(b: Builder, t: DevTools, w: WinBundle | null) {
    // PATH
    const userRaw = isWin ? w?.pathUser ?? '' : '';
    const machineRaw = isWin ? w?.pathMachine ?? '' : '';
    const entries: { dir: string; scope: PathEntry['scope'] }[] = isWin && (userRaw || machineRaw)
      ? [...splitPath(machineRaw).map((dir) => ({ dir, scope: 'machine' as const })), ...splitPath(userRaw).map((dir) => ({ dir, scope: 'user' as const }))]
      : splitPath(process.env.PATH ?? '').map((dir) => ({ dir, scope: 'process' as const }));
    const pa = analysePath(entries);
    const missingUser = pa.filter((e) => !e.exists && e.scope === 'user');
    const missingOther = pa.filter((e) => !e.exists && e.scope !== 'user');
    const dupUser = pa.filter((e) => e.dup && e.scope === 'user');
    const pEid = b.evidence('path', 'PATH entries', isWin ? 'Registry' : 'Environment', 'env', 'sensitive', [
      { key: 'entries', value: String(pa.length) }, { key: 'missing folders (your account)', value: missingUser.map((e) => redact(e.dir)).join(' ; ') || 'none' },
      { key: 'missing folders (system)', value: missingOther.map((e) => redact(e.dir)).join(' ; ') || 'none' }, { key: 'duplicates (your account)', value: dupUser.map((e) => redact(e.dir)).join(' ; ') || 'none' },
      { key: 'length', value: String((userRaw + ';' + machineRaw).length) + ' characters' }]);
    const testEid = 'T-' + sha256('path-test').slice(0, 3).toUpperCase();
    b.addEvidence({ id: testEid, title: 'Direct test: PATH folders exist', source: 'Test', collector: 'test.fs_exists@1.0', collectorVersion: '1.0', capturedAt: nowIso(), hash: sha256(pa.map((e) => e.dir + e.exists).join('|')), size: 200, sensitivity: 'internal', retention: '1y', incidentIds: [], fields: pa.filter((e) => !e.exists).slice(0, 12).map((e) => ({ key: redact(e.dir), value: 'exists: false' })) });
    let pathSt: CheckStatus = 'ok';
    let pathNote = `${pa.length} entries · all folders exist`;
    let pathInc: string | undefined;
    if (missingUser.length) {
      pathSt = 'warn'; pathNote = `${missingUser.length} dead entr${missingUser.length === 1 ? 'y' : 'ies'} in your PATH`;
      pathInc = b.incident('path.missing', {
        type: 'dev', title: `Your PATH has ${missingUser.length} folder${missingUser.length === 1 ? '' : 's'} that don’t exist`, summary: 'Windows checks these folders every time you run a command. Dead entries slow lookups and can hide the tool you meant to run.',
        rootCause: { title: `${missingUser.length} entr${missingUser.length === 1 ? 'y points' : 'ies point'} to folders that are gone: ${missingUser.slice(0, 3).map((e) => redact(e.dir)).join(', ')}${missingUser.length > 3 ? '…' : ''}`, detail: 'Proven by a direct test on each folder. Usually left behind by an uninstaller.', confidence: 'confirmed', evidenceIds: [testEid, pEid] },
        hypotheses: [
          { id: 'p1', title: 'An uninstaller left entries behind', confidence: 'high', evidenceIds: [pEid], detail: 'The folders don’t exist, but their PATH entries remain.' },
          ...(missingOther.length ? [{ id: 'p2', title: `System PATH has ${missingOther.length} dead entr${missingOther.length === 1 ? 'y' : 'ies'} too`, confidence: 'confirmed' as Confidence, evidenceIds: [pEid], detail: 'Fixing the system PATH needs admin rights, which this build doesn’t use. It doesn’t block this fix.', test: 'Edit the system PATH in Windows settings as an administrator.' }] : []),
        ],
        evidence: [{ id: testEid, text: `${missingUser.length} folder(s) don’t exist`, meta: 'Direct test · just now', kind: 'for' }, { id: pEid, text: 'User PATH read from the registry', meta: 'Environment · secret values never read', kind: 'for' }],
        rule: { key: 'path.missing', params: { dirs: JSON.stringify(missingUser.map((e) => e.dir)) } },
      });
      b.finding(`${missingUser.length} dead PATH entr${missingUser.length === 1 ? 'y' : 'ies'}`, 'warn', pathInc);
    } else if (missingOther.length) {
      pathSt = 'warn'; pathNote = `${missingOther.length} dead entr${missingOther.length === 1 ? 'y' : 'ies'} in the system PATH (admin)`;
    }
    if (dupUser.length) {
      const dupInc = b.incident('path.dup', {
        type: 'dev', title: `Your PATH lists ${dupUser.length} folder${dupUser.length === 1 ? '' : 's'} twice`, summary: 'Duplicates are harmless but make PATH longer and harder to read.',
        rootCause: { title: `Repeated entries: ${dupUser.slice(0, 3).map((e) => redact(e.dir)).join(', ')}`, detail: 'Found by comparing each entry after expanding variables.', confidence: 'confirmed', evidenceIds: [pEid] },
        hypotheses: [], evidence: [{ id: pEid, text: `${dupUser.length} duplicate entr${dupUser.length === 1 ? 'y' : 'ies'}`, meta: 'Environment · just now', kind: 'for' }],
        rule: { key: 'path.dup', params: {} },
      });
      if (pathSt === 'ok') { pathSt = 'warn'; pathNote = `${dupUser.length} duplicate entr${dupUser.length === 1 ? 'y' : 'ies'}`; pathInc = dupInc; }
    }
    b.item('path', pathSt, pathNote);
    b.row('dev', { id: 'path', name: 'PATH', note: pathNote, status: pathSt, incidentId: pathInc });

    // Node — including the nvm link case from the design
    const nvmLink = process.env.NVM_SYMLINK;
    const linkMissing = !!nvmLink && !fs.existsSync(nvmLink);
    let nodeSt: CheckStatus = t.node.found ? 'ok' : t.nvm.found ? 'fail' : 'unknown';
    let nodeNote = t.node.found ? `Node ${t.node.version} · npm ${t.npm.version ?? '—'}` : t.nvm.found ? 'nvm installed, but node isn’t reachable' : 'Not installed';
    let nodeInc: string | undefined;
    if (!t.node.found && (linkMissing || t.nvm.found)) {
      const lEid = b.evidence('nvm-link', 'nvm link folder', 'File system', 'fs', 'internal', [{ key: 'NVM_SYMLINK', value: nvmLink ? redact(nvmLink) : 'not set' }, { key: 'exists', value: String(!linkMissing) }, { key: 'nvm', value: t.nvm.version ?? 'found' }]);
      nodeInc = b.incident('node.unreachable', {
        type: 'dev', title: '“node” is not recognized', summary: 'nvm is installed, but no Node.js is reachable on PATH.',
        rootCause: linkMissing ? { title: `The Node link ${redact(nvmLink!)} is missing, so Windows can’t find node.`, detail: 'Proven by a direct test.', confidence: 'confirmed', evidenceIds: [lEid] } : undefined,
        hypotheses: [{ id: 'n1', title: 'An nvm update didn’t recreate the link', confidence: linkMissing ? 'high' : 'medium', evidenceIds: [lEid], detail: 'Recreating the link needs admin rights (a symbolic link), which this build doesn’t use.', test: 'Open an admin terminal and run: nvm use <your version>' }],
        evidence: [{ id: lEid, text: `Link folder exists? ${linkMissing ? 'No' : 'Yes'}`, meta: 'Direct test · just now', kind: 'for' }],
        rule: { key: 'node.unreachable', params: {} },
      });
      b.finding('Node not reachable', 'fail', nodeInc);
    }
    if (t.node.code) { nodeSt = 'unknown'; nodeNote = t.node.note ?? 'Couldn’t check'; }
    b.item('node', nodeSt, nodeNote);
    b.row('dev', { id: 'node', name: 'Node / npm', note: nodeNote, status: nodeSt, incidentId: nodeInc });
    b.evidence('tools', 'Developer tools', 'Programs', 'tools', 'internal', Object.entries(t).map(([k, v]) => ({ key: k, value: v.found ? `${v.version ?? 'found'}${v.path ? ' · ' + v.path : ''}` : v.note ?? 'not found' })));

    const simple = (id: string, name: string, tl: { found: boolean; version?: string; note?: string; code?: string }, missing: CheckStatus = 'unknown') => {
      const st: CheckStatus = tl.code ? 'unknown' : tl.found ? 'ok' : missing;
      const note = tl.found ? (tl.version ?? 'found') : tl.note ?? 'Not installed';
      b.item(id, st, note);
      return { st, note };
    };
    const py = simple('python', 'Python', t.python);
    b.row('dev', { id: 'python', name: 'Python', note: t.python.found ? `${t.python.version}${t.pip.found ? ' · pip ' + t.pip.version : ''}` : py.note, status: py.st });
    const g = simple('git', 'Git', t.git);
    const wsl = isWin ? simple('wsl', 'WSL', t.wsl) : (b.item('wsl', 'unknown', 'Windows only'), { st: 'ok' as CheckStatus, note: '' });
    b.row('dev', { id: 'gitwsl', name: isWin ? 'Git · WSL' : 'Git', note: `${t.git.found ? 'Git ' + t.git.version : 'Git not installed'}${isWin ? ' · ' + (t.wsl.found ? t.wsl.note ?? 'WSL ready' : 'WSL ' + (t.wsl.note ?? 'off')) : ''}`, status: g.st === 'ok' && (wsl.st === 'ok' || wsl.st === 'unknown') ? 'ok' : g.st });
    const dockerSt: CheckStatus = !t.docker.found ? 'ok' : t.dockerEngine.found ? 'ok' : 'unknown';
    const dockerNote = !t.docker.found ? 'Not installed' : t.dockerEngine.found ? `Engine ${t.dockerEngine.version}` : 'Engine off — checks couldn’t run';
    b.item('docker', dockerSt, dockerNote);
    b.row('dev', { id: 'docker', name: 'Docker', note: dockerNote, status: dockerSt });
    const vsNeeded = false;
    b.item('vs', t.vsBuild.found ? 'ok' : vsNeeded ? 'warn' : 'ok', t.vsBuild.found ? `MSVC ${t.vsBuild.version}` : t.vsBuild.note ?? 'Not installed');
    if (isWin) b.row('dev', { id: 'msvc', name: 'VS Build Tools', note: t.vsBuild.found ? `MSVC ${t.vsBuild.version}` : 'Not installed · only needed for native modules', status: 'ok' });
    if (t.nvidia.found) b.row('dev', { id: 'cuda', name: 'CUDA support', note: `Driver supports CUDA ≤ ${t.nvidia.maxCuda ?? '?'}`, status: 'ok' });

    // Secrets — names only
    const names = secretEnvNames();
    b.item('secrets', 'ok', names.length ? `${names.length} secret-looking variables · never read` : 'None found');
    b.addEvidence({ id: evId('secrets'), title: 'Secret-looking environment variables', source: 'Environment', collector: 'secrets.presence@1.0', collectorVersion: '1.0', capturedAt: nowIso(), hash: 'presence-only', size: 0, sensitivity: 'secret', retention: '90d', incidentIds: [], fields: names.length ? names.map((n) => ({ key: n, value: 'present, never read', secret: true })) : [{ key: 'result', value: 'none found' }] });
    for (const f of ['.npmrc', '.ssh', '.aws', '.env']) {
      const p = path.join(os.homedir(), f);
      if (fs.existsSync(p)) b.addEvidence({ id: evId('presence' + f), title: `${f} (presence only)`, source: 'File system', collector: 'secrets.presence@1.0', collectorVersion: '1.0', capturedAt: nowIso(), hash: 'presence-only', size: 0, sensitivity: 'secret', retention: '90d', incidentIds: [], fields: [{ key: 'path', value: redact(p) }, { key: 'present', value: 'yes' }, { key: 'contents', value: 'present, never read', secret: true }] });
    }
  }

  private projectRules(b: Builder, projects: ProjectFacts[], t: DevTools) {
    for (const p of projects) {
      const reqs: Project['requirements'] = [];
      const add = (id: string, name: string, needs: string, have: string, status: CheckStatus, source: string, incidentId?: string) => reqs.push({ id, name, needs, have, status, source, incidentId });
      let incident: string | undefined;
      if (p.node) {
        const want = p.node.engines ?? p.node.nvmrc;
        const ok = t.node.found ? satisfies(t.node.version, want) : false;
        const nodeInc = !t.node.found ? b.incidents.find((i) => i.rule?.key === 'node.unreachable')?.id : undefined;
        add('node', 'Node.js', want ?? 'any', t.node.found ? t.node.version ?? 'found' : 'not on PATH', !t.node.found ? 'fail' : ok === false ? 'warn' : 'ok', p.node.engines ? 'package.json engines' : p.node.nvmrc ? '.nvmrc' : 'package.json', nodeInc);
        if (ok === false && t.node.found) {
          incident = b.incident('node.version:' + p.path, {
            type: 'dev', projectId: p.id, title: `${p.name} wants Node ${want}, this PC has ${t.node.version}`, summary: 'The installed Node.js doesn’t match what the project declares.',
            rootCause: { title: `Node ${t.node.version} doesn’t satisfy “${want}”.`, detail: 'Deterministic version comparison.', confidence: 'confirmed', evidenceIds: [evId('tools')] },
            hypotheses: [{ id: 'v1', title: 'A different Node version is active', confidence: 'confirmed', evidenceIds: [evId('tools')], detail: 'Switch versions with your version manager (nvm, fnm, volta).', test: t.nvm.found ? `nvm install ${want?.replace(/[^\d.]/g, '')} && nvm use ${want?.replace(/[^\d.]/g, '')}` : 'Install the required Node version.' }],
            evidence: [{ id: evId('tools'), text: `node -v → ${t.node.version}`, meta: 'Programs · just now', kind: 'for' }], rule: { key: 'node.version', params: { path: p.path } },
          });
        }
        const pm = p.node.lock ?? (p.node.packageManager?.split('@')[0] as 'pnpm' | 'yarn' | 'npm' | undefined);
        if (pm && pm !== 'npm') add(pm, pm, 'installed', t[pm].found ? t[pm].version ?? 'found' : 'missing', t[pm].found ? 'ok' : 'fail', pm === 'pnpm' ? 'pnpm-lock.yaml' : 'yarn.lock');
        else add('npm', 'npm', 'installed', t.npm.found ? t.npm.version ?? 'found' : 'missing', t.npm.found ? 'ok' : t.node.found ? 'fail' : 'unknown', 'package.json');
      }
      if (p.python) {
        const want = p.python.requires ?? p.python.pyversion;
        const ok = t.python.found ? satisfies(t.python.version, want) : false;
        add('python', 'Python', want ?? 'any', t.python.found ? t.python.version ?? 'found' : 'not installed', !t.python.found ? 'fail' : ok === false ? 'warn' : 'ok', p.python.requires ? 'pyproject.toml' : p.python.pyversion ? '.python-version' : 'requirements.txt');
        if (!p.python.venv && t.python.found && !p.symlink) {
          const vInc = b.incident('venv.missing:' + p.path, {
            type: 'dev', projectId: p.id, title: `${p.name} has no virtual environment`, summary: 'Installing packages without a .venv puts them into your global Python, where projects conflict.',
            rootCause: { title: 'No .venv folder in the project.', detail: 'Direct check of the project folder.', confidence: 'confirmed', evidenceIds: [evId('proj:' + p.path)] },
            hypotheses: [], evidence: [{ id: evId('proj:' + p.path), text: 'No .venv or venv folder', meta: 'Project · just now', kind: 'for' }],
            rule: { key: 'venv.missing', params: { path: p.path, name: p.name } },
          });
          incident = incident ?? vInc;
          add('venv', 'Virtual env', '.venv', 'missing', 'warn', 'folder', vInc);
        } else if (p.python.venv) add('venv', 'Virtual env', '.venv', 'found', 'ok', 'folder');
      }
      if (p.docker) {
        const st: CheckStatus = !t.docker.found ? 'fail' : t.dockerEngine.found ? 'ok' : 'unknown';
        add('docker', 'Docker engine', 'running', !t.docker.found ? 'not installed' : t.dockerEngine.found ? 'running' : 'off', st, p.docker.compose ? 'compose file' : 'Dockerfile');
        if (st === 'unknown') {
          const dInc = b.incident('docker.off:' + p.path, {
            type: 'dev', projectId: p.id, title: `${p.name} needs Docker running`, summary: 'Docker engine is off, so container checks couldn’t run. That’s unknown, not broken.',
            hypotheses: [{ id: 'k1', title: 'Docker Desktop isn’t running', confidence: 'unknown', evidenceIds: [evId('tools')], detail: 'The engine doesn’t answer.', test: 'Start Docker Desktop, then Check again.' }],
            evidence: [{ id: evId('tools'), text: 'docker info → no answer', meta: 'Programs · just now', kind: 'neutral' }], rule: { key: 'docker.off', params: {} },
          });
          incident = incident ?? dInc;
        }
      }
      if (p.git) add('git', 'Git', 'any', t.git.found ? t.git.version ?? 'found' : 'missing', t.git.found ? 'ok' : 'fail', '.git');
      b.addEvidence({ id: evId('proj:' + p.path), title: `Project files · ${p.name}`, source: 'Project', collector: 'project@1.0', collectorVersion: '1.0', capturedAt: nowIso(), hash: sha256(JSON.stringify(p)), size: 400, sensitivity: 'internal', retention: '90d', incidentIds: [], fields: [{ key: 'path', value: p.displayPath }, { key: 'node', value: p.node ? JSON.stringify({ engines: p.node.engines, nvmrc: p.node.nvmrc, lock: p.node.lock }) : '—' }, { key: 'python', value: p.python ? JSON.stringify(p.python) : '—' }, { key: 'docker', value: p.docker ? JSON.stringify(p.docker) : '—' }] });
      const status: CheckStatus = reqs.some((r) => r.status === 'fail') ? 'fail' : reqs.some((r) => r.status === 'unknown') ? 'unknown' : reqs.some((r) => r.status === 'warn') ? 'warn' : 'ok';
      const bad = reqs.filter((r) => r.status !== 'ok');
      const summary = !reqs.length ? 'No requirements declared.' : status === 'ok' ? 'Everything this project needs is here and working.' : bad.map((r) => `${r.name}: ${r.have}`).join(' · ');
      b.projects.push({ id: p.id, name: p.name, path: p.displayPath, stack: [p.node && 'Node', p.python && 'Python', p.docker && 'Docker'].filter(Boolean).join(' · ') || 'Project', status, summary, requirements: reqs, lastChecked: nowIso() });
      b.item('proj-' + p.id, status, status === 'ok' ? 'Ready' : bad[0] ? `${bad[0].name}: ${bad[0].have}` : 'Check');
      b.row('proj', { id: 'p-' + p.id, name: p.name, note: status === 'ok' ? 'Ready' : bad[0] ? `${bad[0].name}: ${bad[0].have}` : '', status, projectId: p.id, incidentId: incident });
    }
    if (!projects.length) b.row('proj', { id: 'p-none', name: 'No projects found', note: 'Add a folder in Settings › Diagnostics', status: 'unknown' });
  }

  // ───────────────────────────── diagnosis ─────────────────────────────

  diagnosisSources(): DiagnosisSource[] {
    return [
      { key: 'events', name: 'Event Viewer', note: 'Errors and warnings, 7 days', sensitive: false, defaultOn: isWin },
      { key: 'drivers', name: 'Drivers & devices', note: 'Versions, dates, signatures', sensitive: false, defaultOn: isWin },
      { key: 'disk', name: 'Disk space', note: 'Free space per drive', sensitive: false, defaultOn: true },
      { key: 'dev', name: 'Dev tools & PATH', note: 'Runtimes, package managers, PATH', sensitive: false, defaultOn: true },
      { key: 'gpu', name: 'GPU & CUDA', note: 'Driver and CUDA support', sensitive: false, defaultOn: true },
      { key: 'dumps', name: 'Crash dump summaries', note: 'Sensitive · stays on this PC · not in this build', sensitive: true, defaultOn: false },
      { key: 'net', name: 'Network', note: 'Passive checks only · not in this build', sensitive: false, defaultOn: false },
    ];
  }

  async diagnose(r: DiagnoseRequest, ctx: { incidents: Incident[] }) {
    const low = r.symptom.toLowerCase();
    const open = ctx.incidents.filter((i) => !['verified', 'closed'].includes(i.status));
    const match = (re: RegExp, keys: string[]) => re.test(low) ? open.find((i) => keys.some((k) => i.rule?.key.startsWith(k))) : undefined;
    const found = match(/freez|hang|crash|restart|blue|bsod|black screen|sleep|wake/, ['stability']) ?? match(/node|npm|not recognized/, ['node.']) ?? match(/path/, ['path.']) ?? match(/disk|space|storage/, ['disk.']) ?? match(/docker|compose/, ['docker.']) ?? match(/python|pip|venv/, ['venv.']);
    if (found) return { incident: { ...found, symptom: r.symptom, source: 'describe' as const }, evidence: [] };
    const now = nowIso();
    const pc = /freez|hang|crash|restart|blue|bsod|slow|sleep|wake|driver/.test(low);
    return {
      incident: {
        id: incId('describe:' + r.symptom + now), type: (pc ? 'pc' : 'dev') as Incident['type'], title: r.symptom.slice(0, 80), status: 'open' as const, createdAt: now, updatedAt: now, source: 'describe' as const, symptom: r.symptom,
        summary: 'No deterministic rule matched what the last scan found. Unknown is a valid answer — these are the cheapest next tests.', evidenceSnapshot: 'ES-' + sha256(r.symptom + now).slice(0, 4),
        hypotheses: pc
          ? [{ id: 'u1', title: 'A recent driver or Windows update', confidence: 'unknown' as Confidence, evidenceIds: [], detail: 'Run a full scan so the event log and drivers are included.', test: 'Run a full scan, then describe the problem again.' },
            { id: 'u2', title: 'Something that runs at start-up', confidence: 'unknown' as Confidence, evidenceIds: [], detail: 'Compare with a clean boot.', test: 'Try a clean boot (msconfig › Hide Microsoft services › Disable all).' }]
          : [{ id: 'u1', title: 'A tool resolves to a different version than expected', confidence: 'unknown' as Confidence, evidenceIds: [], detail: 'Check which executable runs first on PATH.', test: 'Run “where <tool>” in a terminal and compare with the project’s requirements.' }],
        evidence: [], timeline: [], aiNote: { code: 'E_AI_UNAVAILABLE' as const, text: 'Explanations paused — no AI is configured. Rules-only result.' },
      },
      evidence: [],
    };
  }

  // ───────────────────────────── plans ─────────────────────────────

  planFor(inc: Incident, opts: { next?: boolean; variant?: string }): PlanDraft | null {
    const act = (id: string) => DEMO_ACTIONS.find((a) => a.id === id)!;
    const step = (n: number, id: string, title: string, target: string, extra: Partial<PlanStep> = {}): PlanStep => {
      const a = act(id);
      return { id: 'S' + n, actionId: id, actionVersion: a.version, title, targetSummary: target, risk: a.risk, privilege: a.privilege, reboot: a.reboot, undo: a.undo, preconditions: a.preconditions, ...extra };
    };
    const v = (id: string, tier: VerificationCheck['tier'], label: string): VerificationCheck => ({ id, tier, label });
    const key = inc.rule?.key;
    if (opts.next) return null;
    if (key === 'path.missing') {
      const dirs = JSON.parse(inc.rule!.params.dirs ?? '[]') as string[];
      return {
        title: 'Clean up your PATH', kind: 'fix', estimatedMinutes: 1,
        steps: [step(1, 'env.path.user.remove_entry', `Remove ${dirs.length} dead PATH entr${dirs.length === 1 ? 'y' : 'ies'}`, 'User PATH − ' + dirs.map((d) => redact(d)).join(' ; '), { preconditions: ['Each folder still doesn’t exist', 'Current PATH saved for undo', 'Only your account’s PATH is changed'] })],
        verification: [v('v1', 'V1', 'Removed entries are gone, everything else is identical and in order'), v('v2', 'V2', 'node, git and python still resolve to the same programs')],
      };
    }
    if (key === 'path.dup') return {
      title: 'Remove duplicate PATH entries', kind: 'fix', estimatedMinutes: 1,
      steps: [step(1, 'env.path.user.dedupe', 'Remove repeated PATH entries', 'User PATH · keep the first copy of each folder')],
      verification: [v('v1', 'V1', 'Every folder is still listed exactly once, first copies in the same order'), v('v2', 'V2', 'node, git and python still resolve to the same programs')],
    };
    if (key === 'disk.low' && Number(inc.rule!.params.tmpBytes ?? 0) > 50 * 1024 ** 2) return {
      title: 'Free space by clearing old temp files', kind: 'fix', estimatedMinutes: 2,
      steps: [step(1, 'storage.temp.clean', 'Clear temp files older than 7 days', `${redact(os.tmpdir())} · ~${Math.round(Number(inc.rule!.params.tmpBytes) / 1024 ** 2)} MB · files in use are skipped`)],
      verification: [v('v1', 'V1', 'Old temp files were removed'), v('v2', 'V1', 'Free space on the drive did not go down')],
    };
    if (key === 'venv.missing') return {
      title: `Create a virtual environment for ${inc.rule!.params.name}`, kind: 'fix', estimatedMinutes: 1, isolationNote: 'Project-only change — your global Python is untouched.',
      steps: [step(1, 'python.venv.create', 'Create .venv in the project', `${redact(inc.rule!.params.path)}${path.sep}.venv · python -m venv`)],
      verification: [v('v1', 'V1', '.venv exists inside the project'), v('v2', 'V2', 'The .venv Python runs')],
    };
    return null;
  }

  catalog(): ActionEntry[] {
    return DEMO_ACTIONS.map((a) => {
      const oses = LIVE_ACTIONS[a.id];
      return { ...a, os: oses ?? ['windows'], availableInThisBuild: !!oses && oses.includes(THIS_OS) };
    });
  }

  blueprints(): Blueprint[] {
    return [
      { id: 'project', name: 'From my projects', description: 'Read package.json, pyproject.toml and compose files found on this PC' },
      { id: 'web', name: 'Web dev', description: 'Node, package manager, Git' },
      { id: 'data', name: 'Data science', description: 'Python, venv, Jupyter' },
      { id: 'ai', name: 'AI / ML', description: 'Python, GPU driver, PyTorch' },
    ];
  }

  async setupDryRun(blueprintId: string, os_: OsKind) {
    const t = await devTools();
    const rows: SetupRow[] = [];
    const pm = os_ === 'windows' ? 'winget' : os_ === 'macos' ? 'Homebrew' : 'apt';
    const helperNote = 'Package installs need the signed admin helper — not in this build. Install it yourself, then check again.';
    const tool = (id: string, name: string, tl: { found: boolean; version?: string }, pkg: string, publisher: string, note = '', group = 'Tools') =>
      rows.push(tl.found
        ? { id, name, kind: 'keep', current: tl.version, target: tl.version, source: 'already installed', publisher: '—', signature: 'verified', admin: false, restart: false, note, group }
        : { id, name, kind: 'install', target: 'latest', source: `${pm} · ${pkg}`, publisher, signature: 'verified', admin: true, restart: false, note: note ? note + ' · ' + helperNote : helperNote, group });
    let draft: PlanDraft | undefined;
    if (blueprintId === 'project') {
      const projects = discoverProjects(this.deps.projectRoots());
      for (const p of projects.slice(0, 4)) {
        if (p.node) tool('node-' + p.id, `Node.js (${p.name})`, t.node, 'OpenJS.NodeJS.LTS', 'OpenJS Foundation', p.node.engines ? 'engines: ' + p.node.engines : '', p.name);
        if (p.python) {
          tool('py-' + p.id, `Python (${p.name})`, t.python, 'Python.Python.3.12', 'Python Software Foundation', p.python.requires ?? '', p.name);
          rows.push(p.python.venv
            ? { id: 'venv-' + p.id, name: 'Project virtual env', kind: 'keep', current: '.venv', target: '.venv', source: 'found', publisher: '—', signature: 'verified', admin: false, restart: false, group: p.name }
            : { id: 'venv-' + p.id, name: 'Project virtual env', kind: t.python.found ? 'install' : 'blocked', target: '.venv', source: 'python -m venv', publisher: 'Python', signature: 'verified', admin: false, restart: false, note: t.python.found ? 'Into the project only' : 'Needs Python first', group: p.name });
        }
        if (p.docker) tool('docker-' + p.id, `Docker (${p.name})`, t.docker, 'Docker.DockerDesktop', 'Docker Inc.', '', p.name);
      }
      const venvSteps = projects.filter((p) => p.python && !p.python.venv && t.python.found && !p.symlink).slice(0, 4);
      if (venvSteps.length) {
        const a = DEMO_ACTIONS.find((x) => x.id === 'python.venv.create')!;
        draft = {
          title: 'Set up · my projects', kind: 'setup', estimatedMinutes: venvSteps.length * 2,
          steps: venvSteps.map((p, i) => ({ id: 'S' + (i + 1), actionId: a.id, actionVersion: a.version, title: `Create .venv for ${p.name}`, targetSummary: `${p.displayPath}${path.sep}.venv`, risk: a.risk, privilege: a.privilege, reboot: false, undo: a.undo, preconditions: a.preconditions, params: undefined } as PlanStep)),
          verification: [{ id: 'v1', tier: 'V1', label: 'Each .venv exists' }, { id: 'v2', tier: 'V2', label: 'Each .venv Python runs' }],
          isolationNote: 'Project-local environments first — nothing global is installed.',
        };
        (draft as PlanDraft & { paths?: string[] }).paths = venvSteps.map((p) => p.path);
        this.setupPaths = venvSteps.map((p) => p.path);
      }
      if (!projects.length) rows.push({ id: 'none', name: 'No projects found', kind: 'skip', source: '—', publisher: '—', signature: 'unknown', admin: false, restart: false, note: 'Add a project folder in Settings › Diagnostics', group: 'Projects' });
    } else if (blueprintId === 'web') {
      tool('node', 'Node.js LTS', t.node, 'OpenJS.NodeJS.LTS', 'OpenJS Foundation');
      tool('pnpm', 'pnpm', t.pnpm, 'pnpm.pnpm', 'pnpm');
      tool('git', 'Git', t.git, 'Git.Git', 'The Git Development Community');
    } else if (blueprintId === 'data') {
      tool('py', 'Python 3.12', t.python, 'Python.Python.3.12', 'Python Software Foundation');
      rows.push({ id: 'jup', name: 'JupyterLab', kind: 'install', target: '4.x', source: 'PyPI', publisher: 'Project Jupyter', signature: 'verified', admin: false, restart: false, note: 'Into a project .venv only — pick a project first', group: 'Project' });
    } else {
      if (os_ === 'macos') rows.push({ id: 'gpu', name: 'GPU acceleration', kind: 'keep', current: 'Apple MPS', target: 'Apple MPS', source: 'built into macOS', publisher: 'Apple', signature: 'verified', admin: false, restart: false, note: 'CUDA isn’t available on Mac — MPS is used instead', group: 'GPU' });
      else rows.push(t.nvidia.found
        ? { id: 'drv', name: 'NVIDIA GPU driver', kind: 'keep', current: t.nvidia.driver, target: t.nvidia.driver, source: 'already installed', publisher: 'NVIDIA', signature: 'verified', admin: false, restart: false, note: `Supports CUDA ≤ ${t.nvidia.maxCuda ?? '?'}`, group: 'GPU' }
        : { id: 'drv', name: 'NVIDIA GPU driver', kind: 'skip', source: '—', publisher: '—', signature: 'unknown', admin: false, restart: false, note: 'No NVIDIA GPU found — PyTorch will use the CPU build', group: 'GPU' });
      tool('py', 'Python 3.12', t.python, 'Python.Python.3.12', 'Python Software Foundation');
      rows.push({ id: 'torch', name: os_ === 'macos' ? 'PyTorch' : t.nvidia.found ? 'PyTorch (CUDA build)' : 'PyTorch (CPU build)', kind: 'install', target: '2.x', source: os_ !== 'macos' && t.nvidia.found ? 'pytorch.org index' : 'PyPI', publisher: 'PyTorch Foundation', signature: 'verified', admin: false, restart: false, newSource: os_ !== 'macos' && t.nvidia.found, note: 'Into a project .venv only', group: 'Project' });
      if (os_ !== 'macos') rows.push({ id: 'cuda', name: 'CUDA Toolkit', kind: 'skip', source: '—', publisher: '—', signature: 'unknown', admin: false, restart: false, note: 'Not needed — PyTorch brings its own CUDA', group: 'GPU' });
    }
    const totals = { install: 0, update: 0, keep: 0, skip: 0, blocked: 0 };
    rows.forEach((r) => { totals[r.kind]++; });
    return {
      blueprintId, os: os_, rows, totals, downloadMb: 0, needsAdmin: rows.some((r) => r.admin && r.kind === 'install'), needsRestart: false,
      newSources: rows.filter((r) => r.newSource).map((r) => r.source), isolationNote: 'Project-local environments are preferred over installing globally.', draft,
    };
  }

  private setupPaths: string[] = [];

  redaction(inc: Incident, ev: EvidenceItem[]): RedactionPreview {
    const ids = new Set([...inc.evidence.map((e) => e.id), ...(inc.rootCause?.evidenceIds ?? [])]);
    const pairs = ev.filter((e) => ids.has(e.id)).flatMap((e) => e.fields.slice(0, 2).map((f, i) => ({
      id: e.id + (i ? '.' + i : ''), label: e.title + ' · ' + f.key, rawA: f.key + ': ', rawSecret: f.secret ? '[present, never read]' : f.value, rawB: '',
      safe: f.secret ? '[secret removed]' : f.value.replace(/%USERPROFILE%[^ ;]*/g, '<path>').replace(/[A-Z]:\\[^ ;]*/gi, '<path>'), kb: Math.max(0.1, Math.round(f.value.length / 102.4) / 10),
    })));
    return { incidentId: inc.id, pairs: pairs.slice(0, 10), neverSent: ['Full crash dumps', '.env files', 'Keys and passwords', 'Your files'] };
  }

  // ───────────────────────────── actions ─────────────────────────────

  private async readUserPath(): Promise<{ value: string; kind: string }> {
    const r = await powershell(`$k = Get-Item 'HKCU:\\Environment'; $v = [string]$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $t = 'ExpandString'; try { $t = [string]$k.GetValueKind('Path') } catch {}; @{ v = $v; t = $t } | ConvertTo-Json -Compress`, 20000);
    if (!r.ok) throw new Error('Couldn’t read your PATH: ' + r.stderr.slice(0, 200));
    const j = JSON.parse(r.stdout.trim()) as { v: string; t: string };
    return { value: j.v ?? '', kind: j.t === 'String' ? 'String' : 'ExpandString' };
  }

  private async writeUserPath(value: string, kind: string) {
    const r = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true); $k.SetValue('Path', $env:ED_NEWPATH, [Enum]::Parse([Microsoft.Win32.RegistryValueKind], $env:ED_KIND)); $k.Close(); [Environment]::SetEnvironmentVariable('EnvironmentDoctorRefresh', '1', 'User'); [Environment]::SetEnvironmentVariable('EnvironmentDoctorRefresh', $null, 'User')"],
    { timeoutMs: 30000, env: { ...process.env, ED_NEWPATH: value, ED_KIND: kind === 'String' ? 'String' : 'ExpandString' } });
    if (!r.ok) throw new Error('Windows refused the PATH change: ' + r.stderr.slice(0, 200));
  }

  private resolveTools(pathValue: string): Record<string, string> {
    const dirs = splitPath(isWin ? pathValue.replace(/%([^%]+)%/g, (m, n: string) => process.env[n] ?? m) : pathValue);
    const out: Record<string, string> = {};
    for (const tool of ['node', 'git', 'python', 'npm']) {
      const exts = isWin ? ['.exe', '.cmd', '.bat'] : [''];
      out[tool] = 'not found';
      outer: for (const d of dirs) for (const e of exts) { if (fs.existsSync(path.join(d, tool + e))) { out[tool] = path.join(d, tool + e); break outer; } }
    }
    return out;
  }

  private stepPaths(ctx: StepContext, step: PlanStep): string | undefined {
    const m = step.targetSummary.match(/^(.*)[\\/]\.venv/);
    if (!m) return undefined;
    const display = m[1].replace(/ · .*/, '');
    return this.setupPaths.find((p) => redact(p) === display) ?? discoverProjects(this.deps.projectRoots()).find((p) => p.displayPath === display)?.path ?? ctx.memo['venvPath'];
  }

  async fingerprint(steps: PlanStep[], ctx: StepContext): Promise<Record<string, string>> {
    const fp: Record<string, string> = {};
    if (isWin && steps.some((s) => s.actionId.startsWith('env.path.user'))) {
      try { fp['User PATH'] = 'sha256:' + sha256((await this.readUserPath()).value).slice(0, 12); } catch { fp['User PATH'] = 'unreadable'; }
    }
    for (const s of steps.filter((x) => x.actionId === 'python.venv.create')) {
      const p = this.stepPaths(ctx, s);
      if (p) fp[`Project ${path.basename(p)}`] = fs.existsSync(p) ? 'present' : 'missing';
    }
    return fp;
  }

  async precheck(step: PlanStep, ctx: StepContext): Promise<{ label: string; ok: boolean }[]> {
    const entry = this.catalog().find((a) => a.id === step.actionId);
    if (!entry?.availableInThisBuild) return [{ label: 'Action is available in this build', ok: false }];
    if (step.actionId === 'env.path.user.remove_entry' || step.actionId === 'env.path.user.dedupe') {
      try {
        const cur = await this.readUserPath();
        return [{ label: 'Your PATH can be read and saved for undo', ok: true }, { label: 'Only your account’s PATH is changed (no admin)', ok: true }, { label: `PATH has ${splitPath(cur.value).length} entries`, ok: true }];
      } catch { return [{ label: 'Your PATH can be read and saved for undo', ok: false }]; }
    }
    if (step.actionId === 'storage.temp.clean') return [{ label: 'Temp folder exists and belongs to you', ok: fs.existsSync(os.tmpdir()) }, { label: 'Files in use are skipped', ok: true }];
    if (step.actionId === 'python.venv.create') {
      const p = this.stepPaths(ctx, step);
      let isLink = false;
      try { isLink = !!p && fs.lstatSync(p).isSymbolicLink(); } catch { /* */ }
      return [
        { label: 'Project folder exists', ok: !!p && fs.existsSync(p) },
        { label: 'Project folder is not a redirect (junction/symlink)', ok: !isLink },
        { label: 'No .venv yet', ok: !!p && !fs.existsSync(path.join(p, '.venv')) },
      ];
    }
    return step.preconditions.map((label) => ({ label, ok: true }));
  }

  async execute(step: PlanStep, ctx: StepContext) {
    try {
      switch (step.actionId) {
        case 'env.path.user.remove_entry':
        case 'env.path.user.dedupe': {
          const cur = await this.readUserPath();
          ctx.memo.savedPath = cur.value;
          ctx.memo.savedKind = cur.kind;
          ctx.memo.beforeTools = JSON.stringify(this.resolveTools(cur.value + ';' + (process.env.PATH ?? '')));
          const entries = splitPath(cur.value);
          let next: string[];
          if (step.actionId === 'env.path.user.dedupe') {
            const seen = new Set<string>();
            next = entries.filter((e) => { const k = e.toLowerCase().replace(/[\\/]+$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });
          } else {
            // TOCTOU: remove only entries that are STILL missing right now (spec §6).
            const analysed = analysePath(entries.map((dir) => ({ dir, scope: 'user' as const })));
            next = analysed.filter((e) => e.exists).map((e) => e.dir);
          }
          ctx.memo.removed = JSON.stringify(entries.filter((e) => !next.includes(e)));
          ctx.memo.expected = next.join(';');
          if (next.length === entries.length) return { ok: true, info: 'Nothing to remove any more · PATH unchanged' };
          await this.writeUserPath(next.join(';'), cur.kind);
          return { ok: true, info: `Removed ${entries.length - next.length} entr${entries.length - next.length === 1 ? 'y' : 'ies'} · old PATH saved for undo` };
        }
        case 'storage.temp.clean': {
          const before = freeBytes(os.tmpdir());
          ctx.memo.freeBefore = String(before);
          const freed = cleanTemp(os.tmpdir(), 7);
          ctx.memo.freed = String(freed.bytes);
          return { ok: true, info: `Removed ${freed.files} old files · ${Math.round(freed.bytes / 1024 ** 2)} MB · ${freed.skipped} in use skipped` };
        }
        case 'python.venv.create': {
          const p = this.stepPaths(ctx, step);
          if (!p) return { ok: false, info: 'Project folder not found', errorCode: 'E_PRECONDITION_FAILED' as const };
          ctx.memo.venvPath = p;
          const py = isWin ? 'python' : 'python3';
          const r = await run(py, ['-m', 'venv', '.venv'], { cwd: p, timeoutMs: 180000 });
          if (!r.ok) return { ok: false, info: `python -m venv exited ${r.code}: ${r.stderr.slice(0, 160)}`, errorCode: r.timedOut ? 'E_ACTION_TIMEOUT' as const : 'E_ACTION_FAILED' as const };
          ctx.memo.venvCreated = '1';
          return { ok: true, info: `.venv created · exit code ${r.code} (information only)` };
        }
        case 'npm.cache.verify': {
          const r = await run(isWin ? 'npm.cmd' : 'npm', ['cache', 'verify'], { timeoutMs: 180000 });
          return r.ok ? { ok: true, info: 'npm cache verified · exit code 0 (information only)' } : { ok: false, info: r.stderr.slice(0, 160), errorCode: 'E_ACTION_FAILED' as const };
        }
        default:
          return { ok: false, info: 'This action isn’t available in this build', errorCode: 'E_POLICY_DENIED' as const };
      }
    } catch (e) {
      return { ok: false, info: String((e as Error).message ?? e).slice(0, 200), errorCode: 'E_ACTION_FAILED' as const };
    }
  }

  async verify(check: VerificationCheck, ctx: StepContext) {
    try {
      if (ctx.memo.expected !== undefined && ctx.memo.savedPath !== undefined) {
        const cur = await this.readUserPath();
        if (check.id === 'v1') {
          const same = splitPath(cur.value).join(';') === splitPath(ctx.memo.expected).join(';');
          return { pass: same, detail: same ? 'PATH matches the approved result exactly' : 'PATH differs from what was approved — something else changed it' };
        }
        const before = JSON.parse(ctx.memo.beforeTools ?? '{}') as Record<string, string>;
        const after = this.resolveTools(cur.value + ';' + (process.env.PATH ?? ''));
        const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
        return { pass: changed.length === 0, detail: changed.length ? 'Now resolves differently: ' + changed.join(', ') : 'Same programs as before: ' + Object.entries(after).filter(([, v]) => v !== 'not found').map(([k]) => k).join(', ') };
      }
      if (ctx.memo.freed !== undefined) {
        if (check.id === 'v1') return { pass: true, detail: `${Math.round(Number(ctx.memo.freed) / 1024 ** 2)} MB of old temp files removed` };
        const now = freeBytes(os.tmpdir());
        const ok = now + 50 * 1024 ** 2 >= Number(ctx.memo.freeBefore ?? 0);
        return { pass: ok, detail: `Free space now ${Math.round(now / 1024 ** 3 * 10) / 10} GB` };
      }
      if (ctx.memo.venvPath) {
        const venv = path.join(ctx.memo.venvPath, '.venv');
        if (check.id === 'v1') return { pass: fs.existsSync(venv), detail: fs.existsSync(venv) ? '.venv found' : '.venv missing' };
        const exe = isWin ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
        const r = await run(exe, ['--version'], { timeoutMs: 20000 });
        return { pass: r.ok, detail: r.ok ? (r.stdout || r.stderr).trim() : 'The .venv Python didn’t run' };
      }
      return { pass: false, detail: 'No verification is defined for this step' };
    } catch (e) {
      return { pass: false, detail: String((e as Error).message ?? e) };
    }
  }

  async undo(step: PlanStep, ctx: StepContext) {
    if (step.actionId.startsWith('env.path.user') && ctx.memo.savedPath !== undefined) {
      await this.writeUserPath(ctx.memo.savedPath, ctx.memo.savedKind ?? 'ExpandString');
      ctx.memo.expected = ctx.memo.savedPath;
      return { ok: true, info: 'Previous PATH restored exactly' };
    }
    if (step.actionId === 'python.venv.create' && ctx.memo.venvCreated && ctx.memo.venvPath) {
      fs.rmSync(path.join(ctx.memo.venvPath, '.venv'), { recursive: true, force: true });
      return { ok: true, info: '.venv removed' };
    }
    return { ok: false, info: 'Nothing to undo for this step', errorCode: 'E_ACTION_FAILED' as const };
  }
}

// ───────────────────────────── helpers ─────────────────────────────

class Builder {
  pillars: Record<ScanScope, HealthRow[]> = { pc: [], dev: [], proj: [] };
  incidents: Incident[] = [];
  evidenceMap = new Map<string, EvidenceItem>();
  projects: Project[] = [];
  findings: ScanFinding[] = [];
  itemResults: Record<string, { status: CheckStatus; note: string }> = {};

  item(id: string, status: CheckStatus, note: string) { this.itemResults[id] = { status, note }; }
  row(col: ScanScope, r: HealthRow) { this.pillars[col].push(r); }
  finding(text: string, status: CheckStatus, incidentId?: string) { this.findings.push({ id: 'F' + this.findings.length, text, status, incidentId }); }
  addEvidence(e: EvidenceItem) { this.evidenceMap.set(e.id, e); return e.id; }
  evidence(key: string, title: string, source: string, collector: string, sensitivity: EvidenceItem['sensitivity'], fields: EvidenceItem['fields']) {
    const safe = fields.map((f) => ({ ...f, value: f.secret ? 'present, never read' : redact(f.value) }));
    return this.addEvidence({ id: evId(key), title, source, collector: `${collector}@${COLLECTOR_V}`, collectorVersion: COLLECTOR_V, capturedAt: nowIso(), hash: sha256(JSON.stringify(safe)), size: JSON.stringify(safe).length, sensitivity, retention: '90d', incidentIds: [], fields: safe });
  }
  incident(key: string, p: Partial<Incident> & Pick<Incident, 'type' | 'title' | 'summary' | 'hypotheses' | 'evidence'>): string {
    const id = incId(key);
    const snapshot = 'ES-' + sha256(key + JSON.stringify(p.evidence)).slice(0, 4);
    this.incidents.push({ id, status: 'open', createdAt: nowIso(), updatedAt: nowIso(), timeline: [], evidenceSnapshot: snapshot, source: 'scan', ...p });
    for (const e of p.evidence) { const ev = this.evidenceMap.get(e.id); if (ev && !ev.incidentIds.includes(id)) ev.incidentIds.push(id); }
    for (const eid of p.rootCause?.evidenceIds ?? []) { const ev = this.evidenceMap.get(eid); if (ev && !ev.incidentIds.includes(id)) ev.incidentIds.push(id); }
    return id;
  }
  outcome(): ScanOutcome {
    const meta: Record<ScanScope, [string, string]> = { pc: ['This PC', 'Stability, drivers, hardware'], dev: ['Dev tools', 'Runtimes, PATH, SDKs'], proj: ['Projects', 'What each one needs'] };
    const pillars: Pillar[] = (['pc', 'dev', 'proj'] as const).filter((k) => this.pillars[k].length).map((k) => ({ key: k, name: meta[k][0], sub: meta[k][1], rows: this.pillars[k] }));
    return { pillars, findings: this.findings, incidents: this.incidents, evidence: [...this.evidenceMap.values()], projects: this.projects };
  }
}

function topProviders(ev: { p: string }[]) {
  const m: Record<string, number> = {};
  ev.forEach((e) => { m[e.p] = (m[e.p] ?? 0) + 1; });
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3));
}
const conf = (n: number, total: number): Confidence => (n >= 3 && n / total >= 0.6 ? 'high' : n >= 2 ? 'medium' : 'low');
const labelFor = (k: string) => (k === 'display' ? 'Driver reset' : k === 'bsod' ? 'Blue screen' : k === 'hardware' ? 'Hardware error' : 'Unexpected restart');

function freeBytes(p: string): number {
  try { const s = fs.statfsSync(p); return s.bavail * s.bsize; } catch { return 0; }
}

function cleanTemp(dir: string, days: number) {
  const cutoff = Date.now() - days * 86400e3;
  let bytes = 0, files = 0, skipped = 0, visited = 0;
  const walk = (d: string, depth: number): boolean => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return false; }
    let empty = true;
    for (const e of ents) {
      if (++visited > 50000) return false;
      const p = path.join(d, e.name);
      try {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) { empty = false; continue; }
        if (st.isDirectory()) {
          if (depth < 8 && walk(p, depth + 1) && st.mtimeMs < cutoff) { try { fs.rmdirSync(p); } catch { empty = false; } } else empty = false;
        } else if (st.mtimeMs < cutoff) {
          try { fs.unlinkSync(p); bytes += st.size; files++; } catch { skipped++; empty = false; }
        } else empty = false;
      } catch { skipped++; empty = false; }
    }
    return empty;
  };
  walk(dir, 0);
  return { bytes, files, skipped };
}
