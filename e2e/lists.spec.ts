import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  openLive,
  openPreferences,
  SEED,
  test,
} from './fixtures';

/**
 * Lists (#299): the Lists page, a list's page and the section in the
 * rail. The seed has three: Reading list (General), Evacuation checklist
 * (Echo Base, one of four done) and Hyperdrive parts (every item done).
 */

interface Stored {
  lists: Record<
    string,
    { title: string; items: { id: string; text: string; done: boolean }[] }
  >;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const EVAC = '/lists/l-evac';

/** The open items' text, in order. */
function openItems(page: Page, list = 'Evacuation checklist') {
  return page
    .getByRole('list', { name: `Items on “${list}”` })
    .locator('[data-item-text]');
}

const cards = (page: Page) => page.locator('[data-list-card]');

/** Tick or untick an item: its checkbox's 44px label, as a finger would. */
async function tick(page: Page, text: string) {
  const box = page.getByRole('checkbox', { name: `Done: “${text}”` });
  await page.locator('label', { has: box }).click();
}

test('the Lists page finds, filters and opens a list', async ({ page }) => {
  await openLive(page, '/lists');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lists' }),
  ).toBeVisible();
  // Most recently updated first; each card has its project and progress.
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).first()).toContainText('Evacuation checklist');
  await expect(cards(page).first()).toContainText('Echo Base relocation');
  await expect(cards(page).first()).toContainText('1 of 4');
  await expect(cards(page).first()).toContainText('Load the transports');
  await expect(
    cards(page).filter({ hasText: 'Hyperdrive parts' }),
  ).toContainText('Done');
  await expect(cards(page).filter({ hasText: 'Reading list' })).toContainText(
    'General',
  );
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Find looks in the items too.
  await page.getByRole('searchbox', { name: 'Find' }).fill('hangar');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText('Evacuation checklist');
  await page.getByRole('searchbox', { name: 'Find' }).fill('nothing like it');
  await expect(page.getByText('None match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(cards(page)).toHaveCount(3);

  // Show Done, from the address as a link would.
  await page.goto('/lists?show=done');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText('Hyperdrive parts');

  // The table (rows on a phone), and a row opens the list.
  await page.goto('/lists?view=table');
  await expect(page.getByRole('link', { name: 'Reading list' })).toBeVisible();
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
  await page.getByRole('link', { name: 'Reading list' }).click();
  await expect(page).toHaveURL(/\/lists\/l-reading$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Reading list' }),
  ).toBeVisible();
});

test('New list lands on its page; items are added and ticked', async ({
  page,
  request,
}) => {
  await openLive(page, '/lists');
  await page.getByRole('button', { name: 'New list' }).click();
  const panel = page.getByRole('dialog', { name: 'New list' });
  await expect(panel.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await panel.getByRole('textbox', { name: 'Title' }).fill('Base supplies');
  await panel.getByRole('button', { name: 'Add list' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Base supplies' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/lists\/[^/]+$/);
  await expect(page.getByText('No items yet')).toBeVisible();

  // Add an item: Enter adds and keeps the field; Escape closes it.
  const add = page.getByRole('button', { name: 'Add an item' });
  await add.click();
  const field = page.getByRole('textbox', {
    name: 'Add an item to “Base supplies”',
  });
  await field.fill('Thermal blankets');
  await field.press('Enter');
  await field.fill('Ration packs');
  await field.press('Enter');
  await expect(field).toBeFocused();
  await field.press('Escape');
  await expect(add).toBeFocused();
  await expect(openItems(page, 'Base supplies')).toHaveText([
    'Thermal blankets',
    'Ration packs',
  ]);
  await expect(page.locator('[data-list-progress]')).toHaveText('0 of 2');

  // Tick one: it leaves the open items for Done (1), collapsed.
  await tick(page, 'Thermal blankets');
  await expect(openItems(page, 'Base supplies')).toHaveText(['Ration packs']);
  await expect(page.locator('[data-list-progress]')).toHaveText('1 of 2');
  const done = page.getByRole('button', { name: /^Done \(1\)/ });
  await expect(done).toHaveAttribute('aria-expanded', 'false');
  await done.click();
  const untick = page.getByRole('checkbox', {
    name: 'Done: “Thermal blankets”',
  });
  await expect(untick).toBeChecked();
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
  await tick(page, 'Thermal blankets');
  await expect(untick).not.toBeChecked();
  await expect(openItems(page, 'Base supplies')).toHaveText([
    'Thermal blankets',
    'Ration packs',
  ]);

  // Edit in place: Enter opens the field and saves.
  await openItems(page, 'Base supplies').first().click();
  const edit = page.getByRole('textbox', { name: 'Edit “Thermal blankets”' });
  await edit.fill('Thermal blankets, twelve');
  await edit.press('Enter');
  await expect(openItems(page, 'Base supplies').first()).toHaveText(
    'Thermal blankets, twelve',
  );

  await expectSaved(page);
  const lists = Object.values((await stored(request)).lists);
  const made = lists.find((l) => l.title === 'Base supplies');
  expect(made?.items.map((i) => [i.text, i.done])).toEqual([
    ['Thermal blankets, twelve', false],
    ['Ration packs', false],
  ]);
});

test('reorder by keyboard: the menu, and Alt+arrows', async ({
  page,
  request,
}) => {
  await openLive(page, EVAC);
  await expect(openItems(page)).toHaveText([
    'Load the transports',
    'Brief the pilots',
    'Seal the hangar doors',
  ]);

  const more = page.getByRole('button', {
    name: 'More for “Seal the hangar doors”',
  });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('menuitem', { name: 'Move down' }),
  ).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Move to top' }).focus();
  await page.keyboard.press('Enter');
  await expect(openItems(page)).toHaveText([
    'Seal the hangar doors',
    'Load the transports',
    'Brief the pilots',
  ]);
  await expect(
    page.getByRole('status').filter({ hasText: 'Moved' }),
  ).toHaveText('Moved “Seal the hangar doors” to position 1 of 3');

  await openItems(page).nth(0).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(openItems(page)).toHaveText([
    'Load the transports',
    'Seal the hangar doors',
    'Brief the pilots',
  ]);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(openItems(page)).toHaveText([
    'Load the transports',
    'Brief the pilots',
    'Seal the hangar doors',
  ]);
  await expect(openItems(page).nth(2)).toBeFocused();

  await expectSaved(page);
  await page.reload();
  await expect(openItems(page)).toHaveText([
    'Load the transports',
    'Brief the pilots',
    'Seal the hangar doors',
  ]);
  // The done item kept its place in the stored order.
  expect(
    (await stored(request)).lists['l-evac']?.items.map((i) => i.id),
  ).toEqual(['li-e1', 'li-e2', 'li-e3', 'li-e4']);
});

test('reorder by dragging the handle', async ({ page }) => {
  test.skip(isMobile(page), 'Drag is the desktop path.');
  await openLive(page, EVAC);
  const rows = page
    .getByRole('list', { name: 'Items on “Evacuation checklist”' })
    .locator('li');
  const handle = rows.nth(2).locator('[title="Drag to reorder"]');
  await handle.hover();
  await page.mouse.down();
  await handle.dragTo(rows.nth(0));
  await page.mouse.up();
  await expect(openItems(page)).toHaveText([
    'Seal the hangar doors',
    'Load the transports',
    'Brief the pilots',
  ]);
});

test('delete an item and the list, each with Undo', async ({
  page,
  request,
}) => {
  await openLive(page, EVAC);
  await page
    .getByRole('button', { name: 'More for “Brief the pilots”' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(openItems(page)).toHaveText([
    'Load the transports',
    'Seal the hangar doors',
  ]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(openItems(page)).toHaveText([
    'Load the transports',
    'Brief the pilots',
    'Seal the hangar doors',
  ]);

  // The list: More → Delete asks in place first.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const ask = page.getByRole('alertdialog');
  await expect(ask).toContainText(
    'Delete “Evacuation checklist” and its 4 items?',
  );
  await expect(ask.getByRole('button', { name: 'Keep it' })).toBeFocused();
  await ask.getByRole('button', { name: 'Delete list' }).click();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(cards(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(cards(page)).toHaveCount(3);
  await expectSaved(page);
  expect(
    (await stored(request)).lists['l-evac']?.items.map((i) => i.text),
  ).toEqual([
    'Charge the ion cannon',
    'Load the transports',
    'Brief the pilots',
    'Seal the hangar doors',
  ]);
});

test('an unknown list is not found', async ({ page }) => {
  await openLive(page, '/lists/nope');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Not found' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Lists' })).toBeVisible();
});

/** The visible section links: the rail's on desktop, the tab bar's on phones. */
function sections(page: Page) {
  return page
    .getByRole('navigation', { name: 'Sections' })
    .filter({ visible: true })
    .first()
    .locator('ul')
    .first()
    .getByRole('link');
}

test('Lists is a section after Notes (off the phone’s tab bar), and Settings hides it', async ({
  page,
}) => {
  await openLive(page, '/settings/navigation');
  const lists = sections(page).filter({ hasText: 'Lists' });
  if (isMobile(page)) {
    // Not on the tab bar by default: the account menu has it.
    await expect(lists).toHaveCount(0);
    await openPreferences(page);
    await page.getByRole('menuitem', { name: 'Lists' }).click();
    await expect(page).toHaveURL(/\/lists$/);
    await page.goto('/settings/navigation');
    // Phone puts it on the tab bar, after Notes.
    await page.getByRole('switch', { name: 'Lists on the phone' }).click();
    await expect(sections(page)).toHaveText([
      /Focus/,
      /Projects/,
      /Tasks/,
      /Meetings/,
      /Notes/,
      /Lists/,
    ]);
  } else {
    await expect(sections(page).nth(5)).toHaveText(/Lists/);
    await lists.click();
    await expect(page).toHaveURL(/\/lists$/);
    await expect(lists).toHaveAttribute('aria-current', 'page');
    await page.goto('/settings/navigation');
  }
  await expectAccessible(page);

  await page.getByRole('switch', { name: 'Show Lists', exact: true }).click();
  await expect(sections(page).filter({ hasText: 'Lists' })).toHaveCount(0);
  if (isMobile(page)) {
    await openPreferences(page);
    await expect(page.getByRole('menuitem', { name: 'Lists' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  // Hidden, it still opens from its address.
  await page.goto(EVAC);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Evacuation checklist' }),
  ).toBeVisible();
});
