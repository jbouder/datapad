import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, formatDay } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectNote,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

/** The capture line (#330), desktop and phone. */

interface Stored {
  tasks: Record<
    string,
    {
      title: string;
      projectId: string | null;
      assignee: string;
      due: string;
      decide?: boolean;
      blocked?: { on: string | null; note: string } | null;
    }
  >;
  notes: Record<string, { body: string; projectId: string | null }>;
  people: Record<string, { name: string }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const capture = (page: Page) => page.getByRole('combobox', { name: 'Capture' });
const chips = (page: Page) =>
  page.getByRole('list', { name: 'Will be saved as' }).getByRole('listitem');
const toast = (page: Page) => page.getByRole('status').filter({ hasText: /./ });

const findTask = (data: Stored, title: string) =>
  Object.entries(data.tasks).find(([, t]) => t.title === title);

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('capture a note: it goes to Scratch, with Undo', async ({
  page,
  request,
}) => {
  await openLive(page);
  await capture(page).fill('The hangar doors stick in the cold');
  await expect(chips(page)).toHaveText(['Note', 'Scratch']);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
  await capture(page).press('Enter');
  await expect(capture(page)).toHaveValue('');
  await expect(toast(page)).toContainText('Added a note to Scratch');
  await expectSaved(page);
  let data = await stored(request);
  const note = Object.values(data.notes).find(
    (n) => n.body === 'The hangar doors stick in the cold',
  );
  expect(note?.projectId).toBeNull();

  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expectSaved(page);
  data = await stored(request);
  expect(
    Object.values(data.notes).some(
      (n) => n.body === 'The hangar doors stick in the cold',
    ),
  ).toBe(false);
});

test('capture a task with a date and a person, from the menus', async ({
  page,
  request,
}) => {
  await openLive(page);
  const line = capture(page);
  await line.click();
  // @ opens People: tap (or click) the one you mean.
  await line.pressSequentially('[ ] Order the coils @Che');
  await page.getByRole('option', { name: 'Chewbacca' }).click();
  await expect(line).toHaveValue('[ ] Order the coils @Chewbacca ');
  await expect(line).toBeFocused();
  // # opens Projects: the keyboard picks the highlighted one.
  await line.pressSequentially('#fal');
  await expect(
    page.getByRole('option', { name: 'Falcon hyperdrive refit' }),
  ).toHaveAttribute('aria-selected', 'true');
  await line.press('Enter');
  await expect(line).toHaveValue(
    '[ ] Order the coils @Chewbacca #Falconhyperdriverefit ',
  );
  await line.pressSequentially('by tomorrow');
  const due = addDays(today(), 1);
  await expect(chips(page)).toHaveText([
    'Task',
    'Falcon hyperdrive refit',
    'for Chewbacca',
    `Due ${formatDay(due, today())}`,
  ]);
  await expectAccessible(page);
  await line.press('Enter');
  await expect(toast(page)).toContainText(
    'Added a task to Falcon hyperdrive refit',
  );
  await expectSaved(page);
  let data = await stored(request);
  const found = findTask(data, 'Order the coils Chewbacca');
  expect(found?.[1]).toMatchObject({
    projectId: 'p-falcon',
    assignee: 'u-chewie',
    due,
  });

  // Undo takes it back.
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expectSaved(page);
  data = await stored(request);
  expect(findTask(data, 'Order the coils Chewbacca')).toBeUndefined();
});

test('capture something to decide and a waiting-on', async ({
  page,
  request,
}) => {
  await openLive(page);
  const line = capture(page);
  // No date in the line: due a week out, the default.
  const week = `Due ${formatDay(addDays(today(), 7), today())}`;
  await line.fill('? Refit or replace the motivator');
  await expect(chips(page)).toHaveText(['To decide', week]);
  await line.press('Enter');
  await expect(toast(page)).toContainText('Added to decide in General');

  await line.fill('waiting on @Han Solo the hydrospanners');
  await expect(chips(page)).toHaveText([
    'Waiting on',
    'waiting on Han Solo',
    week,
  ]);
  await line.press('Enter');
  await expect(toast(page)).toContainText('Waiting on Han Solo, in General');
  await expectSaved(page);

  const data = await stored(request);
  expect(findTask(data, 'Refit or replace the motivator')?.[1].decide).toBe(
    true,
  );
  expect(findTask(data, 'the hydrospanners')?.[1].blocked).toEqual({
    on: 'u-han',
    note: '',
  });
});

test('the kind chip and Tab change the kind; Esc clears', async ({ page }) => {
  await openLive(page);
  const line = capture(page);
  await line.fill('Ask about the parade');
  await expect(chips(page).first()).toHaveText('Note');
  await page.getByRole('button', { name: /^Note\. Change to Task$/ }).click();
  await expect(chips(page).first()).toHaveText('Task');
  await expect(line).toBeFocused();
  if (!isMobile(page)) {
    await line.press('Tab');
    await expect(chips(page).first()).toHaveText('To decide');
    await expect(line).toBeFocused();
  }
  await line.press('Escape');
  await expect(line).toHaveValue('');
  await expect(chips(page)).toHaveCount(0);
});

test('an unknown name can be added to People', async ({ page, request }) => {
  await openLive(page);
  const line = capture(page);
  await line.click();
  await line.pressSequentially('Met @Lando');
  await page.getByRole('option', { name: 'Add “Lando” to People' }).click();
  await expect(line).toHaveValue('Met @Lando ');
  await expect(chips(page)).toHaveText(['Note', '@Lando']);
  await line.press('Enter');
  await expect(toast(page)).toContainText('Added a note about Lando');
  await expectSaved(page);
  const data = await stored(request);
  const lando = Object.entries(data.people).find(([, p]) => p.name === 'Lando');
  expect(lando).toBeDefined();
  expect(Object.values(data.notes).map((n) => n.body)).toContain(
    `Met @{${lando?.[0]}}`,
  );
});

test('an unknown #word can be created as a project', async ({
  page,
  request,
}) => {
  await openLive(page);
  const line = capture(page);
  await line.click();
  await line.pressSequentially('Scout the ridge #Hoth');
  await page.getByRole('option', { name: 'Create project “Hoth”' }).click();
  await expect(toast(page)).toContainText('Created Hoth');
  await expect(line).toHaveValue('Scout the ridge #Hoth ');
  await expect(chips(page)).toHaveText(['Note', 'Hoth']);
  await line.press('Enter');
  await expect(toast(page)).toContainText('Added a note to Hoth');
  await expectSaved(page);
  const data = (await stored(request)) as Stored & {
    projects: Record<string, { name: string }>;
  };
  const hoth = Object.entries(data.projects).find(([, p]) => p.name === 'Hoth');
  expect(hoth).toBeDefined();
  expect(
    Object.values(data.notes).find((n) => n.body === 'Scout the ridge'),
  ).toMatchObject({ projectId: hoth?.[0] });
});

test('on a project page it files there; expand opens the composer', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  const line = capture(page);
  if (!isMobile(page)) {
    await page.locator('body').press('n');
    await expect(line).toBeFocused();
  }
  await line.fill('Notes from the walkthrough');
  await expect(chips(page)).toHaveText(['Note', 'Echo Base relocation']);
  await page.getByRole('button', { name: 'Write a longer note' }).click();
  const panel = page.getByRole('dialog', { name: 'New note' });
  await expectNote(
    panel.getByRole('textbox', { name: 'Note' }),
    'Notes from the walkthrough',
  );
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('Echo Base relocation');
  // The text moved to the panel (the page behind is inert while it is open).
  await expect(page.locator('#capture')).toHaveValue('');
});

test('Help and the ? sheet list n', async ({ page }) => {
  test.skip(isMobile(page), 'A keyboard shortcut.');
  await openLive(page);
  await page.locator('body').press('?');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Capture: go to the capture line');
  await expect(
    sheet.getByRole('region', { name: 'Capture line' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/help');
  await expect(page.getByRole('main')).toContainText(
    'Capture: go to the capture line',
  );
});

test('Settings → Capture changes what a plain line saves (#343)', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/capture');
  await expect(page).toHaveTitle('Capture · Settings · Datapad');
  const becomes = page.getByRole('group', { name: 'A plain line becomes' });
  await expect(becomes.getByRole('radio', { name: 'A note' })).toBeChecked();
  await becomes
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'A task' }) })
    .click();
  await expect(becomes.getByRole('radio', { name: 'A task' })).toBeChecked();
  // @Name only mentions.
  await page.getByRole('switch', { name: /@Name assigns a task/ }).click();
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
  await expectSaved(page);

  await openLive(page);
  await capture(page).fill('Ask @Han Solo about the motivator');
  // A task, mentioning Han rather than assigned to him.
  await expect(chips(page)).toHaveText([
    'Task',
    '@Han Solo',
    `Due ${formatDay(addDays(today(), 7), today())}`,
  ]);
  await capture(page).press('Enter');
  await expect(toast(page)).toContainText('Added a task to General');
  await expectSaved(page);
  const data = await stored(request);
  const [, task] = findTask(data, 'Ask Han Solo about the motivator') ?? [];
  expect(task?.assignee).toBe('');

  // Reset to defaults: a plain line is a note again.
  await openLive(page, '/settings/capture');
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(becomes.getByRole('radio', { name: 'A note' })).toBeChecked();
  await expectSaved(page);
  await openLive(page);
  await capture(page).fill('The hangar doors stick in the cold');
  await expect(chips(page)).toHaveText(['Note', 'Scratch']);
});
