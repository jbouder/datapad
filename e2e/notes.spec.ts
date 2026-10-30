import type { APIRequestContext, Page } from '@playwright/test';
import {
  addFromTopBar,
  chooseFilter,
  expect,
  expectAccessible,
  expectSaved,
  openLive,
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

function card(page: Page, text: string | RegExp) {
  return page.locator('article[data-note-id]').filter({ hasText: text });
}

/** A note's row in Notes' List (#218). */
function row(page: Page, text: string | RegExp) {
  return page.locator('[data-note-row]').filter({ hasText: text });
}

/** Open a row in the List: its note, whole, in place. */
async function openRow(page: Page, text: string | RegExp) {
  const button = row(page, text).locator(':scope > button');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  return card(page, text);
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('adds notes in two projects, filters by project and text', async ({
  page,
  request,
}) => {
  await openLive(page, '/notes?view=list');
  // No composer on the page: Add note opens the panel.
  await expect(page.getByRole('combobox', { name: 'New note' })).toHaveCount(0);
  const add = page.getByRole('main').getByRole('button', { name: 'Add note' });
  const panel = page.getByRole('dialog', { name: 'New note' });
  const project = panel.getByRole('combobox', { name: 'Project', exact: true });

  // General with no project filtered.
  await add.click();
  await expect(project).toHaveValue('General');
  await panel
    .getByRole('combobox', { name: 'Note' })
    .fill('Order more **heaters**');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel).toBeHidden();
  const heaters = await openRow(page, 'Order more heaters');
  await expect(heaters.locator('strong')).toHaveText('heaters');

  // Into the filtered project.
  await expectSaved(page);
  await page.goto('/notes?view=list&project=p-falcon');
  await add.click();
  await expect(project).toHaveValue('Falcon hyperdrive refit');
  await panel
    .getByRole('combobox', { name: 'Note' })
    .fill('Motivator on back order');
  await panel.getByRole('button', { name: 'Add note' }).click();
  await expect(panel).toBeHidden();
  await expect(row(page, 'Motivator on back order')).toContainText(
    'Falcon hyperdrive refit',
  );
  const falcon = await openRow(page, 'Motivator on back order');
  await expect(
    falcon.getByRole('link', { name: 'Falcon hyperdrive refit' }),
  ).toBeVisible();
  await page.goto('/notes?view=list');

  await expectSaved(page);
  const data = await stored(request);
  expect(data.activity['p-falcon']?.events[0]?.text).toBe('Added a note');

  // Filter by project, then by text (with mentions read as names).
  await chooseFilter(page, 'Project', 'Falcon hyperdrive refit');
  await expect(page).toHaveURL(/project=p-falcon/);
  await expect(page.locator('[data-note-row]')).toHaveCount(1);
  await chooseFilter(page, 'Project', 'All projects');

  await page.getByRole('searchbox', { name: 'Find' }).fill('chewba');
  await expect(page).toHaveURL(/q=chewba/);
  // The other note naming him is in an archived project.
  await expect(page.locator('[data-note-row]')).toHaveCount(1);
  const standup = await openRow(page, 'Standup');
  await expect(standup.locator('mark').first()).toHaveText(/chewba/i);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Find' })).toHaveValue(
    'chewba',
  );

  await page.getByRole('searchbox', { name: 'Find' }).fill('nothing like it');
  await expect(page.getByText('None match these filters.')).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Clear filters' })
    .last()
    .click();
  await expect(page.locator('[data-note-row]')).toHaveCount(5);
  await expect(page.getByRole('searchbox', { name: 'Find' })).toHaveValue('');
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

  await page.goto('/notes?view=list&pinned=1');
  await expect(page.locator('[data-note-row]')).toHaveCount(1);
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
  await openNotes(page, '', ['n-3']);
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
  await openNotes(page, '', ['n-3']);
  const long = card(page, 'Line 1');
  const more = long.getByRole('button', { name: 'Show more' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  // Clamped: the body stops short of the text, which fades out.
  const body = long.locator('[data-overflows]');
  await expect(body).toHaveCount(1);
  expect(
    await body.evaluate((el) => el.scrollHeight > el.clientHeight + 100),
  ).toBe(true);
  await more.click();
  await expect(long.getByRole('button', { name: 'Show less' })).toBeVisible();
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
  await expect(card(page, 'Swap the motivator')).toBeVisible();
  await expect(add).toBeFocused();
});

test('Add note on Notes opens the panel, at any width', async ({ page }) => {
  await openLive(page, '/notes?view=list&project=p-falcon');
  const add = page.getByRole('main').getByRole('button', { name: 'Add note' });
  await expectAccessible(page);
  // A 44px target on touch, and the header wraps without sideways scroll.
  const box = await add.boundingBox();
  const touch = await page.evaluate(
    () => matchMedia('(pointer: coarse)').matches,
  );
  if (touch) expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await add.click();
  const panel = page.getByRole('dialog', { name: 'New note' });
  await expect(panel.getByRole('combobox', { name: 'Note' })).toBeFocused();
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('Falcon hyperdrive refit');
  await expectAccessible(page);
  await page.keyboard.type('Recalibrate the deflector');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel).toBeHidden();
  await expect(row(page, 'Recalibrate the deflector')).toBeVisible();
  await expect(add).toBeFocused();
});

test('Shift+N on Notes starts in the filtered project', async ({ page }) => {
  await openLive(page, '/notes?project=p-falcon');
  await page.locator('body').press('Shift+N');
  const panel = page.getByRole('dialog', { name: 'New note' });
  await expect(
    panel.getByRole('combobox', { name: 'Project', exact: true }),
  ).toHaveValue('Falcon hyperdrive refit');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // General, filtered or not, starts in General.
  await page.goto('/notes?project=general');
  await page.locator('body').press('Shift+N');
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
