import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('desktop app boots in live mode with the sandboxed bridge and security baseline', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-electron-'));
  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  const win = await app.firstWindow();
  await expect.poll(() => win.url(), { timeout: 20_000 }).toMatch(/^app:\/\/app\//);
  await win.waitForLoadState('domcontentloaded');

  // Renderer has no Node, only the narrow bridge.
  const probe = await win.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    bridge: typeof window.envDoctor?.invoke,
    keys: Object.keys(window.envDoctor ?? {}).sort(),
  }));
  expect(probe).toEqual({ require: 'undefined', process: 'undefined', bridge: 'function', keys: ['invoke', 'platform', 'subscribe'] });

  const info = await win.evaluate(async () => window.envDoctor!.invoke('app.info', undefined));
  expect(info.ok && info.data.mode).toBe('live');

  // Unknown channels are refused by the preload allowlist.
  const bad = await win.evaluate(async () => window.envDoctor!.invoke('nope' as never, undefined as never));
  expect(bad.ok).toBe(false);

  // First launch → First run screen.
  await expect(win.locator('#root')).not.toBeEmpty();
  await expect.poll(async () => win.evaluate(() => location.hash)).toContain('/welcome');

  // A real read-only scan completes through IPC + streams.
  const scanned = await win.evaluate(async () => {
    const b = window.envDoctor!;
    const r = await b.invoke('scan.start', { scopes: ['dev'] });
    if (!r.ok) return r.error.headline;
    for (let i = 0; i < 300; i++) {
      const s = await b.invoke('scan.get', undefined);
      if (s.ok && s.data && s.data.state !== 'running') return s.data.state;
      await new Promise((res) => setTimeout(res, 200));
    }
    return 'timeout';
  });
  expect(scanned).toBe('complete');

  // Navigation away from app:// is blocked.
  await win.evaluate(() => { location.href = 'https://example.com/'; });
  await win.waitForTimeout(500);
  expect(win.url()).toMatch(/^app:\/\//);
  await app.close();
});

test('live repair end to end: create a project .venv → verified → undo plan removes it', async () => {
  test.setTimeout(180_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-proj-'));
  const proj = path.join(root, 'demo-py');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'requirements.txt'), 'requests\n');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-electron-'));
  fs.mkdirSync(path.join(userData, 'state'));
  fs.writeFileSync(path.join(userData, 'state', 'settings.json'), JSON.stringify({ diagnostics: { projectRoots: [root] } }));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`] });
  const win = await app.firstWindow();
  await expect.poll(() => win.url(), { timeout: 20_000 }).toMatch(/^app:\/\//);
  const result = await win.evaluate(async () => {
    const b = window.envDoctor!;
    const must = async <T,>(p: Promise<{ ok: boolean; data?: T; error?: { headline: string } }>) => { const r = await p; if (!r.ok) throw new Error(r.error!.headline); return r.data as T; };
    await must(b.invoke('scan.start', { scopes: ['proj'] }));
    for (let i = 0; i < 300; i++) { const s = await must(b.invoke('scan.get', undefined)); if (s && s.state !== 'running') break; await new Promise((r) => setTimeout(r, 200)); }
    const inc = (await must(b.invoke('incidents.list', undefined))).find((i) => /no virtual environment/.test(i.title));
    if (!inc) return { error: 'no venv incident' };
    const run = async (plan: { id: string; binding: { planHash: string } }) => {
      const ap = await must(b.invoke('approval.submit', { planId: plan.id, planHash: plan.binding.planHash, uiConfirmationVersion: 'ui-confirm-3', acknowledged: true }));
      await must(b.invoke('run.start', { approvalId: ap.approvalId, planHash: ap.planHash }));
      for (let i = 0; i < 600; i++) {
        const r = await must(b.invoke('run.get', { incidentId: inc.id }));
        if (r && ['VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(r.state)) return r;
        await new Promise((res) => setTimeout(res, 200));
      }
      return null;
    };
    const fix = await run(await must(b.invoke('plan.forIncident', { incidentId: inc.id })));
    const undo = await run(await must(b.invoke('plan.forIncident', { incidentId: inc.id, variant: 'undo' })));
    return { fix: fix?.state, fixChecks: fix?.verification.map((v) => v.state), undo: undo?.state };
  });
  const afterUndo = fs.existsSync(path.join(proj, '.venv'));
  await app.close();
  expect(result).toEqual({ fix: 'VERIFIED', fixChecks: ['pass', 'pass'], undo: 'VERIFIED' });
  expect(afterUndo).toBe(false);
});
