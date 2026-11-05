import type { APIRequestContext, Page } from '@playwright/test';
import {
  addFromTopBar,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * Lists from anywhere (#300): + (once shown), ⌘K and Shift+L; ⌘K finds
 * lists by title and item. And a project's lists on its page, and Make
 * task from an item (#301). The seed's Evacuation checklist is on Echo
 * Base; Hyperdrive parts, every item done, on the Falcon.
 */

interface Stored {
  tasks: Record<
    string,
    { title: string; projectId: string | null; sourceNoteId?: string }
  >;
  lists: Record<string, { title: string; items: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search' });
const input = (page: Page) => palette(page).getByRole('combobox');

async function openPalette(page: Page) {
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(input(page)).toBeFocused();
}

const newList = (page: Page) => page.getByRole('dialog', { name: 'New list' });

/** The project page's Lists section's rows. */
const rows = (page: Page) =>
  page.getByRole('list', { name: 'Lists', exact: true }).getByRole('listitem');

test('+ offers New list once shown, preset to the project; hiding Lists takes it away', async ({
  page,
}) => {
  await openLive(page, '/settings/navigation');
  await page.getByRole('switch', { name: 'Show New list' }).click();
  await expectSaved(page);

  await page.goto('/projects/p-echo');
  await addFromTopBar(page, 'New list');
  await expect(newList(page)).toBeVisible();
  await expect(
    newList(page).getByRole('combobox', { name: 'Project' }),
  ).toHaveValue('Echo Base relocation');
  await expectAccessible(page);
  await newList(page)
    .getByRole('textbox', { name: 'Title' })
    .fill('Hangar drills');
  await newList(page).getByRole('button', { name: 'Add list' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Hangar drills' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/lists\/[^/]+$/);

  // Hide the Lists section: + and ⌘K leave New list out.
  await page.goto('/settings/navigation');
  await page.getByRole('switch', { name: 'Show Lists', exact: true }).click();
  await expectSaved(page);
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /New list/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await openPalette(page);
  await input(page).fill('new list');
  await expect(
    palette(page).getByRole('option', { name: /New list/ }),
  ).toHaveCount(0);
  // Search still finds the lists there are.
  await input(page).fill('hangar drills');
  await expect(
    palette(page).getByRole('group', { name: 'Lists' }).getByRole('option'),
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  if (!isMobile(page)) {
    await page.locator('body').press('Shift+L');
    await expect(newList(page)).toHaveCount(0);
  }
});

test('⌘K finds a list by an item and by its title, and offers New list', async ({
  page,
}) => {
  await openLive(page);
  await openPalette(page);
  await input(page).fill('hangar doors');
  const lists = palette(page).getByRole('group', { name: 'Lists' });
  await expect(lists.getByRole('option')).toHaveCount(1);
  // The item that matched is the snippet.
  await expect(lists.getByRole('option')).toContainText('Evacuation checklist');
  await expect(lists.getByRole('option')).toContainText(
    'Seal the hangar doors',
  );
  await expectAccessible(page);
  await lists.getByRole('option').click();
  await expect(page).toHaveURL(/\/lists\/l-evac$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Evacuation checklist' }),
  ).toBeVisible();

  await openPalette(page);
  await input(page).fill('hyperdrive');
  await expect(lists.getByRole('option')).toHaveText(/Hyperdrive parts/);

  await input(page).fill('new list');
  await palette(page)
    .getByRole('option', { name: /New list/ })
    .click();
  await expect(newList(page)).toBeVisible();
  await newList(page).getByRole('textbox', { name: 'Title' }).fill('Errands');
  await newList(page).getByRole('button', { name: 'Add list' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Errands' }),
  ).toBeVisible();
});

test('Shift+L opens New list; on a list’s page it adds an item', async ({
  page,
}) => {
  test.skip(isMobile(page), 'A keyboard shortcut.');
  await openLive(page, '/projects/p-echo');
  await page.locator('body').press('Shift+L');
  await expect(newList(page)).toBeVisible();
  await expect(
    newList(page).getByRole('combobox', { name: 'Project' }),
  ).toHaveValue('Echo Base relocation');
  await page.keyboard.press('Escape');
  await expect(newList(page)).toHaveCount(0);

  await page.goto('/lists/l-evac');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Evacuation checklist' }),
  ).toBeVisible();
  await page.locator('body').press('Shift+L');
  await expect(
    page.getByRole('textbox', {
      name: 'Add an item to “Evacuation checklist”',
    }),
  ).toBeFocused();
  await expect(newList(page)).toHaveCount(0);

  // The shortcut sheet lists it, from SHORTCUTS.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add an item' })).toBeFocused();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toContainText(
    'New list (on a list’s page: add an item to it)',
  );
});

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
  await expect(
    page.getByRole('heading', { level: 1, name: 'Hangar drills' }),
  ).toBeVisible();

  // Back on the project: the new one first (in progress, most recent).
  await page.goto('/projects/p-echo');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Hangar drills');
  await expect(rows(page).first()).toContainText('No items');
  await rows(page).getByRole('link', { name: 'Evacuation checklist' }).click();
  await expect(page).toHaveURL(/\/lists\/l-evac$/);

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

test('Make task from an item: the panel preset, the item left as it is', async ({
  page,
  request,
}) => {
  await openLive(page, '/lists/l-evac');
  await page
    .getByRole('button', { name: 'More for “Brief the pilots”' })
    .click();
  await page.getByRole('menuitem', { name: 'Make task' }).click();
  const panel = page.getByRole('dialog', { name: 'New task' });
  await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Brief the pilots',
  );
  await expect(panel.getByRole('combobox', { name: 'Project' })).toHaveValue(
    'Echo Base relocation',
  );
  await expectAccessible(page);
  await panel.getByRole('button', { name: 'Add task' }).click();
  await expect(panel).toBeHidden();

  // The toast offers Open.
  await expect(
    page.getByText('Added “Brief the pilots” to Echo Base relocation'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Task' })
      .getByRole('textbox', { name: 'Title' }),
  ).toHaveValue('Brief the pilots');
  await page.keyboard.press('Escape');

  // The item is still there, still open.
  await expect(
    page.getByRole('checkbox', { name: 'Done: “Brief the pilots”' }),
  ).not.toBeChecked();
  await expectSaved(page);
  const data = await stored(request);
  const made = Object.values(data.tasks).filter(
    (t) => t.title === 'Brief the pilots',
  );
  expect(made).toHaveLength(1);
  expect(made[0]?.projectId).toBe('p-echo');
  expect(data.lists['l-evac']?.items.map((i) => i.text)).toContain(
    'Brief the pilots',
  );
});
