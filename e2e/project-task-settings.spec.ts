import type { APIRequestContext, Locator, Page } from '@playwright/test';
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

/** Choose `option` in a segmented setting. */
async function choose(region: Locator, legend: string, option: string) {
  const group = region.getByRole('group', { name: legend });
  await group
    .locator('label')
    .filter({ has: region.page().getByRole('radio', { name: option }) })
    .click();
  await expect(group.getByRole('radio', { name: option })).toBeChecked();
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

test('the task page collapses or hides its source note', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/pages');
  const task = card(page, 'Task page');
  await choose(task, 'Source note', 'Collapsed');
  await expectStored(request, 'task', { filters: { sourceNote: 'collapsed' } });

  await openLive(page, '/tasks/t-4');
  const main = page.getByRole('main');
  const toggle = main.getByRole('button', { name: 'From note' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(main.getByRole('link', { name: 'Show the note' })).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(main.getByRole('link', { name: 'Show the note' })).toBeVisible();

  await openLive(page, '/settings/pages');
  await choose(card(page, 'Task page'), 'Source note', 'Hidden');
  await expectStored(request, 'task', { filters: { sourceNote: 'hidden' } });
  await openLive(page, '/tasks/t-4');
  await expect(main.getByRole('heading', { name: 'From note' })).toHaveCount(0);
  // The link to it stays, in the details.
  await expect(
    main
      .getByRole('list', { name: 'Details' })
      .getByRole('link', { name: 'From a note' }),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('the task page’s Notes remember open or closed', async ({
  page,
  request,
}) => {
  await openLive(page, '/tasks/t-1');
  const notes = page.getByRole('region', { name: 'Notes', exact: true });
  const toggle = notes.getByRole('button', { name: 'Notes', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(notes.getByText('No notes yet')).toBeHidden();
  await expectStored(request, 'task', { sections: { notes: false } });
  // Every task's page shares it.
  await openLive(page, '/tasks/t-2');
  await expect(
    page
      .getByRole('region', { name: 'Notes', exact: true })
      .getByRole('button', { name: 'Notes', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
});
