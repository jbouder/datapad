import type { Page } from '@playwright/test';
import { expect, isMobile, openLive, SEED, test } from './fixtures';

const openList = (page: Page) => page.getByRole('list', { name: 'Open tasks' });
const doneList = (page: Page) => page.getByRole('list', { name: 'Done tasks' });
/** Click a row's checkbox the way a person does: on its 44px label. */
async function toggle(page: Page, name: string) {
  await page
    .locator('label', { has: page.getByRole('checkbox', { name }) })
    .click();
}

const row = (page: Page, title: string) =>
  page.locator('[data-task-id]').filter({ hasText: title });

test('add three tasks by keyboard, close one, undo', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-falcon');
  await expect(openList(page).getByRole('listitem')).toHaveCount(1);

  // `n` finds the quick-add; Enter adds and stays.
  await page.locator('body').press('n');
  const input = page.getByRole('textbox', { name: 'Add a task' });
  await expect(input).toBeFocused();
  for (const title of [
    'Patch the hull',
    'Clean the dejarik board',
    'Tune the deflector',
  ]) {
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
  }
  // An empty Enter does nothing; Esc clears what you typed.
  await page.keyboard.press('Enter');
  await page.keyboard.type('Never mind');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  // New tasks go after the rest (order = max + 1).
  await expect(openList(page).getByRole('listitem')).toHaveText([
    /Find a replacement motivator/,
    /Patch the hull/,
    /Clean the dejarik board/,
    /Tune the deflector/,
  ]);

  // Close one: it moves to Done (collapsed until opened).
  await toggle(page, 'Close “Patch the hull”');
  await expect(page.getByText('Closed “Patch the hull”')).toBeVisible();
  await expect(openList(page)).not.toContainText('Patch the hull');
  await expect(doneList(page)).toBeHidden();
  await page.getByRole('button', { name: /^Done/ }).click();
  await expect(doneList(page)).toContainText('Patch the hull');
  await expect(
    page.getByRole('checkbox', { name: 'Reopen “Patch the hull”' }),
  ).toBeChecked();

  // Undo puts it back in the open list.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(openList(page)).toContainText('Patch the hull');
  await expect(page.getByRole('button', { name: /^Done/ })).toHaveCount(0);

  // The log has the pair: closed, then reopened.
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

  await task.getByRole('button', { name: /^Due:/ }).click();
  const due = page.getByRole('textbox', { name: 'Due' });
  await expect(due).toBeFocused();
  await due.fill('today');
  await due.press('Enter');
  await expect(task.getByRole('button', { name: /^Due:/ })).toContainText(
    'Today',
  );

  await task.getByRole('button', { name: /^Assignee: Han Solo/ }).click();
  const who = page.getByRole('combobox', { name: 'Assignee' });
  await who.fill('chew');
  await who.press('Enter');
  await expect(
    task.getByRole('button', { name: /^Assignee: Chewbacca/ }),
  ).toBeVisible();

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

test('due dates say overdue and today in words, not only colour', async ({
  page,
  request,
}) => {
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  await request.post('/api/import', {
    data: {
      ...SEED,
      tasks: {
        ...SEED.tasks,
        't-1': { ...SEED.tasks['t-1'], due: iso(yesterday) },
        't-2': { ...SEED.tasks['t-2'], due: iso(today) },
      },
    },
  });
  await openLive(page, '/projects/p-echo');
  await expect(row(page, 'Confirm shield generator delivery')).toContainText(
    /Overdue ·/,
  );
  await expect(row(page, 'Insulate the hangar doors')).toContainText('Today');
});
