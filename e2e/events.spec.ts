import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, localDate } from '../shared/dates';
import { expect, expectSaved, openLive, SEED, test } from './fixtures';

interface Stored {
  events: Record<string, { title: string; time: string; end: string }>;
  notes: Record<string, { eventId: string | null }>;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

function row(page: Page, title: string) {
  return page.locator('[data-event-id]').filter({ hasText: title });
}

const today = localDate(new Date());

test.beforeEach(async ({ request }) => {
  // The seed's dates are fixed; keep Shield review a few days ahead.
  const seed = structuredClone(SEED);
  seed.events['e-1'].date = addDays(today, 3);
  await request.post('/api/import', { data: seed });
});

test('adds a meeting from a project, edits it, sees it on Events, deletes it', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: 'Add event' }).click();
  const form = page.getByRole('dialog', { name: 'New event' });
  // Bound to the project: no picker.
  await expect(form.getByRole('combobox', { name: 'Project' })).toHaveCount(0);

  // Title and date are required; Save points at the first gap.
  await form.getByRole('button', { name: 'Add event' }).click();
  await expect(form.getByText('Give the event a title')).toBeVisible();
  await expect(form.getByLabel('Title')).toBeFocused();

  await form.getByLabel('Title').fill('Hangar walkthrough');
  await form.getByLabel('Date').fill('+2d');
  await form.getByLabel('Date').press('Tab');
  await form.getByLabel('Time', { exact: true }).fill('930');
  await form.getByLabel('End', { exact: true }).fill('10:15');
  await form.getByLabel('End', { exact: true }).press('Tab');
  await expect(form.getByLabel('Time', { exact: true })).toHaveValue('09:30');
  await form.locator('label').filter({ hasText: 'Han Solo' }).click();
  await form.getByRole('button', { name: 'Add event' }).click();
  await expect(form).toBeHidden();

  const added = row(page, 'Hangar walkthrough');
  await expect(added).toContainText('09:30–10:15');
  await expect(added.getByText('Meeting')).toBeVisible();

  // Edit the time: `2pm` reads as 14:00, and the end must come after.
  await added
    .getByRole('button', { name: 'Hangar walkthrough', exact: true })
    .click();
  const edit = page.getByRole('dialog', { name: 'Edit Hangar walkthrough' });
  await edit.getByLabel('Time', { exact: true }).fill('2pm');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit.getByText('End after it starts')).toBeVisible();
  await edit.getByLabel('End', { exact: true }).fill('3pm');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(added).toContainText('14:00–15:00');

  await expectSaved(page);
  const data = await stored(request);
  expect(
    data.activity['p-echo']?.events.slice(0, 2).map((e) => e.text),
  ).toEqual([
    'Edited meeting "Hangar walkthrough"',
    'Added meeting "Hangar walkthrough"',
  ]);

  // On Events, under its month, with its project.
  await page.goto('/events');
  const there = row(page, 'Hangar walkthrough');
  await expect(there).toContainText('14:00–15:00');
  await expect(
    there.getByRole('link', { name: 'Echo Base relocation' }),
  ).toBeVisible();

  // Delete one with a note: it asks, and the note stays.
  const shield = row(page, 'Shield review');
  await shield
    .getByRole('button', { name: 'More for “Shield review”' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const ask = shield.getByRole('alertdialog');
  await expect(ask).toContainText('Its note is kept.');
  await ask.getByRole('button', { name: 'Delete event' }).click();
  await expect(shield).toHaveCount(0);

  await expectSaved(page);
  const after = await stored(request);
  expect(after.events['e-1']).toBeUndefined();
  expect(after.notes['n-2']).toBeDefined();
  expect(after.activity['p-echo']?.events[0]?.text).toBe(
    'Deleted event "Shield review"',
  );
});

test('filters by project and type, and keeps archived projects under Past', async ({
  page,
}) => {
  await openLive(page, '/events');
  await expect(row(page, 'Shield review')).toBeVisible();
  await expect(row(page, 'Quarterly planning')).toBeVisible();

  // An archived project's event is still here, under its project.
  await page.getByRole('button', { name: /^Past/ }).click();
  await expect(
    row(page, 'Medal ceremony').getByRole('link', {
      name: /Yavin IV retrospective/,
    }),
  ).toBeVisible();

  await page
    .locator('label')
    .filter({ hasText: /^Deadline$/ })
    .click();
  await expect(page).toHaveURL(/type=deadline/);
  await expect(page.locator('[data-event-id]')).toHaveCount(1);
  await expect(row(page, 'Quarterly planning')).toContainText('General');

  await page.locator('label').filter({ hasText: /^All$/ }).click();
  await page.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: 'Echo Base relocation' }).click();
  await expect(page).toHaveURL(/project=p-echo/);
  await expect(row(page, 'Quarterly planning')).toHaveCount(0);
  await expect(row(page, 'Shield review')).toBeVisible();

  // Add event from a project filter starts in that project.
  await page.getByRole('button', { name: 'Add event' }).click();
  await expect(
    page.getByRole('dialog').getByRole('combobox', { name: 'Project' }),
  ).toHaveValue('Echo Base relocation');
});
