import type { Page } from '@playwright/test';
import {
  closeFilters,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isMobile,
  openFilters,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * The list toolbar (#269): Find (debounced into `?q=`, a clear button,
 * `f` to reach it, Esc to clear and leave it), the page's filters and
 * Sort, Clear filters, and on phones the Filters (n) sheet.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const titles = (page: Page) =>
  page.locator('[data-task-title]').filter({ visible: true });

test('Find filters after a pause, without a history entry per key, and clears', async ({
  page,
}) => {
  await openLive(page, '/settings');
  await page.goto('/tasks?group=none');
  const find = page.getByRole('searchbox', { name: 'Find' });
  await find.pressSequentially('motivator');
  await expect(page).toHaveURL(/q=motivator/);
  await expect(titles(page)).toHaveText(['Find a replacement motivator']);

  // The × empties it at once, and the list comes back.
  await page.getByRole('button', { name: 'Clear Find' }).click();
  await expect(find).toHaveValue('');
  await expect(page).not.toHaveURL(/q=/);
  await expect(titles(page)).toHaveCount(5);

  // Typing replaced the entry rather than adding to history.
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
});

test('f goes to Find; Esc clears it, then leaves it', async ({ page }) => {
  test.skip(isMobile(page), 'Keyboard shortcut');
  await openLive(page, '/notes?view=list');
  const find = page.getByRole('searchbox', { name: 'Find' });
  await page.locator('body').press('f');
  await expect(find).toBeFocused();
  await page.keyboard.type('chewba');
  await expect(page).toHaveURL(/q=chewba/);
  await page.keyboard.press('Escape');
  await expect(find).toHaveValue('');
  await expect(find).toBeFocused();
  await expect(page).not.toHaveURL(/q=/);
  await page.keyboard.press('Escape');
  await expect(find).not.toBeFocused();

  // Tasks too.
  await openLive(page, '/tasks');
  await page.locator('body').press('f');
  await expect(page.getByRole('searchbox', { name: 'Find' })).toBeFocused();
});

test('filtered to nothing: None match, and Clear filters keeps the sort', async ({
  page,
}) => {
  await openLive(page, '/tasks?status=done&sort=title&q=zzzz');
  await expect(page.getByText('None match these filters.')).toBeVisible();
  if (isMobile(page)) {
    await expect(
      page.getByRole('button', { name: 'Filters (1)' }),
    ).toBeVisible();
  }
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Clear filters' })
    .last()
    .click();
  await expect(page).not.toHaveURL(/status=|q=/);
  await expect(page).toHaveURL(/sort=title/);
  await expect(page.getByRole('searchbox', { name: 'Find' })).toHaveValue('');
  await expect(titles(page).first()).toBeVisible();
  await expect(page.getByText('None match these filters.')).toBeHidden();
  if (isMobile(page)) {
    await expect(
      page.getByRole('button', { name: 'Filters', exact: true }),
    ).toBeVisible();
  } else {
    // Nothing filtered: the toolbar has no Clear filters.
    await expect(
      page.getByRole('button', { name: 'Clear filters' }),
    ).toHaveCount(0);
  }
});

test('Sort in the toolbar writes the same address as the column headers', async ({
  page,
}) => {
  await openLive(page, '/tasks?group=none');
  const filters = await openFilters(page);
  await filters.getByRole('combobox', { name: 'Sort', exact: true }).click();
  await page.getByRole('option', { name: 'Title', exact: true }).click();
  await expect(page).toHaveURL(/sort=title/);
  await filters.getByRole('button', { name: 'Order: ascending' }).click();
  await expect(page).toHaveURL(/dir=desc/);
  await expect(
    filters.getByRole('button', { name: 'Order: descending' }),
  ).toBeVisible();
  await closeFilters(page);
  await expect(titles(page).first()).toHaveText('Renew the docking permit');
});

test('desktop: the filters sit in the toolbar, axe clean', async ({ page }) => {
  test.skip(isMobile(page), 'The phone has the sheet.');
  await openLive(page, '/tasks?status=blocked');
  const main = page.getByRole('main');
  await expect(main.getByRole('group', { name: 'Status' })).toBeVisible();
  await expect(main.getByRole('combobox', { name: 'Group by' })).toBeVisible();
  await expect(main.getByRole('combobox', { name: 'Assignee' })).toBeVisible();
  await expect(
    main.getByRole('combobox', { name: 'Sort', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Filters/ })).toHaveCount(0);
  await expect(
    main.getByRole('button', { name: 'Clear filters' }).first(),
  ).toBeVisible();
  await expectAccessible(page);
  await openLive(page, '/notes');
  await expectAccessible(page);
});

test('phone: Find and a Filters sheet with the rest', async ({ page }) => {
  test.skip(!isMobile(page), 'The sheet is the phone layout.');
  await openLive(page, '/tasks');
  await expect(page.getByRole('searchbox', { name: 'Find' })).toBeVisible();
  // The filters are not on the page itself.
  await expect(page.getByRole('combobox', { name: 'Group by' })).toHaveCount(0);
  const button = page.getByRole('button', { name: 'Filters', exact: true });
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expectNoSidewaysScroll(page);

  const sheet = await openFilters(page);
  await sheet
    .getByRole('group', { name: 'Status' })
    .locator('label', { hasText: 'Blocked' })
    .click();
  await expect(page).toHaveURL(/status=blocked/);
  await expect(sheet.getByRole('combobox', { name: 'Group by' })).toBeVisible();
  await expect(sheet.getByRole('combobox', { name: 'Assignee' })).toBeVisible();
  await expect(
    sheet.getByRole('combobox', { name: 'Sort', exact: true }),
  ).toBeVisible();
  for (const name of ['Clear filters', 'Done']) {
    const box = await sheet.getByRole('button', { name }).boundingBox();
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
  }
  await expectAccessible(page);
  await closeFilters(page);
  await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeFocused();
  await expectAccessible(page);

  await openLive(page, '/notes');
  const notes = await openFilters(page);
  await expect(notes.getByRole('group', { name: 'Show' })).toBeVisible();
  await expectAccessible(page);
});
