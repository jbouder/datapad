import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNote,
  openLive,
  SEED,
  test,
} from './fixtures';

interface Stored {
  notes: Record<string, { body: string; meetingId: string | null }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const box = (page: Page) =>
  page
    .getByRole('main')
    .getByRole('textbox', { name: 'New note for “Shield review”' });

const asking = (page: Page) =>
  page.getByRole('alertdialog', { name: 'Save this note?' });

/** The meeting's room, in meeting mode's header: an in-app page change. */
const roomLink = (page: Page) =>
  page
    .getByRole('list', { name: 'Details' })
    .getByRole('link', { name: 'Echo Base relocation' });

/** Meeting mode's composer is always open (#336): write in it. */
async function write(page: Page, text: string) {
  await box(page).click();
  await expect(box(page)).toBeFocused();
  await page.keyboard.type(text);
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('an unsaved note holds Leave until Discard, then goes on', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings/e-1');
  await write(page, 'Shields hold at ninety');

  await page.getByRole('button', { name: /^Leave/ }).click();
  await expect(asking(page)).toBeVisible();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(
    asking(page).getByRole('button', { name: 'Save note' }),
  ).toBeFocused();
  await expectAccessible(page);

  await asking(page).getByRole('button', { name: 'Discard' }).click();
  // Opened from its address: Leave goes to Today.
  await expect(page).toHaveURL(/\/$/);
  const kept = Object.values((await stored(request)).notes).filter(
    (n) => n.meetingId === 'e-1',
  );
  expect(kept.map((n) => n.body)).not.toContain('Shields hold at ninety');
});

test('a click away keeps the text; a link asks; Save note saves and goes on', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings/e-1');
  await write(page, 'Bring the charts');

  // Meeting mode's composer stays: a click elsewhere does not ask.
  await page.getByRole('heading', { level: 1 }).click();
  await expect(asking(page)).toBeHidden();
  await expectNote(box(page), 'Bring the charts');

  // A link waits for Save note, then follows it.
  await roomLink(page).click();
  await expect(asking(page)).toBeVisible();
  await asking(page).getByRole('button', { name: 'Save note' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect
    .poll(async () =>
      Object.values((await stored(request)).notes)
        .filter((n) => n.meetingId === 'e-1')
        .map((n) => n.body),
    )
    .toContain('Bring the charts');
});

test('Back and Forward over an unsaved note wait for the answer', async ({
  page,
}) => {
  await openLive(page, '/meetings/e-1');
  // In-app history: the meeting, then its room, then Back to the meeting.
  await roomLink(page).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await page.goBack();
  await expect(box(page)).toBeVisible();
  await write(page, 'Ask about the ridge');

  await page.goForward();
  await expect(asking(page)).toBeVisible();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);

  // Esc goes back to writing; it does not leave.
  await page.keyboard.press('Escape');
  await expect(asking(page)).toBeHidden();
  await expect(box(page)).toBeFocused();
  await expectNote(box(page), 'Ask about the ridge');
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
});

test('an unsaved note in a panel asks on a click away and holds closing it', async ({
  page,
}) => {
  await openLive(page, '/meetings/e-1');
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Edit Shield review' });
  const region = form.getByRole('region', { name: 'Notes', exact: true });
  await region.getByRole('button', { name: 'Add note' }).click();
  // Typed once the composer has focus, or the letters are shortcuts.
  const composer = region.getByRole('textbox').first();
  await expect(composer).toBeFocused();
  await page.keyboard.type('Check the generator');
  const ask = form.getByRole('alertdialog', { name: 'Save this note?' });

  // A click on nothing in particular asks, and stays; back in the text
  // it goes.
  await region.getByRole('heading', { name: 'Notes' }).click();
  await expect(ask).toBeVisible();
  await composer.click();
  await expect(ask).toBeHidden();
  await expectNote(composer, 'Check the generator');

  await form.getByRole('button', { name: 'Close' }).click();
  await expect(ask).toBeVisible();
  await expect(form).toBeVisible();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(form).toBeHidden();
});

/** Edit a saved note of Shield review in place: double-click, then type. */
async function editSaved(page: Page, text: string) {
  const row = page
    .getByRole('main')
    .locator('[data-note-id]')
    .filter({ hasText: 'Bring the power budget' });
  await row.locator('[data-note-preview]').dblclick();
  const editor = row.getByRole('textbox', { name: 'Edit note' });
  await expect(editor).toBeFocused();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
  return row;
}

const askingEdit = (page: Page) =>
  page.getByRole('alertdialog', { name: 'Save changes to this note?' });

test('an edited note holds a link until Discard, and keeps the old text', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings/e-1');
  await editSaved(page, ' And the charts.');

  await roomLink(page).click();
  await expect(askingEdit(page)).toBeVisible();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(
    askingEdit(page).getByRole('button', { name: 'Save note' }),
  ).toBeFocused();
  await expectAccessible(page);

  // Esc goes back to the text and the link waits no more.
  await page.keyboard.press('Escape');
  await expect(askingEdit(page)).toBeHidden();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);

  await roomLink(page).click();
  await askingEdit(page).getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  const bodies = Object.values((await stored(request)).notes).map(
    (n) => n.body,
  );
  expect(bodies.some((b) => b.includes('And the charts.'))).toBe(false);
});

test('an edited note holds Forward until Save note, then saves and goes', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings/e-1');
  // In-app history: the meeting, then its room, then Back to the meeting.
  await roomLink(page).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await page.goBack();
  await editSaved(page, ' Bring the charts too.');

  await page.goForward();
  await expect(askingEdit(page)).toBeVisible();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await askingEdit(page).getByRole('button', { name: 'Save note' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect
    .poll(async () =>
      Object.values((await stored(request)).notes).map((n) => n.body),
    )
    .toContainEqual(expect.stringContaining('Bring the charts too.'));
});

test('an unchanged note does not ask; a changed one holds Leave', async ({
  page,
}) => {
  await openLive(page, '/meetings/e-1');
  const row = page
    .getByRole('main')
    .locator('[data-note-id]')
    .filter({ hasText: 'Bring the power budget' });
  await row.locator('[data-note-preview]').dblclick();
  await expect(row.getByRole('textbox', { name: 'Edit note' })).toBeFocused();
  // Opened and not changed: nothing to lose, so a link goes at once.
  await roomLink(page).click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);

  await openLive(page, '/meetings/e-1');
  await editSaved(page, ' Leave asks.');
  await page.getByRole('button', { name: /^Leave/ }).click();
  await expect(askingEdit(page)).toBeVisible();
  await askingEdit(page).getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/$/);
});
