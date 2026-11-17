import type { APIRequestContext, Page } from '@playwright/test';
import { expect, expectAccessible, openLive, SEED, test } from './fixtures';

interface Stored {
  notes: Record<string, { body: string; meetingId: string | null }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const notes = (page: Page) =>
  page.getByRole('main').getByRole('region', { name: 'Notes', exact: true });

const box = (page: Page) =>
  page
    .getByRole('main')
    .getByRole('combobox', { name: 'New note for “Shield review”' });

const asking = (page: Page) =>
  page.getByRole('alertdialog', { name: 'Save this note?' });

/** All, from the rail or the tab bar: an in-app page change. */
const tasksLink = (page: Page) =>
  page
    .getByRole('link', { name: 'All', exact: true })
    .filter({ visible: true })
    .first();

async function write(page: Page, text: string) {
  await notes(page).getByRole('button', { name: 'Add note' }).click();
  await expect(box(page)).toBeFocused();
  await page.keyboard.type(text);
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('an unsaved note holds a link until Discard, then goes on', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings/e-1');
  await write(page, 'Shields hold at ninety');

  await tasksLink(page).click();
  await expect(asking(page)).toBeVisible();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(
    asking(page).getByRole('button', { name: 'Save note' }),
  ).toBeFocused();
  await expectAccessible(page);

  await asking(page).getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/all$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'All', exact: true }),
  ).toBeVisible();
  const kept = Object.values((await stored(request)).notes).filter(
    (n) => n.meetingId === 'e-1',
  );
  expect(kept.map((n) => n.body)).not.toContain('Shields hold at ninety');
});

test('a click away asks; back in the text it goes; Save note saves and goes on', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings/e-1');
  await write(page, 'Bring the charts');

  // A click on nothing in particular asks, and stays.
  await page.getByRole('heading', { level: 1 }).click();
  await expect(asking(page)).toBeVisible();
  await box(page).click();
  await expect(asking(page)).toBeHidden();
  await expect(box(page)).toHaveValue('Bring the charts');

  // A link waits for Save note, then follows it.
  await tasksLink(page).click();
  await expect(asking(page)).toBeVisible();
  await asking(page).getByRole('button', { name: 'Save note' }).click();
  await expect(page).toHaveURL(/\/all$/);
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
  // In-app history: the meeting, then Tasks, then Back to the meeting.
  await tasksLink(page).click();
  await expect(page).toHaveURL(/\/all$/);
  await page.goBack();
  await expect(notes(page)).toBeVisible();
  await write(page, 'Ask about the ridge');

  await page.goForward();
  await expect(asking(page)).toBeVisible();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);

  // Esc goes back to writing.
  await page.keyboard.press('Escape');
  await expect(asking(page)).toBeHidden();
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveValue('Ask about the ridge');
});

test('an unsaved note in a panel holds closing it', async ({ page }) => {
  await openLive(page, '/meetings/e-1');
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Edit Shield review' });
  const region = form.getByRole('region', { name: 'Notes', exact: true });
  await region.getByRole('button', { name: 'Add note' }).click();
  // Typed once the composer has focus, or the letters are shortcuts.
  await expect(region.getByRole('combobox').first()).toBeFocused();
  await page.keyboard.type('Check the generator');
  await form.getByRole('button', { name: 'Close' }).click();
  const ask = form.getByRole('alertdialog', { name: 'Save this note?' });
  await expect(ask).toBeVisible();
  await expect(form).toBeVisible();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(form).toBeHidden();
});
