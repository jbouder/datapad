import type { APIRequestContext, Page } from '@playwright/test';
import {
  addFromTopBar,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  openLive,
  test,
} from './fixtures';

interface Stored {
  tasks: Record<string, { title: string; assignee: string }>;
  people: Record<string, { name: string; me: boolean }>;
  settings: Record<string, { assignToMe?: boolean }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const assignSwitch = (page: Page) =>
  page.getByRole('switch', { name: /Assign new tasks to me/ });

async function addPerson(page: Page, name: string, me = false) {
  await page.getByRole('button', { name: 'Add person' }).click();
  const panel = page.getByRole('dialog', { name: 'Add person' });
  await panel.getByRole('textbox', { name: 'Name' }).fill(name);
  if (me) await panel.getByRole('checkbox', { name: 'This is me' }).click();
  await panel.getByRole('button', { name: 'Add person' }).click();
  await expect(panel).toBeHidden();
}

async function newTask(page: Page, title: string) {
  await addFromTopBar(page, 'Add task');
  const panel = page.getByRole('dialog', { name: 'New task' });
  await panel.getByRole('textbox', { name: 'Title' }).fill(title);
  return panel;
}

test('Assign new tasks to me: off by default, on prefills you, a pick still wins', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/people');
  // Nobody is marked as you yet, so there is nothing to turn on.
  await expect(assignSwitch(page)).toBeDisabled();
  await expect(page.getByText('Mark yourself first')).toBeVisible();

  await addPerson(page, 'Leia Organa', true);
  await addPerson(page, 'Han Solo');
  await expect(assignSwitch(page)).toBeEnabled();
  await expect(assignSwitch(page)).not.toBeChecked();

  // Off: a new task goes to nobody.
  let panel = await newTask(page, 'Sweep the hangar');
  await expect(panel.getByRole('combobox', { name: 'Assignee' })).toHaveValue(
    'Unassigned',
  );
  await panel.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(panel).toBeHidden();

  await assignSwitch(page).click();
  await expect(assignSwitch(page)).toBeChecked();
  await expect(
    page.getByText('New tasks go to Leia Organa unless you pick someone else.'),
  ).toBeVisible();
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // On: the panel starts assigned to you.
  panel = await newTask(page, 'Check the shields');
  await expect(panel.getByRole('combobox', { name: 'Assignee' })).toHaveValue(
    'Leia Organa',
  );
  await panel.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(panel).toBeHidden();

  // Picking someone else still wins.
  panel = await newTask(page, 'Fix the hyperdrive');
  const who = panel.getByRole('combobox', { name: 'Assignee' });
  await who.click();
  await who.fill('han');
  await page.getByRole('option', { name: /^Han Solo/ }).click();
  await panel.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(panel).toBeHidden();
  await expectSaved(page);

  const data = await stored(request);
  const id = (name: string) =>
    Object.entries(data.people).find(([, p]) => p.name === name)?.[0];
  const assigneeOf = (title: string) =>
    Object.values(data.tasks).find((t) => t.title === title)?.assignee;
  expect(data.settings.user?.assignToMe).toBe(true);
  expect(assigneeOf('Sweep the hangar')).toBe('');
  expect(assigneeOf('Check the shields')).toBe(id('Leia Organa'));
  expect(assigneeOf('Fix the hyperdrive')).toBe(id('Han Solo'));

  // Turned off again, new tasks go to nobody.
  await page.reload();
  await assignSwitch(page).click();
  await expect(assignSwitch(page)).not.toBeChecked();
  panel = await newTask(page, 'Restock rations');
  await expect(panel.getByRole('combobox', { name: 'Assignee' })).toHaveValue(
    'Unassigned',
  );
});
