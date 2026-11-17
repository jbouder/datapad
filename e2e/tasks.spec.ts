import type { Page } from '@playwright/test';
import { addDays } from '../shared/dates';
import {
  addFromTopBar,
  expect,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

const lanes = (page: Page) =>
  page.getByRole('complementary', { name: 'Open loops' });
const mine = (page: Page) => lanes(page).getByRole('list', { name: 'Mine' });
const stream = (page: Page) => page.getByRole('list', { name: 'Stream' });
/** Click a row's checkbox the way a person does: on its 44px label. */
async function toggle(page: Page, name: string) {
  await page
    .locator('label', { has: page.getByRole('checkbox', { name }) })
    .click();
}

/** A task's row in All's List (full rows). */
const row = (page: Page, title: string) =>
  page.locator('[data-task-id]').filter({ hasText: title });
/** A task's row in a room's Open loops lanes. */
const loop = (page: Page, title: string) =>
  lanes(page).locator('[data-loop]').filter({ hasText: title });

test('add three tasks in a project room, close one, undo', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-falcon');
  // The motivator waits on Han; nothing open is mine yet.
  await expect(loop(page, 'Find a replacement motivator')).toBeVisible();
  await expect(mine(page)).toHaveCount(0);

  // The top bar's + opens the new-task panel, preset to the room's
  // project; Enter in the title adds.
  const panel = page.getByRole('dialog', { name: 'New task' });
  for (const title of [
    'Patch the hull',
    'Clean the dejarik board',
    'Tune the deflector',
  ]) {
    await addFromTopBar(page, 'Add task');
    const name = panel.getByRole('textbox', { name: 'Title' });
    await expect(name).toBeFocused();
    await expect(panel.getByRole('combobox', { name: 'Project' })).toHaveValue(
      'Falcon hyperdrive refit',
    );
    await page.keyboard.type(title);
    await name.press('Enter');
    await expect(panel).toBeHidden();
    await expect(loop(page, title)).toBeVisible();
  }
  // Undated, so in the order they were added (order = max + 1).
  await expect(mine(page).getByRole('listitem')).toHaveText([
    /Patch the hull/,
    /Clean the dejarik board/,
    /Tune the deflector/,
  ]);

  // Close one: it leaves the lanes, and the stream records it done.
  await toggle(page, 'Close “Patch the hull”');
  await expect(page.getByText('Closed “Patch the hull”')).toBeVisible();
  await expect(mine(page)).not.toContainText('Patch the hull');
  await expect(stream(page).locator('[data-stream^="done:"]')).toContainText([
    'Patch the hull',
  ]);

  // Undo puts it back with the open tasks, where it was.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Close “Patch the hull”' }),
  ).not.toBeChecked();
  await expect(mine(page).getByRole('listitem').first()).toContainText(
    'Patch the hull',
  );
  await expect(stream(page).locator('[data-stream^="done:"]')).toHaveCount(0);

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
  // All's List keeps the full rows (a room's loops do not).
  await openLive(page, '/all?kind=task&view=list&person=u-han');
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
  // No longer Han's, so it leaves the list narrowed to him.
  await expect(task).toHaveCount(0);

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
  await openLive(page, '/all?kind=task&view=list');
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
  await expect(loop(page, 'Confirm shield generator delivery')).toContainText(
    /Overdue ·/,
  );
  await expect(loop(page, 'Insulate the hangar doors')).toContainText('Today');
});
