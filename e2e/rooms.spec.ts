import {
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
 * Pinned rooms (#329): Pin in a room's header puts it in the rail, in the
 * order Settings → Rooms keeps, saved per space.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const pin = (page: import('@playwright/test').Page) =>
  page.getByRole('main').getByRole('button', { name: 'Pin', exact: true });

test('pin and unpin from a room; the rail follows, in the order Settings keeps', async ({
  page,
}) => {
  const desktop = !isMobile(page);
  const rooms = page
    .getByRole('complementary', { name: 'Datapad' })
    .getByRole('region', { name: 'Rooms' });
  const owed = page
    .getByRole('complementary', { name: 'Datapad' })
    .getByRole('region', { name: 'Waiting on' });

  // A project's room: Pin, and the rail lists only what is pinned.
  await openLive(page, '/projects/p-falcon');
  await expect(pin(page)).toHaveAttribute('aria-pressed', 'false');
  await pin(page).click();
  await expect(pin(page)).toHaveAttribute('aria-pressed', 'true');
  if (desktop) {
    await expect(rooms.getByRole('link')).toHaveText([/Falcon/]);
  }

  // A person's room too; they leave Waiting on once pinned.
  await page.goto('/people/u-han');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Han Solo' }),
  ).toBeVisible();
  await pin(page).click();
  await expect(pin(page)).toHaveAttribute('aria-pressed', 'true');
  if (desktop) {
    await expect(rooms.getByRole('link')).toHaveText([/Falcon/, /Han Solo/]);
    await expect(owed.getByRole('link')).toHaveText([/Chewbacca/]);
  }
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Settings → Rooms: Han first, and it stays after a reload.
  await page.goto('/settings/rooms');
  const list = page.getByRole('list', { name: 'Pinned rooms' });
  await expect(list.getByRole('listitem')).toHaveText([
    /Falcon hyperdrive refit\s*Project/,
    /Han Solo\s*Person/,
  ]);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Move Han Solo up' }).click();
  await expect(list.getByRole('listitem')).toHaveText([/Han Solo/, /Falcon/]);
  await expect(
    page.getByRole('button', { name: 'Move Han Solo down' }),
  ).toBeFocused();
  await expectSaved(page);
  await page.reload();
  await expect(list.getByRole('listitem')).toHaveText([/Han Solo/, /Falcon/]);
  if (desktop) {
    await expect(rooms.getByRole('link')).toHaveText([/Han Solo/, /Falcon/]);
  }

  // Unpin from Settings, then from the room: back to the active projects.
  await page.getByRole('button', { name: 'Unpin Han Solo' }).click();
  await expect(list.getByRole('listitem')).toHaveText([/Falcon/]);
  await page.goto('/projects/p-falcon');
  await pin(page).click();
  await expect(pin(page)).toHaveAttribute('aria-pressed', 'false');
  if (desktop) {
    await expect(rooms.getByRole('link')).toHaveText([/Echo Base/, /Falcon/]);
  }
  await page.goto('/settings/rooms');
  await expect(page.getByText('Nothing pinned yet.')).toBeVisible();
});
