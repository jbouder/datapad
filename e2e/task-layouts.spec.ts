import type { Page } from '@playwright/test';
import { expect, expectAccessible, openLive, SEED, test } from './fixtures';

const column = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Tasks board' })
    .getByRole('region', { name, exact: true });

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('the project page has List and Board', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const group = page.getByRole('group', { name: 'Layout (press v to cycle)' });
  await group
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Board' }) })
    .click();
  await expect(column(page, 'This week')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tasks board' })).toContainText(
    'Book the tauntaun vet',
  );
});

for (const view of ['list', 'table', 'board', 'timeline']) {
  test.describe(`${view} layout`, () => {
    test.use({ reducedMotion: 'reduce' });
    test('is axe clean', async ({ page }) => {
      await openLive(page, `/tasks?view=${view}`);
      await expectAccessible(page);
    });
  });
}
