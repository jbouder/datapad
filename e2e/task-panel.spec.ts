import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

const row = (page: Page, title: string) =>
  page.locator('[data-task-id]').filter({ hasText: title });

async function exported(request: APIRequestContext) {
  return (await request.get('/api/export.json')).json();
}

const lines = (
  data: { activity: Record<string, { events: { text: string }[] }> },
  id: string,
) => (data.activity[id]?.events ?? []).map((e) => e.text);

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('edit every field from the panel; one save, one log line', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const opener = row(page, 'Insulate the hangar doors').getByRole('button', {
    name: 'Insulate the hangar doors',
    exact: true,
  });
  await opener.click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel).toBeVisible();
  const title = panel.getByRole('textbox', { name: 'Title' });
  await expect(title).toBeFocused();

  await title.fill('Insulate and seal the hangar doors');
  await panel.locator('label', { hasText: /^High$/ }).click();
  const due = panel.getByRole('textbox', { name: 'Due' });
  await due.fill('tomorrow');
  await due.press('Tab');
  const who = panel.getByRole('combobox', { name: 'Assignee' });
  await who.click();
  await who.fill('leia');
  await page.getByRole('option', { name: /^Leia Organa/ }).click();
  const tags = panel.getByRole('combobox', { name: 'Tags' });
  await tags.click();
  await tags.fill('winter');
  await tags.press('Enter');

  // @ suggests people; Enter inserts the name.
  const details = panel.getByRole('combobox', { name: 'Details' });
  await details.click();
  await details.pressSequentially('Ask @Ch');
  await expect(panel.getByRole('option', { name: /Chewbacca/ })).toBeVisible();
  await details.press('Enter');
  await expect(details).toHaveValue('Ask @Chewbacca ');
  await details.pressSequentially('about the seals.');

  await panel.getByRole('button', { name: 'Add link', exact: true }).click();
  await panel
    .getByRole('textbox', { name: 'Link 1 URL' })
    .fill('https://example.com/seals');
  await panel.getByRole('textbox', { name: 'Link 1 label' }).fill('Seal spec');

  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel).toBeHidden();
  // Focus is back on the row that opened it.
  await expect(
    row(page, 'Insulate and seal the hangar doors').getByRole('button', {
      name: 'Insulate and seal the hangar doors',
      exact: true,
    }),
  ).toBeFocused();

  const task = row(page, 'Insulate and seal the hangar doors');
  await expect(task).toContainText('Tomorrow');
  await expect(task).toContainText('Leia Organa');

  await expectSaved(page);

  const data = await exported(request);
  expect(data.tasks['t-2']).toMatchObject({
    title: 'Insulate and seal the hangar doors',
    priority: 'high',
    assignee: 'u-leia',
    tags: ['winter'],
    desc: 'Ask @{u-chewie} about the seals.',
    links: [
      { type: 'link', url: 'https://example.com/seals', label: 'Seal spec' },
    ],
  });
  expect(
    lines(data, 'p-echo').filter((l) => l.startsWith('Edited task')),
  ).toEqual(['Edited task "Insulate and seal the hangar doors"']);
});

test('moving to another project logs in both', async ({ page, request }) => {
  await openLive(page, '/projects/p-echo');
  await row(page, 'Book the tauntaun vet')
    .getByRole('button', { name: 'Book the tauntaun vet', exact: true })
    .click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel.getByText('From a note')).toBeVisible();
  const project = panel.getByRole('combobox', { name: 'Project' });
  await project.click();
  await project.fill('falcon');
  await expect(page.getByRole('option')).toHaveText([
    /Falcon hyperdrive refit/,
  ]);
  await project.press('Enter');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(row(page, 'Book the tauntaun vet')).toHaveCount(0);

  await expectSaved(page);

  const data = await exported(request);
  expect(lines(data, 'p-echo')[0]).toBe(
    'Moved "Book the tauntaun vet" to Falcon hyperdrive refit',
  );
  expect(lines(data, 'p-falcon')[0]).toBe(
    'Moved "Book the tauntaun vet" here from Echo Base relocation',
  );
});

test('delete with undo restores the same task in the same place', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const before = await page
    .getByRole('list', { name: 'Open tasks' })
    .getByRole('listitem')
    .allTextContents();
  await row(page, 'Insulate the hangar doors')
    .getByRole('button', { name: 'Insulate the hangar doors', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(
    page.getByText('Deleted “Insulate the hangar doors”'),
  ).toBeVisible();
  await expect(row(page, 'Insulate the hangar doors')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Open tasks' }).getByRole('listitem'),
  ).toHaveText(before);
  await expectSaved(page);

  const data = await exported(request);
  expect(data.tasks['t-2']).toEqual(SEED.tasks['t-2']);
});

test('the panel keeps your typing when the task changes elsewhere', async ({
  page,
  context,
}) => {
  test.skip(isMobile(page), 'Two windows side by side is a desktop case.');
  await openLive(page, '/projects/p-echo');
  await row(page, 'Insulate the hangar doors')
    .getByRole('button', { name: 'Insulate the hangar doors', exact: true })
    .click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  const title = panel.getByRole('textbox', { name: 'Title' });
  await title.fill('Typed here');

  const other = await context.newPage();
  await openLive(other, '/projects/p-echo');
  await row(other, 'Insulate the hangar doors')
    .getByRole('button', { name: /^Priority/ })
    .click();
  await other.getByRole('menuitemradio', { name: 'High' }).click();

  await expect(panel.getByText('Updated elsewhere.')).toBeVisible();
  await expect(title).toHaveValue('Typed here');
  await panel.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(title).toHaveValue('Insulate the hangar doors');
  await expect(panel.getByRole('radio', { name: 'High' })).toBeChecked();
});

test('+ opens a new task preset to the project you are on', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-falcon');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Add task', exact: true })
    .click();
  const panel = page.getByRole('dialog', { name: 'New task' });
  await expect(panel.getByRole('combobox', { name: 'Project' })).toHaveValue(
    'Falcon hyperdrive refit',
  );
  await panel
    .getByRole('textbox', { name: 'Title' })
    .fill('Polish the dejarik board');
  await panel.getByRole('textbox', { name: 'Due' }).fill('fri');
  await panel.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(panel).toBeHidden();
  await expect(
    page.getByText(
      'Added “Polish the dejarik board” to Falcon hyperdrive refit',
    ),
  ).toBeVisible();
  await expect(row(page, 'Polish the dejarik board')).toBeVisible();
  await expectSaved(page);

  const data = await exported(request);
  const added = Object.values(data.tasks).find(
    (t) => (t as { title: string }).title === 'Polish the dejarik board',
  ) as { projectId: string; due: string };
  expect(added.projectId).toBe('p-falcon');
  expect(added.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // `n` on a page without a quick-add opens it too.
  await page.goto('/settings');
  await page.locator('body').press('n');
  await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
});
