import type { APIRequestContext, Browser, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
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
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: /^Notes/ }).click();
  await expectStored(request, 'project', { sections: { notes: false } });

  await openLive(page, '/settings/pages');
  await expect(page).toHaveTitle('Pages · Settings · Datapad');
  const tasks = page.getByRole('region', { name: 'Tasks', exact: true });
  await tasks.getByRole('combobox', { name: 'Group by' }).click();
  await page.getByRole('option', { name: 'Assignee', exact: true }).click();
  await expectStored(request, 'tasks', { group: 'assignee' });
  await expect(tasks.getByText('Saved', { exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await expect.poll(() => pages(request)).toEqual({});
  await expect(
    page.getByRole('button', { name: 'Reset all', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(() => pages(request))
    .toEqual({
      tasks: { group: 'assignee', sort: 'title' },
      project: { sections: { notes: false } },
    });
});

test('hidden and ordered sections reset and come back with Undo (#310)', async ({
  page,
  request,
}) => {
  const saved = {
    sections: { notes: false },
    hidden: ['activity'],
    order: ['tasks', 'milestones'],
  };
  await request.post('/api/import', {
    data: {
      settings: { user: { defaultOrg: '', pages: { project: saved } } },
    },
  });
  await expectStored(request, 'project', saved);
  await openLive(page, '/settings/pages');
  // The detail pages each have something to set, so all are listed.
  for (const name of ['Task page', 'Meeting page', 'List page']) {
    await expect(page.getByRole('region', { name })).toHaveCount(1);
  }
  const project = page.getByRole('region', { name: 'Project page' });
  await expect(project.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset Project page' }).click();
  await expectStored(request, 'project', null);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectStored(request, 'project', saved);
});
