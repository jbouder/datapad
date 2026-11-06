import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * The project page's Show done (#318): a toggle in the Tasks header puts
 * the done tasks after the open ones in one list (and the board's Done
 * column), remembered with the page and set in Settings → Pages too.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const tasks = (page: Page) =>
  page.getByRole('region', { name: /^Tasks/ }).first();
const showDone = (page: Page) =>
  tasks(page).getByRole('button', { name: 'Show done' });

/** Wait until the server has saved `expected` as the project page's. */
async function expectStored(request: APIRequestContext, expected: unknown) {
  await expect
    .poll(async () => {
      const file = await (await request.get('/api/export.json')).json();
      return file.settings.user?.pages?.project ?? null;
    })
    .toEqual(expected);
}

test('Show done puts done tasks after the open ones, and is remembered', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const toggle = showDone(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Off: open tasks only, and no Done group inside Tasks.
  await expect(
    page.getByRole('list', { name: 'Open tasks' }).getByRole('listitem'),
  ).toHaveCount(3);
  await expect(tasks(page)).not.toContainText('Survey the north ridge');
  await expect(tasks(page).getByRole('button', { name: /^Done/ })).toHaveCount(
    0,
  );

  // On: one list, open first, then done.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const list = page.getByRole('list', { name: 'Tasks', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list.getByRole('listitem').last()).toContainText(
    'Survey the north ridge',
  );
  await expect(
    page.getByRole('checkbox', { name: 'Reopen “Survey the north ridge”' }),
  ).toBeChecked();
  // The count stays the open count.
  await expect(
    tasks(page).getByRole('heading', { level: 2 }).first(),
  ).toContainText('3');
  await expectStored(request, { filters: { done: 'show' } });
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // It survives a reload, and the address never carries it.
  await openLive(page, '/projects/p-echo');
  await expect(showDone(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(tasks(page)).toContainText('Survey the north ridge');
  expect(new URL(page.url()).search).toBe('');

  // Off again hides them.
  await showDone(page).click();
  await expect(showDone(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(tasks(page)).not.toContainText('Survey the north ridge');
  await expectStored(request, null);
});

test('Show done is in Settings → Pages and shows the board’s Done column', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/pages');
  const group = page
    .getByRole('region', { name: 'Project page', exact: true })
    .getByRole('group', { name: 'Done tasks' });
  await group
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Show' }) })
    .click();
  await expect(group.getByRole('radio', { name: 'Show' })).toBeChecked();
  await expectStored(request, { filters: { done: 'show' } });

  await openLive(page, '/projects/p-echo?view=board');
  await expect(showDone(page)).toHaveAttribute('aria-pressed', 'true');
  const board = page.getByRole('region', { name: 'Tasks board' });
  // The page's toggle, not the board's own checkbox.
  await expect(page.getByText('Show a Done column')).toHaveCount(0);
  await expect(
    board.getByRole('region', { name: 'Done', exact: true }),
  ).toBeVisible();
  await expect(board).toContainText('Survey the north ridge');

  await showDone(page).click();
  await expect(
    board.getByRole('region', { name: 'Done', exact: true }),
  ).toHaveCount(0);
  await expect(board).not.toContainText('Survey the north ridge');
  await expectNoSidewaysScroll(page);
});
