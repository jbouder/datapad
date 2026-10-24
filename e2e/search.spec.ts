import type { Page } from '@playwright/test';
import { expect, isMobile, openLive, SEED, test } from './fixtures';

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search' });
const input = (page: Page) => palette(page).getByRole('combobox');

async function openPalette(page: Page) {
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(input(page)).toBeFocused();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('the trigger shows its shortcut; ⌘K, Ctrl+K and / open search', async ({
  page,
}) => {
  await openLive(page);
  const trigger = page.getByRole('button', { name: 'Search' });
  if (!isMobile(page)) await expect(trigger).toContainText(/⌘K|Ctrl K/);
  await page.locator('body').press('/');
  await expect(palette(page)).toBeVisible();
  // Empty: the most recent projects, then the actions.
  await expect(
    palette(page).getByRole('group', { name: 'Recent projects' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(trigger).toBeVisible();
  for (const keys of ['Meta+k', 'Control+k']) {
    await page.keyboard.press(keys);
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press(keys);
    await expect(palette(page)).toBeHidden();
  }
});

test('search a task title and open it in its panel', async ({ page }) => {
  await openLive(page);
  await openPalette(page);
  await input(page).fill('shield delivery');
  const tasks = palette(page).getByRole('group', { name: 'Tasks' });
  await expect(tasks.getByRole('option')).toHaveCount(1);
  await expect(tasks.getByRole('option')).toContainText(
    'Confirm shield generator delivery',
  );
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Confirm shield generator delivery',
  );

  // Over the panel, Esc closes the palette first, then the panel.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('a word from a note body lands on the note', async ({ page }) => {
  const body = SEED.notes['n-1'].body;
  const word = (body.match(/[A-Za-z]{7,}/g) ?? [])[1] ?? 'power';
  await openLive(page);
  await openPalette(page);
  await input(page).fill(word);
  const notes = palette(page).getByRole('group', { name: 'Notes' });
  await notes.getByRole('option').first().click();
  await expect(page).toHaveURL(/\/notes\?note=/);
  await expect(page.locator('[data-highlighted]')).toContainText(word);
});

test('archived items are marked; people open their detail', async ({
  page,
}) => {
  await openLive(page);
  await openPalette(page);
  await input(page).fill('yavin');
  await expect(
    palette(page)
      .getByRole('group', { name: 'Projects' })
      .getByRole('option')
      .first(),
  ).toContainText('Archived');
  await input(page).fill('chewbacca');
  await palette(page)
    .getByRole('group', { name: 'People' })
    .getByRole('option')
    .first()
    .click();
  await expect(page).toHaveURL(/\/people\/u-chewie$/);
});

test('the New task action opens the new-task panel', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  await openPalette(page);
  await input(page).fill('new task');
  await expect(palette(page).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'New task' });
  await expect(panel).toBeVisible();
  // Preset to the project you were on.
  await expect(panel.getByRole('combobox', { name: 'Project' })).toHaveValue(
    'Echo Base relocation',
  );
});
