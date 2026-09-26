/** Shared helpers for the screen/flow layer. The browser build runs the demo orchestrator in-process. */
import { expect, type Page } from '@playwright/test';
import type { Fault } from '../../src/shared/contracts';

/** Fresh demo state, fast timers (speed × 20). Lands on the given hash route. */
export async function open(page: Page, route = '/', opts: { scanned?: boolean; fault?: Fault } = {}) {
  await page.goto('/?speed=20#/welcome');
  await page.evaluate(async () => { await window.__envDoctorDemo!.reset(); });
  if (opts.scanned !== false) {
    await page.evaluate(async () => {
      const o = window.__envDoctorDemo!.orchestrator;
      const r = await o.handle('scan.start', { scopes: ['pc', 'dev', 'proj'] });
      if (!r.ok) throw new Error(r.error.headline);
      for (;;) {
        const s = await o.handle('scan.get', undefined);
        if (s.ok && s.data && s.data.state !== 'running') break;
        await new Promise((res) => setTimeout(res, 20));
      }
    });
  }
  if (opts.fault) await fault(page, opts.fault);
  await page.goto('/?speed=20#' + route);
  await page.reload();
  await expect(page.locator('#root')).not.toBeEmpty();
}

export async function fault(page: Page, f: Fault) {
  await page.evaluate(async (x) => { await window.__envDoctorDemo!.fault(x); }, f);
}

/** Raw orchestrator call from the page (for arranging state, never for asserting UI). */
export async function api<T = unknown>(page: Page, channel: string, req?: unknown): Promise<T> {
  return page.evaluate(async ([c, r]) => {
    const res = await window.__envDoctorDemo!.orchestrator.handle(c as never, r as never);
    if (!res.ok) throw new Error(res.error.code + ' ' + res.error.headline);
    return res.data as unknown;
  }, [channel, req] as const) as Promise<T>;
}
