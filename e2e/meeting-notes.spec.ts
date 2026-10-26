import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, formatDay, localDate } from '../shared/dates';
import { expect, expectSaved, openLive, SEED, test } from './fixtures';

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

async function action(page: Page, title: string, name: string) {
  await row(page, title)
    .getByRole('button', { name: `More for “${title}”` })
    .click();
  await page.getByRole('menuitem', { name }).click();
}

function composer(page: Page) {
  return page.getByRole('combobox', { name: 'New note' });
}

test.beforeEach(async ({ request }) => {
  // The seed's dates are fixed; bring two meetings into the coming week.
  const seed = structuredClone(SEED);
  seed.meetings['e-1'].date = shieldDay;
  seed.meetings['e-4'].date = planningDay;
  await request.post('/api/import', { data: seed });
});

test('Prep note from Meetings goes to the project and links the note', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings');
  await action(page, 'Shield review', 'Prep note');

  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  const box = composer(page);
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(
    `## Prep: Shield review — ${formatDay(shieldDay, today)}\n`,
  );
  await expect(box).toHaveAttribute('data-meeting', 'e-1');
  await expect(box).toHaveAttribute('data-phase', 'pre');
  await expect(page.getByText('Prep · Shield review').first()).toBeVisible();

  await box.press('End');
  await page.keyboard.type('Ask about the ridge');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(box).toHaveValue('');
  await expect(box).not.toHaveAttribute('data-meeting');

  await expectSaved(page);
  const added = Object.values((await stored(request)).notes).find((n) =>
    n.body.includes('Ask about the ridge'),
  );
  expect(added).toMatchObject({
    meetingId: 'e-1',
    phase: 'pre',
    projectId: 'p-echo',
  });

  // Under the meeting row, grouped and oldest first, with Edit.
  const prep = row(page, 'Shield review').getByRole('region', {
    name: 'Prep notes for “Shield review”',
  });
  await expect(prep.getByRole('listitem')).toHaveCount(2);
  await expect(prep.getByRole('listitem').last()).toContainText(
    'Prep: Shield review',
  );
  await prep.getByRole('link', { name: /^Edit/ }).first().click();
  await expect(page).toHaveURL(/note=n-2/);
});

test('Debrief note on a page with a composer appends to the draft', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  const box = composer(page);
  await box.fill('Half a thought');
  await action(page, 'Shield review', 'Debrief note');

  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect(box).toHaveValue(
    `Half a thought\n## Debrief: Shield review — ${formatDay(shieldDay, today)}\n`,
  );
  await expect(box).toHaveAttribute('data-phase', 'post');
  await expect(page.getByText('Linked to “Shield review”')).toBeVisible();
});

test('from the Focus agenda: a project meeting and a General one', async ({
  page,
}) => {
  await openLive(page, '/');
  const agenda = page.getByRole('region', { name: 'Next 7 days' });
  await expect(agenda.getByRole('listitem')).toHaveCount(2);

  await agenda
    .getByRole('button', { name: 'Debrief note for “Shield review”' })
    .click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expect(composer(page)).toHaveAttribute('data-phase', 'post');

  await page.goto('/');
  await page
    .getByRole('button', { name: 'Prep note for “Quarterly planning”' })
    .click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(composer(page)).toHaveValue(
    `## Prep: Quarterly planning — ${formatDay(planningDay, today)}\n`,
  );
  await expect(
    page.getByRole('combobox', { name: 'Project for the note' }),
  ).toHaveValue('General');
});

test('more than three linked notes wait behind Show all', async ({
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
  await openLive(page, '/meetings');
  const shield = row(page, 'Shield review');
  await expect(shield.getByRole('listitem')).toHaveCount(3);
  await shield.getByRole('button', { name: 'Show all 4' }).click();
  await expect(shield.getByRole('listitem')).toHaveCount(4);
  await expect(
    shield.getByRole('region', { name: 'Notes notes for “Shield review”' }),
  ).toContainText('Extra 2');
});
