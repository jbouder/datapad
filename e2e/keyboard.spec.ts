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

test('capture in the room, then move, edit, complete and date without the mouse', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-falcon');
  // `n` goes to the capture line, preset to the project; Enter adds and
  // keeps focus there.
  const capture = page.getByRole('combobox', { name: 'Capture' });
  await page.locator('body').press('n');
  for (const title of ['Patch the hull', 'Tune the deflector']) {
    await expect(capture).toBeFocused();
    await page.keyboard.type(`[ ] ${title}`);
    await page.keyboard.press('Enter');
    await expect(capture).toHaveValue('');
    await expect(
      page
        .getByRole('complementary', { name: 'Open loops' })
        .locator('[data-loop]')
        .filter({ hasText: title }),
    ).toBeVisible();
  }

  // The rows' keys live on Tasks' List (the room's lanes have none, and
  // no page reorders tasks since the room, #334).
  await openLive(page, '/all?kind=task&view=list&group=none&sort=title');
  const titles = (
    await page.locator('[data-task-id] [data-task-title]').allTextContents()
  ).map((t) => t.trim());
  expect(titles).toContain('Patch the hull');
  await page.locator('body').click({ position: { x: 5, y: 300 } });

  // j moves into the list from wherever focus is, then down; k back up.
  await page.keyboard.press('j');
  expect(await focusedTitle(page)).toBe(titles[0]);
  await page.keyboard.press('j');
  expect(await focusedTitle(page)).toBe(titles[1]);
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  expect(await focusedTitle(page)).toBe(titles[1]);

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
  ) as { status: string; projectId: string };
  expect(task.status).toBe('done');
  expect(task.projectId).toBe('p-falcon');

  // d opens the focused task's due popover where rows edit in place:
  // Timeline's No date. Type a date and it leaves No date.
  await openLive(page, '/all?kind=task&view=timeline');
  const undated = page.locator('section[aria-labelledby="undated-title"]');
  await undated
    .getByRole('button', { name: 'Tune the deflector', exact: true })
    .focus();
  await page.keyboard.press('d');
  const due = page.getByRole('textbox', { name: 'Due' });
  await expect(due).toBeFocused();
  await due.fill('tomorrow');
  await due.press('Enter');
  await expect(undated).not.toContainText('Tune the deflector');
  await expectSaved(page);
  const after = await (await request.get('/api/export.json')).json();
  const tuned = Object.values(after.tasks).find(
    (t) => (t as { title: string }).title === 'Tune the deflector',
  ) as { due: string };
  expect(tuned.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('the Tasks table: j focuses a row, x completes, e opens its panel', async ({
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
  const title = (await opened.locator('[data-task-title]').textContent()) ?? '';
  await opened.focus();
  await page.keyboard.press('e');
  // A task opens in its panel everywhere (#329).
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue(
    title.trim(),
  );
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/all\?kind=task&/);
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
  // Notes' Find (no page has a quick-add since #218).
  await openLive(page, '/notes?view=list');
  const input = page.getByRole('searchbox', { name: 'Find' });
  await input.click();
  await page.keyboard.type('jxenv?');
  await expect(input).toHaveValue('jxenv?');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'List' })).toBeChecked();
});
