/**
 * Demo dataset — the canvas scenarios (boards 01–28) as deterministic fixtures.
 * Used by the demo mode, the browser build and every automated UI test (Handoff §“Test plan”).
 */
import type {
  ActionEntry, Blueprint, CheckStatus, DiagnoseRequest, DiagnosisSource, EvidenceItem, HistoryEvent, Incident,
  MachineInfo, OsKind, Pillar, PlanStep, Project, RedactionPreview, ScanScope, SetupRow, VerificationCheck,
} from '../../shared/contracts';
import type { Dataset, PlanDraft, ScanOutcome, ScanScript, StepContext } from '../dataset';
import { sha256 } from '../util';

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000).toISOString();
const ev = (id: string, title: string, source: string, collector: string, sensitivity: EvidenceItem['sensitivity'], incidentIds: string[], fields: EvidenceItem['fields'], size = 1200, retention: EvidenceItem['retention'] = '90d'): EvidenceItem => ({
  id, title, source, collector, collectorVersion: collector.split('@')[1] ?? '1.0', capturedAt: iso(40), hash: sensitivity === 'secret' ? 'presence-only' : sha256(id + title), size, sensitivity, retention, incidentIds, fields,
});

export const DEMO_ACTIONS: ActionEntry[] = [
  a('nvm.symlink.recreate', '1.0.1', 'Recreate the Node link', 'Puts back the nvm link to a Node version that’s already installed.', 'environment', 'medium', 'admin', false, ['Link folder is missing', 'Parent folder isn’t a redirect', 'Target Node folder unchanged'], ['Link resolves to the right folder', 'node -v returns the expected version'], 'Undo: remove the link again.'),
  a('env.path.user.remove_entry', '1.2.0', 'Remove a dead PATH entry', 'Removes one entry from your PATH that points to a folder that doesn’t exist.', 'environment', 'low', 'user', false, ['Folder still doesn’t exist', 'Current PATH saved'], ['Entry gone, everything else identical'], 'Undo: restore the saved PATH exactly.'),
  a('env.path.user.dedupe', '1.0.0', 'Remove duplicate PATH entries', 'Keeps the first copy of each folder in your user PATH and removes repeats.', 'environment', 'low', 'user', false, ['Current PATH saved', 'Only exact duplicates removed'], ['Every folder still present once', 'Order of first copies unchanged'], 'Undo: restore the saved PATH exactly.'),
  a('git.credential_helper.set', '1.1.0', 'Reset Git credential helper', 'Points Git at Windows Credential Manager so you stop re-typing passwords.', 'environment', 'low', 'user', false, ['Git is installed', 'Current setting saved'], ['git config shows the new helper'], 'Undo: restore the previous helper setting.'),
  a('dns.flush_cache', '1.0.0', 'Clear the DNS cache', 'Clears remembered website addresses so fresh ones are looked up.', 'network', 'low', 'admin', false, ['No VPN change in progress'], ['Test lookup succeeds'], 'Nothing to undo — the cache refills by itself.'),
  a('net.adapter.reset', '1.0.2', 'Restart a network adapter', 'Turns one network adapter off and on. You’ll briefly lose connection.', 'network', 'high', 'admin', false, ['Adapter still matches the one diagnosed', 'You confirm the disconnect'], ['Adapter is up', 'Test connection succeeds'], 'Undo: not needed — the adapter settings are unchanged.'),
  a('windows.sfc.scan', '0.9.0', 'Check Windows system files', 'Runs Windows’ own system-file checker and records what it finds.', 'system', 'medium', 'admin', true, ['On AC power', 'No Windows Update running'], ['Checker finishes with a clear result', 'Original problem re-tested'], 'Undo: Windows keeps its own backups of replaced files.'),
  a('driver.rollback', '0.8.0', 'Roll back a device driver', 'Returns one device to its previous signed driver.', 'drivers', 'high', 'admin', true, ['Previous driver is signed', 'Device identity matches'], ['Device reports working', 'Driver version matches expected'], 'Undo: reinstall the newer driver from the saved package.'),
  a('system.restore_point.create', '1.0.0', 'Create a restore point', 'Saves a Windows restore point before bigger repairs, so there’s always a way back.', 'system', 'low', 'admin', false, ['System Protection is on for C:', 'Enough free space'], ['Restore point listed by Windows'], 'Undo: not needed — it only adds a safety net.'),
  a('boot.safe_mode.next_restart', '1.0.0', 'Restart into Safe Mode (once)', 'Makes the next restart go into Safe Mode — only once. The following restart is normal again.', 'system', 'medium', 'admin', true, ['Guided repair is active', 'Restore point exists', 'On AC power'], ['Windows reports Safe Mode after restart'], 'Undo: the flag clears itself after one restart.'),
  a('driver.gpu.update', '1.0.0', 'Update the GPU driver', 'Installs a newer, signed GPU driver package that was downloaded and verified first.', 'drivers', 'medium', 'admin', true, ['Package signed by the GPU maker', 'Fingerprint matches approval', 'Device identity matches'], ['New driver loaded', 'Device reports working'], 'Undo: roll back to the saved previous driver.'),
  a('driver.gpu.clean_install', '0.9.0', 'Clean GPU driver reinstall', 'Removes the current GPU driver in Safe Mode, then installs a verified clean package.', 'drivers', 'high', 'admin', true, ['In Safe Mode', 'Restore point exists', 'Clean package verified'], ['Sleep/wake test passes 3 times', 'No freezes for 48 h'], 'Undo: restore point or saved previous driver package.'),
  a('pkg.winget.install', '1.0.0', 'Install a tool with winget', 'Installs one exact package version from a source you already use.', 'packages', 'medium', 'admin', false, ['Package ID and version pinned', 'Publisher and signature recorded', 'No new sources added'], ['Installed version matches', 'Tool runs'], 'Undo: uninstall the exact package.'),
  a('pip.venv.install', '1.0.0', 'Install into a project venv', 'Installs a pinned package into the project’s own virtual environment only.', 'project', 'low', 'user', false, ['Project venv found', 'Extra index approved if needed'], ['Package imports in the venv', 'Project check passes'], 'Undo: restore the saved package list.'),
  a('python.venv.create', '1.0.0', 'Create a project virtual env', 'Creates .venv inside the project folder with the Python already installed.', 'project', 'low', 'user', false, ['Project folder exists', 'No .venv yet', 'Python found'], ['.venv/python runs'], 'Undo: delete the new .venv folder.'),
  a('pip.cert_bundle.refresh', '1.0.0', 'Refresh Python certificates', 'Updates the certificate bundle pip uses, from the already-installed package.', 'project', 'low', 'user', false, ['Project virtual env found'], ['pip can reach the package index'], 'Undo: restore the previous bundle file.'),
  a('storage.temp.clean', '1.0.0', 'Clear your temp folder', 'Deletes files older than 7 days from your own temp folder only.', 'system', 'low', 'user', false, ['Only %TEMP% is touched', 'Files in use are skipped'], ['Free space increased'], 'Undo: not possible — only old temporary files are removed.'),
  a('npm.cache.verify', '1.0.0', 'Verify the npm cache', 'Runs npm’s own cache check and garbage-collects broken entries.', 'packages', 'low', 'user', false, ['npm found'], ['npm cache verify reports OK'], 'Nothing to undo — the cache rebuilds itself.'),
];

function a(id: string, version: string, title: string, description: string, category: ActionEntry['category'], risk: ActionEntry['risk'], privilege: ActionEntry['privilege'], reboot: boolean, preconditions: string[], verification: string[], undo: string): ActionEntry {
  return { id, version, title, description, category, risk, privilege, reboot, preconditions, verification, undo, os: ['windows'], signed: true, availableInThisBuild: true };
}

const act = (id: string) => DEMO_ACTIONS.find((x) => x.id === id)!;
const step = (n: number, actionId: string, title: string, targetSummary: string, extra: Partial<PlanStep> = {}): PlanStep => {
  const e = act(actionId);
  return { id: 'S' + n, actionId, actionVersion: e.version, title, targetSummary, risk: e.risk, privilege: e.privilege, reboot: e.reboot, undo: e.undo, preconditions: e.preconditions, ...extra };
};
const check = (id: string, tier: VerificationCheck['tier'], label: string): VerificationCheck => ({ id, tier, label });

// ───────────────────────────── incidents ─────────────────────────────

function incNode(): Incident {
  return {
    id: 'INC-0042', type: 'dev', title: 'npm run dev fails — “node” is not recognized', source: 'scan', projectId: 'ds',
    summary: 'Windows can’t find node because the nvm link folder is missing.', status: 'open', createdAt: iso(45), updatedAt: iso(44),
    evidenceSnapshot: 'ES-7f3a',
    rootCause: { title: 'The Node link C:\\nvm4w\\nodejs is missing, so Windows can’t find node.', detail: 'Proven by a direct test · 3 pieces of evidence agree · rules agree with the AI.', confidence: 'confirmed', evidenceIds: ['T-3', 'E-104', 'E-107'] },
    hypotheses: [
      { id: 'h2', title: 'An nvm update didn’t recreate the link', confidence: 'high', evidenceIds: ['E-109', 'E-110'], detail: 'nvm-windows was updated 3 days ago. Updates sometimes remove the link without recreating it. This explains why the link is gone — it’s the likely cause behind the root cause.' },
      { id: 'h3', title: 'Antivirus quarantined node.exe', confidence: 'low', evidenceIds: ['E-121'], vetoedByRule: 'R-AV-02', detail: 'Ruled out. Windows Defender logged no detections in the last 30 days, and node.exe is still present in the nvm folder. A safety rule blocked this idea from driving any fix.' },
      { id: 'h4', title: 'System-wide PATH is broken too', confidence: 'unknown', evidenceIds: [], detail: 'Couldn’t be checked without admin access. It doesn’t block this fix, and it will be re-checked automatically during verification.', test: 'Re-checked during verification' },
    ],
    evidence: [
      { id: 'T-3', text: 'Link folder exists? No.', meta: 'Direct test · 09:39', kind: 'for' },
      { id: 'E-104', text: 'C:\\nvm4w\\nodejs is not on disk', meta: 'File system · 09:38', kind: 'for' },
      { id: 'E-107', text: 'Registry still points PATH at the link', meta: 'Environment · 2 secret values hidden', kind: 'for' },
      { id: 'E-109', text: 'Node 20.17.0 installed via nvm', meta: 'nvm · 09:38', kind: 'for' },
      { id: 'E-110', text: 'nvm updated 3 days ago', meta: 'Installed apps · 09:38', kind: 'for' },
      { id: 'E-121', text: 'No antivirus detections in 30 days', meta: 'Event log · 09:38', kind: 'against' },
    ],
    timeline: [], aiNote: { code: 'OK', text: 'AI ran locally on redacted evidence and cited every claim. Nothing left this PC.' },
  };
}

function incFreeze(): Incident {
  return {
    id: 'INC-0043', type: 'pc', title: 'Laptop freezes after waking from sleep', source: 'scan', status: 'open', createdAt: iso(40), updatedAt: iso(38),
    summary: '5 freezes in 7 days. 4 of 5 happened within 2 minutes of waking from sleep.', evidenceSnapshot: 'ES-91c2',
    symptom: 'My laptop keeps freezing, usually after it wakes from sleep',
    rootCause: { title: 'The NVIDIA display driver (522.25) stops responding after sleep.', detail: 'Every freeze names the same driver module. The driver was updated the day the freezes began. Likelihood is a label, not a calibrated percentage.', confidence: 'high', evidenceIds: ['E-201', 'E-204', 'E-190'] },
    hypotheses: [
      { id: 'c1', title: 'Display driver fails on resume', confidence: 'high', evidenceIds: ['E-201', 'E-204', 'E-207', 'E-190'], detail: 'All 5 freezes log VIDEO_TDR_FAILURE from nvlddmkm. The driver changed on Sep 23, the day of the first freeze.', test: 'Roll back or reinstall the driver, then run a 3× sleep/wake test.' },
      { id: 'c2', title: 'Fast Startup leaves the GPU in a bad state', confidence: 'medium', evidenceIds: ['E-195'], detail: 'Fast Startup is on and can keep driver state across shutdowns. It doesn’t explain the freeze mid-game on Sep 25.', test: 'Turn Fast Startup off for 2 days and watch for freezes.' },
      { id: 'c3', title: 'Failing memory', confidence: 'low', evidenceIds: ['E-205'], detail: 'No WHEA or memory errors in 30 days. Kept for completeness.', test: 'Windows Memory Diagnostic (needs a restart).' },
      { id: 'c4', title: 'Overheating', confidence: 'unknown', evidenceIds: [], detail: 'No temperature sensor data is available without an optional tool.', test: 'Import a sensor log from a hardware monitor.' },
    ],
    evidence: [
      { id: 'E-201', text: 'nvlddmkm stopped responding · VIDEO_TDR_FAILURE', meta: 'Event log · Sep 23 21:10', kind: 'for' },
      { id: 'E-204', text: 'Reliability: hardware error, same module', meta: 'Reliability · Sep 24', kind: 'for' },
      { id: 'E-190', text: 'NVIDIA driver 522.25 installed Sep 23', meta: 'Drivers · signed', kind: 'for' },
      { id: 'E-195', text: 'Fast Startup on · wake source keyboard', meta: 'Power · sleep/wake log', kind: 'neutral' },
      { id: 'E-205', text: 'No memory errors in 30 days', meta: 'Event log · WHEA', kind: 'against' },
    ],
    timeline: [
      { id: 'f1', at: 'Sep 23 · 21:10', label: 'Freeze Sep 23 · 21:10', cause: 'Froze after waking · display driver stopped responding · VIDEO_TDR_FAILURE', evidenceId: 'E-201', severity: 'freeze' },
      { id: 'f2', at: 'Sep 24 · 08:02', label: 'Freeze Sep 24 · 08:02', cause: 'Froze 1 min 40 s after waking · same driver module', evidenceId: 'E-204', severity: 'freeze' },
      { id: 'f3', at: 'Sep 25 · 07:55', label: 'Freeze Sep 25 · 07:55', cause: 'Froze 50 s after waking · same driver module', evidenceId: 'E-207', severity: 'freeze' },
      { id: 'f4', at: 'Sep 25 · 13:30', label: 'Freeze Sep 25 · 13:30', cause: 'Froze mid-game, not after sleep · same driver module', evidenceId: 'E-209', severity: 'freeze' },
      { id: 'f5', at: 'Today · 08:10', label: 'Freeze Today · 08:10', cause: 'Froze 1 min after waking · restarted by itself', evidenceId: 'E-212', severity: 'crash' },
    ],
    aiNote: { code: 'OK', text: 'Explained on this PC from redacted evidence. Every claim cites an evidence ID.' },
  };
}

function incGpu(): Incident {
  return {
    id: 'INC-0044', type: 'dev', title: 'PyTorch can’t use the GPU', source: 'scan', projectId: 'ml', status: 'open', createdAt: iso(36), updatedAt: iso(35),
    summary: 'PyTorch is built for CUDA 12.4, but the GPU driver only supports up to 11.8.', evidenceSnapshot: 'ES-a410',
    rootCause: { title: 'The GPU driver is too old for the CUDA 12.4 build of PyTorch.', detail: 'Driver 522.25 supports CUDA ≤ 11.8. torch 2.5.1+cu124 needs ≥ 12.4. You don’t need the CUDA Toolkit.', confidence: 'high', evidenceIds: ['E-190', 'E-230'] },
    hypotheses: [
      { id: 'g1', title: 'Driver too old for the cu124 wheel', confidence: 'high', evidenceIds: ['E-190', 'E-230'], detail: 'nvidia-smi reports CUDA 11.8 as the maximum supported level.' },
      { id: 'g2', title: 'CPU-only PyTorch in the project venv', confidence: 'medium', evidenceIds: ['E-231'], detail: 'Two interpreters found. The project .venv may resolve a different torch build than the global one.', test: 'Import torch inside .venv and print torch.version.cuda.' },
      { id: 'g3', title: 'CUDA Toolkit missing', confidence: 'low', evidenceIds: [], vetoedByRule: 'R-CUDA-01', detail: 'PyTorch wheels bundle their own CUDA runtime. A rule blocks installing the Toolkit as a fix.' },
    ],
    evidence: [
      { id: 'E-230', text: 'nvidia-smi: max CUDA 11.8 · driver 522.25', meta: 'GPU · 09:38', kind: 'for' },
      { id: 'E-190', text: 'NVIDIA driver 522.25 installed Sep 23', meta: 'Drivers · signed', kind: 'for' },
      { id: 'E-231', text: '2 Python interpreters found (global, .venv)', meta: 'Project · ml-experiments', kind: 'neutral' },
    ],
    timeline: [], aiNote: { code: 'OK', text: 'Rules-first diagnosis; the local AI only explained it.' },
  };
}

function incDisk(): Incident {
  return {
    id: 'INC-0041', type: 'pc', title: 'Low disk space on C:', source: 'scan', status: 'open', createdAt: iso(45), updatedAt: iso(44),
    summary: 'C: has 11% free — below your 15% goal.', evidenceSnapshot: 'ES-3c11',
    rootCause: { title: 'Temporary files and caches take 18 GB on C:.', detail: 'Your temp folder holds 9.4 GB of files older than 7 days.', confidence: 'medium', evidenceIds: ['E-150'] },
    hypotheses: [{ id: 'd1', title: 'Old temporary files', confidence: 'medium', evidenceIds: ['E-150'], detail: '9.4 GB in %TEMP% older than 7 days.' }],
    evidence: [{ id: 'E-150', text: 'C: 11% free · %TEMP% 9.4 GB', meta: 'Storage · 09:38', kind: 'for' }], timeline: [],
  };
}

function incDocker(): Incident {
  return {
    id: 'INC-0039', type: 'dev', title: 'docker compose up hangs', source: 'scan', projectId: 'api', status: 'open', createdAt: iso(60 * 20), updatedAt: iso(60 * 20),
    summary: 'Docker engine is off, so container checks couldn’t run. That’s unknown, not broken.', evidenceSnapshot: 'ES-0d91',
    hypotheses: [{ id: 'k1', title: 'Docker Desktop isn’t running', confidence: 'unknown', evidenceIds: ['E-160'], detail: 'The engine pipe doesn’t answer. Start Docker Desktop and check again.', test: 'Start Docker Desktop, then Check again.' }],
    evidence: [{ id: 'E-160', text: 'Docker engine pipe not answering', meta: 'Docker · yesterday', kind: 'neutral' }], timeline: [],
  };
}

const RESOLVED: [string, string, string, 'pc' | 'dev', number][] = [
  ['INC-0038', 'git push asks for a password every time', 'This PC', 'dev', 4 * 1440],
  ['INC-0036', 'pip install fails with SSL error', 'data-scripts', 'dev', 8 * 1440],
  ['INC-0035', 'WSL won’t start after Windows update', 'This PC', 'pc', 14 * 1440],
  ['INC-0033', 'Wi-Fi drops every few minutes', 'This PC', 'pc', 17 * 1440],
  ['INC-0031', 'Port 3000 already in use', 'dsconsulting-site', 'dev', 23 * 1440],
];

function resolved(): Incident[] {
  return RESOLVED.map(([id, title, where, type, mins]) => ({
    id, type, title, source: 'demo', summary: where, status: id === 'INC-0033' ? 'closed' : 'verified', createdAt: iso(mins), updatedAt: iso(mins - 30),
    evidenceSnapshot: 'ES-' + id.slice(-4), hypotheses: [], evidence: [], timeline: [],
    rootCause: id === 'INC-0033' ? undefined : { title: 'Resolved', detail: '', confidence: 'confirmed', evidenceIds: [] },
  }));
}

// ───────────────────────────── evidence ─────────────────────────────

function evidence(): EvidenceItem[] {
  return [
    ev('E-107', 'User environment variables', 'Registry', 'env@2.0', 'sensitive', ['INC-0042'], [
      { key: 'Path', value: '…;%NVM_SYMLINK%;C:\\Program Files\\nodejs;…' }, { key: 'NVM_HOME', value: '%LOCALAPPDATA%\\nvm' }, { key: 'NVM_SYMLINK', value: 'C:\\nvm4w\\nodejs' },
      { key: 'GITHUB_TOKEN', value: 'present, never read · looks like a token', secret: true }, { key: 'OPENAI_API_KEY', value: 'present, never read · looks like a key', secret: true }], 3100),
    ev('E-104', 'Does C:\\nvm4w\\nodejs exist?', 'File system', 'fs@1.3', 'internal', ['INC-0042'], [{ key: 'path', value: 'C:\\nvm4w\\nodejs' }, { key: 'exists', value: 'false' }, { key: 'parent exists', value: 'true' }, { key: 'parent is redirect', value: 'false' }], 400),
    ev('T-3', 'Direct test: link folder present', 'Test', 'test.fs_exists@1.0', 'internal', ['INC-0042'], [{ key: 'test', value: 'fs.exists' }, { key: 'target', value: 'C:\\nvm4w\\nodejs' }, { key: 'result', value: 'false' }, { key: 'deterministic', value: 'yes' }], 200, '1y'),
    ev('E-109', 'nvm list', 'nvm', 'nvm@1.0', 'internal', ['INC-0042'], [{ key: 'installed', value: '20.17.0, 18.20.4' }, { key: 'in use', value: 'none (link missing)' }], 300),
    ev('E-110', 'Installed apps', 'Installed apps', 'apps@1.4', 'internal', ['INC-0042'], [{ key: 'NVM for Windows', value: '1.1.12 · updated 3 days ago' }, { key: 'Git', value: '2.46' }, { key: 'Python', value: '3.12' }, { key: 'Docker Desktop', value: 'installed · not running' }], 18000),
    ev('E-121', 'Antivirus log, last 30 days', 'Event log', 'evtlog@1.2', 'internal', ['INC-0042'], [{ key: 'provider', value: 'Windows Defender' }, { key: 'detections', value: '0' }, { key: 'quarantined items', value: '0' }], 44000),
    ev('E-88', '.npmrc (npm settings)', 'File system', 'secrets.presence@1.0', 'secret', ['INC-0042'], [{ key: 'file', value: '%USERPROFILE%\\.npmrc' }, { key: 'present', value: 'yes' }, { key: 'auth token', value: 'present, never read · presence noted only', secret: true }], 0),
    ev('E-90', 'SSH key folder', 'File system', 'secrets.presence@1.0', 'secret', ['INC-0038'], [{ key: 'folder', value: '%USERPROFILE%\\.ssh' }, { key: 'private keys present', value: '2' }, { key: 'key contents', value: 'present, never read', secret: true }], 0),
    ev('E-201', 'Event log · display driver', 'Event log', 'evtlog@1.2', 'sensitive', ['INC-0043'], [{ key: 'source', value: 'nvlddmkm' }, { key: 'event', value: 'Display driver stopped responding and has recovered' }, { key: 'machine', value: '<machine-A>' }, { key: 'time', value: 'Sep 23 21:10' }], 1200),
    ev('E-204', 'Reliability history', 'Reliability', 'reliability@1.1', 'internal', ['INC-0043'], [{ key: 'record', value: 'Hardware error · VIDEO_TDR_FAILURE' }, { key: 'count (7 days)', value: '5' }], 800),
    ev('E-190', 'Driver inventory', 'Drivers', 'drivers@1.3', 'internal', ['INC-0043', 'INC-0044'], [{ key: 'device', value: 'NVIDIA GeForce RTX 3060 Laptop GPU' }, { key: 'driver', value: '522.25 · Sep 23' }, { key: 'signed', value: 'yes · NVIDIA' }], 600),
    ev('E-195', 'Sleep / wake log', 'Power', 'power@1.0', 'internal', ['INC-0043'], [{ key: 'Fast Startup', value: 'on' }, { key: 'last wake source', value: '<device>' }], 400),
    ev('E-205', 'Memory errors (WHEA)', 'Event log', 'evtlog@1.2', 'internal', ['INC-0043'], [{ key: 'errors (30 days)', value: '0' }], 300),
    ev('E-230', 'nvidia-smi', 'GPU', 'gpu@1.2', 'internal', ['INC-0044'], [{ key: 'driver', value: '522.25' }, { key: 'max CUDA', value: '11.8' }, { key: 'GPU', value: 'RTX 3060 Laptop · 6 GB' }], 500),
    ev('E-231', 'Python interpreters', 'Project', 'python@1.1', 'internal', ['INC-0044'], [{ key: 'global', value: 'C:\\Python312\\python.exe · torch none' }, { key: '.venv', value: 'ml-experiments\\.venv · torch 2.5.1+cu124' }], 700),
    ev('E-150', 'Storage', 'Storage', 'storage@1.0', 'internal', ['INC-0041'], [{ key: 'C: free', value: '11% (27 GB)' }, { key: '%TEMP%', value: '9.4 GB · older than 7 days' }], 300),
    ev('E-160', 'Docker engine', 'Docker', 'docker@1.0', 'internal', ['INC-0039'], [{ key: 'engine', value: 'not answering' }, { key: 'Docker Desktop', value: 'installed · 4.34' }], 200),
  ];
}

// ───────────────────────────── projects ─────────────────────────────

const req = (id: string, name: string, needs: string, have: string, status: CheckStatus, source: string, incidentId?: string) => ({ id, name, needs, have, status, source, incidentId });

function projects(): Project[] {
  return [
    { id: 'ds', name: 'dsconsulting-site', stack: 'Node · Vite', path: 'D:\\work\\dsconsulting-site', status: 'fail', summary: 'One requirement fails: Node can’t be found. A fix is waiting in INC-0042.', lastChecked: iso(40),
      requirements: [req('node', 'Node.js', '≥ 20', 'not on PATH', 'fail', 'package.json engines', 'INC-0042'), req('npm', 'npm', '≥ 10', '10.8 (with Node)', 'ok', 'package.json'), req('git', 'Git', 'any', '2.46', 'ok', '.git'), req('port', 'Port 5173 free', 'free', 'free', 'ok', 'vite.config.ts'), req('disk', 'Disk space', '≥ 2 GB', '27 GB', 'ok', 'estimate')] },
    { id: 'ml', name: 'ml-experiments', stack: 'Python · PyTorch · CUDA', path: 'D:\\work\\ml-experiments', status: 'fail', summary: 'PyTorch is installed for CUDA 12.4, but the GPU driver only supports up to 11.8 — training falls back to the CPU.', lastChecked: iso(40),
      requirements: [req('py', 'Python', '≥ 3.12', '3.12.7', 'ok', 'pyproject.toml'), req('torch', 'torch (GPU build)', '2.5.1+cu124', '2.5.1+cu124', 'ok', 'pyproject.toml'), req('drv', 'GPU driver CUDA support', '≥ 12.4', '11.8', 'fail', 'torch wheel', 'INC-0044'), req('cuda', 'torch.cuda.is_available()', 'True', 'False', 'fail', 'direct test', 'INC-0044'), req('msvc', 'C++ build tools', 'MSVC', 'missing', 'warn', 'native deps'), req('disk', 'Disk space', '≥ 15 GB', '27 GB', 'ok', 'estimate')] },
    { id: 'api', name: 'booking-api', stack: 'Docker · Postgres', path: 'D:\\work\\booking-api', status: 'unknown', summary: 'Docker is off, so container checks couldn’t run. That’s unknown, not broken.', lastChecked: iso(40),
      requirements: [req('docker', 'Docker engine', 'running', 'off', 'unknown', 'compose.yaml', 'INC-0039'), req('wsl', 'WSL 2', 'enabled', 'enabled', 'ok', 'Docker Desktop'), req('port', 'Port 5432 free', 'free', 'unknown', 'unknown', 'compose.yaml'), req('virt', 'Virtualization', 'on', 'on', 'ok', 'firmware'), req('disk', 'Disk space', '≥ 10 GB', '27 GB', 'ok', 'estimate')] },
    { id: 'py', name: 'data-scripts', stack: 'Python · venv', path: 'D:\\work\\data-scripts', status: 'ok', summary: 'Everything this project needs is here and working.', lastChecked: iso(40),
      requirements: [req('py', 'Python', '≥ 3.11', '3.12.4', 'ok', '.python-version'), req('venv', 'Virtual env', '.venv', 'found', 'ok', 'folder'), req('pip', 'pip', 'any', '24.2', 'ok', '.venv'), req('ssl', 'SSL certificates', 'valid', 'valid', 'ok', 'certifi'), req('disk', 'Disk space', '≥ 1 GB', '27 GB', 'ok', 'estimate')] },
  ];
}

// ───────────────────────────── health pillars ─────────────────────────────

const row = (id: string, name: string, note: string, status: CheckStatus, incidentId?: string, projectId?: string) => ({ id, name, note, status, incidentId, projectId });

export function demoPillars(): Pillar[] {
  return [
    { key: 'pc', name: 'This PC', sub: 'Stability, drivers, hardware', rows: [
      row('stability', 'Stability', '5 freezes in 7 days', 'fail', 'INC-0043'), row('gpu', 'GPU driver', 'Old — 522.25', 'warn', 'INC-0043'), row('disk', 'Disk C:', '11% free', 'warn', 'INC-0041'),
      row('mem', 'Memory', 'No errors', 'ok'), row('drivers', 'Other drivers', 'All signed', 'ok'), row('wu', 'Windows Update', 'Up to date', 'ok')] },
    { key: 'dev', name: 'Dev tools', sub: 'Runtimes, PATH, SDKs', rows: [
      row('path', 'PATH', 'Node link missing', 'fail', 'INC-0042'), row('cuda', 'CUDA support', 'Driver ≤ 11.8', 'warn', 'INC-0044'), row('msvc', 'VS Build Tools', 'C++ compiler missing', 'warn'),
      row('docker', 'Docker', 'Engine off', 'unknown', 'INC-0039'), row('python', 'Python', '3.12.7', 'ok'), row('gitwsl', 'Git · WSL', 'Ready', 'ok')] },
    { key: 'proj', name: 'Projects', sub: 'What each one needs', rows: [
      row('p-ds', 'dsconsulting-site', 'Node not found', 'fail', 'INC-0042', 'ds'), row('p-ml', 'ml-experiments', 'GPU unavailable', 'fail', 'INC-0044', 'ml'),
      row('p-api', 'booking-api', 'Needs Docker running', 'unknown', 'INC-0039', 'api'), row('p-py', 'data-scripts', 'Ready', 'ok', undefined, 'py')] },
  ];
}

const SCAN_ITEMS: [string, ScanScope, string, number, string, CheckStatus][] = [
  ['hw', 'pc', 'Hardware', 1, 'Inventoried', 'ok'], ['drv', 'pc', 'Drivers & signatures', 2, 'GPU driver old', 'warn'], ['evt', 'pc', 'Event logs · 30 days', 4, '4 display-driver resets', 'fail'],
  ['rel', 'pc', 'Reliability history', 5, '5 freezes', 'fail'], ['disk', 'pc', 'Disk health', 6, 'Healthy · 11% free', 'warn'], ['mem', 'pc', 'Memory', 7, 'No errors', 'ok'],
  ['gpu', 'pc', 'GPU · sleep/wake', 8, 'Crashes after wake', 'fail'], ['startup', 'pc', 'Startup programs', 9, '14 items', 'ok'], ['wu', 'pc', 'Windows Update', 10, 'Up to date', 'ok'],
  ['path', 'dev', 'PATH & environment', 3, 'Node link missing', 'fail'], ['node', 'dev', 'Node / npm', 4, '22.14 · not reachable', 'fail'], ['py', 'dev', 'Python / pip', 5, '3.12.7', 'ok'],
  ['git', 'dev', 'Git', 6, '2.46', 'ok'], ['docker', 'dev', 'Docker', 7, 'Engine off', 'unknown'], ['wsl', 'dev', 'WSL', 8, 'Ready', 'ok'], ['cuda', 'dev', 'CUDA', 9, 'Driver ≤ 11.8', 'warn'],
  ['msvc', 'dev', 'VS Build Tools', 10, 'C++ missing', 'warn'], ['pwsh', 'dev', 'PowerShell', 11, '7.4', 'ok'],
  ['p-ds', 'proj', 'dsconsulting-site', 10, 'Blocked by PATH', 'fail'], ['p-ml', 'proj', 'ml-experiments', 11, 'GPU unavailable', 'fail'], ['p-api', 'proj', 'booking-api', 12, 'Needs Docker', 'unknown'], ['p-py', 'proj', 'data-scripts', 12, 'Ready', 'ok'],
];
const SCAN_FINDINGS: [number, string, CheckStatus, string][] = [
  [4, 'Display driver resets', 'fail', 'INC-0043'], [3, 'Node link missing', 'fail', 'INC-0042'], [9, 'CUDA too old for PyTorch', 'warn', 'INC-0044'], [10, 'C++ compiler missing', 'warn', ''], [6, 'Disk 11% free', 'warn', 'INC-0041'],
];

// ───────────────────────────── setup ─────────────────────────────

const BLUEPRINTS: Blueprint[] = [
  { id: 'project', name: 'From this project', description: 'Read package.json and pyproject.toml' },
  { id: 'ai', name: 'AI / ML', description: 'Python, GPU drivers, PyTorch' },
  { id: 'web', name: 'Web dev', description: 'Node, package manager, Git' },
  { id: 'data', name: 'Data science', description: 'Python, venv, Jupyter' },
];

const srow = (id: string, name: string, kind: SetupRow['kind'], current: string | undefined, target: string | undefined, source: string, publisher: string, note: string, o: Partial<SetupRow> = {}): SetupRow => ({
  id, name, kind, current, target, source, publisher, note, signature: 'verified', admin: false, restart: false, group: 'Tools', ...o,
});

function setupRows(bp: string, os: OsKind): { rows: SetupRow[]; mb: number } {
  const pm = os === 'windows' ? 'winget' : os === 'macos' ? 'Homebrew' : 'apt';
  if (bp === 'ai') {
    if (os === 'macos') return { mb: 1200, rows: [
      srow('gpu', 'GPU acceleration', 'keep', 'Apple MPS', 'Apple MPS', 'built into macOS', 'Apple', 'CUDA isn’t available on Mac — MPS is used instead', { group: 'GPU' }),
      srow('py', 'Python', 'keep', '3.12.7', '3.12.7', 'already installed', '—', 'Meets ≥ 3.12'),
      srow('torch', 'PyTorch', 'install', undefined, '2.5.1', 'PyPI', 'PyTorch Foundation', 'Into .venv only', { group: 'Project' }),
      srow('clt', 'Xcode Command Line Tools', 'install', undefined, 'latest', 'Apple', 'Apple', 'Compiler for native packages', { admin: true }),
      srow('git', 'Git', 'keep', '2.46.0', '2.46.0', 'already installed', '—', '')] };
    const drv = os === 'windows'
      ? srow('drv', 'NVIDIA GPU driver', 'update', '522.25', 'latest', 'NVIDIA', 'NVIDIA Corporation', 'Needed for CUDA 12.4', { admin: true, restart: true, group: 'GPU' })
      : srow('drv', 'NVIDIA GPU driver', 'update', '525', '550', 'apt · Ubuntu repo', 'Canonical', 'Needed for CUDA 12.4', { admin: true, restart: true, group: 'GPU' });
    return { mb: os === 'windows' ? 6200 : 2900, rows: [
      drv,
      srow('py', 'Python', 'keep', '3.12.7', '3.12.7', 'already installed', '—', 'Meets ≥ 3.12'),
      srow('torch', 'PyTorch (CUDA 12.4 build)', 'install', undefined, '2.5.1+cu124', 'pytorch.org index', 'PyTorch Foundation', 'Into .venv only · needs a new package index', { newSource: true, group: 'Project' }),
      os === 'windows' ? srow('msvc', 'VS Build Tools (C++)', 'install', undefined, '17.x', pm + ' · Microsoft', 'Microsoft Corporation', 'One package compiles code', { admin: true }) : srow('gcc', 'build-essential', 'keep', '13.2', '13.2', 'already installed', '—', ''),
      srow('git', 'Git', 'keep', '2.46.0', '2.46.0', 'already installed', '—', ''),
      srow('cuda', 'CUDA Toolkit', 'skip', undefined, undefined, '—', '—', 'Not needed — PyTorch brings its own CUDA', { signature: 'unknown', group: 'GPU' })] };
  }
  if (bp === 'web') return { mb: 20, rows: [
    srow('node', 'Node.js (via nvm)', 'keep', '22.14.0', '22.14.0', 'already installed', '—', 'Meets ≥ 22'),
    srow('pnpm', 'pnpm', 'install', undefined, '9.x', os === 'windows' ? 'winget · pnpm' : pm, 'pnpm', 'Project uses pnpm-lock.yaml'),
    srow('git', 'Git', 'keep', '2.46.0', '2.46.0', 'already installed', '—', ''),
    srow('path', 'PATH clean-up', 'update', '2 dead entries', 'clean', 'Environment Doctor', 'Environment Doctor', 'Fixes node resolving wrongly', { signature: 'verified', group: 'Environment' })] };
  if (bp === 'data') return { mb: 121, rows: [
    srow('py', 'Python', 'keep', '3.12.7', '3.12.7', 'already installed', '—', ''),
    srow('venv', 'Project virtual env', 'install', undefined, '.venv', 'python -m venv', 'Python', 'Keeps packages per project', { group: 'Project' }),
    srow('jup', 'JupyterLab', 'install', undefined, '4.x', 'PyPI', 'Project Jupyter', 'Into .venv only', { group: 'Project' }),
    srow('certs', 'Python certificates', 'update', 'certifi 2023', 'certifi 2026', 'PyPI', 'certifi', 'Fixes SSL errors seen before (INC-0036)', { group: 'Project' })] };
  return { mb: 700, rows: [
    srow('node', 'Node.js', 'keep', '22.14.0', '22.14.0', 'from package.json', '—', 'engines: node ≥ 22', { group: 'Project' }),
    srow('py', 'Python', 'keep', '3.12.7', '3.12.7', 'from pyproject.toml', '—', 'requires-python ≥ 3.12', { group: 'Project' }),
    srow('torch', 'torch 2.5.1+cu124', 'blocked', 'driver needed', '2.5.1+cu124', 'from pyproject.toml', 'PyTorch Foundation', 'Blocked by old GPU driver — see INC-0044', { admin: true, restart: true, group: 'Project' })] };
}

function setupDraft(rows: SetupRow[], bp: string): PlanDraft {
  let n = 0;
  const steps: PlanStep[] = [];
  for (const r of rows) {
    if (r.kind !== 'install' && r.kind !== 'update') continue;
    n++;
    const actionId = r.id === 'drv' ? 'driver.gpu.update' : r.id === 'path' ? 'env.path.user.remove_entry' : r.id === 'venv' ? 'python.venv.create' : r.group === 'Project' ? 'pip.venv.install' : 'pkg.winget.install';
    steps.push(step(n, actionId, (r.kind === 'install' ? 'Install ' : 'Update ') + r.name, `${r.name} ${r.current ? r.current + ' → ' : ''}${r.target ?? ''} · ${r.source}`, r.admin ? { privilege: 'admin' } : {}));
  }
  return {
    title: 'Set up · ' + (BLUEPRINTS.find((b) => b.id === bp)?.name ?? bp), kind: 'setup', steps, estimatedMinutes: Math.max(2, n * 3),
    verification: [check('v-inst', 'V1', 'Installed versions match the plan'), check('v-run', 'V2', 'Each tool runs'), check('v-proj', 'V4', 'Project check passes')],
    isolationNote: bp === 'ai' ? 'PyTorch goes into the project’s .venv — nothing is installed globally.' : undefined,
  };
}

// ───────────────────────────── dataset ─────────────────────────────

export interface DemoDeps { sleep(ms: number): Promise<void> }

export class DemoDataset implements Dataset {
  readonly mode = 'demo' as const;
  constructor(private deps: DemoDeps) {}

  async machine(): Promise<MachineInfo> {
    return { hostname: 'DEV-WORKSTATION', os: 'windows', osLabel: 'Win 11 Pro 24H2 · x64', arch: 'x64', appVersion: '0.9.0', mode: 'demo', guardsOn: true, bootId: '' };
  }

  seed() {
    const hist: Omit<HistoryEvent, 'hash' | 'prevHash'>[] = [
      { id: 'H-1', at: iso(4 * 1440 + 10), kind: 'action', title: 'Reset Git credential helper', detail: 'git.credential_helper.set v1.1.0', incidentId: 'INC-0038', actor: 'engine' },
      { id: 'H-2', at: iso(4 * 1440 + 9), kind: 'verification', title: 'INC-0038 verified', detail: 'git push works without re-entering a password', incidentId: 'INC-0038', actor: 'engine' },
      { id: 'H-3', at: iso(1440 + 330), kind: 'system', title: 'Update 0.9.3 downloaded', detail: 'Signature and fingerprint verified · waiting until no repair is running', actor: 'engine' },
      { id: 'H-4', at: iso(1440 - 360), kind: 'scan', title: 'Standard scan', detail: 'Docker engine off — marked unknown', actor: 'engine' },
    ];
    return { incidents: resolved(), evidence: [], projects: [], pillars: [], history: hist, scanned: false };
  }

  scanScript(scopes: ScanScope[]): ScanScript {
    const items = SCAN_ITEMS.filter((x) => scopes.includes(x[1])).map(([id, column, name]) => ({ id, column, name }));
    const sleep = this.deps.sleep;
    return {
      items,
      async run(onItem, signal) {
        const byTick = SCAN_ITEMS.filter((x) => scopes.includes(x[1]));
        for (let t = 1; t <= 12; t++) {
          if (signal.stopped) break;
          for (const it of byTick) if (it[3] === t + 1) onItem(it[0], { state: 'running' });
          await sleep(350);
          if (signal.stopped) break;
          for (const it of byTick) if (it[3] === t) onItem(it[0], { state: 'done', status: it[5], result: it[4] });
        }
        const all = demoPillars().filter((p) => scopes.includes(p.key));
        const incidents = [incNode(), incFreeze(), incGpu(), incDisk(), incDocker()];
        const findings = SCAN_FINDINGS.map(([, text, status, incidentId], i) => ({ id: 'F' + i, text, status, incidentId: incidentId || undefined }));
        const out: ScanOutcome = { pillars: all, findings, incidents, evidence: evidence(), projects: scopes.includes('proj') ? projects() : [] };
        return out;
      },
    };
  }

  diagnosisSources(): DiagnosisSource[] {
    return [
      { key: 'drivers', name: 'Drivers & devices', note: 'Versions, dates, signatures', sensitive: false, defaultOn: true },
      { key: 'events', name: 'Event Viewer', note: 'Errors and warnings, 30 days', sensitive: false, defaultOn: true },
      { key: 'rel', name: 'Reliability Monitor', note: 'Crash and hang history', sensitive: false, defaultOn: true },
      { key: 'dumps', name: 'Crash dump summaries', note: 'Sensitive · stays on this PC', sensitive: true, defaultOn: false },
      { key: 'disk', name: 'Disk health', note: 'SMART status, errors', sensitive: false, defaultOn: true },
      { key: 'ram', name: 'Memory', note: 'Hardware error log', sensitive: false, defaultOn: true },
      { key: 'gpu', name: 'GPU & CUDA', note: 'Driver, CUDA support, sleep/wake', sensitive: false, defaultOn: true },
      { key: 'startup', name: 'Startup programs', note: 'What runs at boot', sensitive: false, defaultOn: true },
      { key: 'updates', name: 'Windows Update', note: 'Recent installs and failures', sensitive: false, defaultOn: true },
      { key: 'dev', name: 'Dev tools & PATH', note: 'Runtimes, package managers, PATH', sensitive: false, defaultOn: true },
      { key: 'net', name: 'Network', note: 'Passive checks only', sensitive: false, defaultOn: false },
    ];
  }

  async diagnose(r: DiagnoseRequest, ctx: { incidents: Incident[] }) {
    await this.deps.sleep(600);
    const low = r.symptom.toLowerCase();
    const pick = (id: string, make: () => Incident) => ctx.incidents.find((i) => i.id === id && !['verified', 'closed'].includes(i.status)) ?? make();
    if (/freez|hang|sleep|wake|black screen|bsod|blue screen|restart/.test(low)) return { incident: { ...pick('INC-0043', incFreeze), symptom: r.symptom, source: 'describe' as const }, evidence: evidence() };
    if (/torch|cuda|gpu/.test(low)) return { incident: pick('INC-0044', incGpu), evidence: evidence() };
    if (/node|npm|path|not recognized/.test(low)) return { incident: pick('INC-0042', incNode), evidence: evidence() };
    if (/docker|compose|container/.test(low)) return { incident: pick('INC-0039', incDocker), evidence: evidence() };
    if (/disk|space|storage/.test(low)) return { incident: pick('INC-0041', incDisk), evidence: evidence() };
    const id = 'INC-' + String(45 + ctx.incidents.filter((i) => i.source === 'describe').length).padStart(4, '0');
    return {
      incident: {
        id, type: 'pc' as const, title: r.symptom.slice(0, 80), summary: 'Not enough evidence yet. Unknown is a valid answer — here are the cheapest tests to narrow it down.', status: 'open' as const,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), evidenceSnapshot: 'ES-' + sha256(r.symptom).slice(0, 4), symptom: r.symptom, source: 'describe' as const,
        hypotheses: [
          { id: 'u1', title: 'Recent Windows or driver update', confidence: 'unknown' as const, evidenceIds: [], detail: 'No correlated change found in the enabled sources.', test: 'Enable Windows Update history and check again.' },
          { id: 'u2', title: 'A startup program', confidence: 'unknown' as const, evidenceIds: [], detail: 'Needs a clean-boot comparison.', test: 'Record the problem with a reproduction marker.' },
        ],
        evidence: [], timeline: [], aiNote: { code: 'OK' as const, text: 'Rules found no match. The AI proposed tests only — no fix without evidence.' },
      },
      evidence: [],
    };
  }

  planFor(inc: Incident, opts: { next?: boolean; variant?: string }): PlanDraft | null {
    if (inc.id === 'INC-0042') return {
      title: 'Bring Node back', kind: 'fix', estimatedMinutes: 1,
      steps: [
        step(1, 'nvm.symlink.recreate', 'Recreate the Node link', 'C:\\nvm4w\\nodejs → nvm\\v20.17.0', { preconditions: ['Link folder is still missing', 'C:\\nvm4w is not a redirect', 'Node 20.17.0 folder unchanged', 'Meets project needs (≥ 20)'] }),
        step(2, 'env.path.user.remove_entry', 'Remove a dead PATH entry', 'User PATH − C:\\Program Files\\nodejs', { preconditions: ['Folder still doesn’t exist', 'Old PATH saved for undo'] }),
      ],
      verification: [check('v1', 'V1', 'Link resolves to nvm\\v20.17.0'), check('v2', 'V2', 'node -v returns v20.17.0'), check('v3', 'V2', 'npm -v returns 10.8'), check('v4', 'V4', 'npm run dev starts and the dev server responds')],
    };
    if (inc.id === 'INC-0043') {
      if (opts.variant === 'rollback') return {
        title: 'Roll back the display driver', kind: 'fix', estimatedMinutes: 5,
        steps: [step(1, 'driver.rollback', 'Roll back the NVIDIA driver', 'NVIDIA RTX 3060 Laptop · 522.25 → 516.94 (signed)')],
        verification: [check('v1', 'V1', 'Driver 516.94 loaded'), check('v2', 'V3', 'Sleep/wake test passes 3 times'), check('v3', 'V5', 'No freezes for 48 h')],
      };
      if (opts.variant === 'resume') return {
        title: 'Continue guided repair', kind: 'guided', estimatedMinutes: 20,
        steps: [
          step(4, 'driver.gpu.clean_install', 'Remove the current driver', 'NVIDIA display driver 522.25 · package kept for undo'),
          step(5, 'driver.gpu.clean_install', 'Install the clean driver', 'Signed package from step 2 · fingerprint 7c1e…9a02'),
          step(6, 'boot.safe_mode.next_restart', 'Restart normally', 'Clears the Safe Mode flag · normal boot', { title: 'Restart normally' }),
        ],
        verification: [check('v1', 'V1', 'The driver loaded and the GPU reports working'), check('v2', 'V3', 'Sleep test passes 3 times'), check('v3', 'V5', 'No new freeze events for 48 h')],
      };
      return {
        title: 'Guided repair · clean driver reinstall', kind: 'guided', estimatedMinutes: 25,
        steps: [
          step(1, 'system.restore_point.create', 'Create a restore point', 'C: · “Before Environment Doctor INC-0043”'),
          step(2, 'pkg.winget.install', 'Download a clean driver', 'NVIDIA 560.94 · signed by NVIDIA · hash verified', { risk: 'low' }),
          step(3, 'boot.safe_mode.next_restart', 'Restart into Safe Mode', 'Next restart only · restart 1 of 2'),
          step(4, 'driver.gpu.clean_install', 'Remove the current driver', 'NVIDIA display driver 522.25 · package kept for undo'),
          step(5, 'driver.gpu.clean_install', 'Install the clean driver', 'Signed package from step 2'),
          step(6, 'boot.safe_mode.next_restart', 'Restart normally', 'Restart 2 of 2'),
        ],
        verification: [check('v1', 'V1', 'The driver loaded and the GPU reports working'), check('v2', 'V3', 'Sleep test passes 3 times'), check('v3', 'V5', 'No new freeze events for 48 h')],
      };
    }
    if (inc.id === 'INC-0044') {
      if (opts.next) return {
        title: 'Install the CUDA build into .venv', kind: 'fix', estimatedMinutes: 2, isolationNote: 'Project-only change — nothing global is touched.',
        steps: [step(1, 'pip.venv.install', 'Install torch 2.5.1+cu124 into .venv', 'ml-experiments\\.venv · pytorch.org cu124 index (approved)')],
        verification: [check('v1', 'V2', 'torch.cuda.is_available() is True in .venv'), check('v2', 'V4', 'Project smoke test allocates a tensor on the GPU')],
      };
      return {
        title: 'Update the GPU driver', kind: 'fix', estimatedMinutes: 6,
        steps: [step(1, 'driver.gpu.update', 'Update the NVIDIA driver', 'RTX 3060 Laptop · 522.25 → 560.94 (signed · NVIDIA)')],
        verification: [check('v1', 'V1', 'Driver 560.94 loaded'), check('v2', 'V1', 'Driver supports CUDA ≥ 12.4'), check('v3', 'V2', 'torch.cuda.is_available() is True')],
      };
    }
    if (inc.id === 'INC-0041') return {
      title: 'Free space on C:', kind: 'fix', estimatedMinutes: 1,
      steps: [step(1, 'storage.temp.clean', 'Clear old temp files', '%TEMP% · files older than 7 days · ~9.4 GB')],
      verification: [check('v1', 'V1', 'Free space on C: increased'), check('v2', 'V1', 'C: is above 15% free')],
    };
    return null;
  }

  catalog() { return DEMO_ACTIONS; }
  blueprints() { return BLUEPRINTS; }

  async setupDryRun(blueprintId: string, os: OsKind) {
    await this.deps.sleep(250);
    const { rows, mb } = setupRows(blueprintId, os);
    const totals = { install: 0, update: 0, keep: 0, skip: 0, blocked: 0 };
    rows.forEach((r) => { totals[r.kind]++; });
    return {
      blueprintId, os, rows, totals, downloadMb: mb, needsAdmin: rows.some((r) => r.admin && (r.kind === 'install' || r.kind === 'update')),
      needsRestart: rows.some((r) => r.restart && r.kind !== 'keep'), newSources: rows.filter((r) => r.newSource).map((r) => r.source),
      isolationNote: blueprintId === 'ai' ? 'PyTorch goes into the project’s .venv — nothing is installed globally.' : undefined,
      draft: setupDraft(rows, blueprintId),
    };
  }

  redaction(inc: Incident, ev: EvidenceItem[]): RedactionPreview {
    const neverSent = ['Full crash dumps', '.env files', 'Keys and passwords', 'Your files'];
    if (inc.id === 'INC-0043') return { incidentId: inc.id, neverSent, pairs: [
      { id: 'E-201', label: 'Event log · display driver', rawA: 'nvlddmkm stopped responding on ', rawSecret: 'ALEX-LAPTOP', rawB: ' at 21:10', safe: 'machine-A', kb: 1.2 },
      { id: 'E-204', label: 'Reliability history', rawA: 'Hardware error · VIDEO_TDR_FAILURE · user ', rawSecret: 'alex', rawB: '', safe: '<user>', kb: 0.8 },
      { id: 'E-190', label: 'Driver inventory', rawA: 'NVIDIA driver installed Sep 23 by ', rawSecret: 'ALEX-LAPTOP\\alex', rawB: ' · signed', safe: '<user>', kb: 0.6 },
      { id: 'E-195', label: 'Sleep / wake log', rawA: 'Woke from sleep 08:00:20 · source: ', rawSecret: 'Alex’s Keyboard', rawB: '', safe: '<device>', kb: 0.4 },
      { id: 'E-199', label: 'Startup programs', rawA: 'Launch: ', rawSecret: 'C:\\Users\\alex\\AppData\\', rawB: '…\\Discord.exe', safe: '%APPDATA%\\', kb: 0.9 },
      { id: 'E-107', label: 'Environment variables', rawA: 'GITHUB_TOKEN=', rawSecret: '[present, never read]', rawB: '', safe: '[secret removed]', kb: 0.2 },
    ] };
    return { incidentId: inc.id, neverSent, pairs: ev.filter((e) => e.incidentIds.includes(inc.id)).slice(0, 6).map((e) => {
      const f = e.fields[0];
      return { id: e.id, label: e.title, rawA: f ? f.key + ': ' : '', rawSecret: f ? (f.secret ? '[present, never read]' : f.value) : '', rawB: '', safe: f?.secret ? '[secret removed]' : '<redacted>', kb: Math.max(0.1, Math.round(e.size / 100) / 10) };
    }) };
  }

  async fingerprint(): Promise<Record<string, string>> { return { 'User PATH': 'hash:4b1e09ac', 'GPU driver': '522.25' }; }

  async precheck(s: PlanStep): Promise<{ label: string; ok: boolean }[]> {
    await this.deps.sleep(120);
    return s.preconditions.map((label) => ({ label, ok: true }));
  }

  async execute(s: PlanStep, _ctx: StepContext) {
    await this.deps.sleep(s.reboot ? 300 : 700);
    return { ok: true, info: s.title + ' · done' };
  }

  async verify(c: VerificationCheck, ctx: StepContext) {
    await this.deps.sleep(c.tier === 'V4' ? 1400 : 600);
    // INC-0044's first plan is a real partial fix: driver updated, but the project venv still resolves the wrong build.
    if (ctx.incidentId === 'INC-0044' && ctx.memo.variant !== 'next' && c.id === 'v3') return { pass: false, detail: 'torch.cuda.is_available() is still False — .venv has the CPU-only build (torch 2.5.1+cpu).' };
    return { pass: true, detail: c.label + ' · passed' };
  }
}
