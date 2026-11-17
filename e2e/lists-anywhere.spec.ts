import type { Page } from '@playwright/test';
import { expect, openLive, SEED, test } from './fixtures';

/**
 * Lists retired with v2: #328 made each list a checklist note, their own
 * pages went with #329, and the project page's Lists section with the
 * project room (#334). New list is no longer in +, ⌘K or Shift+L.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const newList = (page: Page) => page.getByRole('dialog', { name: 'New list' });

test('New list is gone from + and ⌘K, and Shift+L does nothing', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await expect(page.getByRole('menuitem', { name: 'New list' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('New list');
  await expect(palette.getByRole('option', { name: 'New list' })).toHaveCount(
    0,
  );
  await page.keyboard.press('Escape');
  await page.locator('body').press('Shift+L');
  await expect(newList(page)).toHaveCount(0);
});
