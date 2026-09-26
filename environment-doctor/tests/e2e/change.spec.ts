/** Change path — boards 06 Plan, 07 Execute, 10 Guided, 11 Resume, 15 Drift, 26 Admin hand-off. */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { api, open } from './helpers';
import type { Fault, RunProgress } from '../../src/shared/contracts';

const PLAN = '/incidents/INC-0042/plan';

async function reviewAndApprove(page: Page) {
  await expect(page.getByRole('heading', { name: 'Here’s the fix' })).toBeVisible();
  await page.getByRole('checkbox', { name: /I understand step 1 needs admin rights/ }).check();
  await page.getByRole('button', { name: 'Approve plan' }).click();
  await expect(page.getByRole('heading', { name: 'Approved — final check passed' })).toBeVisible();
}

async function approveAndRun(page: Page, fault?: Fault) {
  await open(page, PLAN, fault ? { fault } : {});
  await reviewAndApprove(page);
  await page.getByRole('button', { name: 'Run the fix' }).click();
}

const uac = (page: Page) => page.getByRole('dialog', { name: 'Windows is asking for permission' });

async function allowAdmin(page: Page) {
  const sim = uac(page).getByRole('region', { name: 'Simulated Windows prompt — demo mode' });
  await expect(sim).toBeVisible();
  await sim.getByRole('button', { name: 'Yes' }).click();
}

async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
      // Focus is always visible (2 px outline on :focus-visible).
      const outline = await target.evaluate((el) => getComputedStyle(el).outlineWidth);
      expect(parseFloat(outline)).toBeGreaterThan(0);
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('Not reachable with Tab: ' + target.toString());
}

test.describe('06 Plan & approval', () => {
  test('AC-07 plan has an admin step, acknowledgement unticked → Approve is disabled and says why', async ({ page }) => {
    await open(page, PLAN);
    await expect(page.getByRole('heading', { name: 'Here’s the fix' })).toBeVisible();
    const steps = page.getByRole('list', { name: 'Plan steps' });
    await expect(steps.locator(':scope > li')).toHaveCount(2);
    await expect(steps.getByText('Needs admin')).toHaveCount(1);
    await expect(steps.getByText('Your account')).toHaveCount(1);

    // Binding summary is always visible; technical details sit behind one toggle.
    const panel = page.getByRole('region', { name: 'Approval' });
    await expect(panel.getByText('Plan fingerprint')).toBeVisible();
    await expect(panel.getByText('ES-7f3a')).toBeVisible();
    await expect(panel.getByText('15 min or restart, whichever is first')).toBeVisible();
    await expect(panel.getByText('ui-confirm-3')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Show technical details' }).click();
    await expect(panel.getByText('ui-confirm-3')).toBeVisible();
    await expect(panel.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
    await expect(panel.getByText('nvm.symlink.recreate · v1.0.1')).toBeVisible();

    const approve = page.getByRole('button', { name: 'Approve plan' });
    await expect(approve).toBeDisabled();
    await expect(page.getByText('Tick the box above to approve — this plan needs admin rights.')).toBeVisible();
    await expect(approve).toHaveAccessibleDescription(/Tick the box above to approve — this plan needs admin rights/);

    await page.getByRole('checkbox', { name: /I understand step 1 needs admin rights/ }).check();
    await expect(approve).toBeEnabled();
    await expect(page.getByText(/Tick the box above to approve/)).toHaveCount(0);
  });

  test('AC-08 approved, final check runs → confirmation card lists the re-checked conditions before “Run the fix”', async ({ page }) => {
    await open(page, PLAN);
    await reviewAndApprove(page);
    const checks = page.getByRole('list', { name: 'Final check' });
    for (const label of ['Link folder is still missing', 'C:\\nvm4w is not a redirect', 'Node 20.17.0 folder unchanged', 'Meets project needs (≥ 20)', 'Folder still doesn’t exist', 'Old PATH saved for undo']) {
      const row = checks.getByRole('listitem').filter({ hasText: label });
      await expect(row).toBeVisible();
      await expect(row).toContainText('Passed');
    }
    await expect(page.getByRole('timer')).toHaveText(/^1[45]:\d\d$/);
    await expect(page.getByText(/Windows asks for permission/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run the fix' })).toBeEnabled();
    // Nothing has run yet — the final check comes first.
    expect(await api(page, 'run.get', { incidentId: 'INC-0042' })).toBeNull();
    // Back keeps the same approval; approving again returns to the same final check.
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Approve plan' }).click();
    await expect(page.getByRole('button', { name: 'Run the fix' })).toBeVisible();
  });

  test('AC-09 approval older than 15 min, user presses Run → E_APPROVAL_EXPIRED state; nothing runs', async ({ page }) => {
    await open(page, PLAN, { fault: 'expireApproval' });
    const fp = await page.getByRole('region', { name: 'Approval' }).getByTitle(/^[0-9a-f]{64}$/).getAttribute('title');
    await reviewAndApprove(page);
    await page.getByRole('button', { name: 'Run the fix' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'This approval ran out' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Nothing ran.');
    await expect(page).toHaveURL(/\/incidents\/INC-0042\/plan/);
    expect(await api(page, 'run.get', { incidentId: 'INC-0042' })).toBeNull();

    await page.getByRole('button', { name: 'Re-check and review' }).click();
    await expect(page.getByRole('heading', { name: 'Approve this exact plan' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /I understand/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Approve plan' })).toBeDisabled();
    const fp2 = await page.getByRole('region', { name: 'Approval' }).getByTitle(/^[0-9a-f]{64}$/).getAttribute('title');
    expect(fp2).not.toEqual(fp);
  });

  test('AC-10 plan hash changed after approval, user presses Run → E_APPROVAL_MISMATCH; new plan shown for review', async ({ page }) => {
    await approveAndRun(page, 'mutatePlan');
    const alert = page.getByRole('alert').filter({ hasText: 'The plan changed after you approved it · Nothing ran' });
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(/\/incidents\/INC-0042\/plan/);
    expect(await api(page, 'run.get', { incidentId: 'INC-0042' })).toBeNull();
    // The new plan is loaded for review, with the change marked, and needs a fresh approval.
    const changed = page.getByRole('list', { name: 'Plan steps' }).locator(':scope > li').filter({ hasText: 'Changed' });
    await expect(changed).toHaveCount(1);
    await expect(changed).toContainText('(changed)');
    await expect(page.getByRole('heading', { name: 'Approve this exact plan' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /I understand/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Approve plan' })).toBeDisabled();
  });
});

test.describe('26 Admin hand-off', () => {
  test('AC-11 admin prompt shown, user declines → “Nothing changed”; non-admin steps offered separately', async ({ page }) => {
    await approveAndRun(page);
    await expect(page).toHaveURL(/\/incidents\/INC-0042\/run/);
    const dlg = uac(page);
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Environment Doctor admin helper');
    await expect(dlg).toContainText('never asks for your password');
    await dlg.getByRole('region', { name: 'Simulated Windows prompt — demo mode' }).getByRole('button', { name: 'No' }).click();

    const declined = page.getByRole('dialog', { name: /nothing changed/i });
    await expect(declined).toContainText('Nothing changed.');
    const run = await api<RunProgress>(page, 'run.get', { incidentId: 'INC-0042' });
    expect(run.state).toBe('CANCELLED');
    expect(run.steps.every((s) => s.state === 'not_run')).toBe(true);

    await declined.getByRole('link', { name: 'Run only the steps that don’t need admin' }).click();
    await expect(page).toHaveURL(/variant=user-only/);
    const steps = page.getByRole('list', { name: 'Plan steps' });
    await expect(steps.locator(':scope > li')).toHaveCount(1);
    await expect(steps).toContainText('Remove a dead PATH entry');
    await expect(steps.getByText('Your account')).toBeVisible();
    await expect(steps.getByText('Needs admin')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve plan' })).toBeEnabled(); // user-only, low risk: no acknowledgement needed
  });

  test('AC-12 helper signature mismatch, any admin step → red helper-untrusted state; all repairs paused', async ({ page }) => {
    await approveAndRun(page, 'helperUntrusted');
    await expect(page).toHaveURL(/\/incidents\/INC-0042\/run/);
    const dlg = page.getByRole('dialog', { name: 'The admin helper failed a safety check' });
    const alert = dlg.getByRole('alert');
    await expect(alert).toContainText('Stopped — the admin helper failed a safety check');
    await expect(alert).toContainText('All repairs are paused');
    await expect(dlg.getByRole('button', { name: 'Repair the app install' })).toBeVisible();
    await expect(dlg).not.toContainText('Simulated Windows prompt');
    // Repairs are paused app-wide (sidebar guard state), and nothing ran.
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByText('Repairs paused')).toBeVisible();
    const run = await api<RunProgress>(page, 'run.get', { incidentId: 'INC-0042' });
    expect(run.steps.some((s) => s.state === 'done')).toBe(false);
    // Closing the dialog keeps the red state on the page.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('main').getByRole('alert').filter({ hasText: 'All repairs are paused' })).toBeVisible();
  });
});

test.describe('07 Running & verifying', () => {
  test('AC-13 execution done, verification running → “Verified” appears only after every contract check passes', async ({ page }) => {
    await approveAndRun(page);
    await expect(uac(page)).toBeVisible();
    // Sample the page every frame from the moment admin is allowed until the run is verified.
    const sampling = page.evaluate(async () => {
      const out: { h: string; passed: number; total: number; says: boolean }[] = [];
      const t0 = performance.now();
      for (;;) {
        const h = document.querySelector('main h1')?.textContent ?? '';
        const rows = Array.from(document.querySelectorAll('[data-check-state]'));
        const main = document.querySelector('main') as HTMLElement | null;
        out.push({ h, passed: rows.filter((r) => r.getAttribute('data-check-state') === 'pass').length, total: rows.length, says: /\bVerified\b/.test((main?.innerText ?? '').replace(/Verified publisher/g, '')) });
        if (h === 'Fixed and verified' || performance.now() - t0 > 20000) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    });
    await allowAdmin(page);
    const samples = await sampling;
    expect(samples.some((s) => s.h === 'Checking that it worked' && s.passed < s.total)).toBe(true);
    for (const s of samples) {
      if (s.h === 'Fixed and verified' || s.says) expect(s.passed === s.total && s.total === 4, JSON.stringify(s)).toBe(true);
    }
    expect(samples[samples.length - 1].h).toBe('Fixed and verified');

    await expect(page.getByRole('heading', { name: 'Fixed and verified' })).toBeVisible();
    const checks = page.getByRole('list', { name: 'Verification checks' });
    await expect(checks.locator('[data-check-state="pass"]')).toHaveCount(4);
    await expect(checks).toContainText('Noted — but that alone never counts as fixed');
    await expect(page.getByRole('list', { name: 'Steps' })).toContainText('information, not proof it worked');
    await expect(page.getByRole('log', { name: 'Activity' })).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  });

  test('AC-14 another repair holds the lock, second plan approved → queued state (E_MUTATION_BUSY), not an error', async ({ page }) => {
    await approveAndRun(page, 'busy');
    await expect(page).toHaveURL(/\/incidents\/INC-0042\/run/);
    const card = page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'Queued behind INC-0043' }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Nothing has run yet');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(card).not.toHaveClass(/danger|error/);
    const run = await api<RunProgress>(page, 'run.get', { incidentId: 'INC-0042' });
    expect(run.queuedBehind).toBe('INC-0043');
    expect(run.steps.every((s) => s.state === 'pending')).toBe(true);

    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Cancelled — nothing more ran' })).toBeVisible();
  });
});

test.describe('15 PC changed mid-repair', () => {
  test('AC-15 watched state changes mid-run, next step due → step not run; screen names it; approval cancelled', async ({ page }) => {
    await approveAndRun(page, 'drift');
    await allowAdmin(page);
    const alert = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Paused — your PC changed mid-repair' }) });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Did not run: Step 2 · Remove a dead PATH entry');
    await expect(alert).toContainText('The approval was cancelled');
    const row = page.getByRole('row').filter({ hasText: 'User PATH' });
    await expect(row).toContainText('hash:4b1e09ac');
    await expect(row).toContainText('hash:9f02c7d1');
    await expect(row).toContainText('Node.js 22 MSI');

    const run = await api<RunProgress>(page, 'run.get', { incidentId: 'INC-0042' });
    expect(run.state).toBe('BLOCKED');
    expect(run.steps.map((s) => s.state)).toEqual(['done', 'not_run']);

    const group = page.getByRole('radiogroup', { name: 'Next step' });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await expect(group.getByRole('radio', { name: /Look again & re-plan/ })).toHaveAttribute('aria-checked', 'true');
    await group.getByRole('radio', { name: /Build undo plan/ }).click();
    await expect(page.getByRole('button', { name: 'Build undo plan' })).toBeVisible();
    await group.getByRole('radio', { name: /Look again & re-plan/ }).click();
    await page.getByRole('button', { name: 'Look again & re-plan' }).click();
    await expect(page).toHaveURL(/\/incidents\/INC-0042$/);
  });
});

test.describe('10 Guided repair · 11 Resume', () => {
  test('AC-19 step needs restart, user continues → journal saved as WAITING_FOR_REBOOT before restart is requested', async ({ page }) => {
    await open(page, '/incidents/INC-0043/guided');
    const list = page.getByRole('list', { name: 'Guided steps' });
    await expect(list.getByRole('listitem')).toHaveCount(7);
    await expect(list).toContainText('Restart 1 of 2');
    await expect(list).toContainText('Prove it’s fixed');

    await page.getByRole('checkbox', { name: /I understand/ }).check();
    await page.getByRole('button', { name: 'Approve plan' }).click();
    await page.getByRole('button', { name: 'Start guided repair' }).click();
    await allowAdmin(page);

    const card = page.getByRole('region', { name: 'Restart into Safe Mode' });
    await expect(card).toContainText('Progress saved — the journal is WAITING_FOR_REBOOT');
    const restart = card.getByRole('button', { name: 'Restart into Safe Mode' });
    await expect(restart).toBeVisible();
    // The durable journal already says WAITING_FOR_REBOOT before the restart is requested.
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('envdoctor.engine-demo') ?? '{}').journal?.state);
    expect(saved).toBe('WAITING_FOR_REBOOT');
    await expect(list.getByRole('listitem').filter({ hasText: 'Create a restore point' })).toContainText('Done');

    await restart.click();
    // The app “restarts” and opens Resume first; nothing auto-continues.
    await expect(page.getByRole('heading', { name: 'Welcome back. Checking where we left off.' })).toBeVisible();
    await expect(page).toHaveURL(/#\/recovery/);
  });

  test('AC-20 app starts with open journal, any screen requested → Resume shows first; re-checks run before any button enables', async ({ page }) => {
    await open(page, '/incidents', { fault: 'openJournal' });
    await expect(page).toHaveURL(/#\/recovery/);
    await expect(page.getByRole('heading', { name: 'Welcome back. Checking where we left off.' })).toBeVisible();
    // Invariant, sampled every frame: no button is enabled while any re-check hasn’t passed.
    const violations = await page.evaluate(async () => {
      const bad: string[] = [];
      const t0 = performance.now();
      for (;;) {
        const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('.ch-resume button'));
        const enabled = btns.filter((b) => !b.disabled).map((b) => b.textContent ?? '');
        const rows = Array.from(document.querySelectorAll('ol[aria-label="Re-checks"] li'));
        const allPass = rows.length > 0 && rows.every((r) => r.getAttribute('data-state') === 'pass');
        if (enabled.length && !allPass) bad.push(enabled.join('|'));
        if (allPass && enabled.length) break;
        if (performance.now() - t0 > 15000) { bad.push('timeout'); break; }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return bad;
    });
    expect(violations).toEqual([]);
    const rechecks = page.getByRole('list', { name: 'Re-checks' }).getByRole('listitem');
    await expect(rechecks).toHaveCount(6);
    await expect(rechecks.filter({ hasText: 'Passed' })).toHaveCount(6);
    await expect(page.getByText('Your approval ended with the restart — nothing continues until you approve again.')).toBeVisible();
    await expect(page.getByText('WAITING_FOR_REBOOT', { exact: true })).toBeVisible();

    const cont = page.getByRole('button', { name: 'Continue — review the next steps' });
    await expect(page.getByRole('button', { name: 'Stop here' })).toBeEnabled();
    await expect(cont).toBeDisabled();
    await expect(cont).toHaveAccessibleDescription('Tick the box above to continue.');
    await page.getByRole('checkbox', { name: /saved my work/ }).check();
    await cont.click();
    // Continuing always goes through a fresh approval of the remaining steps.
    await expect(page).toHaveURL(/\/incidents\/INC-0043\/plan\?planId=/);
    await expect(page.getByRole('heading', { name: 'Approve this exact plan' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Plan steps' }).locator(':scope > li')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Approve plan' })).toBeDisabled();
  });
});

test.describe('AC-26 keyboard only', () => {
  test('AC-26 keyboard only: dev fix INC-0042 plan → tick → approve → run → simulated UAC Yes → Verified', async ({ page }) => {
    await open(page, PLAN);
    await expect(page.getByRole('heading', { name: 'Here’s the fix' })).toBeVisible();
    // Step cards expand with the keyboard too.
    const step2 = page.getByRole('button', { name: /Step 2: Remove a dead PATH entry/ });
    await tabTo(page, step2);
    await page.keyboard.press('Enter');
    await expect(step2).toHaveAttribute('aria-expanded', 'true');

    const ack = page.getByRole('checkbox', { name: /I understand step 1 needs admin rights/ });
    await tabTo(page, ack);
    await page.keyboard.press('Space');
    await expect(ack).toBeChecked();
    await tabTo(page, page.getByRole('button', { name: 'Approve plan' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Approved — final check passed' })).toBeFocused();
    await tabTo(page, page.getByRole('button', { name: 'Run the fix' }));
    await page.keyboard.press('Enter');

    const dlg = uac(page);
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('heading', { name: 'Windows is asking for permission' })).toBeFocused();
    await tabTo(page, dlg.getByRole('button', { name: 'Yes' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Fixed and verified' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Verification checks' }).locator('[data-check-state="pass"]')).toHaveCount(4);
  });
});
