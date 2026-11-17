import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectNoSidewaysScroll,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * The project page's and the task page's settings (#312), set in
 * Settings → Pages: the project page's sections hidden and moved, and
 * the task page's source note collapsed or hidden. (Meetings shows gave
 * way to Show past, #320: `project-show-past.spec.ts`.)
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

function card(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true });
}

/** Wait until the server has saved `expected` for `key` of `page`. */
async function expectStored(
  request: APIRequestContext,
  pageKey: string,
  expected: unknown,
) {
  await expect
    .poll(async () => {
      const file = await (await request.get('/api/export.json')).json();
      return file.settings.user?.pages?.[pageKey] ?? null;
    })
    .toEqual(expected);
}

/** The project page's section headings, top to bottom. */
function headings(page: Page) {
  return page
    .getByRole('main')
    .getByRole('heading', { level: 2 })
    .filter({ has: page.locator('button[aria-expanded]') });
}

test('hide and reorder the project page’s sections', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/pages');
  const project = card(page, 'Project page');
  const editor = project.getByRole('list', { name: 'Project page sections' });
  // Meetings to the top, Whiteboard hidden.
  const up = editor.getByRole('button', { name: 'Move Meetings up' });
  await up.click();
  await up.click();
  await editor.getByRole('switch', { name: 'Show Whiteboard' }).click();
  await expectStored(request, 'project', {
    order: [
      'meetings',
      'milestones',
      'tasks',
      'notes',
      'lists',
      'whiteboard',
      'activity',
    ],
    hidden: ['whiteboard'],
  });

  await openLive(page, '/projects/p-echo');
  const names = headings(page);
  await expect(names.first()).toHaveText(/^Meetings/);
  await expect(names.nth(1)).toHaveText(/^Milestones/);
  await expect(names.nth(2)).toHaveText(/^Tasks/);
  await expect(names.filter({ hasText: /^Whiteboard/ })).toHaveCount(0);
  await expect(names.filter({ hasText: /^Notes/ })).toHaveCount(1);
  await expectNoSidewaysScroll(page);
});
