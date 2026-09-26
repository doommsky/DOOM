/** Group “diagnosis”: screens 05, 08, 09, 16, 21 — AC-05, AC-06, AC-16, AC-17, AC-18, AC-24 (+ Describe prefill, no-safe-fix). */
import { expect, test, type Page } from '@playwright/test';
import type { Approval, Plan, RunProgress } from '../../src/shared/contracts';
import { api, open } from './helpers';

const hypothesisRow = (page: Page, title: string) => page.locator('li.dx-hyp').filter({ has: page.getByRole('button', { name: new RegExp(title) }) });

test.describe('05 Dev issue diagnosis', () => {
  test('AC-05 no percentages anywhere; each hypothesis shows a label and evidence IDs (INC-0042)', async ({ page }) => {
    await open(page, '/incidents/INC-0042');
    await expect(page.getByRole('heading', { level: 1, name: /“node” is not recognized/ })).toBeVisible();
    // Root cause: label, not a number, with its evidence.
    const root = page.getByRole('region', { name: 'Root cause' });
    await expect(root.getByText('Confirmed', { exact: true })).toBeVisible();
    for (const id of ['T-3', 'E-104', 'E-107']) await expect(root.getByRole('link', { name: `Evidence ${id}` })).toBeVisible();
    // Fix CTA loaded (so the whole page has rendered before we scan it for “%”).
    await expect(page.getByText(/Fix ready · 2 steps/)).toBeVisible();

    const expected: [string, string, string[]][] = [
      ['An nvm update didn’t recreate the link', 'High', ['E-109', 'E-110']],
      ['Antivirus quarantined node.exe', 'Low', ['E-121']],
      ['System-wide PATH is broken too', 'Unknown', []],
    ];
    await expect(page.locator('li.dx-hyp')).toHaveCount(expected.length);
    for (const [title, label, ids] of expected) {
      const row = hypothesisRow(page, title);
      await expect(row.locator('[data-confidence]').first()).toHaveText(label);
      if (ids.length) for (const id of ids) await expect(row.getByRole('link', { name: `Evidence ${id}` })).toBeVisible();
      else await expect(row.getByText('No evidence yet')).toBeVisible();
    }
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('%');
  });

  test('AC-06 vetoed hypothesis shows its rule ID when expanded and cannot be selected as the cause', async ({ page }) => {
    await open(page, '/incidents/INC-0042');
    const toggle = page.getByRole('button', { name: /Antivirus quarantined node\.exe/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('region', { name: 'Reasoning: Antivirus quarantined node.exe' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('R-AV-02')).toBeVisible();
    await expect(panel.getByText(/Ruled out by rule R-AV-02/)).toBeVisible();
    await expect(panel.getByText(/can’t be chosen as the cause/)).toBeVisible();
    // No control anywhere in the row can make it the cause.
    const row = hypothesisRow(page, 'Antivirus quarantined node\\.exe');
    await expect(row.getByRole('radio')).toHaveCount(0);
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(row.getByRole('button', { name: /cause|select|choose/i })).toHaveCount(0);
    // The root cause is unchanged.
    await expect(page.getByRole('region', { name: 'Root cause' })).toContainText('The Node link');
  });

  test('evidence filter: Supports / Rules out', async ({ page }) => {
    await open(page, '/incidents/INC-0042');
    const list = page.locator('ul.dx-ev-list');
    await expect(list.locator('li')).toHaveCount(6);
    await page.getByRole('tab', { name: /Rules out/ }).click();
    await expect(list.locator('li')).toHaveCount(1);
    await expect(list).toContainText('No antivirus detections in 30 days');
    await page.getByRole('tab', { name: /Supports/ }).click();
    await expect(list.locator('li')).toHaveCount(5);
  });

  test('no safe fix → “There’s no safe fix for this yet” with the hypothesis test as next step (INC-0039)', async ({ page }) => {
    await open(page, '/incidents/INC-0039');
    await expect(page.getByText('There’s no safe fix for this yet')).toBeVisible();
    await expect(page.getByText(/Next step: Start Docker Desktop, then Check again\./)).toBeVisible();
    await expect(page.getByRole('link', { name: /Review fix/ })).toHaveCount(0);
  });
});

test.describe('05 header actions', () => {
  test('Close incident asks first, changes nothing on the PC and shows the closed summary (INC-0041)', async ({ page }) => {
    await open(page, '/incidents/INC-0041');
    await expect(page.getByText(/Fix ready · 1 step/)).toBeVisible();
    await page.getByRole('button', { name: 'Close incident' }).click();
    const dialog = page.getByRole('dialog', { name: 'Close INC-0041' });
    await expect(dialog).toContainText('Nothing on your PC changes');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Close incident' }).click();
    await dialog.getByRole('button', { name: 'Close incident' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'INC-0041 closed' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'What ran' })).toContainText('No repair record');
    await expect(page.getByRole('link', { name: 'Open History' })).toBeVisible();
  });
});

test.describe('16 Partly fixed', () => {
  test('AC-16 one check fails, run ends → PARTIALLY_VERIFIED; new evidence and next options shown (INC-0044)', async ({ page }) => {
    await open(page, '/diagnose');
    const plan = await api<Plan>(page, 'plan.forIncident', { incidentId: 'INC-0044' });
    const ap = await api<Approval>(page, 'approval.submit', { planId: plan.id, planHash: plan.binding.planHash, uiConfirmationVersion: 'ui-confirm-3', acknowledged: true });
    const run = await api<RunProgress>(page, 'run.start', { approvalId: ap.approvalId, planHash: plan.binding.planHash });
    const runGet = () => api<RunProgress | null>(page, 'run.get', { incidentId: 'INC-0044' });
    await expect.poll(async () => (await runGet())?.adminPrompt, { timeout: 20_000 }).toBe('waiting');
    await api(page, 'run.decide', { executionId: run.executionId, decision: 'admin-allow' });
    await expect.poll(async () => (await runGet())?.state, { timeout: 30_000 }).toBe('PARTIALLY_VERIFIED');

    await page.goto('/?speed=20#/incidents/INC-0044');
    await expect(page.getByRole('heading', { level: 1, name: /Partly fixed/ })).toBeVisible();
    await expect(page.getByText('Partly fixed', { exact: true }).first()).toBeVisible(); // status chip
    await expect(page.getByText('PARTIALLY_VERIFIED').first()).toBeVisible();
    // Which check failed, with its detail.
    const checks = page.getByRole('region', { name: 'Checks' });
    await expect(checks.getByText('torch.cuda.is_available() is True')).toBeVisible();
    await expect(checks.getByText(/still False — \.venv has the CPU-only build/)).toBeVisible();
    await expect(checks.getByText('Failed', { exact: true })).toBeVisible();
    // What stayed fixed.
    const stayed = page.getByRole('list', { name: 'What stayed fixed' });
    await expect(stayed).toContainText('Driver 560.94 loaded');
    await expect(stayed).toContainText('Driver supports CUDA ≥ 12.4');
    // New evidence.
    const learned = page.getByRole('region', { name: 'What we learned' });
    await expect(learned).toContainText('CPU-only build (torch 2.5.1+cpu)');
    // Three next options; the next plan is recommended and preselected.
    const radios = page.getByRole('radiogroup', { name: 'What next?' }).getByRole('radio');
    await expect(radios).toHaveCount(3);
    await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(radios.nth(0)).toContainText('Install the CUDA build into .venv');
    await expect(radios.nth(0)).toContainText('Recommended');
    await expect(radios.nth(1)).toContainText('Keep things as they are');
    await expect(radios.nth(2)).toContainText('Undo');
    // Keep as partly fixed → run.decide keep, nothing changes.
    await radios.nth(1).click();
    await page.getByRole('button', { name: 'Keep as partly fixed' }).click();
    await expect(page.getByText('Kept as partly fixed · nothing changed.')).toBeVisible();
    // Next plan → plan screen for the follow-up fix.
    await radios.nth(0).click();
    await page.getByRole('button', { name: 'Review this plan' }).click();
    await expect(page).toHaveURL(/#\/incidents\/INC-0044\/plan\?next=1$/);
  });
});

test.describe('08 Describe a problem', () => {
  test('AC-17 sensitive source (crash dumps) is off by default and labelled sensitive', async ({ page }) => {
    await open(page, '/diagnose');
    const dumps = page.getByRole('switch', { name: 'Crash dump summaries' });
    await expect(dumps).toHaveAttribute('aria-checked', 'false');
    const row = page.locator('li[data-source="dumps"]');
    await expect(row.getByText('Sensitive · stays on this PC')).toBeVisible();
    await expect(dumps).toHaveAccessibleDescription(/Sensitive · stays on this PC/);
    // Non-sensitive defaults are on; the count reflects the switches.
    await expect(page.getByRole('switch', { name: 'Event Viewer' })).toHaveAttribute('aria-checked', 'true');
    const total = await page.getByRole('switch').count();
    const onNow = await page.locator('[role="switch"][aria-checked="true"]').count();
    await expect(page.getByText(`${onNow} of ${total} on`)).toBeVisible();
    await dumps.press('Space');
    await expect(dumps).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(`${onNow + 1} of ${total} on`)).toBeVisible();
  });

  test('prefills from ?q= and starts a diagnosis that opens the incident', async ({ page }) => {
    await open(page, '/diagnose?q=npm%20run%20dev%20fails');
    const box = page.getByRole('textbox', { name: 'Describe the problem' });
    await expect(box).toHaveValue('npm run dev fails');
    await expect(page.getByText('Sounds like a dev-environment problem')).toBeVisible();
    await expect(page.getByText('17 / 500')).toBeVisible();
    await expect(page.getByText('Looking only — nothing changes during a diagnosis')).toBeVisible();
    // Example chip replaces the text; pills are toggle buttons.
    await page.getByRole('button', { name: 'Use example: My laptop keeps freezing' }).click();
    await expect(box).toHaveValue('My laptop keeps freezing');
    await expect(page.getByText('Sounds like a PC stability problem')).toBeVisible();
    const week = page.getByRole('button', { name: 'This week' });
    await week.click();
    await expect(week).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Start diagnosis' }).click();
    await expect(page).toHaveURL(/#\/incidents\/INC-0043$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Laptop freezes after waking from sleep' })).toBeVisible();
  });

  test('Start diagnosis is disabled with a reason while the description is empty', async ({ page }) => {
    await open(page, '/diagnose');
    const start = page.getByRole('button', { name: 'Start diagnosis' });
    await expect(start).toBeDisabled();
    await expect(start).toHaveAccessibleDescription('Describe the problem first.');
  });
});

test.describe('09 Freeze / crash diagnosis', () => {
  test('AC-18 user selects a freeze with the keyboard → detail row shows time, cause text, evidence ID', async ({ page }) => {
    await open(page, '/incidents/INC-0043');
    await expect(page.getByRole('heading', { level: 1, name: 'Laptop freezes after waking from sleep' })).toBeVisible();
    await expect(page.getByText('Likelihood is a label, not a calibrated percentage.', { exact: false })).toBeVisible();
    const first = page.getByRole('button', { name: 'Freeze Sep 23 · 21:10' });
    await expect(first).toBeVisible();
    // Keyboard only: Tab until the first marker has focus.
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await first.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    const detail = page.getByTestId('timeline-detail');
    await expect(detail).toContainText('Sep 23 · 21:10');
    await expect(detail).toContainText('Froze after waking · display driver stopped responding · VIDEO_TDR_FAILURE');
    await expect(detail.getByRole('link', { name: 'Evidence E-201' })).toBeVisible();
    // Arrow keys move between events.
    await page.keyboard.press('ArrowRight');
    const second = page.getByRole('button', { name: 'Freeze Sep 24 · 08:02' });
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(detail).toContainText('Sep 24 · 08:02');
    await expect(detail.getByRole('link', { name: 'Evidence E-204' })).toBeVisible();
    // Text-list equivalent for screen readers.
    await expect(page.getByRole('list', { name: 'Crash timeline as a list' }).getByRole('listitem')).toHaveCount(5);
  });

  test('alternatives list their tests; fix options route to plan (rollback) or guided repair (clean)', async ({ page }) => {
    await open(page, '/incidents/INC-0043');
    const alts = page.getByRole('region', { name: 'Other possible causes' });
    await expect(alts).toContainText('Fast Startup leaves the GPU in a bad state');
    await expect(alts).toContainText('Test: Turn Fast Startup off for 2 days and watch for freezes.');
    await expect(alts).not.toContainText('Display driver fails on resume'); // that one is the likely cause
    const group = page.getByRole('radiogroup', { name: 'Two ways to fix it' });
    await expect(group.getByRole('radio', { name: /Thorough: clean driver reinstall/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Start guided repair' })).toBeEnabled();
    await group.getByRole('radio', { name: /Quick: roll back the driver/ }).click();
    await expect(group.getByRole('radio', { name: /Quick: roll back the driver/ })).toContainText('1 step');
    await page.getByRole('button', { name: 'Plan the rollback' }).click();
    await expect(page).toHaveURL(/#\/incidents\/INC-0043\/plan\?variant=rollback$/);
    await expect(group).toHaveCount(0); // the plan screen replaced this one (route transitions may lag the URL)
    await page.goto('/?speed=20#/incidents/INC-0043');
    await group.getByRole('radio', { name: /Thorough: clean driver reinstall/ }).click();
    await page.getByRole('button', { name: 'Start guided repair' }).click();
    await expect(page).toHaveURL(/#\/incidents\/INC-0043\/guided$/);
    await expect(group).toHaveCount(0);
    await page.goto('/?speed=20#/incidents/INC-0043');
    await page.getByRole('link', { name: 'What the AI sees' }).first().click();
    await expect(page).toHaveURL(/#\/evidence\/preview\/INC-0043$/);
  });
});

test.describe('21 What the AI sees', () => {
  test('AC-24 cloud mode: unticking items updates the sent list and count; unticked items never leave', async ({ page }) => {
    await open(page, '/evidence/preview/INC-0043');
    await api(page, 'settings.set', { path: 'privacy.aiMode', value: 'cloud' });
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Cloud AI' })).toHaveAttribute('aria-checked', 'true');
    const count = page.getByTestId('aip-count');
    await expect(count).toHaveText('6 items · 4.1 KB');
    const sent = page.getByRole('list', { name: 'Items the AI would receive' });
    await expect(sent.getByRole('listitem')).toHaveCount(6);
    // The secret is only a placeholder on this PC and removed in what is sent.
    await expect(page.locator('li[data-item="E-107"]')).toContainText('[present, never read]');
    await expect(sent.locator('li[data-sent="E-107"]')).toContainText('[secret removed]');

    await page.getByRole('checkbox', { name: /E-204/ }).uncheck();
    await page.getByRole('checkbox', { name: /E-107/ }).uncheck();
    await expect(count).toHaveText('4 items · 3.1 KB');
    await expect(sent.getByRole('listitem')).toHaveCount(4);
    await expect(sent).not.toContainText('E-204');
    await expect(sent).not.toContainText('E-107');
    const send = page.getByRole('button', { name: 'Send 4 items to cloud AI' });
    await expect(send).toBeEnabled();
    await send.click();
    const toast = page.locator('.toast').filter({ hasText: 'Nothing was sent' });
    await expect(toast).toContainText('E-201, E-190, E-195, E-199');
    await expect(toast).not.toContainText('E-204');
    await expect(toast).not.toContainText('E-107');
    await expect(toast).toContainText('No cloud provider is configured');
    await expect(page).toHaveURL(/#\/incidents\/INC-0043$/);
  });

  test('none ticked → nothing will be sent; local mode keeps it on this PC', async ({ page }) => {
    await open(page, '/evidence/preview/INC-0043');
    await expect(page.getByRole('radio', { name: 'On this PC' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Explain on this PC' })).toBeVisible();
    for (const cb of await page.getByRole('checkbox').all()) await cb.uncheck();
    await expect(page.getByText('Nothing selected — nothing will be sent.')).toBeVisible();
    await expect(page.getByTestId('aip-count')).toHaveText('0 items · 0.0 KB');
    await page.getByRole('radio', { name: 'Cloud AI' }).click();
    await expect(page.getByRole('button', { name: 'Send 0 items to cloud AI' })).toBeDisabled();
    await page.getByRole('link', { name: 'Keep it on this PC' }).click();
    await expect(page).toHaveURL(/#\/incidents\/INC-0043$/);
  });
});
