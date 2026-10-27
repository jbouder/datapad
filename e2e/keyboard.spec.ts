import {
  expect,
  expectAccessible,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

test.beforeEach(async ({ page, request }) => {
  test.skip(isMobile(page), 'Keyboard paths are checked on desktop.');
  await request.post('/api/import', { data: SEED });
});

const focusedTitle = (page: import('@playwright/test').Page) =>
  page.evaluate(
    () =>
      document.activeElement
        ?.closest('[data-task-id]')
        ?.querySelector('[data-task-title]')?.textContent ?? null,
  );

test('add, move, complete, edit and reorder without the mouse', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-falcon');
  // `n` opens the new-task panel, preset to the project; Enter adds.
  const adding = page.getByRole('dialog', { name: 'New task' });
  for (const title of ['Patch the hull', 'Tune the deflector']) {
    await page.locator('body').press('n');
    await expect(adding.getByRole('textbox', { name: 'Title' })).toBeFocused();
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
    await expect(adding).toBeHidden();
    await expect(
      page.locator('[data-task-id]').filter({ hasText: title }),
    ).toBeVisible();
  }
  await page.locator('body').click({ position: { x: 5, y: 300 } });

  // j moves into the list from wherever focus is, then down; k back up.
  await page.keyboard.press('j');
  expect(await focusedTitle(page)).toBe('Find a replacement motivator');
  await page.keyboard.press('j');
  expect(await focusedTitle(page)).toBe('Patch the hull');
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  expect(await focusedTitle(page)).toBe('Patch the hull');

  // Alt+↓ reorders the focused task.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(
    page.getByRole('status').filter({ hasText: 'Moved' }),
  ).toHaveText('Moved “Patch the hull” to position 3 of 3');

  // d opens its due popover; type a date.
  await page.keyboard.press('d');
  const due = page.getByRole('textbox', { name: 'Due' });
  await expect(due).toBeFocused();
  await due.fill('tomorrow');
  await due.press('Enter');
  await expect(
    page.locator('[data-task-id]').filter({ hasText: 'Patch the hull' }),
  ).toContainText('Tomorrow');

  // e opens it; edit and save with ⌘/Ctrl+Enter; Esc would cancel.
  await page
    .getByRole('button', { name: 'Patch the hull', exact: true })
    .focus();
  await page.keyboard.press('e');
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Patch the hull plating');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel).toBeHidden();

  // x completes the focused task.
  await expect(
    page.getByRole('button', { name: 'Patch the hull plating', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('x');
  await expect(page.getByText('Closed “Patch the hull plating”')).toBeVisible();
  await expectSaved(page);
  const data = await (await request.get('/api/export.json')).json();
  const task = Object.values(data.tasks).find(
    (t) => (t as { title: string }).title === 'Patch the hull plating',
  ) as { status: string; due: string };
  expect(task.status).toBe('done');
  expect(task.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('the Tasks table: j focuses a row, x completes, e opens its page', async ({
  page,
}) => {
  await openLive(page, '/tasks?view=table&group=none&sort=title');
  await page.keyboard.press('j');
  const first = page.locator('tr[data-row-id]').first();
  await expect(first).toBeFocused();
  await page.keyboard.press('j');
  await expect(page.locator('tr[data-row-id]').nth(1)).toBeFocused();
  await page.keyboard.press('x');
  await expect(page.getByText(/^Closed “/)).toBeVisible();
  const opened = page.locator('tr[data-row-id]').first();
  const id = await opened.getAttribute('data-row-id');
  await opened.focus();
  await page.keyboard.press('e');
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));
  await page.goBack();
  await expect(page.locator('tr[data-row-id]').first()).toBeVisible();
});

test.describe('the shortcut sheet', () => {
  test.use({ reducedMotion: 'reduce' });
  test('? opens it; it lists every binding and is axe clean', async ({
    page,
  }) => {
    await openLive(page, '/');
    await page.locator('body').press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    for (const key of ['n', 'j', 'x', 'e', 'v', 'Alt+↑']) {
      await expect(
        sheet.locator('kbd', { hasText: key }).first(),
      ).toBeVisible();
    }
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });
});

test('letters type, not trigger, while you are in a field', async ({
  page,
}) => {
  // Focus's quick-add.
  await openLive(page, '/');
  const input = page.getByRole('textbox', { name: 'Add a task' });
  await input.click();
  await page.keyboard.type('jxen?');
  await expect(input).toHaveValue('jxen?');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.locator('[data-task-id]').filter({ hasText: 'Confirm shield' }),
  ).not.toContainText('Closed');
});
