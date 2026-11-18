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

test('Settings → Navigation is gone: its address is Settings → Rooms', async ({
  page,
}) => {
  await openLive(page, '/settings/navigation');
  await expect(page).toHaveURL(/\/settings\/rooms$/);
  await expect(
    page.getByRole('navigation', { name: 'Settings' }).getByRole('link', {
      name: 'Navigation',
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('main').getByRole('heading', { level: 2, name: 'Rooms' }),
  ).toBeVisible();
});

test('an export with navigation preferences from before v2 still imports', async ({
  page,
  request,
}) => {
  const res = await request.post('/api/import', {
    data: {
      ...SEED,
      settings: {
        user: {
          defaultOrg: '',
          nav: { order: ['tasks', 'focus'], hidden: ['lists'] },
        },
      },
    },
  });
  expect(res.ok()).toBe(true);
  await openLive(page, '/');
  const data = await (await request.get('/api/export.json')).json();
  expect(data.settings.user.nav).toEqual({
    order: ['tasks', 'focus'],
    hidden: ['lists'],
  });
});
