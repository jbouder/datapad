import type { Page } from '@playwright/test';
import { addDays } from '../shared/dates';
import {
  expect,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

const openList = (page: Page) => page.getByRole('list', { name: 'Open tasks' });
/** The open and done tasks in one list, with Show done on (#318). */
const allList = (page: Page) =>
  page.getByRole('list', { name: 'Tasks', exact: true });
/** Click a row's checkbox the way a person does: on its 44px label. */
async function toggle(page: Page, name: string) {
  await page
    .locator('label', { has: page.getByRole('checkbox', { name }) })
    .click();
}

const row = (page: Page, title: string) =>
  page.locator('[data-task-id]').filter({ hasText: title });

test('add three tasks from the project page, close one, undo', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-falcon');
  await expect(openList(page).getByRole('listitem')).toHaveCount(1);

  // No quick-add on a project page: `n` (or Add task) opens the panel,
  // preset to the project; Enter in the title adds.
  await expect(page.getByRole('textbox', { name: 'Add a task' })).toHaveCount(
    0,
  );
  const panel = page.getByRole('dialog', { name: 'New task' });
  for (const [i, title] of [
    'Patch the hull',
    'Clean the dejarik board',
    'Tune the deflector',
  ].entries()) {
    if (i === 0) await page.locator('body').press('n');
    else
      await page
        .getByRole('main')
        .getByRole('button', { name: 'Add task', exact: true })
        .click();
    const name = panel.getByRole('textbox', { name: 'Title' });
    await expect(name).toBeFocused();
    await expect(panel.getByRole('combobox', { name: 'Project' })).toHaveValue(
      'Falcon hyperdrive refit',
    );
    await page.keyboard.type(title);
    await name.press('Enter');
    await expect(panel).toBeHidden();
    await expect(row(page, title)).toBeVisible();
  }
  // New tasks go after the rest (order = max + 1).
  await expect(openList(page).getByRole('listitem')).toHaveText([
    /Find a replacement motivator/,
    /Patch the hull/,
    /Clean the dejarik board/,
    /Tune the deflector/,
  ]);

  // Close one: it leaves the list (done tasks show with Show done, #318).
  await toggle(page, 'Close “Patch the hull”');
  await expect(page.getByText('Closed “Patch the hull”')).toBeVisible();
  await expect(openList(page)).not.toContainText('Patch the hull');
  await page.getByRole('button', { name: 'Show done' }).click();
  await expect(allList(page).getByRole('listitem').last()).toContainText(
    'Patch the hull',
  );
  await expect(
    page.getByRole('checkbox', { name: 'Reopen “Patch the hull”' }),
  ).toBeChecked();

  // Undo puts it back with the open tasks.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Close “Patch the hull”' }),
  ).not.toBeChecked();
  await expect(allList(page).getByRole('listitem').nth(1)).toContainText(
    'Patch the hull',
  );

  // The log has the pair: closed, then reopened.
  await expectSaved(page);

  const activity = await (await request.get('/api/export.json')).json();
  const lines = activity.activity['p-falcon'].events.map(
    (e: { text: string }) => e.text,
  );
  expect(lines.slice(0, 5)).toEqual([
    'Reopened "Patch the hull"',
    'Closed "Patch the hull"',
    'Added task "Tune the deflector"',
    'Added task "Clean the dejarik board"',
    'Added task "Patch the hull"',
  ]);
});

test('inline popovers change priority, due and assignee from the row', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'Inline popovers are a desktop affordance.');
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-falcon');
  const task = row(page, 'Find a replacement motivator');

  const priority = task.getByRole('button', { name: /^Priority: Medium/ });
  await priority.click();
  await page.getByRole('menuitemradio', { name: 'High' }).click();
  await expect(
    task.getByRole('button', { name: /^Priority: High/ }),
  ).toBeFocused();

  await task.getByRole('button', { name: /^Due/ }).click();
  const due = page.getByRole('textbox', { name: 'Due' });
  await expect(due).toBeFocused();
  await due.fill('today');
  await due.press('Enter');
  await expect(task.getByRole('button', { name: /^Due/ })).toContainText(
    'Today',
  );

  await task.getByRole('button', { name: /^Assignee: Han Solo/ }).click();
  const who = page.getByRole('combobox', { name: 'Assignee' });
  await who.fill('chew');
  // Enter picks the highlighted option, so let the list filter and
  // highlight it first.
  await expect(page.getByRole('option')).toHaveText([/Chewbacca/]);
  await expect(page.getByRole('option', { name: /Chewbacca/ })).toHaveAttribute(
    'data-highlighted',
  );
  await who.press('Enter');
  await expect(
    task.getByRole('button', { name: /^Assignee: Chewbacca/ }),
  ).toBeVisible();

  await expectSaved(page);

  const data = await (await request.get('/api/export.json')).json();
  expect(data.tasks['t-5']).toMatchObject({
    priority: 'high',
    assignee: 'u-chewie',
  });
  expect(data.activity['p-falcon'].events[0].text).toBe(
    'Edited task "Find a replacement motivator"',
  );
});

test('rows are 36px on desktop and 44px on phones, with 44px checkboxes on touch', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-echo');
  const first = page.locator('[data-task-id]').first();
  const box = await first.boundingBox();
  const check = await first.locator('label').first().boundingBox();
  if (isMobile(page)) {
    // Rounded: layout lands on sub-pixels at the phone's pixel ratio.
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(check?.height ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(check?.width ?? 0)).toBeGreaterThanOrEqual(44);
  } else {
    expect(Math.round(box?.height ?? 0)).toBe(36);
  }
});

test('due dates say overdue and today in words, not only color', async ({
  page,
  request,
}) => {
  await request.post('/api/import', {
    data: {
      ...SEED,
      tasks: {
        ...SEED.tasks,
        't-1': { ...SEED.tasks['t-1'], due: addDays(today(), -1) },
        't-2': { ...SEED.tasks['t-2'], due: today() },
      },
    },
  });
  await openLive(page, '/projects/p-echo');
  await expect(row(page, 'Confirm shield generator delivery')).toContainText(
    /Overdue ·/,
  );
  await expect(row(page, 'Insulate the hangar doors')).toContainText('Today');
});
