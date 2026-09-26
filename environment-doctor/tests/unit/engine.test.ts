/** Orchestrator safety rules (spec §5, §7, §8, §14, §24) against the demo dataset. */
import { describe, expect, it } from 'vitest';
import type { Channel, Req, Res, RunProgress, Streams } from '../../src/shared/contracts';
import { UI_CONFIRMATION_VERSION } from '../../src/shared/contracts';
import { Orchestrator } from '../../src/engine/orchestrator';
import { DemoDataset } from '../../src/engine/demo/fixtures';
import type { Host } from '../../src/engine/engine';

function makeHost() {
  const store = new Map<string, string>();
  let boot = 'boot-1';
  const listeners: ((s: string, d: unknown) => void)[] = [];
  let now = Date.now();
  const host: Host & { advance(ms: number): void; on(cb: (s: string, d: unknown) => void): void } = {
    sleep: () => new Promise((r) => setTimeout(r, 0)),
    now: () => now,
    bootId: async () => boot,
    simulateReboot: async () => { boot = 'boot-' + Math.random(); },
    load: async (k) => (store.has(k) ? { value: JSON.parse(store.get(k)!) } : null),
    save: async (k, v) => { store.set(k, JSON.stringify(v)); },
    emit: <S extends keyof Streams>(s: S, d: Streams[S]) => listeners.forEach((l) => l(s, d)),
    online: async () => true,
    advance: (ms) => { now += ms; },
    on: (cb) => { listeners.push(cb); },
  };
  return host;
}

function setup() {
  const host = makeHost();
  const o = new Orchestrator({ host, datasets: { demo: () => new DemoDataset({ sleep: host.sleep }) }, defaultMode: 'demo' });
  async function call<C extends Channel>(c: C, r?: Req<C>): Promise<Res<C>> {
    const res = await o.handle(c, r as Req<C>);
    if (!res.ok) throw Object.assign(new Error(res.error.code + ': ' + res.error.headline), { api: res.error });
    return res.data;
  }
  async function callErr<C extends Channel>(c: C, r?: Req<C>) {
    const res = await o.handle(c, r as Req<C>);
    if (res.ok) throw new Error('expected error from ' + c);
    return res.error;
  }
  const waitRun = (incidentId: string, pred: (r: RunProgress) => boolean) => new Promise<RunProgress>((resolve) => {
    const check = async () => { const r = await call('run.get', { incidentId }); if (r && pred(r)) resolve(r); else setTimeout(check, 5); };
    void check();
  });
  async function scan() {
    const { scanId } = await call('scan.start', { scopes: ['pc', 'dev', 'proj'] });
    for (;;) { const s = await call('scan.get'); if (s && s.scanId === scanId && s.state !== 'running') return s; await new Promise((r) => setTimeout(r, 5)); }
  }
  return { host, o, call, callErr, waitRun, scan };
}

async function approve(t: ReturnType<typeof setup>, incidentId: string, variant?: Req<'plan.forIncident'>['variant']) {
  const plan = await t.call('plan.forIncident', { incidentId, variant });
  const ap = await t.call('approval.submit', { planId: plan.id, planHash: plan.binding.planHash, uiConfirmationVersion: UI_CONFIRMATION_VERSION, acknowledged: true });
  return { plan, ap };
}

describe('engine', () => {
  it('first run: nothing scanned, then a scan fills health and incidents', async () => {
    const t = setup();
    expect((await t.call('health.get')).lastScanAt).toBeUndefined();
    const s = await t.scan();
    expect(s.state).toBe('complete');
    const h = await t.call('health.get');
    expect(h.pillars).toHaveLength(3);
    expect((await t.call('incidents.list')).map((i) => i.id)).toContain('INC-0042');
  });

  it('AC-03: stopping a scan leaves unchecked items unknown, never healthy', async () => {
    const t = setup();
    const { scanId } = await t.call('scan.start', { scopes: ['pc', 'dev', 'proj'] });
    const s = await t.call('scan.stop', { scanId });
    expect(s.headline).toMatch(/Scan stopped/);
    expect(s.items.filter((i) => i.state !== 'done').every((i) => i.status === 'unknown')).toBe(true);
    const h = await t.call('health.get');
    expect(h.unknownCount).toBeGreaterThan(0);
  });

  it('AC-07/08/13: approval needs acknowledgement; final check listed; verified only after all checks', async () => {
    const t = setup();
    await t.scan();
    const plan = await t.call('plan.forIncident', { incidentId: 'INC-0042' });
    expect(plan.requiresAdmin).toBe(true);
    const e = await t.callErr('approval.submit', { planId: plan.id, planHash: plan.binding.planHash, uiConfirmationVersion: UI_CONFIRMATION_VERSION, acknowledged: false });
    expect(e.code).toBe('E_APPROVAL_MISMATCH');
    const ap = await t.call('approval.submit', { planId: plan.id, planHash: plan.binding.planHash, uiConfirmationVersion: UI_CONFIRMATION_VERSION, acknowledged: true });
    expect(ap.finalCheck.length).toBeGreaterThan(0);
    const run = await t.call('run.start', { approvalId: ap.approvalId, planHash: ap.planHash });
    const waiting = await t.waitRun('INC-0042', (r) => r.adminPrompt === 'waiting');
    await t.call('run.decide', { executionId: waiting.executionId, decision: 'admin-allow' });
    const seen: string[] = [];
    t.host.on((s, d) => { if (s === 'run.progress') seen.push((d as RunProgress).state); });
    const done = await t.waitRun('INC-0042', (r) => ['VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'BLOCKED'].includes(r.state));
    expect(done.state).toBe('VERIFIED');
    expect(done.verification.every((v) => v.state === 'pass')).toBe(true);
    expect(seen.indexOf('VERIFYING')).toBeLessThan(seen.indexOf('VERIFIED'));
    expect(run.executionId).toBe(done.executionId);
    expect((await t.call('lock.get')).held).toBe(false);
    expect((await t.call('incident.get', { id: 'INC-0042' })).status).toBe('verified');
  });

  it('AC-09: an approval older than 15 minutes runs nothing', async () => {
    const t = setup();
    await t.scan();
    const { ap } = await approve(t, 'INC-0041');
    t.host.advance(16 * 60 * 1000);
    const e = await t.callErr('run.start', { approvalId: ap.approvalId, planHash: ap.planHash });
    expect(e.code).toBe('E_APPROVAL_EXPIRED');
    expect(await t.call('run.get', { incidentId: 'INC-0041' })).toBeNull();
  });

  it('AC-10: a plan changed after approval is rejected and a new plan offered', async () => {
    const t = setup();
    await t.scan();
    await t.call('demo.fault', { fault: 'mutatePlan' });
    const { ap } = await approve(t, 'INC-0041');
    const e = await t.callErr('run.start', { approvalId: ap.approvalId, planHash: ap.planHash });
    expect(e.code).toBe('E_APPROVAL_MISMATCH');
    expect(e.ref).toBeTruthy();
    const fresh = await t.call('plan.get', { id: e.ref! });
    expect(fresh.status).toBe('draft');
  });

  it('AC-20 (engine): restart invalidates approvals', async () => {
    const t = setup();
    await t.scan();
    const { ap } = await approve(t, 'INC-0041');
    await t.host.simulateReboot!();
    const e = await t.callErr('run.start', { approvalId: ap.approvalId, planHash: ap.planHash });
    expect(e.code).toBe('E_APPROVAL_EXPIRED');
  });

  it('AC-11: declining the admin prompt changes nothing and offers the user-level steps', async () => {
    const t = setup();
    await t.scan();
    const { ap } = await approve(t, 'INC-0042');
    await t.call('run.start', { approvalId: ap.approvalId, planHash: ap.planHash });
    const w = await t.waitRun('INC-0042', (r) => r.adminPrompt === 'waiting');
    await t.call('run.decide', { executionId: w.executionId, decision: 'admin-decline' });
    const r = await t.waitRun('INC-0042', (x) => x.state === 'CANCELLED');
    expect(r.steps.every((s) => s.state !== 'done')).toBe(true);
    const userOnly = await t.call('plan.forIncident', { incidentId: 'INC-0042', variant: 'user-only' });
    expect(userOnly.steps.every((s) => s.privilege === 'user')).toBe(true);
  });

  it('AC-12: helper signature mismatch pauses all repairs', async () => {
    const t = setup();
    await t.scan();
    await t.call('demo.fault', { fault: 'helperUntrusted' });
    const { ap } = await approve(t, 'INC-0042');
    const r = await t.call('run.start', { approvalId: ap.approvalId, planHash: ap.planHash });
    expect(r.state).toBe('BLOCKED');
    expect(r.error?.code).toBe('E_HELPER_UNTRUSTED');
    expect((await t.call('health.get')).banner?.kind).toBe('helper-untrusted');
  });

  it('AC-14: a second repair while the lock is held is queued, not an error', async () => {
    const t = setup();
    await t.scan();
    const a = await approve(t, 'INC-0042');
    await t.call('run.start', { approvalId: a.ap.approvalId, planHash: a.ap.planHash });
    await t.waitRun('INC-0042', (r) => r.adminPrompt === 'waiting');
    const b = await approve(t, 'INC-0041');
    const q = await t.call('run.start', { approvalId: b.ap.approvalId, planHash: b.ap.planHash });
    expect(q.queuedBehind).toBe('INC-0042');
    expect(q.error?.code).toBe('E_MUTATION_BUSY');
  });

  it('AC-15: drift stops the repair and names the step that did not run', async () => {
    const t = setup();
    await t.scan();
    await t.call('demo.fault', { fault: 'drift' });
    const { ap } = await approve(t, 'INC-0042');
    await t.call('run.start', { approvalId: ap.approvalId, planHash: ap.planHash });
    const w = await t.waitRun('INC-0042', (r) => r.adminPrompt === 'waiting');
    await t.call('run.decide', { executionId: w.executionId, decision: 'admin-allow' });
    const r = await t.waitRun('INC-0042', (x) => x.state === 'BLOCKED');
    expect(r.error?.code).toBe('E_DRIFT_DETECTED');
    expect(r.notRunStep).toMatch(/Step 2/);
    expect(r.steps[1].state).toBe('not_run');
  });

  it('AC-16: a failing check ends PARTIALLY_VERIFIED with what was learned, then a next plan', async () => {
    const t = setup();
    await t.scan();
    const { ap } = await approve(t, 'INC-0044');
    await t.call('run.start', { approvalId: ap.approvalId, planHash: ap.planHash });
    const w = await t.waitRun('INC-0044', (r) => r.adminPrompt === 'waiting');
    await t.call('run.decide', { executionId: w.executionId, decision: 'admin-allow' });
    const r = await t.waitRun('INC-0044', (x) => TERMINAL(x));
    expect(r.state).toBe('PARTIALLY_VERIFIED');
    const inc = await t.call('incident.get', { id: 'INC-0044' });
    expect(inc.status).toBe('partially_verified');
    expect(inc.learned?.length).toBeGreaterThan(0);
    const next = await t.call('plan.forIncident', { incidentId: 'INC-0044', next: true });
    expect(next.requiresAdmin).toBe(false);
  });

  it('AC-19/20: guided repair saves WAITING_FOR_REBOOT before the restart, then resume needs a new approval', async () => {
    const t = setup();
    await t.scan();
    const { ap } = await approve(t, 'INC-0043');
    await t.call('run.start', { approvalId: ap.approvalId, planHash: ap.planHash });
    const w = await t.waitRun('INC-0043', (r) => r.adminPrompt === 'waiting');
    await t.call('run.decide', { executionId: w.executionId, decision: 'admin-allow' });
    const r = await t.waitRun('INC-0043', (x) => x.state === 'WAITING_FOR_REBOOT');
    expect(r.steps.filter((s) => s.state === 'done')).toHaveLength(3);
    await t.call('run.decide', { executionId: r.executionId, decision: 'restart-now' });
    const j = await t.call('recovery.get');
    expect(j?.state).toBe('WAITING_FOR_REBOOT');
    const e = await t.callErr('recovery.resolve', { decision: 'continue' });
    expect(e.code).toBe('E_RECOVERY_UNKNOWN');
    const checked = await t.call('recovery.recheck');
    expect(checked.rechecks.every((c) => c.state === 'pass')).toBe(true);
    const res = await t.call('recovery.resolve', { decision: 'continue' });
    const cont = await t.call('plan.get', { id: res.planId! });
    expect(cont.status).toBe('draft');
    expect(cont.steps.map((s) => s.title)).toEqual(['Remove the current driver', 'Install the clean driver', 'Restart normally']);
    expect(await t.call('recovery.get')).toBeNull();
  });

  it('AC-25: locked settings cannot change', async () => {
    const t = setup();
    const e = await t.callErr('settings.set', { path: 'privacy.redactSecrets', value: false });
    expect(e.code).toBe('E_POLICY_DENIED');
    expect((await t.call('settings.get')).privacy.redactSecrets).toBe(true);
  });

  it('audit chain is intact and detects tampering', async () => {
    const t = setup();
    await t.scan();
    expect((await t.call('history.list')).integrity).toBe('ok');
  });

  it('rejects unknown channels and malformed payloads', async () => {
    const t = setup();
    const r = await t.o.handle('nope' as Channel, undefined as never);
    expect(r.ok).toBe(false);
    const e = await t.callErr('incident.get', { id: 42 as unknown as string });
    expect(e.code).toBe('E_INVALID_REQUEST');
  });
});

const TERMINAL = (r: RunProgress) => ['VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(r.state);
