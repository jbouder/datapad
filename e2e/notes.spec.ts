import type { APIRequestContext, Page } from '@playwright/test';
import {
  addFromTopBar,
  expect,
  expectAccessible,
  expectSaved,
  noteAction,
  noteRow,
  openLive,
  openNoteRow,
  openNotes,
  SEED,
  test,
} from './fixtures';

interface Stored {
  notes: Record<
    string,
    { body: string; pinned: boolean; projectId: string | null }
  >;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

/** A note's row in Notes' List (#218, the compact row since #274). */
function row(page: Page, text: string | RegExp) {
  return noteRow(page.getByRole('main'), text);
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('pins, edits in place and toggles a checkbox without logging', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const notes = page.locator('li[data-note-id]');
  // Pinned first.
  await expect(notes.first()).toContainText('Standup');

  // Pin and Unpin are in each row's ⋯ menu (#273).
  await noteAction(noteRow(page, 'Bring the power budget'), 'Pin');
  await noteAction(noteRow(page, 'Standup'), 'Unpin');
  await expect(notes.first()).toContainText('Bring the power budget');

  // Edit: mentions come back as names, and are tokens again on save.
  const standup = noteRow(page, 'Standup');
  await noteAction(standup, 'Edit');
  const editor = standup.getByRole('combobox', { name: 'Edit note' });
  await expect(editor).toHaveValue(/@Chewbacca has the hangar keys/);
  await editor.evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(el.value.length, el.value.length),
  );
  await page.keyboard.type(' Ask @Han');
  await page.keyboard.press('Enter');
  await standup.getByRole('button', { name: 'Save note' }).click();
  await openNoteRow(standup);
  await expect(standup.locator('.mention')).toHaveText([
    '@Chewbacca',
    '@Han Solo',
  ]);
  await expect(standup).toContainText('edited');

  const before = (await stored(request)).activity['p-echo']?.events.length;
  await standup.getByRole('checkbox', { name: 'Check the heaters' }).check();
  await expectSaved(page);
  const data = await stored(request);
  expect(data.notes['n-1']?.body).toContain('- [x] Check the heaters');
  expect(data.notes['n-1']?.body).toContain('@{u-han}');
  expect(data.activity['p-echo']?.events.length).toBe(before);
});

test('delete waits for Undo before it is logged', async ({ page, request }) => {
  await openNotes(page, '', ['n-3']);
  const ideas = row(page, 'Ideas for the next quarter');
  await noteAction(ideas, 'Delete');
  await expect(ideas).toHaveCount(0);
  await page
    .locator('output.toast')
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(ideas).toBeVisible();

  await noteAction(ideas, 'Delete');
  await expect(ideas).toHaveCount(0);
  // Not yet deleted, so not yet logged.
  expect((await stored(request)).notes['n-3']).toBeDefined();
  // Leaving the page settles it.
  await page
    .getByRole('link', { name: 'Today' })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect
    .poll(async () => (await stored(request)).notes['n-3'])
    .toBeUndefined();
  const data = await stored(request);
  expect(data.activity.general?.events[0]?.text).toBe('Deleted a note');
});

test('Add note on a project page opens the panel, preset to it', async ({
  page,
}) => {
  await openLive(page, '/projects/p-falcon');
  // No composer on the page: Add note in the Notes section opens the panel.
  await expect(page.getByRole('combobox', { name: 'New note' })).toHaveCount(0);
  // Exact: a meeting row's own is "Add note to “…”".
  const add = page
    .getByRole('main')
    .getByRole('button', { name: 'Add note', exact: true });
  await expectAccessible(page);
  const box = await add.boundingBox();
  const touch = await page.evaluate(
    () => matchMedia('(pointer: coarse)').matches,
  );
  if (touch) expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);

  await add.click();
  const panel = page.getByRole('dialog', { name: 'New note' });
  await expect(panel.getByRole('combobox', { name: 'Note' })).toBeFocused();
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('Falcon hyperdrive refit');
  await page.keyboard.type('Swap the motivator');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel).toBeHidden();
  await expect(noteRow(page, 'Swap the motivator')).toBeVisible();
  await expect(add).toBeFocused();
});

test('Write a note on Notes starts in the filtered project', async ({
  page,
}) => {
  await openLive(page, '/notes?project=p-falcon');
  await addFromTopBar(page, 'Write a note');
  const panel = page.getByRole('dialog', { name: 'New note' });
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('Falcon hyperdrive refit');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // General, filtered or not, starts in General.
  await page.goto('/notes?project=general');
  await addFromTopBar(page, 'Write a note');
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('General');
});

test('writes a note from anywhere, into the project you are on', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-falcon');
  await addFromTopBar(page, 'Write a note');
  const panel = page.getByRole('dialog', { name: 'New note' });
  const body = panel.getByRole('combobox', { name: 'Note' });
  await expect(body).toBeFocused();
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('Falcon hyperdrive refit');

  // Empty: it says so instead of adding.
  await panel.getByRole('button', { name: 'Add note' }).click();
  await expect(panel.getByText('Write something first')).toBeVisible();

  await body.fill('Check the coolant lines');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel).toBeHidden();
  await expect(
    page.getByText('Added a note to Falcon hyperdrive refit'),
  ).toBeVisible();
  await expect(noteRow(page, 'Check the coolant lines')).toBeVisible();

  await expectSaved(page);
  const data = await stored(request);
  const added = Object.values(data.notes).find(
    (n) => n.body === 'Check the coolant lines',
  );
  expect(added?.projectId).toBe('p-falcon');
});

test('Write a note writes a General note from a page with no project', async ({
  page,
}) => {
  await openLive(page, '/tasks');
  await addFromTopBar(page, 'Write a note');
  const panel = page.getByRole('dialog', { name: 'New note' });
  await expect(panel.getByRole('combobox', { name: 'Note' })).toBeFocused();
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('General');

  // Closing with text asks first.
  await page.keyboard.type('Ask about the parade');
  await page.keyboard.press('Escape');
  await expect(panel.getByText('Discard your changes?')).toBeVisible();
  await panel.getByRole('button', { name: 'Discard' }).click();
  await expect(panel).toBeHidden();
});
