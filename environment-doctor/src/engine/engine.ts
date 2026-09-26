/**
 * The orchestrator core (spec v1.2 §5, §7, §8, §10, §14, §24).
 *
 * Owns every safety rule that must not depend on the UI:
 *  - approvals bound to one immutable plan hash + evidence snapshot + boot session, 15 min TTL
 *  - one mutation at a time (global lock), others queue
 *  - recovery journal written BEFORE each mutation; restart invalidates approvals
 *  - drift and TOCTOU re-checks immediately before each step
 *  - “Verified” only after every declared verification check passes
 *  - tamper-evident audit chain
 */
import {
  APPROVAL_TTL_MS, TERMINAL_STATES, UI_CONFIRMATION_VERSION,
  type ActivityItem, type ApiError, type Approval, type ApprovalRequest, type EvidenceItem, type Fault, type Health,
  type HistoryEvent, type HistoryList, type Incident, type IncidentSummary, type JournalState, type LockState, type Pillar,
  type Plan, type PlanStep, type Project, type RecoveryJournal, type Result, type RunProgress, type ScanFinding,
  type ScanItem, type ScanProgress, type ScanScope, type Streams, type DiagnoseRequest, type OsKind,
} from '../shared/contracts';
import type { Dataset, PlanDraft, StepContext } from './dataset';
import { clone, sha256, shortHash, stableJson, uid } from './util';

export interface Host {
  sleep(ms: number): Promise<void>;
  now(): number;
  bootId(): Promise<string>;
  /** Demo only: pretend the PC restarted (new boot session). */
  simulateReboot?(): Promise<void>;
  load(key: string): Promise<{ value: unknown; restored?: boolean } | null>;
  save(key: string, value: unknown): Promise<void>;
  emit<S extends keyof Streams>(stream: S, data: Streams[S]): void;
  online(): Promise<boolean>;
}

interface JournalRecord extends RecoveryJournal {
  memo: Record<string, string>;
  fingerprint: Record<string, string>;
  currentStepId?: string;
}

interface EngineState {
  v: 1;
  scanned: boolean;
  lastScanAt?: string;
  pillars: Pillar[];
  incidents: Record<string, Incident>;
  evidence: Record<string, EvidenceItem>;
  projects: Project[];
  plans: Record<string, Plan & { variant?: string; parentPlanId?: string; resumeOf?: string }>;
  approvals: Record<string, Approval & { used?: boolean; cancelled?: boolean }>;
  runs: Record<string, RunProgress>;
  journal: JournalRecord | null;
  lock: LockState;
  history: HistoryEvent[];
  fault: Fault;
  helperUntrusted: boolean;
  scanSeq: number;
}

export class EngineError extends Error {
  constructor(public api: ApiError) { super(api.headline); }
}

const err = (code: ApiError['code'], headline: string, didNotHappen?: string, nextStep?: string, extra: Partial<ApiError> = {}): ApiError => ({ code, headline, didNotHappen, nextStep, ...extra });
export const fail = (e: ApiError): never => { throw new EngineError(e); };

type Waiter = (decision: string) => void;

export class Engine {
  private s!: EngineState;
  private scanSignal: { stopped: boolean } | null = null;
  private scanState: ScanProgress | null = null;
  private waiters = new Map<string, Waiter>();
  private ready: Promise<void>;
  private storageRestored = false;

  constructor(readonly dataset: Dataset, private host: Host, private ns: string) {
    this.ready = this.init();
  }

  // ───────────────────────────── lifecycle / persistence ─────────────────────────────

  private async init() {
    const loaded = await this.host.load(this.ns);
    if (loaded && (loaded.value as EngineState)?.v === 1) {
      this.s = loaded.value as EngineState;
      this.storageRestored = !!loaded.restored;
      await this.reconcileAfterStart();
    } else {
      this.s = this.fresh();
      await this.save();
    }
  }

  private fresh(): EngineState {
    const seed = this.dataset.seed();
    const s: EngineState = {
      v: 1, scanned: seed.scanned, pillars: seed.pillars, incidents: {}, evidence: {}, projects: seed.projects, plans: {}, approvals: {}, runs: {},
      journal: null, lock: { held: false, queue: [] }, history: [], fault: 'none', helperUntrusted: false, scanSeq: 118,
    };
    seed.incidents.forEach((i) => { s.incidents[i.id] = i; });
    seed.evidence.forEach((e) => { s.evidence[e.id] = e; });
    let prev = '0'.repeat(64);
    for (const h of seed.history.sort((a, b) => a.at.localeCompare(b.at))) {
      const hash = sha256(prev + stableJson(h));
      s.history.push({ ...h, prevHash: prev, hash });
      prev = hash;
    }
    return s;
  }

  async whenReady() { await this.ready; }

  private async save() { await this.host.save(this.ns, this.s); }

  /** Spec §14: after a crash or restart, find non-terminal executions and never blindly repeat. */
  private async reconcileAfterStart() {
    const j = this.s.journal;
    if (!j) return;
    const boot = await this.host.bootId();
    const run = this.s.runs[j.incidentId];
    if (j.state === 'WAITING_FOR_REBOOT') {
      j.reason = boot !== (run?.executionId ? this.s.plans[j.planId]?.binding.bootId : '') ? 'Your PC restarted as planned. The approval ended with the restart.' : j.reason;
    } else if (!TERMINAL_STATES.includes(j.state)) {
      if (j.currentStepId) j.unknownSteps = [j.currentStepId];
      j.state = 'RECOVERY_REQUIRED';
      j.reason = 'Environment Doctor stopped while a repair was running.';
    }
    // Any approval from a previous boot session is invalid (spec §5).
    for (const a of Object.values(this.s.approvals)) if (a.bootId !== boot) a.cancelled = true;
    // The process that held the lock is gone; the lock is recoverable only via the recovery flow.
    if (run && !TERMINAL_STATES.includes(run.state)) { run.state = j.state; run.adminPrompt = null; }
    this.addHistory('recovery', 'Found an unfinished repair on start', j.reason, j.incidentId, 'engine');
    await this.save();
  }

  // ───────────────────────────── history (tamper-evident chain) ─────────────────────────────

  private addHistory(kind: HistoryEvent['kind'], title: string, detail: string, incidentId: string | undefined, actor: HistoryEvent['actor']) {
    const prev = this.s.history.length ? this.s.history[this.s.history.length - 1].hash : '0'.repeat(64);
    const e = { id: uid('H'), at: new Date(this.host.now()).toISOString(), kind, title, detail, incidentId, actor };
    this.s.history.push({ ...e, prevHash: prev, hash: sha256(prev + stableJson(e)) });
    if (this.s.history.length > 2000) this.s.history.splice(0, this.s.history.length - 2000);
  }

  async historyList(): Promise<HistoryList> {
    await this.ready;
    let ok = true;
    for (let i = 0; i < this.s.history.length; i++) {
      const { hash, prevHash, ...rest } = this.s.history[i];
      if (sha256(prevHash + stableJson(rest)) !== hash) { ok = false; break; }
      if (i > 0 && prevHash !== this.s.history[i - 1].hash) { ok = false; break; }
    }
    const restored = this.storageRestored || this.s.fault === 'storageRestored';
    return {
      events: [...this.s.history].reverse(),
      integrity: !ok ? 'broken' : restored ? 'restored' : 'ok',
      integrityNote: !ok ? 'The audit chain doesn’t match — history may have been edited outside the app.' : restored ? 'History restored from backup. Events after the last backup may be missing.' : `Chain intact · ${this.s.history.length} events · each linked by SHA-256`,
    };
  }

  // ───────────────────────────── faults (demo/test only) ─────────────────────────────

  async setFault(f: Fault) {
    await this.ready;
    if (this.dataset.mode !== 'demo') fail(err('E_POLICY_DENIED', 'Fault injection is only available in demo mode', 'Nothing changed on this PC.'));
    this.s.fault = f;
    if (f === 'openJournal') await this.injectOpenJournal();
    if (f === 'helperUntrusted') this.s.helperUntrusted = false;
    await this.save();
    return { fault: f };
  }

  private async injectOpenJournal() {
    const inc = this.s.incidents['INC-0043'] ?? Object.values(this.s.incidents)[0];
    if (!inc) return;
    const plan = await this.planForIncident(inc.id, {});
    const pending = plan.steps.slice(3).map((x) => x.id);
    const done = plan.steps.slice(0, 3).map((x) => x.id);
    const executionId = uid('EX');
    this.s.journal = {
      executionId, incidentId: inc.id, planId: plan.id, state: 'WAITING_FOR_REBOOT', reason: 'Your PC restarted as planned. The approval ended with the restart.',
      completedSteps: done, pendingSteps: pending, unknownSteps: [], savedAt: new Date(this.host.now()).toISOString(), rechecks: [], memo: {}, fingerprint: {},
    };
    this.s.lock = { held: true, incidentId: inc.id, executionId, since: new Date().toISOString(), queue: [] };
    this.s.runs[inc.id] = this.newRun(executionId, inc.id, plan, 'WAITING_FOR_REBOOT');
    this.s.runs[inc.id].steps.forEach((st, i) => { if (i < 3) st.state = 'done'; });
    await this.host.simulateReboot?.();
    for (const a of Object.values(this.s.approvals)) a.cancelled = true;
  }

  async reset() {
    this.s = this.fresh();
    this.scanState = null;
    await this.save();
    return { ok: true as const };
  }

  // ───────────────────────────── health / scan ─────────────────────────────

  async health(): Promise<Health> {
    await this.ready;
    const machine = await this.machine();
    const rows = this.s.pillars.flatMap((p) => p.rows);
    const offline = this.s.fault === 'offline' || !(await this.host.online());
    let banner: Health['banner'];
    if (this.s.helperUntrusted) banner = { kind: 'helper-untrusted', text: 'Stopped — the admin helper failed a safety check. All repairs are paused.' };
    else if (this.storageRestored || this.s.fault === 'storageRestored') banner = { kind: 'backup-restored', text: 'History restored from backup. Anything after the last backup may be missing.' };
    else if (offline) banner = { kind: 'offline', text: 'You’re offline. Scans, diagnosis and most fixes still work; downloads and cloud AI are paused.' };
    return {
      machine, pillars: this.s.pillars, lastScanAt: this.s.lastScanAt, offline, banner,
      unknownCount: rows.filter((r) => r.status === 'unknown').length,
      problemCount: rows.filter((r) => r.status === 'warn' || r.status === 'fail').length,
      checkedCount: rows.filter((r) => r.status !== 'unknown').length,
      ...(this.dataset.healthExtras?.() ?? {}),
    };
  }

  async machine() {
    const m = await this.dataset.machine();
    return { ...m, bootId: await this.host.bootId(), guardsOn: !this.s?.helperUntrusted };
  }

  get scanned() { return this.s?.scanned ?? false; }

  async scanStart(scopes: ScanScope[]): Promise<{ scanId: string }> {
    await this.ready;
    if (this.scanState?.state === 'running') return { scanId: this.scanState.scanId };
    if (!scopes.length) fail(err('E_INVALID_REQUEST', 'Pick at least one area to scan', 'No scan started.'));
    this.s.scanSeq++;
    const scanId = 'SC-' + String(this.s.scanSeq).padStart(4, '0');
    const script = this.dataset.scanScript(scopes, { projects: this.s.projects });
    const items: ScanItem[] = script.items.map((i) => ({ ...i, state: 'waiting' }));
    const signal = { stopped: false };
    this.scanSignal = signal;
    const findings: ScanFinding[] = [];
    const st: ScanProgress = { scanId, state: 'running', items, findings, current: 'Starting read-only scan…', percent: 0, headline: 'Scanning your PC, tools and projects', subline: 'Looking only — nothing changes during a scan.' };
    this.scanState = st;
    this.emitScan();
    const onItem = (id: string, patch: Partial<ScanItem>) => {
      const it = st.items.find((x) => x.id === id);
      if (!it || st.state !== 'running') return;
      Object.assign(it, patch);
      if (patch.state === 'running') st.current = 'Checking ' + it.name + '…';
      if (patch.state === 'done' && (patch.status === 'fail' || patch.status === 'warn') && patch.result) {
        findings.push({ id: 'F-' + id, text: it.name + ': ' + patch.result, status: patch.status });
      }
      const done = st.items.filter((x) => x.state === 'done').length;
      st.percent = Math.round((done / Math.max(1, st.items.length)) * 100);
      this.emitScan();
    };
    void (async () => {
      let outcome;
      try {
        outcome = await script.run(onItem, signal);
      } catch (e) {
        outcome = null;
        st.subline = 'The scan hit an error: ' + (e as Error).message;
      }
      if (signal.stopped) return; // scanStop() finalised the state
      st.state = 'complete';
      st.percent = 100;
      st.items.forEach((i) => { if (i.state !== 'done') { i.state = 'skipped'; i.status = 'unknown'; i.result = i.result ?? 'Not checked'; } });
      if (outcome) {
        this.mergeScan(outcome, scopes);
        const inc = outcome.findings.filter((f) => f.status === 'fail').length;
        const problems = outcome.findings.length;
        st.findings = outcome.findings;
        st.headline = problems ? `Scan complete — ${problems} problem${problems === 1 ? '' : 's'} found` : 'Scan complete — no problems found';
        st.subline = this.dataset.mode === 'demo' ? 'The old GPU driver explains both the freezes and PyTorch not seeing the GPU.' : inc ? 'Open a problem to see the evidence and a fix.' : 'Unknown items were not counted as healthy.';
      }
      this.s.scanned = true;
      this.s.lastScanAt = new Date(this.host.now()).toISOString();
      this.addHistory('scan', 'Scan ' + scanId, `${st.items.filter((i) => i.state === 'done').length} checks · ${st.findings.length} findings · read-only`, undefined, 'engine');
      await this.save();
      this.emitScan();
    })();
    return { scanId };
  }

  private mergeScan(o: { pillars: Pillar[]; incidents: Incident[]; evidence: EvidenceItem[]; projects: Project[] }, scopes: ScanScope[]) {
    const settled = (id?: string) => { const i = id ? this.s.incidents[id] : undefined; return i && ['verified', 'closed'].includes(i.status); };
    for (const inc of o.incidents) {
      const cur = this.s.incidents[inc.id];
      if (cur && !['open', 'diagnosing'].includes(cur.status)) continue;
      this.s.incidents[inc.id] = cur ? { ...inc, createdAt: cur.createdAt } : inc;
    }
    for (const e of o.evidence) this.s.evidence[e.id] = e;
    const pillars = o.pillars.map((p) => ({ ...p, rows: p.rows.map((r) => (settled(r.incidentId) ? { ...r, status: 'ok' as const, note: 'Fixed · verified' } : r)) }));
    this.s.pillars = [...this.s.pillars.filter((p) => !scopes.includes(p.key)), ...pillars].sort((a, b) => ['pc', 'dev', 'proj'].indexOf(a.key) - ['pc', 'dev', 'proj'].indexOf(b.key));
    if (scopes.includes('proj')) this.s.projects = o.projects.map((p) => {
      const reqs = p.requirements.map((r) => (settled(r.incidentId) ? { ...r, status: 'ok' as const, have: 'fixed · verified' } : r));
      const status = reqs.some((r) => r.status === 'fail') ? 'fail' : reqs.some((r) => r.status === 'unknown') ? 'unknown' : reqs.some((r) => r.status === 'warn') ? 'warn' : 'ok';
      return { ...p, requirements: reqs, status };
    });
  }

  async scanStop(scanId: string): Promise<ScanProgress> {
    await this.ready;
    const st = this.scanState;
    if (!st || st.scanId !== scanId) fail(err('E_NOT_FOUND', 'That scan isn’t running', 'Nothing was stopped.'));
    if (st!.state !== 'running') return st!;
    this.scanSignal!.stopped = true;
    st!.state = 'stopped';
    st!.items.forEach((i) => { if (i.state !== 'done') { i.state = 'skipped'; i.status = 'unknown'; i.result = 'Not checked'; } });
    st!.headline = 'Scan stopped — partial results kept';
    st!.subline = 'Anything not checked is marked unknown, not healthy.';
    // UI rule 9: unchecked rows become Unknown on Home; they never count toward health.
    const byCol: Record<string, Pillar> = {};
    for (const p of this.s.pillars) byCol[p.key] = p;
    const meta: Record<ScanScope, [string, string]> = { pc: ['This PC', 'Stability, drivers, hardware'], dev: ['Dev tools', 'Runtimes, PATH, SDKs'], proj: ['Projects', 'What each one needs'] };
    for (const col of ['pc', 'dev', 'proj'] as ScanScope[]) {
      const its = st!.items.filter((i) => i.column === col);
      if (!its.length) continue;
      byCol[col] = { key: col, name: meta[col][0], sub: meta[col][1], rows: its.map((i) => ({ id: i.id, name: i.name, note: i.state === 'done' ? i.result ?? '' : 'Not checked — scan stopped', status: i.state === 'done' ? i.status ?? 'unknown' : 'unknown' })) };
    }
    this.s.pillars = (['pc', 'dev', 'proj'] as const).filter((k) => byCol[k]).map((k) => byCol[k]);
    this.s.scanned = true;
    this.s.lastScanAt = new Date(this.host.now()).toISOString();
    this.addHistory('scan', 'Scan ' + scanId + ' stopped', `${st!.items.filter((i) => i.state === 'done').length} of ${st!.items.length} checks finished · the rest marked unknown`, undefined, 'you');
    await this.save();
    this.emitScan();
    return st!;
  }

  scanGet() { return this.scanState; }
  private emitScan() { if (this.scanState) this.host.emit('scan.progress', clone(this.scanState)); }

  // ───────────────────────────── incidents / diagnosis ─────────────────────────────

  async incidentsList(): Promise<IncidentSummary[]> {
    await this.ready;
    return Object.values(this.s.incidents).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((i) => ({
      id: i.id, type: i.type, title: i.title, status: i.status, updatedAt: i.updatedAt, confidence: i.rootCause?.confidence ?? i.hypotheses[0]?.confidence,
      pillar: i.projectId ? 'proj' : i.type === 'pc' ? 'pc' : 'dev',
    }));
  }

  async incidentGet(id: string): Promise<Incident> {
    await this.ready;
    const i = this.s.incidents[id] ?? fail(err('E_NOT_FOUND', 'Incident ' + id + ' wasn’t found', 'Nothing changed.', 'Open the incident list.'));
    return i;
  }

  async incidentClose(id: string): Promise<IncidentSummary> {
    const i = await this.incidentGet(id);
    if (this.s.lock.held && this.s.lock.incidentId === id) fail(err('E_MUTATION_BUSY', 'A repair for this incident is still running', 'The incident stays open.'));
    i.status = 'closed';
    i.updatedAt = new Date(this.host.now()).toISOString();
    this.addHistory('diagnosis', i.id + ' closed', i.title, i.id, 'you');
    await this.save();
    return (await this.incidentsList()).find((x) => x.id === id)!;
  }

  async diagnose(req: DiagnoseRequest) {
    await this.ready;
    if (!req.symptom.trim()) fail(err('E_INVALID_REQUEST', 'Describe the problem first', 'No diagnosis started.'));
    const { incident, evidence } = await this.dataset.diagnose(req, { incidents: Object.values(this.s.incidents), evidence: Object.values(this.s.evidence) });
    incident.updatedAt = new Date(this.host.now()).toISOString();
    this.s.incidents[incident.id] = incident;
    for (const e of evidence) this.s.evidence[e.id] = e;
    this.addHistory('diagnosis', 'Diagnosis for ' + incident.id, `“${req.symptom.slice(0, 80)}” · sources: ${req.sources.join(', ') || 'none'}`, incident.id, 'you');
    await this.save();
    return { incidentId: incident.id };
  }

  // ───────────────────────────── plans ─────────────────────────────

  private hashPlan(p: Pick<Plan, 'incidentId' | 'kind' | 'steps' | 'verification'>, evidenceSnapshot: string, nonce = '') {
    return sha256(stableJson({ incidentId: p.incidentId, kind: p.kind, steps: p.steps, verification: p.verification, evidenceSnapshot, nonce }));
  }

  private async materialise(incident: Incident, draft: PlanDraft, variant?: string, extra: Partial<EngineState['plans'][string]> = {}): Promise<Plan> {
    const catalog = this.dataset.catalog();
    const steps: PlanStep[] = draft.steps.map((st) => {
      const entry = catalog.find((c) => c.id === st.actionId);
      if (!entry) return { ...st, removedReason: 'This action isn’t in the signed catalog.' };
      if (!entry.availableInThisBuild) return { ...st, removedReason: entry.privilege === 'admin' ? 'Needs the signed admin helper, which isn’t part of this build.' : 'Not available on this PC.' };
      if (entry.version !== st.actionVersion) return { ...st, removedReason: 'Catalog version mismatch.' };
      return st;
    });
    const live = steps.filter((x) => !x.removedReason);
    const id = uid('PL');
    const boot = await this.host.bootId();
    const planHash = this.hashPlan({ incidentId: incident.id, kind: draft.kind, steps: live, verification: draft.verification }, incident.evidenceSnapshot, id);
    const plan = {
      id, incidentId: incident.id, title: draft.title, kind: draft.kind, steps, verification: draft.verification,
      requiresAdmin: live.some((x) => x.privilege === 'admin'), requiresReboot: live.some((x) => x.reboot), estimatedMinutes: draft.estimatedMinutes,
      isolationNote: draft.isolationNote, status: 'draft' as const, variant,
      binding: { planHash, evidenceSnapshot: incident.evidenceSnapshot, expiresAt: '', expiresOnReboot: true as const, uiConfirmationVersion: UI_CONFIRMATION_VERSION, bootId: boot },
      ...extra,
    };
    this.s.plans[id] = plan;
    return plan;
  }

  async planGet(id: string): Promise<Plan> {
    await this.ready;
    return this.s.plans[id] ?? fail(err('E_NOT_FOUND', 'That plan no longer exists', 'Nothing ran.', 'Go back to the incident.'));
  }

  async planForIncident(incidentId: string, opts: { next?: boolean; variant?: string }): Promise<Plan> {
    await this.ready;
    const inc = await this.incidentGet(incidentId);
    const variant = opts.variant ?? (opts.next ? 'next' : undefined);
    const existing = Object.values(this.s.plans).find((p) => p.incidentId === incidentId && p.variant === variant && p.status === 'draft' && !p.resumeOf);
    if (existing && variant !== 'undo') return existing;
    let draft: PlanDraft | null;
    if (variant === 'user-only') {
      const base = this.dataset.planFor(inc, {});
      draft = base && { ...base, title: base.title + ' · without admin steps', steps: base.steps.filter((x) => x.privilege === 'user') };
      if (draft && !draft.steps.length) fail(err('E_POLICY_DENIED', 'Every step in this fix needs admin rights', 'Nothing changed.', 'Keep the incident open, or approve the admin prompt next time.'));
    } else if (variant === 'undo') {
      const last = Object.values(this.s.plans).filter((p) => p.incidentId === incidentId && p.status === 'executed').pop();
      const run = this.s.runs[incidentId];
      if (!last || !run) fail(err('E_NOT_FOUND', 'Nothing to undo for this incident', 'Nothing changed.'));
      const doneIds = run!.steps.filter((x) => x.state === 'done').map((x) => x.id);
      draft = {
        title: 'Undo · ' + last!.title, kind: 'fix', estimatedMinutes: last!.estimatedMinutes,
        steps: last!.steps.filter((x) => doneIds.includes(x.id)).reverse().map((x, i) => ({ ...x, id: 'U' + (i + 1), title: 'Undo: ' + x.title, targetSummary: x.undo, undoOf: x.id })),
        verification: [{ id: 'u1', tier: 'V1', label: 'Previous state restored exactly' }],
      };
    } else {
      draft = this.dataset.planFor(inc, { next: opts.next, variant });
    }
    if (!draft) fail(err('E_RULE_UNSUPPORTED', 'There’s no safe fix for this yet', 'Nothing will change.', inc.hypotheses[0]?.test ?? 'Collect more evidence and check again.'));
    const plan = await this.materialise(inc, draft!, variant);
    if (!plan.steps.some((x) => !x.removedReason)) {
      fail(err('E_POLICY_DENIED', 'This fix isn’t allowed in this build', 'Nothing changed.', 'See why each step was removed.', { detail: plan.steps.map((x) => x.title + ': ' + x.removedReason).join('\n') }));
    }
    inc.planId = plan.id;
    if (inc.status === 'open') inc.status = 'planned';
    await this.save();
    return plan;
  }

  /** Setup dry run produces a plan like any other fix (Handoff flow “Setup”). */
  async setupDryRun(blueprintId: string, os: OsKind) {
    await this.ready;
    const dry = await this.dataset.setupDryRun(blueprintId, os, { projects: this.s.projects });
    const { draft, ...rest } = dry;
    if (!draft || !draft.steps.length) return rest;
    const incId = 'SU-' + blueprintId.toUpperCase().slice(0, 4) + '-' + os.slice(0, 3);
    const inc: Incident = this.s.incidents[incId] ?? {
      id: incId, type: 'setup', title: draft.title + ' (' + os + ')', summary: 'Dry run: ' + Object.entries(rest.totals).filter(([, n]) => n).map(([k, n]) => n + ' ' + k).join(' · '),
      status: 'open', createdAt: new Date(this.host.now()).toISOString(), updatedAt: new Date(this.host.now()).toISOString(), hypotheses: [], evidence: [], timeline: [],
      evidenceSnapshot: 'ES-' + sha256(stableJson(rest.rows)).slice(0, 4), source: 'setup',
    };
    if (!['open', 'planned'].includes(inc.status)) return rest;
    inc.evidenceSnapshot = 'ES-' + sha256(stableJson(rest.rows)).slice(0, 4);
    this.s.incidents[incId] = inc;
    for (const p of Object.values(this.s.plans)) if (p.incidentId === incId && p.status === 'draft') p.status = 'superseded';
    const plan = await this.materialise(inc, draft, 'setup');
    if (!plan.steps.some((x) => !x.removedReason)) {
      plan.status = 'superseded';
      await this.save();
      return rest;
    }
    inc.planId = plan.id;
    await this.save();
    return { ...rest, planId: plan.id };
  }

  // ───────────────────────────── approval ─────────────────────────────

  async approve(r: ApprovalRequest): Promise<Approval> {
    await this.ready;
    const plan = await this.planGet(r.planId);
    if (plan.status === 'superseded' || plan.binding.planHash !== r.planHash) fail(err('E_APPROVAL_MISMATCH', 'The plan changed after you reviewed it', 'Nothing was approved.', 'Review the new plan.', { ref: this.latestPlanFor(plan.incidentId)?.id }));
    if (r.uiConfirmationVersion !== UI_CONFIRMATION_VERSION) fail(err('E_APPROVAL_MISMATCH', 'This screen is out of date', 'Nothing was approved.', 'Reload and review again.'));
    if (plan.status !== 'draft') fail(err('E_APPROVAL_MISMATCH', 'This plan was already used', 'Nothing was approved.', 'Build a new plan.'));
    const active = plan.steps.filter((x) => !x.removedReason);
    const needsAck = plan.requiresAdmin || plan.requiresReboot || active.some((x) => x.risk === 'high');
    if (needsAck && !r.acknowledged) fail(err('E_APPROVAL_MISMATCH', 'Tick the acknowledgement first', 'Nothing was approved.', 'Read what will change, then tick the box.'));
    const inc = await this.incidentGet(plan.incidentId);
    if (inc.stale) fail(err('E_EVIDENCE_STALE', 'This diagnosis is out of date', 'Nothing was approved.', 'Check again.'));
    const now = this.host.now();
    const ctx = this.ctxFor(plan, 'final-check');
    const finalCheck = (await Promise.all(active.map((st) => this.dataset.precheck(st, ctx)))).flat();
    const approval = {
      approvalId: 'AP-' + sha256(plan.id + now).slice(0, 6), planId: plan.id, planHash: plan.binding.planHash,
      approvedAt: new Date(now).toISOString(), expiresAt: new Date(now + APPROVAL_TTL_MS).toISOString(), bootId: await this.host.bootId(), finalCheck,
    };
    this.s.approvals[approval.approvalId] = approval;
    plan.status = 'approved';
    plan.binding = { ...plan.binding, approvalId: approval.approvalId, expiresAt: approval.expiresAt };
    this.addHistory('approval', 'You approved plan ' + shortHash(plan.binding.planHash), `${plan.title} · expires in 15 min or on restart`, plan.incidentId, 'you');
    if (this.s.fault === 'mutatePlan') {
      // Simulated tampering after approval (spec §34 “approval replay / changed-plan mismatch”).
      const st = plan.steps.find((x) => !x.removedReason);
      if (st) st.targetSummary += ' (changed)';
      plan.binding = { ...plan.binding, planHash: this.hashPlan(plan, plan.binding.evidenceSnapshot, 'mutated') };
    }
    await this.save();
    return approval;
  }

  private latestPlanFor(incidentId: string) {
    return Object.values(this.s.plans).filter((p) => p.incidentId === incidentId && p.status === 'draft').pop();
  }

  private ctxFor(plan: Plan, executionId: string): StepContext {
    return { incidentId: plan.incidentId, planId: plan.id, executionId, memo: { variant: (this.s.plans[plan.id] as { variant?: string }).variant ?? '' } };
  }

  // ───────────────────────────── run / journal ─────────────────────────────

  private newRun(executionId: string, incidentId: string, plan: Plan, state: JournalState): RunProgress {
    return {
      executionId, incidentId, planId: plan.id, state, stepIndex: 0,
      steps: plan.steps.filter((x) => !x.removedReason).map((x) => ({ id: x.id, title: x.title, state: 'pending' })),
      verification: plan.verification.map((v) => ({ id: v.id, label: v.label, tier: v.tier, state: 'pending' })),
      drift: [], activity: [], adminPrompt: null,
    };
  }

  private log(run: RunProgress, text: string, kind: ActivityItem['kind'] = 'info') {
    run.activity.push({ at: new Date(this.host.now()).toISOString(), text, kind });
  }

  private emitRun(run: RunProgress) { this.host.emit('run.progress', clone(run)); }

  async runGet(incidentId: string) { await this.ready; return this.s.runs[incidentId] ?? null; }
  async lockGet(): Promise<LockState> { await this.ready; return this.s.lock; }

  async runStart(approvalId: string, planHash: string): Promise<RunProgress> {
    await this.ready;
    const ap = this.s.approvals[approvalId] ?? fail(err('E_APPROVAL_MISMATCH', 'This approval isn’t valid', 'Nothing ran.', 'Review the plan again.'));
    const plan = await this.planGet(ap.planId);
    const boot = await this.host.bootId();
    const expired = this.s.fault === 'expireApproval' || this.host.now() > Date.parse(ap.expiresAt) || ap.bootId !== boot || ap.cancelled;
    if (expired) {
      ap.cancelled = true;
      plan.status = 'expired';
      this.addHistory('approval', 'Approval ' + approvalId + ' ran out', 'Nothing ran · re-check required', plan.incidentId, 'engine');
      await this.save();
      fail(err('E_APPROVAL_EXPIRED', 'This approval ran out', 'Nothing ran.', 'Re-check and review', { detail: ap.bootId !== boot ? 'Your PC restarted after you approved.' : 'Approvals last 15 minutes.' }));
    }
    if (ap.used) fail(err('E_APPROVAL_MISMATCH', 'This approval was already used', 'Nothing ran.', 'Build a new plan.'));
    if (ap.planHash !== plan.binding.planHash || planHash !== ap.planHash) {
      ap.cancelled = true;
      plan.status = 'superseded';
      const inc = await this.incidentGet(plan.incidentId);
      const fresh = await this.materialise(inc, { title: plan.title, kind: plan.kind, steps: plan.steps.filter((x) => !x.removedReason), verification: plan.verification, estimatedMinutes: plan.estimatedMinutes, isolationNote: plan.isolationNote }, (plan as { variant?: string }).variant);
      inc.planId = fresh.id;
      this.addHistory('approval', 'Plan changed after approval', 'Approval ' + approvalId + ' cancelled · nothing ran', plan.incidentId, 'engine');
      await this.save();
      fail(err('E_APPROVAL_MISMATCH', 'The plan changed after you approved it', 'Nothing ran.', 'Review the new plan', { ref: fresh.id }));
    }
    const lockHeld = this.s.lock.held && this.s.lock.incidentId !== plan.incidentId;
    if (lockHeld || this.s.fault === 'busy') {
      const behind = lockHeld ? this.s.lock.incidentId! : 'INC-0043';
      const run = this.newRun(uid('EX'), plan.incidentId, plan, 'APPROVED');
      run.queuedBehind = behind;
      run.error = err('E_MUTATION_BUSY', 'Queued behind ' + behind, 'Nothing has run yet.', 'Cancel');
      this.log(run, 'Waiting for the repair on ' + behind + ' to finish', 'warn');
      if (!this.s.lock.queue.includes(plan.incidentId)) this.s.lock.queue.push(plan.incidentId);
      this.s.runs[plan.incidentId] = run;
      const inc = await this.incidentGet(plan.incidentId);
      inc.status = 'queued';
      await this.save();
      this.emitRun(run);
      return run;
    }
    if (plan.requiresAdmin && (this.s.fault === 'helperUntrusted' || this.s.helperUntrusted)) {
      this.s.helperUntrusted = true;
      const run = this.newRun(uid('EX'), plan.incidentId, plan, 'BLOCKED');
      run.adminPrompt = 'untrusted';
      run.error = err('E_HELPER_UNTRUSTED', 'Stopped — the admin helper failed a safety check', 'Nothing ran. All repairs are paused.', 'Repair the app install');
      this.log(run, 'Admin helper signature mismatch · all repairs paused', 'error');
      this.s.runs[plan.incidentId] = run;
      ap.cancelled = true;
      plan.status = 'expired';
      this.addHistory('system', 'Admin helper failed a safety check', 'Signature mismatch · all repairs paused', plan.incidentId, 'engine');
      await this.save();
      this.emitRun(run);
      return run;
    }
    ap.used = true;
    const executionId = 'EX-' + plan.incidentId.slice(-4) + '-' + sha256(approvalId).slice(0, 4);
    const run = this.newRun(executionId, plan.incidentId, plan, 'APPROVED');
    this.s.runs[plan.incidentId] = run;
    this.s.lock = { held: true, incidentId: plan.incidentId, executionId, since: new Date(this.host.now()).toISOString(), queue: this.s.lock.queue.filter((q) => q !== plan.incidentId) };
    const inc = await this.incidentGet(plan.incidentId);
    inc.status = 'running';
    this.log(run, 'You approved plan ' + shortHash(plan.binding.planHash), 'ok');
    this.log(run, 'Repair lock taken · updates paused');
    const active = plan.steps.filter((x) => !x.removedReason);
    this.s.journal = {
      executionId, incidentId: plan.incidentId, planId: plan.id, state: 'APPROVED', reason: 'Repair in progress', completedSteps: [], pendingSteps: active.map((x) => x.id),
      unknownSteps: [], savedAt: new Date(this.host.now()).toISOString(), rechecks: [], memo: this.ctxFor(plan, executionId).memo, fingerprint: {},
    };
    await this.save();
    this.emitRun(run);
    void this.execute(run, plan).catch(async (e) => {
      run.state = 'RECOVERY_REQUIRED';
      run.error = err('E_ACTION_INTERRUPTED', 'A step didn’t finish', 'The repair stopped part-way.', 'Resume', { detail: String(e) });
      if (this.s.journal) { this.s.journal.state = 'RECOVERY_REQUIRED'; this.s.journal.reason = 'Unexpected error: ' + String(e); }
      await this.save();
      this.emitRun(run);
    });
    return run;
  }

  private async setState(run: RunProgress, state: JournalState) {
    run.state = state;
    if (this.s.journal && this.s.journal.executionId === run.executionId) {
      this.s.journal.state = state;
      this.s.journal.savedAt = new Date(this.host.now()).toISOString();
    }
    await this.save(); // journal is durable before the next mutation (spec §14)
    this.emitRun(run);
  }

  private waitFor(executionId: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.waiters.delete(executionId); resolve('timeout'); }, timeoutMs);
      this.waiters.set(executionId, (d) => { clearTimeout(t); this.waiters.delete(executionId); resolve(d); });
    });
  }

  private async execute(run: RunProgress, plan: Plan) {
    const j = this.s.journal!;
    const ctx: StepContext = { incidentId: plan.incidentId, planId: plan.id, executionId: run.executionId, memo: j.memo };
    const steps = plan.steps.filter((x) => !x.removedReason);
    await this.setState(run, 'PRECONDITION_CHECK');
    j.fingerprint = await this.dataset.fingerprint(steps, ctx);
    await this.setState(run, 'READY');
    let adminGranted = false;
    const driftAt = steps.length > 1 ? steps.length - 1 : 0;
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const rs = run.steps.find((x) => x.id === st.id)!;
      if (rs.state === 'done') continue;
      run.stepIndex = i;
      if (st.privilege === 'admin' && !adminGranted) {
        run.adminPrompt = 'waiting';
        this.log(run, 'Waiting for the Windows admin prompt (UAC)…');
        this.emitRun(run);
        const d = await this.waitFor(run.executionId, 120000);
        if (d !== 'admin-allow') {
          run.adminPrompt = d === 'timeout' ? 'timeout' : 'declined';
          run.error = err('E_POLICY_DENIED', d === 'timeout' ? 'The admin prompt timed out' : 'You declined the admin prompt', 'Nothing changed.', 'Run the steps that don’t need admin, or try again.');
          steps.slice(i).forEach((x) => { const r = run.steps.find((y) => y.id === x.id)!; if (r.state === 'pending') r.state = 'not_run'; });
          this.log(run, run.error.headline + ' · nothing changed', 'warn');
          return this.finish(run, plan, 'CANCELLED');
        }
        adminGranted = true;
        run.adminPrompt = null;
        this.log(run, 'Admin helper started · signature valid · request matches the approved plan', 'ok');
      }
      // Drift (spec §7/§15): compare the fingerprint of relevant state right before the step.
      const now = await this.dataset.fingerprint(steps, ctx);
      let drift = this.dataset.drift?.(j.fingerprint, now) ?? diffFingerprint(j.fingerprint, now);
      if (this.s.fault === 'drift' && i === driftAt) drift = [{ id: 'd1', what: 'User PATH', before: j.fingerprint['User PATH'] ?? 'hash:4b1e09ac', after: 'hash:9f02c7d1 · 1 entry added', source: 'Another installer (Node.js 22 MSI) ran at ' + new Date(this.host.now()).toLocaleTimeString() }];
      if (drift.length) {
        run.drift = drift;
        run.notRunStep = `Step ${i + 1} · ${st.title}`;
        run.error = err('E_DRIFT_DETECTED', 'Paused — your PC changed mid-repair', `Step ${i + 1} (${st.title}) did not run.`, 'Look again');
        rs.state = 'not_run';
        steps.slice(i + 1).forEach((x) => { run.steps.find((y) => y.id === x.id)!.state = 'not_run'; });
        this.log(run, 'Unexpected change: ' + drift.map((x) => x.what).join(', ') + ' · approval cancelled', 'error');
        this.addHistory('drift', 'Drift detected during ' + run.executionId, drift.map((x) => `${x.what}: ${x.before} → ${x.after}`).join('; '), plan.incidentId, 'engine');
        const ap = plan.binding.approvalId ? this.s.approvals[plan.binding.approvalId] : undefined;
        if (ap) ap.cancelled = true;
        return this.finish(run, plan, 'BLOCKED');
      }
      // TOCTOU re-check immediately before mutation (spec §6).
      const pre = await this.dataset.precheck(st, ctx);
      const bad = pre.find((p) => !p.ok);
      if (bad) {
        run.error = err('E_PRECONDITION_FAILED', `Stopped before step ${i + 1}`, `${st.title} did not run.`, 'Re-diagnose', { detail: bad.label });
        rs.state = 'not_run';
        this.log(run, `Precondition failed: ${bad.label}`, 'error');
        return this.finish(run, plan, 'BLOCKED');
      }
      if (i === 0) this.log(run, 'Final check passed · nothing changed since approval', 'ok');
      rs.state = 'running';
      j.currentStepId = st.id;
      await this.setState(run, 'EXECUTING');
      const out = st.undoOf && this.dataset.undo ? await this.dataset.undo(st, ctx) : await this.dataset.execute(st, ctx);
      j.currentStepId = undefined;
      if (!out.ok) {
        rs.state = 'failed';
        rs.exitInfo = out.info;
        run.error = err(out.errorCode === 'E_PRECONDITION_FAILED' ? 'E_PRECONDITION_FAILED' : 'E_ACTION_FAILED', `Step ${i + 1} didn’t finish`, 'Later steps did not run.', 'See what happened', { detail: out.info });
        steps.slice(i + 1).forEach((x) => { run.steps.find((y) => y.id === x.id)!.state = 'not_run'; });
        this.log(run, `Step ${i + 1} failed · ${out.info}`, 'error');
        return this.finish(run, plan, 'FAILED');
      }
      rs.state = 'done';
      rs.exitInfo = out.info;
      j.completedSteps.push(st.id);
      j.pendingSteps = j.pendingSteps.filter((x) => x !== st.id);
      this.log(run, `Step ${i + 1} done · ${out.info}`, 'ok');
      await this.save();
      this.emitRun(run);
      if (st.reboot && i < steps.length - 1) {
        // Durable BEFORE asking for the restart (AC-19).
        j.reason = 'Waiting for the restart you approved.';
        await this.setState(run, 'WAITING_FOR_REBOOT');
        this.log(run, 'State saved · restart needed to continue', 'warn');
        run.error = err('E_REBOOT_REQUIRED', 'Restart needed to continue', 'Nothing else has run yet.', 'Restart now');
        this.emitRun(run);
        const d = await this.waitFor(run.executionId, 24 * 3600 * 1000);
        if (d === 'restart-now') {
          j.reason = 'Your PC restarted as planned. The approval ended with the restart.';
          this.log(run, 'Restarting…', 'info');
          await this.host.simulateReboot?.();
          for (const a of Object.values(this.s.approvals)) a.cancelled = true;
          await this.save();
          this.emitRun(run);
        }
        return; // the journal stays open; the Resume screen takes over after restart
      }
    }
    await this.setState(run, 'EXECUTED');
    this.log(run, 'All steps ran. Exit codes are information, not proof — checking that it worked…');
    await this.setState(run, 'VERIFYING');
    let failed = 0;
    const learned: string[] = [];
    for (let k = 0; k < run.verification.length; k++) {
      const v = run.verification[k];
      v.state = 'running';
      this.emitRun(run);
      const res = await this.dataset.verify(plan.verification[k], ctx);
      const forcedFail = this.s.fault === 'partial' && k === run.verification.length - 1;
      v.state = res.pass && !forcedFail ? 'pass' : 'fail';
      v.detail = forcedFail ? 'The original failing test still fails.' : res.detail;
      if (v.state === 'fail') { failed++; learned.push(v.detail ?? v.label); }
      this.log(run, `${v.label} · ${v.state === 'pass' ? 'passed' : 'failed'}`, v.state === 'pass' ? 'ok' : 'error');
      this.emitRun(run);
    }
    if (failed) {
      run.error = err('E_VERIFICATION_FAILED', 'Partly fixed', `${failed} of ${run.verification.length} checks didn’t pass, so this isn’t marked fixed.`, 'Next plan');
      const inc = await this.incidentGet(plan.incidentId);
      inc.learned = learned;
      return this.finish(run, plan, 'PARTIALLY_VERIFIED');
    }
    if (plan.verification.some((v) => v.tier === 'V5')) run.watch = { until: new Date(this.host.now() + 48 * 3600e3).toISOString(), label: 'Quietly watching for 48 h' };
    else run.watch = { until: new Date(this.host.now() + 24 * 3600e3).toISOString(), label: 'We’ll re-check quietly tomorrow' };
    return this.finish(run, plan, 'VERIFIED');
  }

  private async finish(run: RunProgress, plan: Plan, state: JournalState) {
    const inc = await this.incidentGet(plan.incidentId);
    inc.updatedAt = new Date(this.host.now()).toISOString();
    inc.status = state === 'VERIFIED' ? 'verified' : state === 'PARTIALLY_VERIFIED' ? 'partially_verified' : state === 'BLOCKED' ? 'blocked' : state === 'CANCELLED' || state === 'FAILED' ? 'open' : inc.status;
    if (state === 'VERIFIED') {
      for (const p of this.s.pillars) for (const r of p.rows) if (r.incidentId === inc.id) { r.status = 'ok'; r.note = 'Fixed · verified'; }
      for (const p of this.s.projects) for (const r of p.requirements) if (r.incidentId === inc.id) { r.status = 'ok'; r.have = 'fixed · verified'; }
      for (const p of this.s.projects) if (!p.requirements.some((r) => r.status !== 'ok')) p.status = 'ok';
    }
    plan.status = 'executed';
    this.s.journal = null;
    this.s.lock = { held: false, queue: this.s.lock.queue };
    if (state === 'VERIFIED') this.log(run, 'Incident verified · lock released', 'ok');
    else this.log(run, 'Lock released', 'info');
    this.addHistory(state === 'VERIFIED' || state === 'PARTIALLY_VERIFIED' ? 'verification' : 'action', `${inc.id} ${state === 'VERIFIED' ? 'verified' : state.toLowerCase().replace(/_/g, ' ')}`, run.activity.slice(-2).map((a) => a.text).join(' · '), inc.id, 'engine');
    await this.setState(run, state);
  }

  async runDecide(executionId: string, decision: string): Promise<RunProgress> {
    await this.ready;
    const run = Object.values(this.s.runs).find((r) => r.executionId === executionId) ?? fail(err('E_NOT_FOUND', 'That repair isn’t known', 'Nothing changed.'));
    const w = this.waiters.get(executionId);
    if (['admin-allow', 'admin-decline', 'restart-now', 'later'].includes(decision)) {
      if (!w) fail(err('E_INVALID_REQUEST', 'Nothing is waiting for that answer', 'Nothing changed.'));
      if (decision === 'later') {
        this.log(run!, 'Restart postponed · the journal stays saved until you restart', 'info');
        this.emitRun(run!);
        return run!;
      }
      w!(decision);
      await this.host.sleep(10);
      return run!;
    }
    const inc = await this.incidentGet(run!.incidentId);
    if (decision === 'cancel') {
      if (run!.state !== 'APPROVED' || !run!.queuedBehind) fail(err('E_INVALID_REQUEST', 'Only a queued repair can be cancelled here', 'Nothing changed.'));
      run!.state = 'CANCELLED';
      run!.queuedBehind = undefined;
      run!.error = undefined;
      this.s.lock.queue = this.s.lock.queue.filter((q) => q !== inc.id);
      inc.status = 'open';
      this.log(run!, 'Cancelled · nothing ran', 'info');
    } else if (decision === 'keep') {
      inc.status = run!.state === 'VERIFIED' ? 'verified' : 'partially_verified';
      this.log(run!, 'Kept as is · incident stays open as partly fixed', 'info');
    } else if (decision === 'relook') {
      inc.status = 'open';
      inc.stale = false;
      inc.evidenceSnapshot = 'ES-' + sha256(inc.id + this.host.now()).slice(0, 4);
      for (const p of Object.values(this.s.plans)) if (p.incidentId === inc.id && p.status === 'draft') p.status = 'superseded';
      this.log(run!, 'Evidence re-collected · a new plan is needed', 'info');
    } else if (decision === 'undo') {
      this.log(run!, 'Undo plan requested — it needs its own approval', 'info');
    }
    inc.updatedAt = new Date(this.host.now()).toISOString();
    this.addHistory('action', 'Decision: ' + decision, inc.id + ' · ' + run!.executionId, inc.id, 'you');
    await this.save();
    this.emitRun(run!);
    return run!;
  }

  // ───────────────────────────── recovery (screen 11) ─────────────────────────────

  async recoveryGet(): Promise<RecoveryJournal | null> {
    await this.ready;
    const j = this.s.journal;
    if (!j) return null;
    const boot = await this.host.bootId();
    const plan = this.s.plans[j.planId];
    // A journal waiting for a restart only needs the Resume screen once the restart happened.
    if (j.state === 'WAITING_FOR_REBOOT' && plan && plan.binding.bootId === boot && this.waiters.has(j.executionId)) return null;
    const { memo: _m, fingerprint: _f, currentStepId: _c, ...pub } = j;
    return pub;
  }

  async recoveryRecheck(): Promise<RecoveryJournal> {
    await this.ready;
    const j = this.s.journal ?? fail(err('E_NOT_FOUND', 'There’s no unfinished repair', 'Nothing to resume.'));
    const plan = await this.planGet(j!.planId);
    const labels = this.dataset.mode === 'demo' && j!.incidentId === 'INC-0043'
      ? ['Restart was the one we planned', 'Restore point from 10:14 still exists', 'Clean driver package unchanged', 'Same GPU as diagnosed', 'Nothing else changed while restarting', 'No other repair is running']
      : ['A restart or stop was detected — the old approval has ended', 'Completed steps are still in place', 'Nothing relevant changed while stopped', 'No other repair is running'];
    j!.rechecks = labels.map((label) => ({ label, state: 'pending' }));
    for (const r of j!.rechecks) { r.state = 'running'; await this.host.sleep(250); r.state = 'pass'; }
    if (j!.unknownSteps.length) {
      const ctx: StepContext = { incidentId: j!.incidentId, planId: j!.planId, executionId: j!.executionId, memo: j!.memo };
      const now = await this.dataset.fingerprint(plan.steps, ctx);
      const changed = diffFingerprint(j!.fingerprint, now);
      if (changed.length) {
        j!.completedSteps.push(...j!.unknownSteps);
        j!.rechecks.push({ label: 'The interrupted step did change the PC — counted as done', state: 'pass' });
      } else {
        j!.pendingSteps.unshift(...j!.unknownSteps);
        j!.rechecks.push({ label: 'The interrupted step made no change — it will be offered again', state: 'pass' });
      }
      j!.unknownSteps = [];
    }
    await this.save();
    const { memo: _m, fingerprint: _f, currentStepId: _c, ...pub } = j!;
    return pub;
  }

  async recoveryResolve(decision: 'continue' | 'stop') {
    await this.ready;
    const j = this.s.journal ?? fail(err('E_NOT_FOUND', 'There’s no unfinished repair', 'Nothing to resume.'));
    if (!j!.rechecks.length || j!.rechecks.some((r) => r.state !== 'pass')) fail(err('E_RECOVERY_UNKNOWN', 'We can’t tell yet what state the PC is in', 'Nothing will run.', 'Check again'));
    const plan = await this.planGet(j!.planId);
    const inc = await this.incidentGet(j!.incidentId);
    const run = this.s.runs[inc.id];
    this.s.journal = null;
    this.s.lock = { held: false, queue: this.s.lock.queue };
    if (decision === 'stop') {
      inc.status = 'open';
      if (run) { run.state = 'CANCELLED'; this.log(run, 'Stopped after restart · completed steps stay in place', 'info'); }
      this.addHistory('recovery', 'Repair stopped after restart', `${j!.completedSteps.length} steps done · ${j!.pendingSteps.length} not run`, inc.id, 'you');
      await this.save();
      return { incidentId: inc.id };
    }
    const remaining = plan.steps.filter((x) => !x.removedReason && j!.pendingSteps.includes(x.id));
    if (!remaining.length) {
      inc.status = 'open';
      await this.save();
      return { incidentId: inc.id };
    }
    // Rule 4: restart ends approval — the remaining steps become a new plan that must be approved again.
    const cont = await this.materialise(inc, { title: plan.title.replace(/^Guided repair · /, 'Continue · '), kind: plan.kind, steps: remaining, verification: plan.verification, estimatedMinutes: Math.max(1, Math.round(plan.estimatedMinutes / 2)) }, 'resume', { resumeOf: plan.id });
    inc.planId = cont.id;
    inc.status = 'planned';
    if (run) { run.state = 'CANCELLED'; this.log(run, 'Restart handled · remaining steps need a fresh approval', 'info'); }
    this.addHistory('recovery', 'Resumed after restart', `Re-checked ${j!.rechecks.length} conditions · ${remaining.length} steps need approval again`, inc.id, 'you');
    await this.save();
    return { incidentId: inc.id, planId: cont.id };
  }

  // ───────────────────────────── evidence / other reads ─────────────────────────────

  async evidenceList(incidentId?: string) {
    await this.ready;
    return Object.values(this.s.evidence).filter((e) => !incidentId || e.incidentIds.includes(incidentId));
  }
  async evidenceGet(id: string) {
    await this.ready;
    return this.s.evidence[id] ?? fail(err('E_NOT_FOUND', 'Evidence ' + id + ' wasn’t found', 'Nothing changed.'));
  }
  async redaction(incidentId: string) {
    const inc = await this.incidentGet(incidentId);
    return this.dataset.redaction(inc, await this.evidenceList());
  }
  async projectsList() { await this.ready; return this.s.projects; }
  async projectGet(id: string) {
    await this.ready;
    return this.s.projects.find((p) => p.id === id) ?? fail(err('E_NOT_FOUND', 'Project wasn’t found', 'Nothing changed.'));
  }
}

function diffFingerprint(a: Record<string, string>, b: Record<string, string>) {
  return Object.keys(a).filter((k) => b[k] !== undefined && a[k] !== b[k]).map((k, i) => ({ id: 'd' + i, what: k, before: a[k], after: b[k], source: 'Detected outside Environment Doctor' }));
}

export function toResult<T>(p: Promise<T>): Promise<Result<T>> {
  return p.then((data) => ({ ok: true as const, data }), (e) => ({ ok: false as const, error: e instanceof EngineError ? e.api : { code: 'E_ACTION_FAILED' as const, headline: 'Something went wrong', didNotHappen: 'Nothing changed.', detail: String(e?.message ?? e) } }));
}
