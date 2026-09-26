/** Group “start”: 01 First run, 02 Home, 03 Live scan, 04 Command palette, 17 Incidents (AC-01…AC-04, AC-26 parts). */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ScanProgress, ScanScope, Settings } from '../../src/shared/contracts';
import { api, open } from './helpers';

/** Keyboard-only: press Tab until `target` has focus (fails if it is never reached). */
async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error('Element was not reachable with Tab');
}

async function scanAndWait(page: Page, scopes: ScanScope[]) {
  await api(page, 'scan.start', { scopes });
  await expect.poll(async () => (await api<ScanProgress | null>(page, 'scan.get'))?.state, { timeout: 15_000 }).not.toBe('running');
}

const pillar = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test.describe('01 First run', () => {
  test('AC-01 finishing step 3 starts a scan with only the chosen scopes; cloud AI stays off unless picked', async ({ page }) => {
    await open(page, '/welcome', { scanned: false });
    await expect(page.getByRole('heading', { level: 1, name: /looked after like a technician would/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Setup steps' }).locator('[aria-current="step"]')).toContainText('What it does');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Where should the AI think?' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /^On this PC\s*Recommended/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /cloud when needed/ })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'What should the first scan cover?' })).toBeVisible();
    const proj = page.getByRole('checkbox', { name: /^Projects/ });
    await expect(proj).toBeChecked();
    await proj.uncheck();
    await page.getByRole('button', { name: 'Run first scan' }).click();

    await expect(page).toHaveURL(/#\/scan$/);
    await expect(page.getByRole('heading', { level: 2, name: 'This PC' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Dev tools' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Projects' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /Scan complete/ })).toBeVisible();

    const scan = await api<ScanProgress>(page, 'scan.get');
    expect([...new Set(scan.items.map((i) => i.column))].sort()).toEqual(['dev', 'pc']);
    const settings = await api<Settings>(page, 'settings.get');
    expect(settings.privacy.aiMode).not.toBe('cloud');
    expect(settings.privacy.aiMode).toBe('local');
  });

  test('AC-01 cloud AI is only set when the person picks it', async ({ page }) => {
    await open(page, '/welcome', { scanned: false });
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /^Off/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'What should the first scan cover?' })).toBeVisible();
    expect((await api<Settings>(page, 'settings.get')).privacy.aiMode).toBe('off');
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('radio', { name: /cloud when needed/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'What should the first scan cover?' })).toBeVisible();
    expect((await api<Settings>(page, 'settings.get')).privacy.aiMode).toBe('cloud');
  });
});

test.describe('02 Home', () => {
  test('headline counts problems, unknown is shown and never counted healthy, rows open incidents', async ({ page }) => {
    await open(page, '/');
    await expect(page.getByRole('heading', { level: 1, name: '5 problems need you' })).toBeVisible();
    await expect(page.getByText('2 not checked — not counted as healthy')).toBeVisible();
    await expect(page.getByText(/scanned (just now|\d+ min ago)/)).toBeVisible();
    const dev = pillar(page, 'Dev tools');
    await expect(dev.getByText('3 issues')).toBeVisible();
    await expect(dev.locator('li[data-status="unknown"]')).toContainText('Docker');
    await expect(dev.locator('li[data-status="unknown"]').getByRole('img', { name: 'Unknown' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Run scan/ })).toHaveAttribute('href', '#/scan?start=1');
    await expect(page.getByRole('link', { name: /Describe a problem/ })).toHaveAttribute('href', '#/diagnose');
    await expect(page.getByRole('link', { name: /Set up a project or new PC/ })).toHaveAttribute('href', '#/setup');
    await dev.getByRole('link', { name: /PATH/ }).click();
    await expect(page).toHaveURL(/#\/incidents\/INC-0042$/);
  });

  test('AC-02 “Problems only” shows only warn/fail/unknown rows; healthy pillars say “No problems here”', async ({ page }) => {
    await open(page, '/');
    // Arrange a fully healthy pillar: settle both PC incidents, then re-scan the PC.
    await api(page, 'incident.close', { id: 'INC-0043' });
    await api(page, 'incident.close', { id: 'INC-0041' });
    await scanAndWait(page, ['pc']);
    await page.reload();

    const pc = pillar(page, 'This PC');
    await expect(pc.getByText('Healthy', { exact: true })).toBeVisible();
    await expect(pc.getByText('Memory')).toBeVisible();

    await page.getByRole('tab', { name: 'Problems only' }).click();
    await expect(page.getByRole('tab', { name: 'Problems only' })).toHaveAttribute('aria-selected', 'true');
    await expect(pc.getByText('No problems here')).toBeVisible();
    await expect(pc.locator('li')).toHaveCount(0);

    const shown = page.locator('[data-pillar] li[data-status]');
    const statuses = await shown.evaluateAll((els) => els.map((e) => e.getAttribute('data-status')));
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) expect(['warn', 'fail', 'unknown']).toContain(s);
    await expect(pillar(page, 'Dev tools').getByText('Python', { exact: true })).toHaveCount(0);
    await expect(pillar(page, 'Dev tools').getByText('Docker')).toBeVisible(); // unknown is not healthy → still shown
    await expect(pillar(page, 'Projects').getByText('booking-api')).toBeVisible();
    await expect(pillar(page, 'Projects').getByText('data-scripts')).toHaveCount(0);

    await page.getByRole('tab', { name: 'All' }).click();
    await expect(pillar(page, 'Dev tools').getByText('Python', { exact: true })).toBeVisible();
  });
});

test.describe('03 Live scan', () => {
  test('AC-03 pressing Stop → “Scan stopped”; unchecked items stay Unknown, never healthy', async ({ page }) => {
    await open(page, '/', { scanned: false });
    await page.goto('/?speed=1#/scan?start=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Scanning your PC, tools and projects' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Scan progress' })).toBeVisible();
    await expect(page.locator('li[data-state="done"]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Stop scan' }).click();

    await expect(page.getByRole('heading', { level: 1, name: /Scan stopped/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop scan' })).toHaveCount(0);
    await expect(page.locator('li[data-state="waiting"], li[data-state="running"]')).toHaveCount(0);
    const skipped = page.locator('li[data-state="skipped"]');
    const n = await skipped.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(skipped.nth(i)).toContainText('Not checked');
      await expect(skipped.nth(i).getByRole('img', { name: 'Unknown' })).toBeVisible();
      await expect(skipped.nth(i).getByRole('img', { name: 'Healthy' })).toHaveCount(0);
    }
    await expect(page.getByText(`${n} not checked — marked Unknown, never healthy`)).toBeVisible();

    // Home keeps the partial results: the unchecked rows are Unknown and not counted as healthy.
    await page.getByRole('link', { name: 'See partial results' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByText(/\d+ not checked — not counted as healthy/)).toBeVisible();
    const stoppedRows = page.locator('[data-pillar] li', { hasText: 'Not checked — scan stopped' });
    expect(await stoppedRows.count()).toBe(n);
    for (const s of await stoppedRows.evaluateAll((els) => els.map((e) => e.getAttribute('data-status')))) expect(s).toBe('unknown');
  });

  test('a scan with ?start=1 runs to completion with results and links onward', async ({ page }) => {
    await open(page, '/scan?start=1');
    await expect(page.getByRole('heading', { level: 1, name: /Scan complete/ })).toBeVisible();
    await expect(page).toHaveURL(/#\/scan$/);
    for (const col of ['This PC', 'Dev tools', 'Projects']) await expect(page.getByRole('heading', { level: 2, name: col })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Found so far' }).getByRole('link', { name: /Node link missing/ })).toHaveAttribute('href', '#/incidents/INC-0042');
    await expect(page.getByRole('link', { name: 'Open incidents' })).toBeVisible();
    // “Run a full scan” from the palette while already on this screen starts a fresh scan.
    const first = (await api<ScanProgress>(page, 'scan.get')).scanId;
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search or run a command' }).fill('full scan');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await api<ScanProgress>(page, 'scan.get')).scanId).not.toBe(first);
    await expect(page).toHaveURL(/#\/scan$/);
    await expect(page.getByRole('heading', { level: 1, name: /Scan complete/ })).toBeVisible();
    await page.getByRole('link', { name: 'See results' }).click();
    await expect(page).toHaveURL(/#\/$/);
  });
});

test.describe('04 Command palette', () => {
  test('AC-04 query that matches nothing → “Diagnose: [query]” routes to Describe with the text prefilled', async ({ page }) => {
    await open(page, '/');
    await expect(page.getByRole('heading', { level: 1, name: /problems? need/ })).toBeVisible();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search or run' });
    await expect(dialog).toBeVisible();
    const box = dialog.getByRole('combobox', { name: 'Search or run a command' });
    await expect(box).toBeFocused();
    const q = 'my printer smells of toast';
    await box.fill(q);
    const options = dialog.getByRole('option');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText(new RegExp(`Diagnose: “${q}”`));
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await expect(box).toHaveAttribute('aria-activedescendant', (await options.first().getAttribute('id'))!);
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/#\/diagnose\?q=my%20printer%20smells%20of%20toast$/);
    // Describe (screen 08) prefills its symptom field from ?q=.
    await expect(page.locator('textarea').first()).toHaveValue(q);
  });

  test('matching queries list grouped results, Diagnose is always offered last, Esc closes', async ({ page }) => {
    await open(page, '/');
    await page.getByRole('button', { name: 'Search or run (Ctrl K)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Search or run' });
    await expect(dialog.getByRole('group', { name: 'Run' })).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Incidents' }).getByRole('option').first()).toBeVisible();
    await dialog.getByRole('combobox').fill('inc');
    const last = dialog.getByRole('option').last();
    await expect(last).toHaveText(/Diagnose: “inc”/);
    await expect(dialog.getByRole('group', { name: 'Go to' }).getByRole('option', { name: /Incidents/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('17 Incidents', () => {
  test('search filters by ID and title; tabs show counts; empty state for no matches', async ({ page }) => {
    await open(page, '/incidents');
    await expect(page.getByRole('tab', { name: /Open/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Open/ })).toContainText('5');
    await expect(page.getByRole('tab', { name: /Resolved/ })).toContainText('5');
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(5);
    await expect(rows.first().getByText(/High|Medium|Low|Confirmed|Unknown/).first()).toBeVisible();
    await expect(page.locator('tbody')).not.toContainText('%');

    const search = page.getByRole('searchbox', { name: 'Search incidents' });
    await search.fill('INC-0043');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Laptop freezes after waking from sleep');
    await search.fill('pytorch');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('INC-0044');
    await expect(rows.first()).toContainText('ml-experiments');
    await search.fill('zzz-nothing');
    await expect(page.getByText('No incidents match')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(rows).toHaveCount(5);

    await page.getByRole('tab', { name: /Resolved/ }).click();
    await expect(rows).toHaveCount(5);
    await expect(page.locator('tbody')).toContainText('git push asks for a password every time');
    await expect(page.getByRole('link', { name: /git push asks/ })).toHaveAttribute('href', '#/incidents/INC-0038');
  });
});

test.describe('AC-26 keyboard only', () => {
  test('AC-26 palette: Ctrl+K → type → arrows → Enter navigates; focus stays in the dialog', async ({ page }) => {
    await open(page, '/');
    await expect(page.getByRole('heading', { level: 1, name: /problems? need/ })).toBeVisible();
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'Search or run a command' });
    await expect(box).toBeFocused();
    await page.keyboard.type('sett');
    const options = page.getByRole('option');
    await expect(options.nth(0)).toHaveText(/^Settings/);
    await expect(options.nth(1)).toHaveText(/Privacy & AI settings/);
    await page.keyboard.press('Tab'); // trapped: focus stays inside the dialog
    await expect(page.getByRole('dialog', { name: 'Search or run' })).toBeVisible();
    await expect(box).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/settings\/privacy$/);
  });

  test('AC-26 Home filter: Tab to the filter, arrow to “Problems only”', async ({ page }) => {
    await open(page, '/');
    const all = page.getByRole('tab', { name: 'All' });
    await tabTo(page, all);
    await expect(all).toBeFocused();
    await page.keyboard.press('ArrowRight');
    const problems = page.getByRole('tab', { name: 'Problems only' });
    await expect(problems).toBeFocused();
    await expect(problems).toHaveAttribute('aria-selected', 'true');
    await expect(pillar(page, 'Dev tools').getByText('Python', { exact: true })).toHaveCount(0);
    await expect(pillar(page, 'Dev tools').getByText('PATH', { exact: true })).toBeVisible();
    // Rows are reachable and open with Enter.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('href', /#\/incidents\//);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/incidents\/INC-\d+$/);
  });

  test('AC-26 Incidents: search → Tab to the row → Enter opens it', async ({ page }) => {
    await open(page, '/incidents');
    const search = page.getByRole('searchbox', { name: 'Search incidents' });
    await tabTo(page, search);
    await page.keyboard.type('node');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.keyboard.press('Tab');
    const link = page.getByRole('link', { name: /node.*is not recognized/ });
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/incidents\/INC-0042$/);
  });
});
