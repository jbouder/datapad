import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * A project's lists on its page (#301). Lists' own pages went with v2
 * (#329), since #328 made each list a checklist note: a list's title opens
 * the list panel, and New list is no longer in +, ⌘K or Shift+L. The
 * seed's Evacuation checklist is on Echo Base; Hyperdrive parts, every
 * item done, on the Falcon.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const newList = (page: Page) => page.getByRole('dialog', { name: 'New list' });

/** The project page's Lists section's rows. */
const rows = (page: Page) =>
  page.getByRole('list', { name: 'Lists', exact: true }).getByRole('listitem');

test('the project page shows its lists; Add list starts one there', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  const section = page.getByRole('button', { name: /^Lists/ });
  await expect(section).toHaveAttribute('aria-expanded', 'true');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Evacuation checklist');
  await expect(rows(page).first()).toContainText('1 of 4');
  // Its first open item, not the items themselves.
  await expect(rows(page).first()).toContainText('Load the transports');
  await expect(rows(page).first()).not.toContainText('Brief the pilots');
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  await page.getByRole('button', { name: 'Add list', exact: true }).click();
  await expect(
    newList(page).getByRole('combobox', { name: 'Project' }),
  ).toHaveValue('Echo Base relocation');
  await newList(page)
    .getByRole('textbox', { name: 'Title' })
    .fill('Hangar drills');
  await newList(page).getByRole('button', { name: 'Add list' }).click();
  await expect(newList(page)).toBeHidden();

  // Still on the project: the new one first (in progress, most recent).
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Hangar drills');
  await expect(rows(page).first()).toContainText('No items');
  await rows(page)
    .getByRole('button', { name: 'Evacuation checklist' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Edit list' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A done list is muted; a project with none says so.
  await page.goto('/projects/p-falcon');
  await expect(rows(page).first()).toContainText('Hyperdrive parts');
  await expect(rows(page).first()).toContainText('Done');
  await expect(rows(page).first()).toHaveAttribute('data-done', 'true');
  await page.goto('/projects/p-yavin');
  await expect(page.getByText('No lists yet')).toBeVisible();

  // Collapsible, and remembered for every project's page.
  await page.getByRole('button', { name: /^Lists/ }).click();
  await expect(page.getByText('No lists yet')).toBeHidden();
  await expectSaved(page);
  await page.goto('/projects/p-echo');
  await expect(page.getByRole('button', { name: /^Lists/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(rows(page)).toBeHidden();
});

test('New list is gone from + and ⌘K, and Shift+L does nothing', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await expect(page.getByRole('menuitem', { name: 'New list' })).toHaveCount(
    0,
  );
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
