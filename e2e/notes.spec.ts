import type { APIRequestContext, Page } from '@playwright/test';
import {
  addFromSearch,
  expect,
  expectSaved,
  fillNote,
  noteAction,
  noteRow,
  noteText,
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
  // The project room's stream (#334): newest first, so each row says
  // whether it is pinned.
  await openLive(page, '/projects/p-echo');
  const prep = noteRow(page, 'Bring the power budget');
  await expect(noteRow(page, 'Standup')).toContainText('Pinned');
  await expect(prep).not.toContainText('Pinned');

  // Pin and Unpin are in each row's ⋯ menu (#273).
  await noteAction(prep, 'Pin');
  await noteAction(noteRow(page, 'Standup'), 'Unpin');
  await expect(prep).toContainText('Pinned');
  await expect(noteRow(page, 'Standup')).not.toContainText('Pinned');

  // Edit: mentions come back as names, and are tokens again on save.
  const standup = noteRow(page, 'Standup');
  await noteAction(standup, 'Edit');
  const editor = standup.getByRole('textbox', { name: 'Edit note' });
  await expect
    .poll(() => noteText(editor))
    .toMatch(/@Chewbacca has the hangar keys/);
  // The editor opens with the caret at the end.
  await expect(editor).toBeFocused();
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

test('Write a note on Notes starts in the filtered project', async ({
  page,
}) => {
  await openLive(page, '/notes?project=p-falcon');
  await addFromSearch(page, 'New note');
  const panel = page.getByRole('dialog', { name: 'New note' });
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('Falcon hyperdrive refit');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // General, filtered or not, starts in General.
  await page.goto('/notes?project=general');
  await addFromSearch(page, 'New note');
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('General');
});

test('writes a note from anywhere, into the project you are on', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-falcon');
  await addFromSearch(page, 'New note');
  const panel = page.getByRole('dialog', { name: 'New note' });
  const body = panel.getByRole('textbox', { name: 'Note' });
  await expect(body).toBeFocused();
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('Falcon hyperdrive refit');

  // Empty: it says so instead of adding.
  await panel.getByRole('button', { name: 'Add note' }).click();
  await expect(panel.getByText('Write something first')).toBeVisible();

  await fillNote(body, 'Check the coolant lines');
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
  await addFromSearch(page, 'New note');
  const panel = page.getByRole('dialog', { name: 'New note' });
  await expect(panel.getByRole('textbox', { name: 'Note' })).toBeFocused();
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
