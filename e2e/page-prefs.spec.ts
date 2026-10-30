import type { APIRequestContext, Browser, Page } from '@playwright/test';
import {
  chooseFilter,
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
 * and sections save themselves, follow the space to every device, and are
 * edited and reset in Settings → Pages. The address still wins.
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

/** Tasks' Group by shows `text` (in the Filters sheet on phones). */
async function expectGroupBy(page: Page, text: string) {
  const filters = await openFilters(page);
  await expect(
    filters.getByRole('combobox', { name: 'Group by' }),
  ).toContainText(text);
  await closeFilters(page);
}

function layout(page: Page) {
  return page.getByRole('group', { name: 'Layout (press v to cycle)' });
}

async function pickLayout(page: Page, name: string) {
  await layout(page)
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .click();
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

test('a change saves itself and comes back on reload and another device', async ({
  page,
  request,
  browser,
  email,
}) => {
  await openLive(page, '/tasks');
  await chooseFilter(page, 'Group by', 'Due date');
  const filters = await openFilters(page);
  await filters
    .getByRole('group', { name: 'Status' })
    .locator('label', { hasText: 'All' })
    .click();
  await closeFilters(page);
  await pickLayout(page, 'Board');
  await expect(page).toHaveURL(/group=due/);
  // The changes go out together, a moment after the last one.
  await expectStored(request, 'tasks', {
    view: 'board',
    group: 'due',
    filters: { status: 'all' },
  });

  // A bare address shows them, without rewriting it.
  await page.goto('/tasks');
  await expectGroupBy(page, 'Due date');
  await expect(
    layout(page).getByRole('radio', { name: 'Board' }),
  ).toBeChecked();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.reload();
  await expectGroupBy(page, 'Due date');

  // Another device (a fresh browser) opens the page the same way.
  const other = await otherDevice(browser, page, email);
  await other.goto('/tasks');
  await expect(
    layout(other).getByRole('radio', { name: 'Board' }),
  ).toBeChecked();
  const otherFilters = await openFilters(other);
  await expect(
    otherFilters.getByRole('combobox', { name: 'Group by' }),
  ).toContainText('Due date');
  await expect(
    otherFilters.getByRole('group', { name: 'Status' }).getByRole('radio', {
      name: 'All',
    }),
  ).toBeChecked();
  await other.context().close();
});

test('the address wins; the search text is never saved', async ({
  page,
  request,
}) => {
  await openLive(page, '/tasks');
  await chooseFilter(page, 'Group by', 'Due date');
  await expectStored(request, 'tasks', { group: 'due' });

  // A link that names its own grouping shows it, and saves nothing.
  await page.goto('/tasks?group=priority');
  await expectGroupBy(page, 'Priority');
  await page.getByRole('searchbox', { name: 'Find' }).fill('tauntaun');
  await expect(page).toHaveURL(/q=tauntaun/);
  await page.waitForTimeout(800);
  expect((await pages(request))?.tasks).toEqual({ group: 'due' });

  // Back to the default from a page that opened on a saved grouping.
  await page.goto('/tasks');
  await expectGroupBy(page, 'Due date');
  await chooseFilter(page, 'Group by', 'Project');
  await expectGroupBy(page, 'Project');
  await expect(page).toHaveURL(/\/tasks$/);
  // Back: the grouping the page opened with.
  await page.goBack();
  await expectGroupBy(page, 'Due date');
  await expect
    .poll(async () => (await pages(request))?.tasks ?? null)
    .toBe(null);
  await page.goto('/tasks');
  await expectGroupBy(page, 'Project');
});

test('Back returns to what the page showed before a change', async ({
  page,
  request,
}) => {
  await openLive(page, '/notes');
  await layout(page).locator('label', { hasText: 'Grid' }).click();
  await (await openFilters(page))
    .getByRole('group', { name: 'Show' })
    .locator('label', { hasText: 'Pinned' })
    .click();
  await closeFilters(page);
  await expectStored(request, 'notes', {
    view: 'grid',
    filters: { pinned: '1' },
  });
  // Opened with Pinned saved; All is chosen, then Back.
  await page.goto('/notes');
  let show = (await openFilters(page)).getByRole('group', { name: 'Show' });
  await expect(show.getByRole('radio', { name: 'Pinned' })).toBeChecked();
  await show.locator('label', { hasText: 'All' }).click();
  await expect(show.getByRole('radio', { name: 'All' })).toBeChecked();
  await expect(page).toHaveURL(/\/notes$/);
  await closeFilters(page);
  await page.goBack();
  show = (await openFilters(page)).getByRole('group', { name: 'Show' });
  await expect(show.getByRole('radio', { name: 'Pinned' })).toBeChecked();
});

test('sections remember open or closed, one set for every project', async ({
  page,
  request,
  browser,
  email,
}) => {
  await openLive(page, '/projects/p-echo');
  const activity = page.getByRole('button', { name: /^Activity/ });
  await expect(activity).toHaveAttribute('aria-expanded', 'false');
  await activity.click();
  await page.getByRole('button', { name: /^Meetings/ }).click();
  await expectStored(request, 'project', {
    sections: { activity: true, meetings: false },
  });

  const other = await otherDevice(browser, page, email);
  await other.goto('/projects/p-falcon');
  await expect(
    other.getByRole('button', { name: /^Activity/ }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    other.getByRole('button', { name: /^Meetings/ }),
  ).toHaveAttribute('aria-expanded', 'false');
  await other.context().close();
});

test('Settings → Pages edits and resets, with Undo', async ({
  page,
  request,
}) => {
  await openLive(page, '/tasks');
  await chooseFilter(page, 'Group by', 'Assignee');
  await expectStored(request, 'tasks', { group: 'assignee' });
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: /^Notes/ }).click();
  await expectStored(request, 'project', { sections: { notes: false } });

  await openLive(page, '/settings/pages');
  await expect(page).toHaveTitle('Pages · Settings · Datapad');
  const tasks = page.getByRole('region', { name: 'Tasks', exact: true });
  await expect(tasks.getByText('Saved', { exact: true })).toBeVisible();
  await expect(tasks.getByRole('combobox', { name: 'Group by' })).toContainText(
    'Assignee',
  );
  const project = page.getByRole('region', { name: 'Project page' });
  await expect(project).toContainText('1 section closed as you left it.');
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Edited here, saved at once, and the page opens that way.
  await tasks.getByRole('combobox', { name: 'Sort by' }).click();
  await page.getByRole('option', { name: 'Title', exact: true }).click();
  await expectStored(request, 'tasks', { group: 'assignee', sort: 'title' });

  // Reset one page, then Undo.
  await page.getByRole('button', { name: 'Reset Tasks' }).click();
  await expect(tasks.getByText('Defaults', { exact: true })).toBeVisible();
  await expectStored(request, 'tasks', null);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStored(request, 'tasks', { group: 'assignee', sort: 'title' });

  // Reset all, then Undo.
  await page.getByRole('button', { name: 'Reset all' }).click();
  await expect.poll(() => pages(request)).toEqual({});
  await expect(page.getByRole('button', { name: 'Reset all' })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(() => pages(request))
    .toEqual({
      tasks: { group: 'assignee', sort: 'title' },
      project: { sections: { notes: false } },
    });

  await page.goto('/tasks');
  await expectGroupBy(page, 'Assignee');
});

test('this browser’s earlier choices carry over once', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('datapad:view:notes', 'grid');
    localStorage.setItem('datapad:section:p-echo:activity', 'open');
  });
  await openLive(page, '/notes');
  await expect(layout(page).getByRole('radio', { name: 'Grid' })).toBeChecked();
  await expectStored(request, 'notes', { view: 'grid' });
  await expectStored(request, 'project', { sections: { activity: true } });
});

test('a saved Feed on Notes reads as List (#218)', async ({
  page,
  request,
}) => {
  await request.post('/api/import', {
    data: {
      settings: {
        user: { defaultOrg: '', pages: { notes: { view: 'feed' } } },
      },
    },
  });
  await openLive(page, '/notes');
  await expect(layout(page).getByRole('radio', { name: 'List' })).toBeChecked();
  await expect(
    page.getByRole('main').locator('li[data-note-id]').first(),
  ).toBeVisible();
});

test('a saved Notepad layout on Notes reads as List (#261)', async ({
  page,
  request,
}) => {
  await request.post('/api/import', {
    data: {
      settings: {
        user: { defaultOrg: '', pages: { notes: { view: 'notepad' } } },
      },
    },
  });
  await openLive(page, '/notes');
  await expect(layout(page).getByRole('radio')).toHaveCount(2);
  await expect(layout(page).getByRole('radio', { name: 'List' })).toBeChecked();
  await expect(
    page.getByRole('main').locator('li[data-note-id]').first(),
  ).toBeVisible();
});

test('a saved value the page no longer has falls back to the default', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings');
  await chooseFilter(page, 'Project', 'Falcon hyperdrive refit');
  await expectStored(request, 'meetings', {
    filters: { project: 'p-falcon' },
  });
  // Saved values the page no longer has (a project that is gone, a
  // layout it never had): Meetings opens on its defaults.
  await request.post('/api/import', {
    data: {
      settings: {
        user: {
          defaultOrg: '',
          pages: {
            meetings: { view: 'gallery', filters: { project: 'p-ghost' } },
          },
        },
      },
    },
  });
  await openLive(page, '/meetings');
  const filters = await openFilters(page);
  await expect(
    filters.getByRole('combobox', { name: 'Project' }),
  ).toContainText('All projects');
  await closeFilters(page);
  await expect(layout(page).getByRole('radio', { name: 'List' })).toBeChecked();
});
