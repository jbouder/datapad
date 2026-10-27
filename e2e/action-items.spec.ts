import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  openLive,
  SEED,
  test,
} from './fixtures';

interface Stored {
  tasks: Record<
    string,
    {
      id: string;
      title: string;
      projectId: string | null;
      status: string;
      meetingId?: string | null;
    }
  >;
  meetings: Record<string, unknown>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const SHIELD = '/meetings/e-1';
const ITEM = 'Send the shield schematics';

const section = (page: Page) =>
  page.getByRole('region', { name: /^Action items/ });

async function addItem(page: Page, title: string) {
  const items = section(page);
  const field = items.getByRole('textbox', {
    name: 'Add an action item to “Shield review”',
  });
  if (!(await field.isVisible())) {
    await items.getByRole('button', { name: 'Add an action item' }).click();
  }
  await field.fill(title);
  await field.press('Enter');
  await expect(
    items.locator('[data-task-id]', { hasText: title }),
  ).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  const data = structuredClone(SEED) as typeof SEED & {
    meetings: Record<string, unknown>;
  };
  const shield = data.meetings['e-1'] as (typeof SEED.meetings)['e-1'] & {
    topics?: unknown;
  };
  shield.topics = [
    { id: 't-ridge', title: 'North ridge', done: false, outcome: '' },
  ];
  await request.post('/api/import', { data });
});

test('action items on a meeting’s page: add, close, reopen and open', async ({
  page,
  request,
}) => {
  await openLive(page, SHIELD);
  const items = section(page);
  await expect(items).toContainText('No action items yet');

  await addItem(page, ITEM);
  // The field stays open for the next; Esc closes it.
  await addItem(page, 'Brief the pilots');
  await page.keyboard.press('Escape');
  await expect(
    items.getByRole('textbox', { name: /Add an action item/ }),
  ).toBeHidden();
  await expect(
    items.getByRole('button', { name: 'Add an action item' }),
  ).toBeFocused();
  await expect(items).toContainText('2 open');

  await expectSaved(page);
  let data = await stored(request);
  const item = Object.values(data.tasks).find((t) => t.title === ITEM);
  expect(item).toMatchObject({ projectId: 'p-echo', meetingId: 'e-1' });

  // Close it: it moves after the open one, struck through.
  await items
    .locator('[data-task-id]', { hasText: ITEM })
    .locator('label')
    .first()
    .click();
  await expect(items).toContainText('1 open');
  await expect(items.locator('[data-task-id]')).toHaveText([
    /Brief the pilots/,
    new RegExp(ITEM),
  ]);
  await expectSaved(page);
  data = await stored(request);
  expect(data.tasks[item?.id ?? '']?.status).toBe('done');

  // Reopen it.
  await items
    .locator('[data-task-id]', { hasText: ITEM })
    .locator('label')
    .first()
    .click();
  await expect(items).toContainText('2 open');

  // A row opens the task's panel, which says where it came from.
  await items.getByRole('button', { name: ITEM, exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-from-meeting]')).toContainText(
    'From Shield review',
  );
  await expect(
    panel.getByRole('link', { name: 'Shield review' }),
  ).toHaveAttribute('href', SHIELD);
  await panel.getByLabel('Due').fill('today');
  await panel.getByLabel('Due').press('Tab');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Ordinary tasks: on Focus, Tasks and the project too.
  await expectSaved(page);
  await openLive(page, '/');
  await expect(
    page
      .getByRole('region', { name: 'Open tasks' })
      .getByRole('list', { name: 'Today' }),
  ).toContainText(ITEM);
  await openLive(page, '/tasks');
  await expect(page.getByRole('main')).toContainText(ITEM);
  await openLive(page, '/projects/p-echo');
  await expect(page.getByRole('main')).toContainText(ITEM);

  // Its page says where it came from, and links back.
  await openLive(page, `/tasks/${item?.id}`);
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Shield review' })
    .click();
  await expect(page).toHaveURL(new RegExp(`${SHIELD}$`));
});

test('the meeting’s panel has action items too', async ({ page, request }) => {
  await openLive(page, SHIELD);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Shield review' });
  const items = edit.getByRole('region', { name: /^Action items/ });
  await items.getByRole('button', { name: 'Add an action item' }).click();
  const field = items.getByRole('textbox', {
    name: 'Add an action item to “Shield review”',
  });
  await field.fill(ITEM);
  // Enter adds it; it does not submit the meeting's form.
  await field.press('Enter');
  await expect(items.locator('[data-task-id]')).toHaveText([new RegExp(ITEM)]);
  await expect(edit).toBeVisible();
  await expect(items).toContainText('1 open');
  await expectAccessible(page);

  await items
    .locator('[data-task-id]', { hasText: ITEM })
    .locator('label')
    .first()
    .click();
  await expect(items).not.toContainText('open');
  await expectSaved(page);
  const data = await stored(request);
  expect(Object.values(data.tasks)).toContainEqual(
    expect.objectContaining({ title: ITEM, meetingId: 'e-1', status: 'done' }),
  );
});

test('Make a task from a topic links it; deleting the meeting keeps it', async ({
  page,
  request,
}) => {
  await openLive(page, SHIELD);
  await page
    .getByRole('region', { name: /^Topics/ })
    .getByRole('button', { name: 'More for topic “North ridge”' })
    .click();
  await page.getByRole('menuitem', { name: 'Make a task' }).click();
  const task = page.getByRole('dialog', { name: 'New task' });
  await expect(task.getByLabel('Title')).toHaveValue('North ridge');
  await expect(task).toContainText('An action item of Shield review');
  await task.getByRole('button', { name: 'Add task' }).click();
  await expect(task).toBeHidden();
  await expect(
    section(page).locator('[data-task-id]', { hasText: 'North ridge' }),
  ).toBeVisible();

  await expectSaved(page);
  let data = await stored(request);
  const made = Object.values(data.tasks).find((t) => t.title === 'North ridge');
  expect(made).toMatchObject({ projectId: 'p-echo', meetingId: 'e-1' });

  // Delete says the action item is kept, and it is, unlinked.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'Its note and action item are kept.',
  );
  await page.getByRole('button', { name: 'Delete meeting' }).click();
  await expect(page).toHaveURL(/\/meetings$/);
  await expectSaved(page);
  data = await stored(request);
  expect(data.meetings['e-1']).toBeUndefined();
  expect(data.tasks[made?.id ?? '']).toMatchObject({
    title: 'North ridge',
    projectId: 'p-echo',
    meetingId: null,
  });
});
