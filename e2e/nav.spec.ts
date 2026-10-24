import { expect, isMobile, openLive, SEED, test } from './fixtures';

test('the rail shows live counts, active projects and Archived', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'The rail is desktop only.');
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/');
  const rail = page.getByRole('complementary', { name: 'Datapad' });

  // Seed: 5 open tasks, none in the archived project. Events in the next
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
    ['/events', 'Events'],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { level: 1, name: heading }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${heading} · Datapad`);
  }
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
  await page.goto('/');
  const order: string[] = [];
  for (let i = 0; i < 16; i += 1) {
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

test('the + button is “Add task” and takes you to a quick-add', async ({
  page,
}) => {
  await page.goto('/help');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Add task' })
    .click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(page.getByRole('textbox', { name: 'Add a task' })).toBeFocused();
});
