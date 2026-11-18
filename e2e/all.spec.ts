import {
  chooseFilter,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isMobile,
  noteRow,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * All (#337): every kind in one list, the kind chips, Find, the filters
 * that follow the kinds, the address keeping them, and the Rooms chip.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const items = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'Items' });

test('every kind in one list; chips, filters and the address agree', async ({
  page,
}) => {
  await openLive(page, '/all');
  await expect(
    page.getByRole('heading', { level: 1, name: 'All' }),
  ).toBeVisible();
  // Open items of every kind: a task, a note, a project, a person.
  await expect(items(page)).toContainText('Renew the docking permit');
  await expect(items(page)).toContainText('Fewer moons');
  await expect(items(page)).toContainText('Echo Base relocation');
  await expect(items(page)).toContainText('Leia Organa');
  // Archived: Yavin's report and its project are not open.
  await expect(items(page)).not.toContainText('Write the Yavin report');
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Tasks only: the task filters appear, and the address says so.
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await expect(page).toHaveURL(/\/all\?kind=task$/);
  await expect(
    items(page).getByRole('link', { name: 'Mon Mothma' }),
  ).toHaveCount(0);
  await chooseFilter(page, 'Room', 'Echo Base relocation');
  await expect(page).toHaveURL(/\/all\?kind=task&room=p-echo$/);
  await expect(items(page).locator('[data-task-id]')).toHaveCount(3);
  await expect(items(page)).not.toContainText('Renew the docking permit');
  await chooseFilter(page, 'Status', 'Done or past');
  await expect(items(page).locator('[data-task-id]')).toHaveText([
    /Survey the north ridge/,
  ]);
  await expectAccessible(page);

  // Back restores the open tasks; a reload keeps everything.
  await page.goBack();
  await expect(page).toHaveURL(/\/all\?kind=task&room=p-echo$/);
  await page.reload();
  await expect(items(page).locator('[data-task-id]')).toHaveCount(3);
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Tasks', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expectNoSidewaysScroll(page);
});

test('find a note and open it in place', async ({ page }) => {
  await openLive(page, '/all?kind=note');
  await page.getByRole('searchbox', { name: 'Find' }).fill('moons');
  await expect(page).toHaveURL(/\/all\?kind=note&q=moons$/);
  const row = noteRow(page, 'Fewer moons');
  await expect(items(page).locator('li[data-note-id]')).toHaveCount(1);
  await row.getByRole('button', { name: /^Note from / }).click();
  await expect(
    row.getByRole('button', { name: /^Note from / }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toContainText('More heaters');

  // A note's link (⌘K, a task's From note) opens and shows it.
  await openLive(page, '/all?kind=note&note=n-3');
  await expect(
    noteRow(page, 'Fewer moons').getByRole('button', { name: /^Note from / }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expectAccessible(page);
});

test('the Rooms chip: on, off, the address and the kinds', async ({ page }) => {
  await openLive(page, '/all?kind=task&room=p-echo');
  const main = page.getByRole('main');
  const chip = (name: string) =>
    main.getByRole('button', { name, exact: true });
  const rooms = main.getByRole('region', { name: 'Rooms' });
  await expect(chip('Rooms')).toHaveAttribute('aria-pressed', 'false');
  await expect(rooms).toHaveCount(0);
  await expect(main.getByRole('searchbox', { name: 'Find' })).toBeVisible();

  // On: the rooms in place of the items, the kinds and filters cleared,
  // and none of the item toolbar.
  await chip('Rooms').click();
  await expect(page).toHaveURL(/\/all\?show=rooms$/);
  await expect(chip('Rooms')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('Tasks')).toHaveAttribute('aria-pressed', 'false');
  await expect(
    rooms.getByRole('link', { name: 'Echo Base relocation' }),
  ).toBeVisible();
  await expect(items(page)).toHaveCount(0);
  await expect(main.getByRole('searchbox')).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Save view' })).toHaveCount(0);
  await expect(main.getByText(/^\d+ items?$/)).toHaveCount(0);
  const box = await chip('Rooms').boundingBox();
  if (isMobile(page))
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // A reload keeps it.
  await page.reload();
  await expect(chip('Rooms')).toHaveAttribute('aria-pressed', 'true');
  await expect(rooms).toBeVisible();

  // A kind turns it off.
  await chip('Notes').click();
  await expect(page).toHaveURL(/\/all\?kind=note$/);
  await expect(chip('Rooms')).toHaveAttribute('aria-pressed', 'false');
  await expect(rooms).toHaveCount(0);
  await expect(items(page)).toContainText('Fewer moons');

  // On again clears the kind; off is plain All.
  await chip('Rooms').click();
  await expect(page).toHaveURL(/\/all\?show=rooms$/);
  await expect(chip('Notes')).toHaveAttribute('aria-pressed', 'false');
  await chip('Rooms').click();
  await expect(page).toHaveURL(/\/all$/);
  await expect(rooms).toHaveCount(0);
  await expect(items(page)).toContainText('Leia Organa');

  // Back goes back to the rooms.
  await page.goBack();
  await expect(page).toHaveURL(/\/all\?show=rooms$/);
  await expect(rooms).toBeVisible();
});

test('the rooms: open a project room, pin a person', async ({ page }) => {
  await openLive(page, '/all?show=rooms');
  const rooms = page.getByRole('main').getByRole('region', { name: 'Rooms' });
  await expect(
    rooms.getByRole('heading', { name: 'Rebel Alliance' }),
  ).toBeVisible();
  const pin = rooms.getByRole('button', { name: 'Pin Han Solo' });
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  if (!isMobile(page)) {
    await expect(
      page
        .getByRole('complementary', { name: 'Datapad' })
        .getByRole('region', { name: 'Rooms' })
        .getByRole('link', { name: /Han Solo/ }),
    ).toBeVisible();
  }
  await expectAccessible(page);

  await rooms.getByRole('link', { name: 'Echo Base relocation' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Echo Base relocation' }),
  ).toBeVisible();
});
