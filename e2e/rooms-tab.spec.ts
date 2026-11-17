import {
  expect,
  expectAccessible,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * The phone's Rooms tab: the rail's rooms and the people waiting on, as
 * a page (`/rooms`), with the tab current inside any room.
 */

test('the Rooms tab lists the rail’s rooms and stays current inside one', async ({
  page,
  request,
}) => {
  test.skip(!isMobile(page), 'The tab bar is for phones.');
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/');
  const tabs = page.getByRole('navigation', { name: 'Sections' }).last();
  const roomsTab = tabs.getByRole('link', { name: 'Rooms' });
  await expect(roomsTab).toBeVisible();
  await expect(roomsTab).not.toHaveAttribute('aria-current', 'page');

  await roomsTab.click();
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(page).toHaveTitle('Rooms · Datapad');
  await expect(roomsTab).toHaveAttribute('aria-current', 'page');
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', { level: 1, name: 'Rooms' }),
  ).toBeVisible();

  // The same rows as the rail: the active projects, then who owes you.
  const rooms = main.getByRole('region', { name: 'Rooms' });
  await expect(rooms.getByRole('link')).toHaveText([
    /Echo Base relocation\s*3 open/,
    /Falcon hyperdrive refit\s*1 open/,
  ]);
  const owed = main.getByRole('region', { name: 'Waiting on' });
  await expect(owed.getByRole('link')).toHaveText([
    /Chewbacca\s*1 waiting/,
    /Han Solo\s*1 waiting/,
  ]);
  for (const link of await main.getByRole('listitem').getByRole('link').all()) {
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(
    main.getByRole('link', { name: 'All projects and people' }),
  ).toBeVisible();
  await expectAccessible(page);

  // Into a room: the tab stays current, and no other tab is.
  await rooms.getByRole('link', { name: /Echo Base/ }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Echo Base relocation' }),
  ).toBeVisible();
  await expect(roomsTab).toHaveAttribute('aria-current', 'page');
  await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);

  // A person's room too.
  await roomsTab.click();
  await owed.getByRole('link', { name: /Han Solo/ }).click();
  await expect(page).toHaveURL(/\/people\/u-han$/);
  await expect(roomsTab).toHaveAttribute('aria-current', 'page');

  // All is still All.
  await tabs.getByRole('link', { name: 'All' }).click();
  await expect(tabs.getByRole('link', { name: 'All' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(roomsTab).not.toHaveAttribute('aria-current', 'page');
});

test('with nothing to list, Rooms points to All', async ({ page }) => {
  test.skip(!isMobile(page), 'The tab bar is for phones.');
  // A new user: no projects, no people.
  await openLive(page, '/rooms');
  await expect(page.getByText('No rooms yet.')).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('link', { name: 'All', exact: true })
    .click();
  await expect(page).toHaveURL(/\/all\?kind=project,person$/);
});

test('desktop has no Rooms tab; /rooms still renders', async ({ page }) => {
  test.skip(isMobile(page), 'The rail is desktop only.');
  await openLive(page, '/rooms');
  const places = page
    .getByRole('complementary', { name: 'Datapad' })
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('list')
    .first();
  await expect(places.getByRole('link')).toHaveText([
    /^Today$/,
    /^Unfiled/,
    /^All$/,
  ]);
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1, name: 'Rooms' }),
  ).toBeVisible();
});
