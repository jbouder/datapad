import type { APIRequestContext, Page } from '@playwright/test';
import { addDays } from '../shared/dates';
import { expect, expectSaved, openLive, SEED, test, today } from './fixtures';

interface Stored {
  meetings: Record<string, { title: string; time: string; end: string }>;
  notes: Record<string, { meetingId: string | null }>;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

function row(page: Page, title: string) {
  return page.locator('[data-meeting-id]').filter({ hasText: title });
}

test.beforeEach(async ({ request }) => {
  // The seed's dates are fixed; keep Shield review a few days ahead.
  const seed = structuredClone(SEED);
  seed.meetings['e-1'].date = addDays(today(), 3);
  await request.post('/api/import', { data: seed });
});

test('adds a meeting from a project, edits it, sees it on Meetings, deletes it', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: 'Add meeting' }).click();
  const form = page.getByRole('dialog', { name: 'New meeting' });
  // Bound to the project: no picker.
  await expect(form.getByRole('combobox', { name: 'Project' })).toHaveCount(0);

  // Title and date are required; Save points at the first gap.
  await form.getByRole('button', { name: 'Add meeting' }).click();
  await expect(form.getByText('Give the meeting a title')).toBeVisible();
  await expect(form.getByLabel('Title')).toBeFocused();

  await form.getByLabel('Title').fill('Hangar walkthrough');
  await form.getByLabel('Date').fill('+2d');
  await form.getByLabel('Date').press('Tab');
  await form.getByLabel('Time', { exact: true }).fill('930');
  await form.getByLabel('End', { exact: true }).fill('10:15');
  await form.getByLabel('End', { exact: true }).press('Tab');
  await expect(form.getByLabel('Time', { exact: true })).toHaveValue('9:30 AM');
  await form.locator('label').filter({ hasText: 'Han Solo' }).click();
  await form.getByRole('button', { name: 'Add meeting' }).click();
  await expect(form).toBeHidden();

  const added = row(page, 'Hangar walkthrough');
  await expect(added).toContainText('9:30–10:15 AM');

  // Edit the time: `2pm` reads as 2:00 PM, and the end must come after.
  await added
    .getByRole('button', { name: 'More for “Hangar walkthrough”' })
    .click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Hangar walkthrough' });
  await edit.getByLabel('Time', { exact: true }).fill('2pm');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit.getByText('End after it starts')).toBeVisible();
  await edit.getByLabel('End', { exact: true }).fill('3pm');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(added).toContainText('2:00–3:00 PM');

  await expectSaved(page);
  const data = await stored(request);
  expect(
    data.activity['p-echo']?.events.slice(0, 2).map((e) => e.text),
  ).toEqual([
    'Edited meeting "Hangar walkthrough"',
    'Added meeting "Hangar walkthrough"',
  ]);

  // On Meetings, under its month, with its project.
  await page.goto('/meetings');
  const there = row(page, 'Hangar walkthrough');
  await expect(there).toContainText('2:00–3:00 PM');
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
  await ask.getByRole('button', { name: 'Delete meeting' }).click();
  await expect(shield).toHaveCount(0);

  await expectSaved(page);
  const after = await stored(request);
  expect(after.meetings['e-1']).toBeUndefined();
  expect(after.notes['n-2']).toBeDefined();
  expect(after.activity['p-echo']?.events[0]?.text).toBe(
    'Deleted meeting "Shield review"',
  );
});

test('filters by project and General, and keeps archived projects under Past', async ({
  page,
}) => {
  await openLive(page, '/meetings');
  await expect(row(page, 'Shield review')).toBeVisible();
  await expect(row(page, 'Quarterly planning')).toBeVisible();

  // An archived project's meeting is still here, under its project.
  await page.getByRole('button', { name: /^Past/ }).click();
  await expect(
    row(page, 'Medal ceremony').getByRole('link', {
      name: /Yavin IV retrospective/,
    }),
  ).toBeVisible();

  // No type filter: a meeting is the only kind there is.
  await expect(page.getByRole('radiogroup', { name: 'Type' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Type' })).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: 'General', exact: true }).click();
  await expect(page).toHaveURL(/project=general/);
  await expect(page.locator('[data-meeting-id]')).toHaveCount(1);
  await expect(row(page, 'Quarterly planning')).toContainText('General');

  await page.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: 'Echo Base relocation' }).click();
  await expect(page).toHaveURL(/project=p-echo/);
  await expect(row(page, 'Quarterly planning')).toHaveCount(0);
  await expect(row(page, 'Shield review')).toBeVisible();

  // Add meeting from a project filter starts in that project.
  await page.getByRole('button', { name: 'Add meeting' }).click();
  await expect(
    page.getByRole('dialog').getByRole('combobox', { name: 'Project' }),
  ).toHaveValue('Echo Base relocation');
});

test('old addresses land on Meetings, or on the meeting they opened', async ({
  page,
}) => {
  await openLive(page, '/events?view=list&event=e-1');
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Shield review' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Shield review · Datapad');

  // A meeting's row was /meetings?meeting=<id> until it had a page.
  await page.goto('/meetings?view=list&meeting=e-1');
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Shield review' }),
  ).toBeVisible();

  // Other parameters come along unchanged.
  await page.goto('/events?project=p-echo&view=calendar');
  await expect(page).toHaveURL(/\/meetings\?project=p-echo&view=calendar$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Meetings' }),
  ).toBeVisible();
});

test('empty states tell none yet from none that match', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings?project=p-falcon');
  await expect(page.getByText('No meetings match.')).toBeVisible();
  // Only past meetings: nothing coming up, and Past is still there.
  await page.goto('/meetings?project=p-yavin');
  await expect(page.getByText('Nothing coming up that matches.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Past/ })).toBeVisible();

  const issued = await request.get('/api/erase-token');
  const { token } = (await issued.json()) as { token: string };
  const erased = await request.post('/api/erase', { data: { token } });
  expect(erased.ok()).toBe(true);
  await openLive(page, '/meetings');
  await expect(page.getByText('No meetings yet. Add a meeting.')).toBeVisible();
});
