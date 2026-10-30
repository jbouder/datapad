import type { APIRequestContext } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectSaved,
  moreAction,
  moreActions,
  openLive,
  SEED,
  test,
} from './fixtures';

interface Stored {
  projects: Record<string, { name: string; tags: string[] }>;
  tasks: Record<
    string,
    { title: string; projectId: string | null; order: number; priority: string }
  >;
  templates: Record<string, { name: string; tasks: { title: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

test('save a project’s tasks as a template, then start a project from it', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  // Not without open tasks.
  await openLive(page, '/projects/p-yavin');
  await expect(
    page.getByRole('heading', { name: 'Yavin IV retrospective', level: 1 }),
  ).toBeVisible();
  expect(await moreActions(page)).not.toContain('Save as template');

  // In the header's More menu.
  await openLive(page, '/projects/p-echo');
  await moreAction(page, 'Save as template');

  const panel = page.getByRole('dialog', { name: 'New template' });
  await expect(panel.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Echo Base relocation kickoff',
  );
  await panel.getByRole('textbox', { name: 'Name' }).fill('Base move');
  await expect(panel.getByRole('textbox', { name: /^Task \d+$/ })).toHaveCount(
    3,
  );
  // Add one at the end with Enter, move it to the top.
  await panel.getByRole('textbox', { name: 'Task 3' }).press('Enter');
  await expect(panel.getByRole('textbox', { name: 'Task 4' })).toBeFocused();
  await page.keyboard.type('Kickoff call');
  for (const n of [4, 3, 2]) {
    await panel.getByRole('button', { name: `Move task ${n} up` }).click();
  }
  await expect(panel.getByRole('textbox', { name: 'Task 1' })).toHaveValue(
    'Kickoff call',
  );
  await panel.getByLabel('Priority of task 1').selectOption('high');
  await expectAccessible(page);
  await panel.getByRole('button', { name: 'Add template' }).click();
  await expect(panel).toBeHidden();
  await expectSaved(page);

  await openLive(page, '/settings/templates');
  await expect(
    page.getByRole('list', { name: 'Project templates' }),
  ).toContainText('Base move');
  await expect(
    page.getByRole('list', { name: 'Project templates' }),
  ).toContainText('4 tasks');

  // A new project from it.
  await openLive(page, '/projects');
  await page.getByRole('button', { name: 'Add project' }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Name' }).fill('Hoth outpost');
  await form.getByRole('combobox', { name: 'Start from template' }).click();
  await page.getByRole('option', { name: 'Base move (4 tasks)' }).click();
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(
    page.getByRole('heading', { name: 'Hoth outpost', level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Open tasks' })
      .getByRole('listitem')
      .first(),
  ).toContainText('Kickoff call');
  await expectSaved(page);

  const data = await stored(request);
  const hoth = Object.entries(data.projects).find(
    ([, p]) => p.name === 'Hoth outpost',
  );
  const tasks = Object.values(data.tasks)
    .filter((t) => t.projectId === hoth?.[0])
    .sort((a, b) => a.order - b.order);
  expect(tasks.map((t) => t.title)[0]).toBe('Kickoff call');
  expect(tasks[0]?.priority).toBe('high');
  expect(tasks).toHaveLength(4);
  expect(hoth?.[1].tags).toEqual(['infra', 'hoth']);
});
