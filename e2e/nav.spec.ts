import {
  addFromTopBar,
  expect,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

test('the rail shows live counts, active projects and Archived', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'The rail is desktop only.');
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/');
  const rail = page.getByRole('complementary', { name: 'Datapad' });

  // Seed: 5 open tasks, none in the archived project. Meetings in the next
  // week depend on today, so only task counts are asserted.
  await expect(
    rail.getByRole('link', { name: /^Focus 5 open$/ }),
  ).toBeVisible();
  await expect(
    rail.getByRole('link', { name: /^Tasks 5 open$/ }),
  ).toBeVisible();
  const projects = rail.getByRole('region', { name: 'Active projects' });
  // Done and archived projects are left out; most recently updated first.
  await expect(projects.getByRole('link')).toHaveText([
    /Echo Base relocation\s*3 open/,
    /Falcon hyperdrive refit\s*1 open/,
  ]);
  await expect(rail.getByRole('link', { name: /Archived/ })).toBeVisible();

  await projects.getByRole('link', { name: /Echo Base/ }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect(
    projects.getByRole('link', { name: /Echo Base/ }),
  ).toHaveAttribute('aria-current', 'page');
  // A project page belongs to Projects.
  await expect(rail.getByRole('link', { name: 'Projects' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page).toHaveTitle('Echo Base relocation · Datapad');

  // Counts follow the data.
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Add a task' });
  await input.fill('Count me');
  await input.press('Enter');
  await expect(
    rail.getByRole('link', { name: /^Focus 6 open$/ }),
  ).toBeVisible();
});

test('the tab bar navigates on a phone and marks the current section', async ({
  page,
}) => {
  test.skip(!isMobile(page), 'The tab bar is for phones.');
  await page.goto('/');
  const tabs = page.getByRole('navigation', { name: 'Sections' }).last();
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Focus' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await tabs.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tasks' }),
  ).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Tasks' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('/ is Focus, and every section has its route', async ({ page }) => {
  // The old /focus address lands on /.
  await page.goto('/focus');
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Focus' }),
  ).toBeVisible();
  for (const [path, heading] of [
    ['/projects', 'Projects'],
    ['/archive', 'Archived'],
    ['/tasks', 'Tasks'],
    ['/notes', 'Notes'],
    ['/meetings', 'Meetings'],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { level: 1, name: heading }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${heading} · Datapad`);
  }
});

test('Decisions are retired: their address is Focus and kept ones show nowhere', async ({
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
    await expect(
      page.getByRole('heading', { level: 1, name: 'Focus' }),
    ).toBeVisible();
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
  await palette.getByRole('combobox').fill('Decisions');
  await expect(
    palette.getByRole('option', { name: /Go to Decisions/ }),
  ).toHaveCount(0);

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
  await page.getByRole('link', { name: 'Back to Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto('/no/such/page');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Not found' }),
  ).toBeVisible();
});

test('tab order is rail, then top bar, then main', async ({ page }) => {
  test.skip(isMobile(page), 'Keyboard order is checked on desktop.');
  // Main has a quick-add once the data is in.
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

test('the + button is “Add task” and opens the new-task panel', async ({
  page,
}) => {
  await page.goto('/help');
  await addFromTopBar(page, 'Add task');
  const panel = page.getByRole('dialog', { name: 'New task' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Title' })).toBeFocused();
});

test('sections run Focus, Projects, Tasks, Meetings, Notes, Whiteboard (off the phone); People and Orgs are in Settings', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page
    .getByRole('navigation', { name: 'Sections' })
    .filter({ visible: true })
    .first();
  await expect(nav.getByRole('link')).toHaveText([
    /Focus/,
    /Projects/,
    /Tasks/,
    /Meetings/,
    /Notes/,
    // The space's whiteboard is a section, off the phone's tab bar by
    // default (the account menu has it there).
    ...(isMobile(page) ? [] : [/Whiteboard/]),
  ]);
  // People and Orgs live under Settings (#159), in neither the rail nor
  // the tab bar.
  await expect(nav.getByRole('link', { name: /People|Orgs/ })).toHaveCount(0);
  if (isMobile(page)) {
    // Five tabs, each at least 44px square.
    for (const link of await nav.getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }
});
