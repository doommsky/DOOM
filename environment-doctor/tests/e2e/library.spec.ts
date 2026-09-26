/** Group “library”: Setup (12), Projects (13), Evidence (18), History (19), Safe actions (20), Settings (22). */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ActionEntry, HistoryList, Settings } from '../../src/shared/contracts';
import { api, open } from './helpers';

/** Keyboard only: press Tab until `target` has focus. */
async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Element not reachable with Tab');
}

const setupRow = (page: Page, name: RegExp) => page.getByRole('row').filter({ has: page.getByTestId('setup-row-name').filter({ hasText: name }) });

test.describe('Setup (12)', () => {
  test('AC-21 blueprint needs a new package source → source flagged; nothing added without explicit approval', async ({ page }) => {
    await open(page, '/setup');
    await page.getByRole('radio', { name: /AI \/ ML/ }).click();
    await page.getByRole('radiogroup', { name: 'Operating system' }).getByRole('radio', { name: 'Windows' }).click();
    await expect(page.getByRole('heading', { name: 'Dry run — nothing is installed yet' })).toBeVisible();
    await expect(page.getByText('AI / ML · Windows')).toBeVisible();

    const torch = setupRow(page, /PyTorch \(CUDA 12\.4 build\)/);
    await expect(torch).toContainText('New source — needs your approval');
    await expect(torch).toContainText('Install');
    // Only rows that need a new source are flagged.
    await expect(page.getByText('New source — needs your approval')).toHaveCount(1);

    const note = page.getByRole('note', { name: 'New package sources' });
    await expect(note).toContainText('pytorch.org index');
    await expect(note).toContainText('Nothing is added without your explicit approval');

    // The only way forward is the approval screen for this exact plan.
    const cta = page.getByRole('link', { name: 'Review plan' });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/#\/incidents\/[^/]+\/plan\?planId=PL-/);
    const m = /#\/incidents\/([^/]+)\/plan\?planId=([^&]+)/.exec(page.url())!;
    const [incidentId, planId] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
    const plan = await api<{ status: string; kind: string; incidentId: string }>(page, 'plan.get', { id: planId });
    expect(plan).toMatchObject({ status: 'draft', kind: 'setup', incidentId });

    // The dry run changed nothing: no approval, no action, no run for this setup.
    const hist = await api<HistoryList>(page, 'history.list');
    expect(hist.events.filter((e) => e.incidentId === incidentId && ['approval', 'action', 'verification'].includes(e.kind))).toHaveLength(0);
    expect(hist.events.filter((e) => e.kind === 'approval')).toHaveLength(0);
    expect(await api(page, 'run.get', { incidentId })).toBeNull();
  });

  test('AC-22 OS switched to macOS, AI/ML blueprint → GPU row explains MPS; no CUDA rows', async ({ page }) => {
    await open(page, '/setup');
    await page.getByRole('radio', { name: /AI \/ ML/ }).click();
    const osGroup = page.getByRole('radiogroup', { name: 'Operating system' });
    // Keyboard-operable OS switch: Windows → macOS with the arrow key.
    await osGroup.getByRole('radio', { name: 'Windows' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(osGroup.getByRole('radio', { name: 'macOS' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('AI / ML · macOS')).toBeVisible();

    const gpu = setupRow(page, /GPU acceleration/);
    await expect(gpu).toContainText('Apple MPS');
    await expect(gpu).toContainText('CUDA isn’t available on Mac — MPS is used instead');

    const names = page.getByTestId('setup-row-name');
    await expect(names.first()).toBeVisible();
    const all = await names.allTextContents();
    expect(all.length).toBeGreaterThan(2);
    for (const n of all) expect(n).not.toMatch(/CUDA/i);
    await expect(page.getByText('New source — needs your approval')).toHaveCount(0);
    await expect(page.getByText('No new package sources will be added.')).toBeVisible();
  });
});

test.describe('Projects (13)', () => {
  test('project detail shows requirements vs this PC; unknown is not counted as met', async ({ page }) => {
    await open(page, '/projects');
    await page.getByRole('link', { name: /ml-experiments/ }).click();
    await expect(page).toHaveURL(/#\/projects\/ml$/);
    await expect(page.getByRole('heading', { name: 'ml-experiments', level: 2 })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '3 of 6 requirements met' })).toBeVisible();
    const drv = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'GPU driver CUDA support' }) });
    await expect(drv).toContainText('Blocking');
    await expect(drv.getByRole('link', { name: 'INC-0044' })).toBeVisible();

    await page.getByRole('link', { name: /booking-api/ }).click();
    await expect(page.getByRole('progressbar', { name: '3 of 5 requirements met' })).toBeVisible();
    await expect(page.getByText(/unknown, not counted as met/)).toBeVisible();
  });

  test('no projects yet → empty state links to Settings › Diagnostics', async ({ page }) => {
    await open(page, '/projects', { scanned: false });
    await expect(page.getByText('No projects yet')).toBeVisible();
    await page.getByRole('link', { name: 'Open Settings › Diagnostics' }).click();
    await expect(page).toHaveURL(/#\/settings\/diagnostics$/);
    await expect(page.getByRole('heading', { name: 'Project folders' })).toBeVisible();
  });
});

test.describe('Evidence (18)', () => {
  test('AC-23 item is a secret, item opened → values show “never read”; no raw value exists in the renderer', async ({ page }) => {
    await open(page, '/evidence');
    await page.getByRole('button', { name: /^Secrets/ }).click();
    await expect(page.getByRole('button', { name: /^Secrets/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('link', { name: /E-88/ }).click();
    await expect(page).toHaveURL(/#\/evidence\/E-88$/);

    const stored = page.getByLabel('Stored fields for E-88');
    await expect(stored).toContainText('auth token');
    await expect(stored).toContainText('never read');
    await expect(stored.getByText('Secret · never read')).toBeVisible();
    await expect(page.getByText('presence only', { exact: true })).toBeVisible();
    await expect(page.getByText('Secret · presence only')).toBeVisible();

    // A partly hidden item keeps its secret fields as presence only too.
    await page.getByRole('button', { name: /^All/ }).click();
    await page.getByRole('link', { name: /E-107/ }).click();
    const env = page.getByLabel('Stored fields for E-107');
    await expect(env.getByText('Secret · never read')).toHaveCount(2);
    await expect(env).toContainText('GITHUB_TOKEN');
    await expect(env).toContainText('present, never read');

    // No raw secret anywhere the renderer can reach: DOM text, markup and storage.
    const html = await page.content();
    const text = await page.evaluate(() => document.body.innerText);
    const storage = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
    for (const s of [html, text, storage]) {
      expect(s).not.toContain('ghp_');
      expect(s).not.toMatch(/\bsk-[A-Za-z0-9]/);
      expect(s).not.toMatch(/BEGIN (OPENSSH|RSA) PRIVATE KEY/);
    }
    await expect(page.getByRole('link', { name: 'What the AI would see' })).toHaveAttribute('href', '#/evidence/preview/INC-0042');
  });
});

test.describe('History (19)', () => {
  test('after a scan the chain is intact and the scan is listed; filters narrow the timeline', async ({ page }) => {
    await open(page, '/history');
    await expect(page.getByRole('heading', { name: 'Chain intact' })).toBeVisible();
    await expect(page.getByText(/Chain intact · \d+ events/)).toBeVisible();
    const timeline = page.getByRole('region', { name: 'Timeline' });
    await expect(timeline.getByText(/^Scan SC-/)).toBeVisible();
    await expect(timeline.getByRole('heading', { name: 'Today' })).toBeVisible();

    await page.getByRole('button', { name: 'Scans', exact: true }).click();
    const kinds = () => timeline.locator('[data-kind]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    await expect.poll(async () => [...new Set(await kinds())]).toEqual(['scan']);

    await page.getByRole('button', { name: 'Security', exact: true }).click();
    await expect(timeline.getByText('Update 0.9.3 downloaded')).toBeVisible();
    await expect(timeline.getByText(/^Scan SC-/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Repairs', exact: true }).click();
    await expect(timeline.getByText('Reset Git credential helper')).toBeVisible();
    await expect(timeline.getByRole('link', { name: 'INC-0038' }).first()).toBeVisible();
  });

  test('history restored from backup → warning, not “Chain intact”', async ({ page }) => {
    await open(page, '/history', { fault: 'storageRestored' });
    await expect(page.getByText('History restored from backup').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Restored from backup' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chain intact' })).toHaveCount(0);
  });
});

test.describe('Safe actions (20)', () => {
  test('risk filter narrows the catalog; detail shows checks, proof and undo', async ({ page }) => {
    await open(page, '/actions');
    await expect(page.getByText('The AI can only pick from this signed catalog; it can never run arbitrary commands.')).toBeVisible();
    const catalog = await api<ActionEntry[]>(page, 'actions.catalog');
    const list = page.getByRole('list', { name: 'Actions' });
    const cards = list.getByRole('link');
    await expect(cards).toHaveCount(catalog.length);

    await page.getByRole('tab', { name: /^High/ }).click();
    await expect(cards).toHaveCount(catalog.filter((a) => a.risk === 'high').length);
    for (const t of await cards.allTextContents()) expect(t).toContain('High risk');

    // Keyboard: ArrowLeft moves High → Medium.
    await page.getByRole('tab', { name: /^High/ }).press('ArrowLeft');
    await expect(page.getByRole('tab', { name: /^Medium/ })).toHaveAttribute('aria-selected', 'true');
    await expect(cards).toHaveCount(catalog.filter((a) => a.risk === 'medium').length);
    for (const t of await cards.allTextContents()) { expect(t).toContain('Medium risk'); expect(t).not.toContain('Low risk'); }

    await page.getByRole('tab', { name: /^Low/ }).click();
    await list.getByRole('link', { name: /Remove a dead PATH entry/ }).click();
    await expect(page).toHaveURL(/#\/actions\/env\.path\.user\.remove_entry$/);
    await expect(page.getByRole('heading', { name: 'Remove a dead PATH entry', level: 2 })).toBeVisible();
    await expect(page.getByText('env.path.user.remove_entry · v1.2.0').first()).toBeVisible();
    await expect(page.getByText('Folder still doesn’t exist')).toBeVisible();
    await expect(page.getByText('Undo: restore the saved PATH exactly.')).toBeVisible();
    await expect(page.getByText('Your account').first()).toBeVisible();

    await page.getByRole('tab', { name: /^All/ }).click();
    await page.getByRole('searchbox', { name: 'Search actions' }).fill('driver');
    for (const t of await cards.allTextContents()) expect(t.toLowerCase()).toContain('driver');
  });
});

test.describe('Settings (22)', () => {
  test('AC-25 locked setting, user clicks it → nothing changes; “Always on” explains why', async ({ page }) => {
    await open(page, '/settings/privacy');
    const sw = page.getByRole('switch', { name: 'Never collect or send secrets' });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(sw).toHaveAttribute('aria-disabled', 'true');
    await sw.click({ force: true });
    await sw.focus();
    await page.keyboard.press('Space');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    const row = page.locator('[data-setting="privacy.redactSecrets"]');
    await expect(row.getByText('Always on', { exact: true })).toBeVisible();
    await expect(row).toContainText('secrets are never stored or sent');
    await expect(sw).toHaveAccessibleDescription(/secrets are never stored or sent/);
    await expect(page.getByRole('alert')).toHaveCount(0);

    const dumps = page.getByRole('switch', { name: 'Send full crash dumps' });
    await dumps.click({ force: true });
    await expect(dumps).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-setting="privacy.sendCrashDumps"]').getByText('Always off', { exact: true })).toBeVisible();

    const s = await api<Settings>(page, 'settings.get');
    expect(s.privacy).toMatchObject({ redactSecrets: true, sendCrashDumps: false, previewBeforeSend: true });
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Never collect or send secrets' })).toHaveAttribute('aria-checked', 'true');

    await page.goto('/?speed=20#/settings/updates');
    const upd = page.getByRole('switch', { name: 'Never update during a repair' });
    await upd.click({ force: true });
    await expect(upd).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-setting="updates.blockDuringRepair"]').getByText('Always on', { exact: true })).toBeVisible();
  });

  test('AC-26 (Settings) keyboard only: a normal toggle flips with Space/Enter, focus visible, saved', async ({ page }) => {
    await open(page, '/settings/general');
    const sw = page.getByRole('switch', { name: 'Scan when the app starts' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await tabTo(page, sw);
    expect(await sw.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    await page.keyboard.press('Space');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await api<Settings>(page, 'settings.get')).general.scanOnStart).toBe(true);

    await page.reload();
    const again = page.getByRole('switch', { name: 'Scan when the app starts' });
    await expect(again).toHaveAttribute('aria-checked', 'true');
    await tabTo(page, again);
    await page.keyboard.press('Enter');
    await expect(again).toHaveAttribute('aria-checked', 'false');

    // Section navigation by keyboard.
    await page.reload();
    const privacy = page.getByRole('link', { name: 'Privacy & AI' });
    await tabTo(page, privacy);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/settings\/privacy$/);
    await expect(page.getByRole('heading', { name: 'Privacy & AI', level: 2 })).toBeVisible();
  });

  test('engine mode: live unavailable in the browser build → inline error, still demo', async ({ page }) => {
    await open(page, '/settings/general');
    const modes = page.getByRole('radiogroup', { name: 'Engine mode' });
    await modes.getByRole('radio', { name: /Live — this PC/ }).click();
    await expect(page.getByText('Live mode needs the desktop app')).toBeVisible();
    await expect(page.getByText('Still in demo mode.')).toBeVisible();
    await expect(modes.getByRole('radio', { name: /Demo — sample data/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/#\/settings\/general$/);
  });
});
