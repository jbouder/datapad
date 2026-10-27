import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, localDate } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

interface Stored {
  notes: Record<
    string,
    {
      body: string;
      meetingId: string | null;
      phase: string | null;
      projectId: string | null;
    }
  >;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const today = localDate(new Date());
const shieldDay = addDays(today, 3);
const planningDay = addDays(today, 2);

function row(page: Page, title: string) {
  return page.locator('[data-meeting-id]').filter({ hasText: title }).first();
}

/** The row's ⋯ menu item. */
async function action(page: Page, title: string, name: string) {
  await row(page, title)
    .getByRole('button', { name: `More for “${title}”` })
    .click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/** Add note: beside the row on desktop, in its menu on a phone. */
async function addNote(page: Page, title: string) {
  if (isMobile(page)) {
    await action(page, title, 'Add note');
  } else {
    await row(page, title)
      .getByRole('button', { name: `Add note to “${title}”` })
      .click();
  }
}

function composer(page: Page, title: string) {
  return page.getByRole('combobox', { name: `New note for “${title}”` });
}

/** The Notes section's list on a meeting's page. */
function linked(page: Page) {
  return page.getByRole('region', { name: 'Notes', exact: true });
}

test.beforeEach(async ({ request }) => {
  // The seed's dates are fixed; bring two meetings into the coming week.
  const seed = structuredClone(SEED);
  seed.meetings['e-1'].date = shieldDay;
  seed.meetings['e-4'].date = planningDay;
  await request.post('/api/import', { data: seed });
});

/**
 * Write and save two notes on Shield review under its row, in place; the
 * row only says so, and its page lists them.
 */
async function writeTwo(page: Page) {
  const url = page.url();
  for (const text of ['Ask about the ridge', 'Ridge is clear']) {
    await addNote(page, 'Shield review');
    const box = composer(page, 'Shield review');
    await expect(box).toBeFocused();
    // No seed and no kind to pick: an empty note.
    await expect(box).toHaveValue('');
    await expect(row(page, 'Shield review').getByRole('radio')).toHaveCount(0);
    await page.keyboard.type(text);
    await row(page, 'Shield review')
      .getByRole('button', { name: 'Save note' })
      .click();
    await expect(box).toBeHidden();
    await expect(
      page.getByText('Added a note to “Shield review”').first(),
    ).toBeVisible();
    expect(page.url()).toBe(url);
  }
  await expect(
    row(page, 'Shield review').getByRole('list', { name: /^Notes/ }),
  ).toHaveCount(0);
  await row(page, 'Shield review')
    .getByRole('link', { name: 'Shield review', exact: true })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  // One list, newest first, the seed's old Prep note (phase `pre`) last.
  const items = linked(page).getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Ridge is clear');
  await expect(items.nth(1)).toContainText('Ask about the ridge');
  await expect(items.nth(2)).toContainText('Shield review — 2026-10-27');
}

async function expectStoredTwo(request: APIRequestContext) {
  const notes = Object.values((await stored(request)).notes);
  const find = (text: string) => notes.find((n) => n.body.includes(text));
  for (const text of ['Ask about the ridge', 'Ridge is clear']) {
    expect(find(text)).toEqual(
      expect.objectContaining({
        body: text,
        meetingId: 'e-1',
        phase: null,
        projectId: 'p-echo',
      }),
    );
  }
  // The old phased note is untouched.
  expect(find('Bring the power budget')).toMatchObject({ phase: 'pre' });
}

test('notes on a meeting row on Meetings, written in place', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings');
  await writeTwo(page);
  // No kinds of note to choose from any more.
  await expect(page.getByRole('button', { name: /Prep|Debrief/ })).toHaveCount(
    0,
  );
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
  await expectSaved(page);
  await expectStoredTwo(request);
});

test('notes on a meeting row on a project page, in place', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  await writeTwo(page);
  await expectSaved(page);
  await expectStoredTwo(request);
});

test('the row’s composer: one per meeting, Esc and Cancel', async ({
  page,
}) => {
  await openLive(page, '/meetings');
  const shield = row(page, 'Shield review');
  await addNote(page, 'Shield review');
  const box = composer(page, 'Shield review');
  await expect(box).toBeFocused();
  await page.keyboard.type('Bring the charts');

  // The menu's Add note goes back to the one composer.
  await box.blur();
  await action(page, 'Shield review', 'Add note');
  await expect(
    page.getByRole('combobox', { name: /^New note for/ }),
  ).toHaveCount(1);
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('Bring the charts');

  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await expect(page).toHaveURL(/\/meetings/);

  // Esc dropped the draft.
  await action(page, 'Shield review', 'Add note');
  await expect(box).toHaveValue('');
  await shield.getByRole('button', { name: 'Cancel' }).click();
  await expect(box).toBeHidden();
});

test('notes on the meeting’s page: add, edit and delete', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings/e-1');
  const main = page.getByRole('main');
  const notes = linked(page);
  const items = notes.getByRole('listitem');
  // The seed's old Prep note (phase `pre`) is listed like any other.
  await expect(items).toHaveCount(1);
  await expect(items.nth(0)).toContainText('Bring the power budget');

  // Esc closes the composer.
  await notes.getByRole('button', { name: 'Add note' }).click();
  const box = main.getByRole('combobox', {
    name: 'New note for “Shield review”',
  });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();

  // ⌘Enter saves the note.
  await notes.getByRole('button', { name: 'Add note' }).click();
  await expect(box).toBeFocused();
  await page.keyboard.type('Shields hold at **ninety**');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(box).toBeHidden();
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Shields hold at ninety');
  await expect(items.nth(0).locator('strong')).toHaveText('ninety');

  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Edit in place.
  await items.nth(0).getByRole('button', { name: /^Edit/ }).click();
  const edit = main.getByRole('combobox', { name: 'Edit note' });
  await expect(edit).toBeFocused();
  await edit.fill('Shields hold at ninety-five');
  await main.getByRole('button', { name: 'Save note' }).click();
  await expect(items.nth(0)).toContainText('Shields hold at ninety-five');
  await expect(items.nth(0)).toContainText('edited');

  // Delete the old one, with Undo offered; Undo brings it back.
  await items
    .nth(1)
    .getByRole('button', { name: /^Delete/ })
    .click();
  await expect(items).toHaveCount(1);
  await page
    .locator('output.toast')
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(items).toHaveCount(2);

  // The meeting's panel lists the same notes.
  await main.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit Shield review' });
  await expect(
    form.getByRole('region', { name: 'Notes', exact: true }),
  ).toContainText('Shields hold at ninety-five');
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();

  await expectSaved(page);
  const all = Object.values((await stored(request)).notes).filter(
    (n) => n.meetingId === 'e-1',
  );
  expect(all).toHaveLength(2);
  expect(all).toContainEqual(
    expect.objectContaining({
      body: 'Shields hold at ninety-five',
      phase: null,
      projectId: 'p-echo',
    }),
  );
});

test('from the Focus agenda: a project meeting and a General one', async ({
  page,
  request,
}) => {
  await openLive(page, '/?view=week');
  const agenda = page.getByRole('region', { name: 'Next 7 days' });
  await expect(agenda.getByRole('listitem')).toHaveCount(2);

  await agenda
    .getByRole('button', { name: 'Add note to “Shield review”' })
    .click();
  const box = composer(page, 'Shield review');
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('');
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
  await page.keyboard.type('Ridge is clear');
  await agenda.getByRole('button', { name: 'Save note' }).click();
  await expect(box).toBeHidden();
  await expect(page.getByText('Added a note to “Shield review”')).toBeVisible();

  await agenda
    .getByRole('button', { name: 'Add note to “Quarterly planning”' })
    .click();
  const general = composer(page, 'Quarterly planning');
  await expect(general).toBeFocused();
  await expect(general).toHaveValue('');
  await page.keyboard.type('Budget first');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(general).toBeHidden();
  await expect(page).toHaveURL(/\/\?view=week$/);

  await expectSaved(page);
  const notes = Object.values((await stored(request)).notes);
  expect(notes.find((n) => n.body === 'Ridge is clear')).toMatchObject({
    meetingId: 'e-1',
    phase: null,
    projectId: 'p-echo',
  });
  expect(notes.find((n) => n.body === 'Budget first')).toMatchObject({
    meetingId: 'e-4',
    phase: null,
    projectId: null,
  });
});

test('the page lists every note on the meeting, newest first', async ({
  page,
  request,
}) => {
  const seed = structuredClone(SEED);
  seed.meetings['e-1'].date = shieldDay;
  const notes: Record<string, object> = seed.notes;
  for (const [i, phase] of (['pre', 'post', null] as const).entries()) {
    notes[`n-x${i}`] = {
      ...seed.notes['n-2'],
      id: `n-x${i}`,
      body: `Extra ${i}`,
      phase,
      createdAt: `2026-10-23T1${i}:00:00.000Z`,
    };
  }
  await request.post('/api/import', { data: seed });
  await openLive(page, '/meetings/e-1');
  const items = linked(page).getByRole('listitem');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText('Extra 2');
  await expect(items.nth(2)).toContainText('Extra 0');
  await expect(items.nth(3)).toContainText('Shield review — 2026-10-27');
});

test('a meeting’s note on Notes shows a chip that opens the meeting', async ({
  page,
}) => {
  await openLive(page, '/notes');
  const card = page
    .locator('article[data-note-id]')
    .filter({ hasText: 'Bring the power budget' });
  await card.getByRole('link', { name: 'Meeting: Shield review' }).click();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(linked(page)).toContainText('Bring the power budget');
});
