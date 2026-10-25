import type { APIRequestContext, Page } from '@playwright/test';
import { expect, expectSaved, openLive, SEED, test } from './fixtures';

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

function card(page: Page, text: string | RegExp) {
  return page.locator('article[data-note-id]').filter({ hasText: text });
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('adds notes in two projects, filters by project and text', async ({
  page,
  request,
}) => {
  await openLive(page, '/notes');
  const box = page.getByRole('combobox', { name: 'New note' });

  // General by default; the composer clears and keeps focus.
  await box.click();
  await page.keyboard.type('Order more **heaters**');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
  await expect(card(page, 'Order more heaters').locator('strong')).toHaveText(
    'heaters',
  );

  // Into a project, picked under the composer.
  const picker = page.getByRole('combobox', { name: 'Project for the note' });
  await picker.click();
  await picker.fill('falc');
  await picker.press('Enter');
  await box.fill('Motivator on back order');
  await page.getByRole('button', { name: 'Add note' }).click();
  const falcon = card(page, 'Motivator on back order');
  await expect(
    falcon.getByRole('link', { name: 'Falcon hyperdrive refit' }),
  ).toBeVisible();

  await expectSaved(page);
  const data = await stored(request);
  expect(data.activity['p-falcon']?.events[0]?.text).toBe('Added a note');

  // Filter by project, then by text (with mentions read as names).
  await page.getByRole('combobox', { name: 'Project', exact: true }).click();
  await page.getByRole('option', { name: 'Falcon hyperdrive refit' }).click();
  await expect(page).toHaveURL(/project=p-falcon/);
  await expect(page.locator('article[data-note-id]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Project', exact: true }).click();
  await page.getByRole('option', { name: 'All projects' }).click();

  await page.getByRole('searchbox', { name: 'Find' }).fill('chewba');
  await expect(page).toHaveURL(/q=chewba/);
  // The other note naming him is in an archived project.
  await expect(page.locator('article[data-note-id]')).toHaveCount(1);
  await expect(page.locator('article mark').first()).toHaveText(/chewba/i);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Find' })).toHaveValue(
    'chewba',
  );

  await page.getByRole('searchbox', { name: 'Find' }).fill('nothing like it');
  await expect(page.getByText('No notes match.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear the filters' }).click();
  await expect(page.locator('article[data-note-id]')).toHaveCount(5);
});

test('pins, edits in place and toggles a checkbox without logging', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const notes = page.locator('article[data-note-id]');
  // Pinned first.
  await expect(notes.first()).toContainText('Standup');

  const prep = card(page, 'Bring the power budget');
  await prep.getByRole('button', { name: 'Pin' }).click();
  await card(page, 'Standup').getByRole('button', { name: 'Unpin' }).click();
  await expect(notes.first()).toContainText('Bring the power budget');

  await page.goto('/notes?pinned=1');
  await expect(page.locator('article[data-note-id]')).toHaveCount(1);
  await page.goto('/projects/p-echo');

  // Edit: mentions come back as names, and are tokens again on save.
  const standup = card(page, 'Standup');
  await standup.getByRole('button', { name: 'Edit' }).click();
  const editor = standup.getByRole('combobox', { name: 'Edit note' });
  await expect(editor).toHaveValue(/@Chewbacca has the hangar keys/);
  await editor.evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(el.value.length, el.value.length),
  );
  await page.keyboard.type(' Ask @Han');
  await page.keyboard.press('Enter');
  await standup.getByRole('button', { name: 'Save note' }).click();
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
  await openLive(page, '/notes');
  const ideas = card(page, 'Ideas for the next quarter');
  await ideas.getByRole('button', { name: 'Delete' }).click();
  await expect(ideas).toHaveCount(0);
  await page
    .locator('output.toast')
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(ideas).toBeVisible();

  await ideas.getByRole('button', { name: 'Delete' }).click();
  await expect(ideas).toHaveCount(0);
  // Not yet deleted, so not yet logged.
  expect((await stored(request)).notes['n-3']).toBeDefined();
  // Leaving the page settles it.
  await page.getByRole('link', { name: 'Tasks' }).first().click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tasks' }),
  ).toBeVisible();
  await expectSaved(page);
  const data = await stored(request);
  expect(data.notes['n-3']).toBeUndefined();
  expect(data.activity.general?.events[0]?.text).toBe('Deleted a note');
});

test('long notes clamp with Show more', async ({ page, request }) => {
  const seed = structuredClone(SEED);
  seed.notes['n-3'].body = Array.from(
    { length: 30 },
    (_, i) => `Line ${i + 1}`,
  ).join('\n');
  await request.post('/api/import', { data: seed });
  await openLive(page, '/notes');
  const long = card(page, 'Line 1');
  const more = long.getByRole('button', { name: 'Show more' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(long.getByText('Line 30')).not.toBeInViewport();
  await more.click();
  await expect(long.getByRole('button', { name: 'Show less' })).toBeVisible();
});

test('the composer is one line until you use it', async ({ page }) => {
  await openLive(page, '/notes');
  const box = page.getByRole('combobox', { name: 'New note' });
  const add = page.getByRole('button', { name: 'Add note' });
  const picker = page.getByRole('combobox', { name: 'Project for the note' });
  await expect(box).toHaveAttribute('placeholder', 'Write a note…');
  await expect(add).toBeHidden();
  await expect(picker).toBeHidden();

  await box.click();
  await expect(add).toBeVisible();
  await expect(picker).toBeVisible();

  // Left empty, it folds away again; with text in it, it stays open.
  await page.getByRole('heading', { name: 'Notes', level: 1 }).click();
  await expect(add).toBeHidden();
  await box.fill('Half a thought');
  await page.getByRole('heading', { name: 'Notes', level: 1 }).click();
  await expect(add).toBeVisible();
});

test('writes a note from anywhere, into the project you are on', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-falcon');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Write a note' })
    .click();
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
  await expect(card(page, 'Check the coolant lines')).toBeVisible();

  await expectSaved(page);
  const data = await stored(request);
  const added = Object.values(data.notes).find(
    (n) => n.body === 'Check the coolant lines',
  );
  expect(added?.projectId).toBe('p-falcon');
});

test('Shift+N writes a General note from a page with no project', async ({
  page,
}) => {
  await openLive(page, '/tasks');
  await page.locator('body').press('Shift+N');
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
