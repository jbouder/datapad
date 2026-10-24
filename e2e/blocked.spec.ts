import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

interface Stored {
  tasks: Record<
    string,
    { blocked?: { on: string | null; note: string } | null }
  >;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const TITLE = 'Find a replacement motivator';

function row(page: Page, title = TITLE) {
  return page.locator('[data-task-id]').filter({ hasText: title }).first();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('mark a task blocked on someone; Focus, People and Tasks show it', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-falcon');
  await row(page)
    .getByRole('button', { name: `More for “${TITLE}”` })
    .click();
  await page.getByRole('menuitem', { name: 'Mark blocked…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Blocked' });
  const who = dialog.getByRole('combobox', { name: 'Waiting on' });
  await who.click();
  await who.fill('leia');
  await page.getByRole('option', { name: /^Leia Organa/ }).click();
  await dialog
    .getByRole('textbox', { name: 'What for' })
    .fill('Sign-off on the budget');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Mark blocked' }).click();
  await expect(dialog).toBeHidden();

  await expect(
    row(page).getByRole('button', { name: /^Blocked on Leia Organa/ }),
  ).toBeVisible();
  await expectSaved(page);
  const data = await stored(request);
  expect(data.tasks['t-5']?.blocked).toEqual({
    on: 'u-leia',
    note: 'Sign-off on the budget',
  });
  expect(data.activity['p-falcon']?.events[0]?.text).toBe(
    `Blocked "${TITLE}" on Leia Organa`,
  );

  // Focus: a Blocked bucket, first.
  await openLive(page, '/');
  const blocked = page.getByRole('list', { name: 'Blocked' });
  await expect(blocked).toContainText(TITLE);

  // Tasks: Show Blocked lists only it.
  await openLive(page, '/tasks?status=blocked');
  const main = page.getByRole('main');
  await expect(main.getByText(TITLE).first()).toBeVisible();
  await expect(main.getByText('Insulate the hangar doors')).toHaveCount(0);

  // People: waiting on Leia.
  await openLive(page, '/settings/people/u-leia');
  await expect(
    page.getByRole('list', { name: 'Tasks waiting on Leia Organa' }),
  ).toContainText(TITLE);
});

test('b unblocks the focused task, with Undo', async ({ page, request }) => {
  test.skip(isMobile(page), 'Keyboard shortcut');
  const seed = structuredClone(SEED);
  Object.assign(seed.tasks['t-5'], { blocked: { on: null, note: 'Parts' } });
  await request.post('/api/import', { data: seed });
  await openLive(page, '/projects/p-falcon');
  await page.getByRole('button', { name: TITLE, exact: true }).focus();
  await page.keyboard.press('b');
  await expect(page.getByText(`Unblocked “${TITLE}”`)).toBeVisible();
  await expect(row(page).getByRole('button', { name: /^Blocked/ })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(
    row(page).getByRole('button', { name: /^Blocked: Parts/ }),
  ).toBeVisible();

  // b on an unblocked task asks who it waits on.
  await page.getByRole('button', { name: TITLE, exact: true }).focus();
  await page.keyboard.press('b');
  await expect(page.getByText(`Unblocked “${TITLE}”`)).toBeVisible();
  await page.keyboard.press('b');
  await expect(page.getByRole('dialog', { name: 'Blocked' })).toBeVisible();
});

test('the task panel sets and clears it', async ({ page, request }) => {
  await openLive(page, '/projects/p-falcon');
  await page.getByRole('button', { name: TITLE, exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  await panel.getByRole('switch', { name: /^Blocked/ }).click();
  await panel.getByRole('textbox', { name: 'What for' }).fill('Parts on order');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expectSaved(page);
  expect((await stored(request)).tasks['t-5']?.blocked).toEqual({
    on: null,
    note: 'Parts on order',
  });
  await expect(
    row(page).getByRole('button', { name: /^Blocked: Parts on order/ }),
  ).toBeVisible();
});
