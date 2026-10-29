import type { APIRequestContext, Page } from '@playwright/test';
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
    { id: string; body: string; scratch?: boolean; projectId: string | null }
  >;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

async function notepad(request: APIRequestContext) {
  return Object.values((await stored(request)).notes).filter((n) => n.scratch);
}

/** Every activity line, in every scope. */
async function logged(request: APIRequestContext): Promise<number> {
  const { activity } = await stored(request);
  return Object.values(activity).reduce((n, a) => n + a.events.length, 0);
}

const pad = (page: Page) => page.getByRole('combobox', { name: 'Notepad' });

/** A layout, by its label (the radio itself is visually hidden). */
async function pick(page: Page, name: string) {
  const group = page.getByRole('group', { name: 'Layout (press v to cycle)' });
  await group
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .click();
  await expect(group.getByRole('radio', { name })).toBeChecked();
}
const status = (page: Page) => page.locator('[data-notepad-status]');

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('the Notepad saves as you type, silently, and comes back', async ({
  page,
  request,
}) => {
  const before = await logged(request);
  await openLive(page, '/notepad');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Notepad' }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/^Notepad/);
  await expect(pad(page)).toHaveValue('');
  await expect(status(page)).toHaveText('Saves as you type.');
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  await pad(page).click();
  await page.keyboard.type('Call the tauntaun vet');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ask about the heaters');
  // A second after the last keystroke, without leaving the field.
  await expect(status(page)).toHaveText('Saved.');
  await expect(pad(page)).toBeFocused();
  await expectSaved(page);
  const [note] = await notepad(request);
  expect(note).toMatchObject({
    body: 'Call the tauntaun vet\nAsk about the heaters',
    projectId: null,
  });
  // Typing it logged nothing anywhere.
  expect(await logged(request)).toBe(before);

  // More, then another page before the second is up: it is kept.
  await page.keyboard.type('. Soon.');
  await page.getByRole('link', { name: 'Tasks' }).first().click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tasks' }),
  ).toBeVisible();
  await expectSaved(page);
  expect((await notepad(request)).map((n) => n.body)).toEqual([
    'Call the tauntaun vet\nAsk about the heaters. Soon.',
  ]);

  // Back on the Notepad, after a reload, it is all there.
  await openLive(page, '/notepad');
  await expect(pad(page)).toHaveValue(
    'Call the tauntaun vet\nAsk about the heaters. Soon.',
  );
  expect(await logged(request)).toBe(before);
});

test('the Notepad is one note, first in List and Grid, opening its page, and on another device', async ({
  page,
  context,
  request,
}) => {
  await openLive(page, '/notepad');
  await pad(page).fill('Shield frequencies');
  await expect(status(page)).toHaveText('Saved.');
  await expectSaved(page);

  // Another tab shows it, and its change comes back here.
  const other = await context.newPage();
  await openLive(other, '/notepad');
  await expect(pad(other)).toHaveValue('Shield frequencies');
  await pad(other).fill('Shield frequencies, rotated');
  await expect(status(other)).toHaveText('Saved.');
  await expect(pad(page)).toHaveValue('Shield frequencies, rotated');
  await other.close();
  await expectSaved(page);
  expect(await notepad(request)).toHaveLength(1);

  // List: first, labelled Notepad, and it opens the Notepad.
  await page.goto('/notes');
  const first = page.locator('[data-note-row]').first();
  await expect(first).toContainText('Shield frequencies, rotated');
  await expect(first).toContainText('Notepad');
  await expectAccessible(page);
  await first.getByRole('link').click();
  await expect(page).toHaveURL(/\/notepad$/);
  await expect(pad(page)).toHaveValue('Shield frequencies, rotated');

  // Grid: first, labelled Notepad; the card opens the Notepad too.
  await page.goto('/notes');
  await pick(page, 'Grid');
  const card = page
    .getByRole('list', { name: 'Notes' })
    .locator('article')
    .first();
  await expect(card).toContainText('Notepad');
  await expect(card).toContainText('Shield frequencies, rotated');
  await card.getByRole('link', { name: 'Open the Notepad' }).click();
  await expect(page).toHaveURL(/\/notepad$/);

  // A link to its note (⌘K) opens the Notepad as well.
  await page.goto('/');
  await page.getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('rotated');
  await palette.getByRole('option', { name: /Shield frequencies/ }).click();
  await expect(page).toHaveURL(/\/notepad$/);
  const [note] = await notepad(request);
  await page.goto(`/notes?note=${note?.id}`);
  await expect(page).toHaveURL(/\/notepad$/);

  // Emptying it removes it.
  await pad(page).fill('');
  await pad(page).blur();
  await expect(status(page)).toHaveText('Saved.');
  await expectSaved(page);
  expect(await notepad(request)).toHaveLength(0);
});

test('Notes’ old Notepad address lands on /notepad; ⌘K and the nav go there', async ({
  page,
}) => {
  await openLive(page, '/notes?view=notepad');
  await expect(page).toHaveURL(/\/notepad$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Notepad' }),
  ).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('Go to Notepad');
  await palette.getByRole('option', { name: /Go to Notepad/ }).click();
  await expect(page).toHaveURL(/\/notepad$/);

  // The rail's Tools on desktop, the account menu on a phone.
  await page.goto('/');
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Account and settings' }).click();
    await page.getByRole('menuitem', { name: 'Notepad' }).click();
  } else {
    await page
      .getByRole('complementary', { name: 'Datapad' })
      .getByRole('link', { name: 'Notepad' })
      .click();
  }
  await expect(page).toHaveURL(/\/notepad$/);
  if (!isMobile(page)) {
    await expect(
      page
        .getByRole('complementary', { name: 'Datapad' })
        .getByRole('link', { name: 'Notepad' }),
    ).toHaveAttribute('aria-current', 'page');
  }
});
