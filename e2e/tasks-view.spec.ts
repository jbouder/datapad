import type { Page } from '@playwright/test';
import {
  expect,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

const table = (page: Page) => page.getByRole('table', { name: 'Tasks' });

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('group by assignee, Shift-select two, move them, undo', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'Multi-select is the desktop table.');
  await openLive(page, '/tasks');
  await choose(page, 'Group by', 'Assignee');
  await expect(page).toHaveURL(/group=assignee/);
  await expect(table(page).getByRole('rowheader')).toHaveText([
    /Chewbacca/,
    /Han Solo/,
    /Leia Organa/,
    /Unassigned/,
  ]);

  const unassigned = table(page).locator('tbody[data-group="unassigned"]');
  await unassigned
    .getByRole('checkbox', { name: 'Select “Book the tauntaun vet”' })
    .click();
  await unassigned
    .getByRole('checkbox', { name: 'Select “Renew the docking permit”' })
    .click({ modifiers: ['Shift'] });
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
  await expect(bar.getByRole('status')).toHaveText('2 tasks selected');
  // Both boxes show ticked (a Shift-click must not undo its own tick).
  await expect(
    unassigned.getByRole('checkbox', {
      name: 'Select “Renew the docking permit”',
    }),
  ).toBeChecked();
  await expect(
    unassigned.getByRole('checkbox', {
      name: 'Select “Book the tauntaun vet”',
    }),
  ).toBeChecked();
  // The header row sits above the first group, not on it.
  const head = await table(page).locator('thead').boundingBox();
  const firstGroup = await table(page).locator('tbody').first().boundingBox();
  expect((head?.y ?? 0) + (head?.height ?? 0)).toBeLessThanOrEqual(
    (firstGroup?.y ?? 0) + 1,
  );

  await bar.getByRole('button', { name: 'Move…' }).click();
  const picker = page.getByRole('combobox', { name: 'Move to project' });
  await picker.fill('falcon');
  await page.getByRole('option', { name: /Falcon hyperdrive refit/ }).click();
  await expect(page.getByText('Moved 2 tasks')).toBeVisible();
  await expect(bar).toBeHidden();
  await expectSaved(page);
  let data = await (await request.get('/api/export.json')).json();
  expect(data.tasks['t-4'].projectId).toBe('p-falcon');
  expect(data.tasks['t-6'].projectId).toBe('p-falcon');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expectSaved(page);
  data = await (await request.get('/api/export.json')).json();
  expect(data.tasks['t-4'].projectId).toBe('p-echo');
  expect(data.tasks['t-6'].projectId).toBeNull();
});

test('delete a selected task, then Undo restores it as it was', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'Multi-select is the desktop table.');
  await openLive(page, '/tasks');
  const before = (await (await request.get('/api/export.json')).json()).tasks[
    't-4'
  ];
  expect(before.title).toBe('Book the tauntaun vet');
  await table(page)
    .getByRole('checkbox', { name: 'Select “Book the tauntaun vet”' })
    .click();
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
  await bar.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Deleted 1 task')).toBeVisible();
  await expect(table(page)).not.toContainText('Book the tauntaun vet');
  await expectSaved(page);
  let data = await (await request.get('/api/export.json')).json();
  expect(data.tasks['t-4']).toBeUndefined();

  // Undo is a checked restore (#235), not a blind write: it logs.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(table(page)).toContainText('Book the tauntaun vet');
  await expectSaved(page);
  data = await (await request.get('/api/export.json')).json();
  const { updatedAt: _a, ...was } = before;
  const { updatedAt: _b, ...now } = data.tasks['t-4'];
  expect(now).toEqual(was);
  const scope = before.projectId ?? 'general';
  expect(data.activity[scope].events[0].text).toBe(
    'Restored task "Book the tauntaun vet"',
  );
});

test('sorting, filters and Back, all in the URL', async ({ page }) => {
  test.skip(isMobile(page), 'Column sorting is the desktop table.');
  await openLive(page, '/tasks?group=none');
  const titleHeader = table(page).getByRole('columnheader', { name: /Title/ });
  await titleHeader.getByRole('button').click();
  await expect(page).toHaveURL(/sort=title/);
  await expect(titleHeader).toHaveAttribute('aria-sort', 'ascending');
  const titles = table(page).locator('[data-task-title]');
  await expect(titles.first()).toHaveText('Book the tauntaun vet');
  await titleHeader.getByRole('button').click();
  await expect(titleHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(titles.first()).toHaveText('Renew the docking permit');

  await page.locator('label', { hasText: /^Done$/ }).click();
  await expect(page).toHaveURL(/status=done/);
  await expect(titles).toHaveText([
    'Write the Yavin report',
    'Survey the north ridge',
  ]);
  await page.goBack();
  await expect(page).not.toHaveURL(/status=done/);
  await expect(titles).toHaveCount(5);

  await page.getByRole('searchbox', { name: 'Find' }).fill('motivator');
  await expect(titles).toHaveText(['Find a replacement motivator']);
});

test('Add task on Mine assigns to you; ⌘A and Esc', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'Selection is the desktop table.');
  await openLive(page, '/tasks?who=mine');
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add task' })
    .click();
  const panel = page.getByRole('dialog', { name: 'New task' });
  await expect(panel.getByRole('combobox', { name: 'Assignee' })).toHaveValue(
    'Leia Organa',
  );
  await panel.getByLabel('Title').fill('Brief the pilots');
  await panel.getByRole('button', { name: 'Add task' }).click();
  await expect(panel).toBeHidden();
  await expect(table(page).locator('[data-task-title]')).toContainText([
    'Brief the pilots',
  ]);
  await expectSaved(page);
  const data = await (await request.get('/api/export.json')).json();
  const added = Object.values(data.tasks).find(
    (t) => (t as { title: string }).title === 'Brief the pilots',
  ) as { assignee: string };
  expect(added.assignee).toBe('u-leia');

  await table(page).locator('tr[data-row-id]').first().focus();
  await page.keyboard.press('ControlOrMeta+a');
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
  await expect(bar.getByRole('status')).toHaveText(/selected$/);
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
});

test('phones get task rows under group headers', async ({ page }) => {
  test.skip(!isMobile(page), 'Rows are the phone layout.');
  await openLive(page, '/tasks');
  await expect(table(page)).toBeHidden();
  const echo = page.getByRole('region', { name: 'Echo Base relocation' });
  await expect(echo.locator('[data-task-id]')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'General' })).toContainText(
    'Renew the docking permit',
  );
});

test('a thousand tasks render promptly', async ({ page, request }) => {
  const tasks: Record<string, unknown> = {};
  for (let i = 0; i < 1000; i += 1) {
    tasks[`bulk-${i}`] = {
      ...SEED.tasks['t-1'],
      id: `bulk-${i}`,
      title: `Bulk task ${String(i).padStart(4, '0')}`,
      projectId: ['p-echo', 'p-falcon', null][i % 3],
      order: i + 10,
    };
  }
  await request.post('/api/import', {
    data: { ...SEED, tasks: { ...SEED.tasks, ...tasks } },
  });
  await openLive(page, '/settings');
  const started = Date.now();
  await page
    .getByRole('link', { name: /^Tasks/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page.locator('[data-task-title]').filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
  // A smoke budget for a gross regression, not a benchmark: about 700ms
  // alone, but a loaded CI runner has taken over 5s, and with
  // failOnFlakyTests one slow first try fails the run.
  expect(Date.now() - started).toBeLessThan(12_000);
});

test('the selection bar stays at the foot of the window', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/tasks');
  await page
    .getByRole('checkbox', { name: /^Select “/ })
    .first()
    .click();
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
  await expect(bar.getByRole('status')).toHaveText('1 task selected');
  // The window's foot (above the tab bar on phones), not the page's: the
  // page's entrance leaves a translate on it, which would hold a fixed bar
  // below a long list.
  const height = page.viewportSize()?.height ?? 0;
  const tabBar = isMobile(page) ? 56 : 0;
  await expect
    .poll(async () => {
      const box = await bar.boundingBox();
      return box ? Math.round(height - tabBar - (box.y + box.height)) : -1;
    })
    .toBe(16);
});
