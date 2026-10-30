import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  moreAction,
  openLive,
  SEED,
  test,
} from './fixtures';

const row = (page: Page, title: string) =>
  page.locator('[data-task-id]').filter({ hasText: title });

async function stored(request: APIRequestContext) {
  return (await request.get('/api/export.json')).json();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('a task opened from Tasks is a page: its facts, details and notes', async ({
  page,
}) => {
  await openLive(page, '/tasks?view=list');
  await row(page, 'Confirm shield generator delivery')
    .getByRole('button', {
      name: 'Confirm shield generator delivery',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/tasks\/t-1$/);
  await expect(page).toHaveTitle('Confirm shield generator delivery · Datapad');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', {
      level: 1,
      name: 'Confirm shield generator delivery',
    }),
  ).toBeVisible();
  // Under Tasks in the nav.
  const nav = isMobile(page)
    ? page.getByRole('navigation', { name: 'Sections' })
    : page.getByRole('complementary', { name: 'Datapad' });
  await expect(
    nav.getByRole('link', { name: /^Tasks/ }).first(),
  ).toHaveAttribute('aria-current', 'page');

  await expect(
    main.getByRole('link', { name: 'Echo Base relocation' }),
  ).toBeVisible();
  const details = main.getByRole('list', { name: 'Details' });
  await expect(details).toContainText('Open');
  await expect(details).toContainText('High priority');
  await expect(details).toContainText('Leia Organa');
  await expect(details).toContainText('logistics');
  await expect(details.getByRole('link', { name: /#12/ })).toHaveAttribute(
    'href',
    'https://example.com/issues/12',
  );
  await expect(
    main.getByRole('region', { name: 'Details', exact: true }),
  ).toContainText('Ask @Han Solo for the manifest.');

  // A running note, added on the page.
  const notes = main.getByRole('region', { name: 'Notes', exact: true });
  await notes.getByRole('button', { name: 'Add note' }).click();
  const composer = notes.getByRole('combobox', {
    name: 'New note on “Confirm shield generator delivery”',
  });
  await expect(composer).toBeFocused();
  await page.keyboard.type('Manifest is in the hold.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(notes).toContainText('Manifest is in the hold.');

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Back returns to the list.
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks\?view=list$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tasks' }),
  ).toBeVisible();
});

test('Close, Edit in the panel, Delete with Undo', async ({
  page,
  request,
}) => {
  await openLive(page, '/tasks/t-2');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByText('Closed “Insulate the hangar doors”'),
  ).toBeVisible();
  await expect(main.getByRole('list', { name: 'Details' })).toContainText(
    'Done',
  );
  await main.getByRole('button', { name: 'Reopen' }).click();
  await expect(main.getByRole('list', { name: 'Details' })).toContainText(
    'Open',
  );

  await main.getByRole('button', { name: 'Edit', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  await panel.getByLabel('Title').fill('Insulate the north hangar doors');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expect(
    main.getByRole('heading', {
      level: 1,
      name: 'Insulate the north hangar doors',
    }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Insulate the north hangar doors · Datapad');

  await moreAction(page, 'Delete');
  await expect(page).toHaveURL(/\/tasks$/);
  const toast = page.getByText('Deleted “Insulate the north hangar doors”');
  await expect(toast).toBeVisible();
  await expectSaved(page);
  expect((await stored(request)).tasks['t-2']).toBeUndefined();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expectSaved(page);
  expect((await stored(request)).tasks['t-2']?.title).toBe(
    'Insulate the north hangar doors',
  );
});

test('Add task opens the new-task panel', async ({ page }) => {
  await openLive(page, '/tasks');
  await expect(page.getByRole('textbox', { name: 'Add a task' })).toHaveCount(
    0,
  );
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add task' })
    .click();
  const panel = page.getByRole('dialog', { name: 'New task' });
  await panel.getByLabel('Title').fill('Wax the snowspeeders');
  await panel.getByRole('button', { name: 'Add task' }).click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByText('Added “Wax the snowspeeders” to General'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);
});

test('elsewhere a task still opens its panel', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  await row(page, 'Insulate the hangar doors')
    .getByRole('button', { name: 'Insulate the hangar doors', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
});

test('a task that is not there says so', async ({ page }) => {
  await openLive(page, '/tasks/nope');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Not found' }),
  ).toBeVisible();
  await expect(page.getByText('There is no task here.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
});
