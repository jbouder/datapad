import { COMMANDS, FORMAT_SHORTCUTS } from '../shared/composer';
import { PAGES } from '../shared/pages';
import { SHORTCUTS } from '../shared/shortcuts';
import { expect, openHelp, openLive, test } from './fixtures';

/**
 * The Help page's tables come from the lists the app binds, so every
 * shortcut, `/` command, formatting key and layout is on it. (Every
 * theme's axe check and the 320px reflow check for /help are in
 * a11y.spec.ts and reflow.spec.ts.)
 */

test('says which build is running (#237)', async ({ page, request }) => {
  const health = (await (await request.get('/api/health')).json()) as {
    ok: boolean;
    version: string;
    commit: string;
  };
  expect(health.ok).toBe(true);
  expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
  await openLive(page, '/help');
  await expect(
    page.getByRole('region', { name: 'What Datapad is' }).getByTestId('build'),
  ).toContainText(
    `Datapad ${health.version}, built from commit ${health.commit}`,
  );
});

test('lists every page’s layouts', async ({ page }) => {
  await openLive(page, '/help');
  const layouts = page.getByRole('table', { name: 'Layouts' });
  const pages = Object.values(PAGES).filter((p) =>
    p.fields.some((f) => f.key === 'view' && f.options),
  );
  await expect(layouts.getByRole('row')).toHaveCount(pages.length + 1);
  for (const p of pages) {
    const field = p.fields.find((f) => f.key === 'view');
    const row = layouts.getByRole('row', { name: new RegExp(`^${p.label} `) });
    await expect(row).toContainText(p.label);
    for (const o of field?.options ?? []) {
      await expect(row).toContainText(o.label);
    }
  }
});

test('lists every shortcut, / command and formatting key', async ({ page }) => {
  await openLive(page, '/help');
  const keyboard = page.getByRole('region', { name: 'Keyboard' });
  for (const s of SHORTCUTS) {
    await expect(keyboard).toContainText(s.action);
  }
  const commands = page.getByRole('table', { name: '/ commands' });
  await expect(commands.getByRole('row')).toHaveCount(COMMANDS.length + 1);
  for (const c of COMMANDS) {
    await expect(commands).toContainText(`/${c.id}`);
  }
  const keys = page.getByRole('table', { name: 'Formatting keys' });
  await expect(keys.getByRole('row')).toHaveCount(FORMAT_SHORTCUTS.length + 1);
  await expect(keys).toContainText('⌘/Ctrl+Shift+X');
});

test('each section has its own address', async ({ page }) => {
  await openLive(page, '/help');
  await page
    .getByRole('navigation', { name: 'On this page' })
    .getByRole('link', { name: 'Summaries' })
    .click();
  await expect(page).toHaveURL(/\/help#summaries$/);
  await expect(
    page.getByRole('heading', { name: 'Summaries', level: 2 }),
  ).toBeInViewport();

  await page.goto('/help#data');
  await expect(
    page.getByRole('heading', { name: 'Your data', level: 2 }),
  ).toBeInViewport();
});

test('the account menu opens it', async ({ page }) => {
  await openLive(page, '/');
  await openHelp(page);
  await expect(page).toHaveURL(/\/help$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Help' }),
  ).toBeVisible();
});

test('? leads to it too', async ({ page }) => {
  await openLive(page, '/');
  await page.locator('body').press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await sheet.getByRole('link', { name: 'Help' }).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/help#keyboard$/);
  await expect(
    page.getByRole('heading', { name: 'Keyboard', level: 2 }),
  ).toBeInViewport();
});
