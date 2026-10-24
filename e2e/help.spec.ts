import { COMMANDS, FORMAT_SHORTCUTS } from '../shared/composer';
import { SHORTCUTS } from '../shared/shortcuts';
import { expect, openLive, test } from './fixtures';

/**
 * The Help page's tables come from the lists the app binds, so every
 * shortcut, `/` command and formatting key is on it. (Every theme's axe
 * check and the 320px reflow check for /help are in a11y.spec.ts and
 * reflow.spec.ts.)
 */

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

test('the header’s question mark opens it', async ({ page }) => {
  await openLive(page, '/');
  await page.getByRole('link', { name: 'Help' }).click();
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
