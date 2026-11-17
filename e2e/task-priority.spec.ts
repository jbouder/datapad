import type { APIRequestContext, Page } from '@playwright/test';
import {
  addFromTopBar,
  expect,
  expectAccessible,
  expectSaved,
  openLive,
  test,
} from './fixtures';

interface Stored {
  tasks: Record<string, { title: string; priority: string }>;
  settings: Record<string, { defaultPriority?: string }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const setting = (page: Page) =>
  page.getByRole('group', { name: 'New task priority' });

async function newTask(page: Page, title: string) {
  await addFromTopBar(page, 'Add task');
  const panel = page.getByRole('dialog', { name: 'New task' });
  await panel.getByRole('textbox', { name: 'Title' }).fill(title);
  return panel;
}

test('new tasks start at Medium; Settings → Pages changes it', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/pages');
  await expect(
    setting(page).getByRole('radio', { name: 'Medium' }),
  ).toBeChecked();
  await expectAccessible(page);

  let panel = await newTask(page, 'Sweep the hangar');
  await expect(panel.getByRole('radio', { name: 'Medium' })).toBeChecked();
  await panel.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(panel).toBeHidden();

  await setting(page).getByText('High', { exact: true }).click();
  await expect(
    setting(page).getByRole('radio', { name: 'High' }),
  ).toBeChecked();

  panel = await newTask(page, 'Check the shields');
  await expect(panel.getByRole('radio', { name: 'High' })).toBeChecked();
  await panel.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(panel).toBeHidden();

  await expectSaved(page);
  const data = await stored(request);
  expect(data.settings.user?.defaultPriority).toBe('high');
  const byTitle = Object.fromEntries(
    Object.values(data.tasks).map((t) => [t.title, t.priority]),
  );
  expect(byTitle).toMatchObject({
    'Sweep the hangar': 'med',
    'Check the shields': 'high',
  });
});
