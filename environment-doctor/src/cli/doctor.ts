/**
 * doctor — the same engine from the command line (Handoff screen 14, v1.3 CLI contract).
 * The CLI is a thin client: it never mutates. `fix` explains the plan and tells you to approve it in the app.
 *
 *   doctor check   [--scope pc,dev,proj] [--format text|json]   read-only scan; exit code = health
 *   doctor explain <incident-id> [--format json]
 *   doctor fix     <incident-id>        shows the plan; approval happens in the app only
 *   doctor setup   --blueprint project|web|data|ai --plan-only
 *   doctor list                          open incidents
 *
 * Exit codes: 0 healthy · 1 problems found · 2 unsupported · 3 permission denied · 4 indeterminate (unknowns) · 70 internal error
 */
import os from 'node:os';
import path from 'node:path';
import type { Channel, Req, Res } from '../shared/contracts';
import { Orchestrator } from '../engine/orchestrator';
import { LiveDataset } from '../engine/live/dataset';
import { createNodeHost } from '../engine/live/nodeHost';

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const has = (name: string) => args.includes('--' + name);
const json = flag('format', 'text') === 'json';
const SCHEMA = 'environment-doctor/cli@1';

const dataDir = process.env.ENVDOCTOR_DATA ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'Environment Doctor', 'state');
const host = createNodeHost(dataDir, () => undefined);
const o = new Orchestrator({ host, defaultMode: 'live', datasets: { live: () => new LiveDataset({ sleep: host.sleep, appVersion: '0.9.0', projectRoots: () => [] }) } });

async function call<C extends Channel>(c: C, r?: Req<C>): Promise<Res<C>> {
  const res = await o.handle(c, r as Req<C>);
  if (!res.ok) { out({ error: res.error }, `✖ ${res.error.headline}${res.error.didNotHappen ? ' · ' + res.error.didNotHappen : ''}${res.error.nextStep ? '\n  next: ' + res.error.nextStep : ''}`); process.exit(res.error.code === 'E_COLLECTION_PERMISSION' ? 3 : res.error.code === 'E_COLLECTION_UNSUPPORTED' ? 2 : 70); }
  return res.data;
}
function out(obj: unknown, text: string) { process.stdout.write(json ? JSON.stringify({ schema: SCHEMA, ...(obj as object) }, null, 2) + '\n' : text + '\n'); }
const mark = (s: string) => ({ ok: '✔', warn: '▲', fail: '✖', unknown: '?' } as Record<string, string>)[s] ?? '·';

async function check() {
  const scopes = (flag('scope', 'pc,dev,proj') ?? '').split(',').filter((s) => ['pc', 'dev', 'proj'].includes(s)) as ('pc' | 'dev' | 'proj')[];
  const { scanId } = await call('scan.start', { scopes });
  if (!json) process.stdout.write('Scanning (read-only)…\n');
  for (;;) {
    const s = await call('scan.get');
    if (s && s.scanId === scanId && s.state !== 'running') break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const h = await call('health.get');
  const inc = (await call('incidents.list')).filter((i) => !['verified', 'closed'].includes(i.status));
  const text = [
    `Environment Doctor · ${h.machine.hostname} · ${h.machine.osLabel}`, '',
    ...h.pillars.flatMap((p) => [p.name, ...p.rows.map((r) => `  ${mark(r.status)} ${r.name.padEnd(22)} ${r.note}${r.incidentId ? '  [' + r.incidentId + ']' : ''}`), '']),
    `${h.problemCount} problem(s) · ${h.unknownCount} not checked (not counted as healthy) · ${inc.length} open incident(s)`,
    inc.length ? `Explain one:  doctor explain ${inc[0].id}` : '',
  ].join('\n');
  out({ machine: h.machine, pillars: h.pillars, problemCount: h.problemCount, unknownCount: h.unknownCount, incidents: inc }, text);
  process.exit(h.problemCount ? 1 : h.unknownCount ? 4 : 0);
}

async function explain(id: string) {
  const i = await call('incident.get', { id });
  out({ incident: i }, [
    `${i.id} · ${i.title}`, i.summary, '',
    i.rootCause ? `Root cause (${i.rootCause.confidence}): ${i.rootCause.title}\n  evidence: ${i.rootCause.evidenceIds.join(', ')}` : 'Root cause: unknown (not enough evidence)', '',
    'Other explanations:', ...i.hypotheses.map((h) => `  - ${h.title} [${h.confidence}]${h.vetoedByRule ? ' · ruled out by ' + h.vetoedByRule : ''}${h.test ? '\n    test: ' + h.test : ''}`),
  ].join('\n'));
}

async function fix(id: string) {
  const plan = await call('plan.forIncident', { incidentId: id });
  out({ plan, approval: 'required-in-app' }, [
    `Plan for ${id}: ${plan.title}`, ...plan.steps.map((s, n) => `  ${n + 1}. ${s.title} — ${s.targetSummary} [${s.privilege}${s.removedReason ? ', removed: ' + s.removedReason : ''}]`),
    'Verification:', ...plan.verification.map((v) => `  ${v.tier} ${v.label}`), '',
    'Nothing has changed. The CLI never mutates — open Environment Doctor to review and approve this plan.',
  ].join('\n'));
}

async function setup() {
  if (!has('plan-only')) { out({ error: 'plan-only required' }, 'setup is dry-run only from the CLI: add --plan-only'); process.exit(2); }
  const dr = await call('setup.dryRun', { blueprintId: flag('blueprint', 'project')!, os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux' });
  out({ dryRun: dr }, dr.rows.map((r) => `  ${r.kind.padEnd(8)} ${r.name.padEnd(28)} ${r.current ?? ''}${r.target ? ' → ' + r.target : ''}  ${r.note ?? ''}`).join('\n'));
}

async function list() {
  const inc = await call('incidents.list');
  out({ incidents: inc }, inc.map((i) => `${i.id}  ${i.status.padEnd(18)} ${i.title}`).join('\n') || 'No incidents yet — run: doctor check');
}

(async () => {
  const [cmd, a1] = args;
  try {
    if (cmd === 'check' || cmd === 'scan') await check();
    else if (cmd === 'explain' && a1) await explain(a1);
    else if (cmd === 'fix' && a1) await fix(a1);
    else if (cmd === 'setup') await setup();
    else if (cmd === 'list') await list();
    else { process.stdout.write('usage: doctor check|explain <id>|fix <id>|setup --plan-only|list [--format json]\n'); process.exit(2); }
    process.exit(0);
  } catch (e) {
    process.stderr.write(String(e) + '\n');
    process.exit(70);
  }
})();
