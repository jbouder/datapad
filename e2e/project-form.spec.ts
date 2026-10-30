import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectSaved,
  moreAction,
  moreActions,
  openLive,
  SEED,
  test,
} from './fixtures';

const panel = (page: Page) => page.getByRole('dialog');

async function activity(request: APIRequestContext, id: string) {
  const data = await (await request.get('/api/export.json')).json();
  return (data.activity[id]?.events ?? []).map((e: { text: string }) => e.text);
}

test('name and Enter creates a project and goes to it', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects');
  await page.getByRole('button', { name: 'Add project' }).click();
  const name = panel(page).getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await name.fill('Death Star plans');
  await name.press('Enter');
  await expect(panel(page)).toBeHidden();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Death Star plans' }),
  ).toBeVisible();
  const id = page.url().split('/').pop() ?? '';
  expect(await activity(request, id)).toEqual(['Created project']);
});

test('Save never disables: it focuses the first problem', async ({ page }) => {
  await openLive(page, '/projects');
  await page.getByRole('button', { name: 'Add project' }).click();
  const create = panel(page).getByRole('button', { name: 'Create project' });
  await expect(create).toBeEnabled();
  await create.click();
  const name = panel(page).getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(panel(page).getByText('Give the project a name')).toBeVisible();

  await name.fill('Hoth');
  const target = panel(page).getByRole('textbox', { name: 'Target date' });
  await target.fill('someday');
  await target.press('Tab');
  await create.click();
  await expect(target).toBeFocused();
  await expect(panel(page)).toBeVisible();

  // ⌘/Ctrl+Enter submits from anywhere once it is fixed.
  await target.fill('+2w');
  await target.press('Tab');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel(page)).toBeHidden();
});

test('a start date shows on the page and cannot come after the target', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects');
  await page.getByRole('button', { name: 'Add project' }).click();
  await panel(page).getByRole('textbox', { name: 'Name' }).fill('Hoth');
  const start = panel(page).getByRole('textbox', { name: 'Start date' });
  const target = panel(page).getByRole('textbox', { name: 'Target date' });
  await start.fill('2030-03-10');
  await start.press('Tab');
  await target.fill('2030-03-01');
  await target.press('Tab');
  const create = panel(page).getByRole('button', { name: 'Create project' });
  await create.click();
  await expect(target).toBeFocused();
  await expect(
    panel(page).getByText('Starts after the target date'),
  ).toBeVisible();

  await target.fill('2030-04-01');
  await target.press('Tab');
  await create.click();
  await expect(panel(page)).toBeHidden();
  await expect(page.getByText(/^Starts .*2030/)).toBeVisible();
  await expectSaved(page);
  const data = await (await request.get('/api/export.json')).json();
  const hoth = Object.values(data.projects).find(
    (p) => (p as { name: string }).name === 'Hoth',
  );
  expect(hoth).toMatchObject({
    startDate: '2030-03-10',
    targetDate: '2030-04-01',
  });
});

test('edit logs details and status separately; a new org is offered', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-falcon');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(panel(page)).toBeVisible();

  const org = panel(page).getByRole('combobox', { name: 'Org' });
  await org.click();
  await org.fill('Kessel Run Ltd');
  await expect(
    page.getByRole('option', { name: 'Add “Kessel Run Ltd” as an org' }),
  ).toBeVisible();
  await org.press('Enter');
  await expect(org).toHaveValue('Kessel Run Ltd');

  await panel(page)
    .locator('label', { hasText: /^Active$/ })
    .click();
  await expect(
    panel(page).getByRole('radio', { name: 'Active' }),
  ).toBeChecked();
  await panel(page).locator('label', { hasText: 'Leia Organa' }).click();
  await panel(page).getByRole('button', { name: 'Save' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.getByText('Kessel Run Ltd')).toBeVisible();

  await expectSaved(page);

  const lines = await activity(request, 'p-falcon');
  expect(lines.slice(0, 2)).toEqual([
    'Status changed to active',
    'Edited project details',
  ]);
  await expectSaved(page);

  const data = await (await request.get('/api/export.json')).json();
  expect(data.projects['p-falcon']).toMatchObject({
    org: 'Kessel Run Ltd',
    status: 'active',
    members: ['u-han', 'u-chewie', 'u-leia'],
  });
});

test('a dirty form asks before Esc throws it away', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel(page).getByRole('textbox', { name: 'Name' }).fill('Echo Base II');
  await page.keyboard.press('Escape');
  await expect(
    panel(page).getByRole('alertdialog', { name: 'Discard your changes?' }),
  ).toBeVisible();
  await panel(page).getByRole('button', { name: 'Discard' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Echo Base relocation' }),
  ).toBeVisible();
});

test('archive with undo, then delete with the counts', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-echo');

  await moreAction(page, 'Archive');
  await expect(page.getByText('Archived Echo Base relocation')).toBeVisible();
  expect(await moreActions(page)).toContain('Unarchive');
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await moreActions(page)).toContain('Archive');
  expect((await activity(request, 'p-echo')).slice(0, 2)).toEqual([
    'Unarchived project',
    'Archived project',
  ]);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Delete' }).click();
  const ask = panel(page).getByRole('alertdialog');
  await expect(ask).toContainText(
    'Delete Echo Base relocation and its 4 tasks, 2 notes, 1 milestone and activity?',
  );
  await ask.getByRole('button', { name: 'Delete project' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText('Deleted Echo Base relocation')).toBeVisible();

  await expectSaved(page);

  const data = await (await request.get('/api/export.json')).json();
  expect(data.projects['p-echo']).toBeUndefined();
  expect(
    Object.values(data.tasks).filter(
      (t) => (t as { projectId: string }).projectId === 'p-echo',
    ),
  ).toEqual([]);
  expect(data.activity['p-echo']).toBeUndefined();
  // Its meetings moved to General.
  expect(data.meetings['e-1'].projectId).toBeNull();
});
