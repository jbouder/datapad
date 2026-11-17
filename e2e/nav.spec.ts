import {
  addFromSearch,
  addTask,
  expect,
  expectAccessible,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * The v2 shell (#329): the rail (Today, Unfiled, All, then Rooms and the
 * people who owe you something), the phone's three tabs, and every old
 * address landing on its new home.
 */

test('the rail has Today, Unfiled and All, the active projects as rooms, and who owes you', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'The rail is desktop only.');
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/');
  const rail = page.getByRole('complementary', { name: 'Datapad' });
  const places = rail.getByRole('navigation', { name: 'Sections' });

  // The seed's Ideas note is General and mentions nobody: one unfiled.
  await expect(places.getByRole('list').first().getByRole('link')).toHaveText([
    /^Today$/,
    /^Unfiled\s*1 unfiled$/,
    /^All$/,
  ]);
  await expect(rail.getByRole('link', { name: 'Today' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Nothing pinned: the active projects, most recently changed first.
  const rooms = rail.getByRole('region', { name: 'Rooms' });
  await expect(rooms.getByRole('link')).toHaveText([
    /Echo Base relocation\s*3 open/,
    /Falcon hyperdrive refit\s*1 open/,
  ]);
  // Leia is you: Chewie's and Han's open tasks are what they owe you.
  const owed = rail.getByRole('region', { name: 'Waiting on' });
  await expect(owed.getByRole('link')).toHaveText([
    /Chewbacca\s*1 waiting/,
    /Han Solo\s*1 waiting/,
  ]);

  await rooms.getByRole('link', { name: /Echo Base/ }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect(rooms.getByRole('link', { name: /Echo Base/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page).toHaveTitle('Echo Base relocation · Datapad');

  await owed.getByRole('link', { name: /Han Solo/ }).click();
  await expect(page).toHaveURL(/\/people\/u-han$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Han Solo' }),
  ).toBeVisible();

  // All opens on Tasks until Settings → All says otherwise (#343).
  await places.getByRole('link', { name: 'All' }).click();
  await expect(page).toHaveURL(/\/all\?kind=task$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'All' }),
  ).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Tasks', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(places.getByRole('link', { name: 'All' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // The Unfiled count follows the data.
  await places.getByRole('link', { name: /Unfiled/ }).click();
  await expect(page).toHaveURL(/\/unfiled$/);
  await expect(
    page.getByRole('list', { name: 'Unfiled notes' }).getByRole('article'),
  ).toHaveCount(1);
  await expectAccessible(page);
});

test('a phone has three tabs, Today, Unfiled and All, each a 44px target', async ({
  page,
}) => {
  test.skip(!isMobile(page), 'The tab bar is for phones.');
  await page.goto('/');
  const tabs = page.getByRole('navigation', { name: 'Sections' }).last();
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('link')).toHaveText(['Today', 'Unfiled', 'All']);
  await expect(tabs.getByRole('link', { name: 'Today' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  for (const link of await tabs.getByRole('link').all()) {
    const box = await link.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await tabs.getByRole('link', { name: 'All' }).click();
  await expect(page).toHaveURL(/\/all\?kind=task$/);
  await expect(tabs.getByRole('link', { name: 'All' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await tabs.getByRole('link', { name: 'Unfiled' }).click();
  await expect(page).toHaveURL(/\/unfiled$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Unfiled' }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('old addresses land on their new homes', async ({ page, request }) => {
  await request.post('/api/import', { data: SEED });
  // Focus is Today; the digest is its week zoom.
  await openLive(page, '/focus');
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await openLive(page, '/digest');
  await expect(page).toHaveURL(/localhost:\d+\/\?view=week$/);
  await expect(page.getByRole('region', { name: 'Digest' })).toBeVisible();
  // The Notepad is Unfiled.
  await page.goto('/notepad');
  await expect(page).toHaveURL(/\/unfiled$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Unfiled' }),
  ).toBeVisible();
  // The list pages are All, by kind, their filters as All reads them.
  for (const [path, url] of [
    ['/projects', /\/all\?kind=project$/],
    ['/archive', /\/all\?kind=project&status=archived$/],
    ['/tasks?who=mine', /\/all\?kind=task&person=me$/],
    ['/notes', /\/all\?kind=note$/],
    ['/meetings', /\/all\?kind=meeting$/],
    ['/lists/l-evac', /\/all\?kind=note$/],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveURL(url);
    await expect(
      page.getByRole('heading', { level: 1, name: 'All' }),
    ).toBeVisible();
    await expect(page).toHaveTitle('All · Datapad');
  }
  // A person under Settings is their room.
  await page.goto('/settings/people/u-chewie');
  await expect(page).toHaveURL(/\/people\/u-chewie$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Chewbacca' }),
  ).toBeVisible();
});

test('a task’s old page is its project’s room, with the task’s panel open', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/tasks/t-2');
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Insulate the hangar doors',
  );
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Echo Base relocation' }),
  ).toBeVisible();

  // A General task's room is Today; a task that is gone is Not found.
  await page.goto('/tasks/t-6');
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
  await page.goto('/tasks/nope');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Not found' }),
  ).toBeVisible();
});

test('Decisions are retired: their address is Today and kept ones show nowhere', async ({
  page,
  request,
}) => {
  await request.post('/api/import', {
    data: {
      ...SEED,
      decisions: {
        'd-1': {
          id: 'd-1',
          projectId: 'p-echo',
          title: 'Zebra protocol',
          status: 'decided',
          decidedAt: '2026-10-01',
          createdAt: '2026-10-01T09:00:00.000Z',
          updatedAt: '2026-10-01T09:00:00.000Z',
        },
      },
    },
  });
  for (const path of ['/decisions', '/decisions/d-1?project=p-echo']) {
    await openLive(page, path);
    await expect(page).toHaveURL(/localhost:\d+\/$/);
  }
  await expect(page.getByRole('link', { name: /Decisions/ })).toHaveCount(0);

  await page.goto('/projects/p-echo');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Echo Base relocation' }),
  ).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Decision');

  await page.getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('Zebra');
  await expect(palette).toContainText('Nothing matches');

  // The data is kept.
  const data = await (await request.get('/api/export.json')).json();
  expect(Object.keys(data.decisions)).toEqual(['d-1']);
});

test('an unknown project or path says Not found, with a way back', async ({
  page,
}) => {
  await openLive(page, '/projects/does-not-exist');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Not found' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Go to All' }).click();
  await expect(page).toHaveURL(/\/all\?kind=project$/);

  await page.goto('/no/such/page');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Not found' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Go to Today' }).click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});

test('tab order is rail, then top bar, then main', async ({ page }) => {
  test.skip(isMobile(page), 'Keyboard order is checked on desktop.');
  // Main has controls once the data is in.
  await openLive(page, '/');
  const order: string[] = [];
  for (let i = 0; i < 24; i += 1) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (el?.closest('aside')) return 'rail';
        if (el?.closest('header')) return 'top';
        if (el?.closest('main')) return 'main';
        return 'other';
      }),
    );
  }
  const first = (where: string) => order.indexOf(where);
  expect(first('rail')).toBeGreaterThan(-1);
  expect(first('rail')).toBeLessThan(first('top'));
  expect(first('top')).toBeLessThan(first('main'));
});

test('no +: Search adds a task, Today a meeting and All a project (#341)', async ({
  page,
}) => {
  await page.goto('/help');
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Add', exact: true }),
  ).toHaveCount(0);
  await addFromSearch(page, 'New task');
  const panel = page.getByRole('dialog', { name: 'New task' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // Add meeting beside Today's timeline starts on the day shown.
  await page.goto('/');
  await page.getByRole('button', { name: 'Add meeting' }).click();
  const meeting = page.getByRole('dialog', { name: 'New meeting' });
  await expect(meeting).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(meeting).toBeHidden();

  // New project beside All's project rooms.
  await page.goto('/all');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('dialog', { name: 'New project' })).toBeVisible();
});

test('the rail’s counts follow the data', async ({ page, request }) => {
  test.skip(isMobile(page), 'The rail is desktop only.');
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-falcon');
  const rooms = page
    .getByRole('complementary', { name: 'Datapad' })
    .getByRole('region', { name: 'Rooms' });
  await expect(rooms.getByRole('link', { name: /Falcon/ })).toHaveText(
    /1 open/,
  );
  await addTask(page, 'Count me');
  await expect(rooms.getByRole('link', { name: /Falcon/ })).toHaveText(
    /2 open/,
  );
});
