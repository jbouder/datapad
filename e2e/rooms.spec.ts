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
    await expect(rooms.getByRole('list').getByRole('link')).toHaveText([
      /Falcon/,
    ]);
  }

  // A person's room too; they leave Waiting on once pinned.
  await page.goto('/people/u-han');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Han Solo' }),
  ).toBeVisible();
  await pin(page).click();
  await expect(pin(page)).toHaveAttribute('aria-pressed', 'true');
  if (desktop) {
    await expect(rooms.getByRole('list').getByRole('link')).toHaveText([
      /Falcon/,
      /Han Solo/,
    ]);
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
    await expect(rooms.getByRole('list').getByRole('link')).toHaveText([
      /Han Solo/,
      /Falcon/,
    ]);
  }

  // Unpin from Settings, then from the room: back to the active projects.
  await page.getByRole('button', { name: 'Unpin Han Solo' }).click();
  await expect(list.getByRole('listitem')).toHaveText([/Falcon/]);
  await page.goto('/projects/p-falcon');
  await pin(page).click();
  await expect(pin(page)).toHaveAttribute('aria-pressed', 'false');
  if (desktop) {
    await expect(rooms.getByRole('list').getByRole('link')).toHaveText([
      /Echo Base/,
      /Falcon/,
    ]);
  }
  await page.goto('/settings/rooms');
  await expect(page.getByText('Nothing pinned yet.')).toBeVisible();
});

test('the Rooms heading in the rail opens the Rooms page', async ({ page }) => {
  test.skip(isMobile(page), 'The phone has no rail; Rooms is a tab.');
  await openLive(page, '/');
  const heading = page
    .getByRole('complementary', { name: 'Datapad' })
    .getByRole('heading', { name: 'Rooms' });
  const link = heading.getByRole('link', { name: 'Rooms' });
  await link.click();
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Rooms' }),
  ).toBeVisible();
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expectAccessible(page);
});

test('add a project or a person from Rooms and land in the new room', async ({
  page,
}) => {
  // Desktop: the + beside Rooms in the rail. Phone: the same + on /rooms.
  const mobile = isMobile(page);
  await openLive(page, mobile ? '/rooms' : '/');
  const rooms = mobile
    ? page.getByRole('main').getByRole('region', { name: 'Rooms' })
    : page
        .getByRole('complementary', { name: 'Datapad' })
        .getByRole('region', { name: 'Rooms' });
  const add = rooms.getByRole('button', { name: 'Add a room' });

  await add.click();
  await page.getByRole('menuitem', { name: 'New project' }).click();
  const projectForm = page.getByRole('dialog', { name: 'New project' });
  await projectForm.getByRole('textbox', { name: 'Name' }).fill('Hoth outpost');
  await projectForm.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Hoth outpost' }),
  ).toBeVisible();

  if (mobile) await openLive(page, '/rooms');
  await add.click();
  await page.getByRole('menuitem', { name: 'New person' }).click();
  const personForm = page.getByRole('dialog', { name: 'Add person' });
  await personForm.getByRole('textbox', { name: 'Name' }).fill('Lando');
  await personForm.getByRole('button', { name: 'Add person' }).click();
  await expect(page).toHaveURL(/\/people\/[^/]+$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lando' }),
  ).toBeVisible();
  await expectSaved(page);
});

test('hide a project from the rail, then show it again from Settings', async ({
  page,
}) => {
  const mobile = isMobile(page);
  const rooms = mobile
    ? page.getByRole('main').getByRole('region', { name: 'Rooms' })
    : page
        .getByRole('complementary', { name: 'Datapad' })
        .getByRole('region', { name: 'Rooms' });
  const roomList = async () => {
    if (mobile) await page.goto('/rooms');
    return rooms.getByRole('list').getByRole('link');
  };

  await openLive(page, '/projects/p-falcon');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Hide from rail' }).click();
  await expect(
    page.getByText('Hid Falcon hyperdrive refit from the rail'),
  ).toBeVisible();
  await expectSaved(page);
  await expect(await roomList()).not.toContainText([/Falcon/]);
  await expect(await roomList()).toContainText([/Echo Base/]);

  // Settings → Rooms lists it, and Show puts it back.
  await page.goto('/settings/rooms');
  const hidden = page.getByRole('list', { name: 'Hidden projects' });
  await expect(hidden.getByRole('listitem')).toHaveText([
    /Falcon hyperdrive refit/,
  ]);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
  await page
    .getByRole('button', { name: 'Show Falcon hyperdrive refit on the rail' })
    .click();
  await expect(page.getByText('Nothing hidden.')).toBeVisible();
  await expectSaved(page);
  await expect(await roomList()).toContainText([/Falcon/]);
});
