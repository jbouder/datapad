import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, formatDay, localDate } from '../shared/dates';
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
const shieldLine = (lead: string) =>
  `## ${lead}Shield review — ${formatDay(shieldDay, today)}`;

function row(page: Page, title: string) {
  return page.locator('[data-meeting-id]').filter({ hasText: title }).first();
}

async function action(page: Page, title: string, name: string) {
  await row(page, title)
    .getByRole('button', { name: `More for “${title}”` })
    .click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

function composer(page: Page, title: string) {
  return page.getByRole('combobox', { name: `New note for “${title}”` });
}

function group(page: Page, title: string, label: string) {
  return row(page, title).getByRole('region', {
    name: `${label} notes for “${title}”`,
  });
}

test.beforeEach(async ({ request }) => {
  // The seed's dates are fixed; bring two meetings into the coming week.
  const seed = structuredClone(SEED);
  seed.meetings['e-1'].date = shieldDay;
  seed.meetings['e-4'].date = planningDay;
  await request.post('/api/import', { data: seed });
});

/** Write and save one note of each kind on Shield review, in place. */
async function writeAllThree(page: Page) {
  const url = page.url();
  for (const [item, lead, text] of [
    ['Prep note', 'Prep: ', 'Ask about the ridge'],
    ['Debrief note', 'Debrief: ', 'Ridge is clear'],
    ['Note', '', 'Shields hold at ninety'],
  ] as const) {
    await action(page, 'Shield review', item);
    const box = composer(page, 'Shield review');
    await expect(box).toBeFocused();
    await expect(box).toHaveValue(`${shieldLine(lead)}\n`);
    await page.keyboard.type(text);
    await row(page, 'Shield review')
      .getByRole('button', { name: 'Save note' })
      .click();
    await expect(box).toBeHidden();
    expect(page.url()).toBe(url);
  }
  await expect(group(page, 'Shield review', 'Prep')).toContainText(
    'Prep: Shield review',
  );
  await expect(
    group(page, 'Shield review', 'Prep').getByRole('listitem'),
  ).toHaveCount(2);
  await expect(group(page, 'Shield review', 'Debrief')).toContainText(
    'Debrief: Shield review',
  );
  // Past three, the plain note waits behind Show all.
  await row(page, 'Shield review')
    .getByRole('button', { name: 'Show all 4' })
    .click();
  await expect(group(page, 'Shield review', 'Notes')).toContainText(
    'Shield review',
  );
}

async function expectStoredAllThree(request: APIRequestContext) {
  const notes = Object.values((await stored(request)).notes);
  const find = (text: string) => notes.find((n) => n.body.includes(text));
  expect(find('Ask about the ridge')).toMatchObject({
    meetingId: 'e-1',
    phase: 'pre',
    projectId: 'p-echo',
  });
  expect(find('Ridge is clear')).toMatchObject({
    meetingId: 'e-1',
    phase: 'post',
    projectId: 'p-echo',
  });
  expect(find('Shields hold at ninety')).toMatchObject({
    meetingId: 'e-1',
    phase: null,
    projectId: 'p-echo',
  });
}

test('Prep, Debrief and a plain note on Meetings, written in place', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings');
  await writeAllThree(page);
  await expect(page).toHaveURL(/\/meetings/);
  await expectSaved(page);
  await expectStoredAllThree(request);
});

test('Prep, Debrief and a plain note on a project page, in place', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  await writeAllThree(page);
  await expect(page).toHaveURL(/\/projects\/p-echo$/);
  await expectSaved(page);
  await expectStoredAllThree(request);
});

test('the composer: phase picker, one per meeting, Esc and Cancel', async ({
  page,
}) => {
  await openLive(page, '/meetings');
  const shield = row(page, 'Shield review');
  if (isMobile(page)) {
    await action(page, 'Shield review', 'Debrief note');
  } else {
    await shield
      .getByRole('button', { name: 'Debrief note for “Shield review”' })
      .click();
  }
  const box = composer(page, 'Shield review');
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute('data-phase', 'post');
  await expect(shield.getByRole('radio', { name: 'Debrief' })).toBeChecked();

  // Untouched, the seed follows the phase.
  await shield
    .getByRole('group', { name: 'Kind of note' })
    .getByText('Prep', { exact: true })
    .click();
  await expect(box).toHaveValue(`${shieldLine('Prep: ')}\n`);
  await expect(box).toHaveAttribute('data-phase', 'pre');

  // Another action on the same meeting switches the one composer.
  await box.focus();
  await page.keyboard.press('End');
  await page.keyboard.type('Bring the charts');
  await action(page, 'Shield review', 'Note');
  await expect(
    page.getByRole('combobox', { name: /^New note for/ }),
  ).toHaveCount(1);
  await expect(shield.getByRole('radio', { name: 'Note' })).toBeChecked();
  await expect(box).toHaveValue(`${shieldLine('Prep: ')}\nBring the charts`);

  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  await box.focus();
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await expect(page).toHaveURL(/\/meetings/);

  // Esc dropped the draft: it starts from the seed again.
  await action(page, 'Shield review', 'Prep note');
  await expect(box).toHaveValue(`${shieldLine('Prep: ')}\n`);
  await shield.getByRole('button', { name: 'Cancel' }).click();
  await expect(box).toBeHidden();
});

test('from the Focus agenda: a project meeting and a General one', async ({
  page,
  request,
}) => {
  await openLive(page, '/');
  const agenda = page.getByRole('region', { name: 'Next 7 days' });
  await expect(agenda.getByRole('listitem')).toHaveCount(2);

  await agenda
    .getByRole('button', { name: 'Debrief note for “Shield review”' })
    .click();
  const box = composer(page, 'Shield review');
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(`${shieldLine('Debrief: ')}\n`);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
  await page.keyboard.type('Ridge is clear');
  await agenda.getByRole('button', { name: 'Save note' }).click();
  await expect(box).toBeHidden();
  await expect(page.getByText('Added a note to “Shield review”')).toBeVisible();

  await agenda
    .getByRole('button', { name: 'Note for “Quarterly planning”', exact: true })
    .click();
  const general = composer(page, 'Quarterly planning');
  await expect(general).toHaveValue(
    `## Quarterly planning — ${formatDay(planningDay, today)}\n`,
  );
  await page.keyboard.type('Budget first');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(general).toBeHidden();
  await expect(page).toHaveURL(/\/$/);

  await expectSaved(page);
  const notes = Object.values((await stored(request)).notes);
  expect(notes.find((n) => n.body.includes('Ridge is clear'))).toMatchObject({
    meetingId: 'e-1',
    phase: 'post',
    projectId: 'p-echo',
  });
  expect(notes.find((n) => n.body.includes('Budget first'))).toMatchObject({
    meetingId: 'e-4',
    phase: null,
    projectId: null,
  });
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
