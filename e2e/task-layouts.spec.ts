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

const stored = async (request: APIRequestContext) =>
  (await request.get('/api/export.json')).json();

const column = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Tasks board' })
    .getByRole('region', { name, exact: true });

const card = (page: Page, title: string) =>
  page
    .getByRole('region', { name: 'Tasks board' })
    .locator('li')
    .filter({ hasText: title });

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('group by project, Board: drag a task to another project, undo', async ({
  page,
  request,
}) => {
  test.skip(
    isMobile(page),
    'Dragging is the desktop path; phones use the menu.',
  );
  await openLive(page, '/tasks?view=board');
  await expect(
    column(page, 'Echo Base relocation').getByRole('heading'),
  ).toContainText('3');
  await card(page, 'Insulate the hangar doors').dragTo(
    column(page, 'Falcon hyperdrive refit'),
  );
  await expect(
    page.getByText(
      'Moved “Insulate the hangar doors” to Falcon hyperdrive refit',
    ),
  ).toBeVisible();
  await expect(column(page, 'Falcon hyperdrive refit')).toContainText(
    'Insulate the hangar doors',
  );
  await expectSaved(page);
  expect((await stored(request)).tasks['t-2'].projectId).toBe('p-falcon');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(column(page, 'Echo Base relocation')).toContainText(
    'Insulate the hangar doors',
  );
  await expectSaved(page);
  expect((await stored(request)).tasks['t-2'].projectId).toBe('p-echo');
});

test('due columns set real dates; the Done column closes', async ({
  page,
  request,
}) => {
  await openLive(page, '/tasks?view=board&group=due');
  // The menu is the keyboard and touch path.
  await card(page, 'Renew the docking permit')
    .getByRole('button', { name: 'Move “Renew the docking permit” to…' })
    .click();
  await page.getByRole('menuitem', { name: 'Later' }).click();
  await expect(
    page.getByText(/^Moved “Renew the docking permit” to Later \(/),
  ).toBeVisible();
  await expect(column(page, 'Later')).toContainText('Renew the docking permit');

  // Overdue takes no drops.
  await card(page, 'Renew the docking permit')
    .getByRole('button', { name: 'Move “Renew the docking permit” to…' })
    .click();
  await page.getByRole('menuitem', { name: 'Overdue' }).click();
  await expect(
    page.getByText('Overdue is where late tasks land; pick a date instead'),
  ).toBeVisible();

  await page.getByText('Show a Done column').click();
  await card(page, 'Renew the docking permit')
    .getByRole('button', { name: 'Move “Renew the docking permit” to…' })
    .click();
  await page.getByRole('menuitem', { name: 'Done' }).click();
  await expect(column(page, 'Done')).toContainText('Renew the docking permit');
  await expectSaved(page);
  const t6 = (await stored(request)).tasks['t-6'];
  expect(t6.status).toBe('done');
  expect(t6.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('Timeline: drag a point to a later day, and date an undated task', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'Pointer dragging is the desktop path.');
  await openLive(page, '/tasks?view=timeline');
  const point = page.locator('button[data-label^="Book the tauntaun vet"]');
  const box = await point.boundingBox();
  if (!box) throw new Error('No point');
  // Week zoom is 36px a day: two days later.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 72, box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(
    page.getByText(/^Moved “Book the tauntaun vet” to /),
  ).toBeVisible();
  await expectSaved(page);
  expect((await stored(request)).tasks['t-4'].due).toBe('2026-11-02');

  const tray = page.getByRole('region', { name: /No date/ });
  await expect(tray).toContainText('Insulate the hangar doors');
  const lane = page.locator('[data-layout-id="p-echo"] > div').last();
  await tray
    .locator('li')
    .filter({ hasText: 'Insulate the hangar doors' })
    .dragTo(lane, {
      targetPosition: { x: 300, y: 10 },
    });
  await expect(
    page.getByText(/^“Insulate the hangar doors” is due /),
  ).toBeVisible();
  await expect(tray).not.toContainText('Insulate the hangar doors');
});

test('the project page has List and Board', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const group = page.getByRole('group', { name: 'Layout (press v to cycle)' });
  await group
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Board' }) })
    .click();
  await expect(column(page, 'This week')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tasks board' })).toContainText(
    'Book the tauntaun vet',
  );
});

for (const view of ['list', 'table', 'board', 'timeline']) {
  test.describe(`${view} layout`, () => {
    test.use({ reducedMotion: 'reduce' });
    test('is axe clean', async ({ page }) => {
      await openLive(page, `/tasks?view=${view}`);
      await expectAccessible(page);
    });
  });
}
