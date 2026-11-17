import type { Page } from '@playwright/test';
import { expect, openLive, SEED, test } from './fixtures';

/**
 * Lists retired with v2: #328 made each list a checklist note, their own
 * pages went with #329, and the project page's Lists section with the
 * project room (#334). The top bar's + went with #341. Nothing offers a
 * new list, and search shows no lists.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const newList = (page: Page) => page.getByRole('dialog', { name: 'New list' });

test('nothing offers a new list, and search shows no lists', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Add', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('New list');
  await expect(palette.getByRole('option', { name: 'New list' })).toHaveCount(
    0,
  );
  await palette.getByRole('combobox').fill('Evacuation checklist');
  // The seed's lists are kept in the data; search no longer shows them.
  await expect(palette).toContainText('Nothing matches');
  await expect(palette.getByRole('group', { name: 'Lists' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('body').press('Shift+L');
  await expect(newList(page)).toHaveCount(0);
});
