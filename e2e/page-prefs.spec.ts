import type { APIRequestContext, Browser, Page } from '@playwright/test';
import {
  closeFilters,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  openFilters,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * Saved page preferences (#186): a page's layout, sort, grouping, filters
 * and sections save themselves and follow the space to every device; All's
 * are set and reset in Settings → All (#343). The address still wins.
 */

interface Stored {
  settings: {
    user?: { pages?: Record<string, Record<string, unknown>> };
  };
}

async function pages(request: APIRequestContext) {
  const file = (await (await request.get('/api/export.json')).json()) as Stored;
  return file.settings.user?.pages ?? null;
}

/** Wait until the server has `expected` for `page`. */
async function expectStored(
  request: APIRequestContext,
  page: string,
  expected: unknown,
) {
  await expect
    .poll(async () => (await pages(request))?.[page] ?? null)
    .toEqual(expected);
}

/** Another device: a new browser context, signed in as the same address. */
async function otherDevice(browser: Browser, page: Page, email: string) {
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize(),
    extraHTTPHeaders: { 'x-dev-access-email': email },
  });
  return context.newPage();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

/** A project room's lanes. */
function lanes(page: Page) {
  return page.getByRole('complementary', { name: 'Open loops' });
}

test('sections remember open or closed, one set for every project', async ({
  page,
  request,
  browser,
  email,
}) => {
  // A room's lanes, and its Plan's Activity.
  await openLive(page, '/projects/p-echo');
  await lanes(page).getByRole('button', { name: /^Mine/ }).click();
  await page.goto('/projects/p-echo/plan');
  const activity = page.getByRole('button', { name: /^Activity/ });
  await expect(activity).toHaveAttribute('aria-expanded', 'false');
  await activity.click();
  await expectStored(request, 'project', {
    sections: { activity: true, mine: false },
  });

  const other = await otherDevice(browser, page, email);
  await other.goto('/projects/p-falcon/plan');
  await expect(
    other.getByRole('button', { name: /^Activity/ }),
  ).toHaveAttribute('aria-expanded', 'true');
  await other.goto('/projects/p-falcon');
  await expect(
    lanes(other).getByRole('button', { name: /^Mine/ }),
  ).toHaveAttribute('aria-expanded', 'false');
  await other.context().close();
});

test('Settings → All sets how All opens, and resets with Undo (#343)', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/all');
  await expect(page).toHaveTitle('All · Settings · Datapad');
  const opens = page.getByRole('group', { name: 'Opens on' });
  await expect(opens.getByRole('button', { name: 'Tasks' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await opens.getByRole('button', { name: 'Notes' }).click();
  await page.getByRole('combobox', { name: 'Tasks sort by' }).click();
  await page.getByRole('option', { name: 'Priority', exact: true }).click();
  await expectStored(request, 'all', {
    filters: { kinds: 'task,note', taskSort: 'priority' },
  });
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // The rail's (or the tab bar's) All opens on them.
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'All', exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/all\?kind=task,note$/);
  await openLive(page, '/all?kind=task');
  const controls = await openFilters(page);
  await expect(
    controls.getByRole('combobox', { name: 'Sort', exact: true }),
  ).toContainText('Priority');
  await closeFilters(page);

  // Reset to defaults, then Undo.
  await openLive(page, '/settings/all');
  const reset = page.getByRole('button', { name: 'Reset to defaults' });
  await reset.click();
  await expectStored(request, 'all', null);
  await expect(reset).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStored(request, 'all', {
    filters: { kinds: 'task,note', taskSort: 'priority' },
  });
});

test('Settings → All renames, moves and deletes saved views (#343)', async ({
  page,
  request,
}) => {
  const views = [
    { id: 'v-1', name: 'Mine', query: 'kind=task&person=me' },
    { id: 'v-2', name: 'Calendar', query: 'kind=meeting&view=calendar' },
  ];
  await request.post('/api/import', {
    data: {
      settings: { user: { defaultOrg: '', pages: { all: { views } } } },
    },
  });
  await openLive(page, '/settings/all');
  const list = page.getByRole('list', { name: 'Saved views' });
  const name = list.getByRole('textbox', { name: 'Name of Mine' });
  await name.fill('My tasks');
  await name.press('Enter');
  await list.getByRole('button', { name: 'Move Calendar up' }).click();
  await expectStored(request, 'all', {
    views: [views[1], { ...views[0], name: 'My tasks' }],
  });
  await list.getByRole('button', { name: 'Delete Calendar' }).click();
  await expectStored(request, 'all', {
    views: [{ ...views[0], name: 'My tasks' }],
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStored(request, 'all', {
    views: [views[1], { ...views[0], name: 'My tasks' }],
  });
  // Reset keeps them: they are yours, not settings.
  await expect(
    page.getByRole('button', { name: 'Reset to defaults' }),
  ).toBeDisabled();
  await expectAccessible(page);
});

test('a project room’s lanes hide and move from Settings → Rooms, and reset with Undo', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/rooms');
  const editor = page.getByRole('list', { name: 'Project room lanes' });
  await editor.getByRole('switch', { name: 'Show To decide' }).click();
  await editor.getByRole('button', { name: 'Move Waiting on up' }).click();
  await expectStored(request, 'project', {
    hidden: ['decide'],
    order: ['waiting', 'mine', 'decide'],
  });
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // A room's lanes follow: To decide hidden, Waiting on first.
  await openLive(page, '/projects/p-echo');
  const sections = lanes(page).getByRole('button', {
    name: /^(Mine|Waiting on|To decide)/,
  });
  await expect(sections).toHaveCount(2);
  await expect(sections.first()).toHaveText(/^Waiting on/);

  await openLive(page, '/settings/rooms');
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expectStored(request, 'project', null);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStored(request, 'project', {
    hidden: ['decide'],
    order: ['waiting', 'mine', 'decide'],
  });
});
