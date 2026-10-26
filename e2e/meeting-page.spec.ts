import type { APIRequestContext } from '@playwright/test';
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
  meetings: Record<string, { title: string; topics?: { title: string }[] }>;
  notes: Record<string, { meetingId: string | null }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const today = localDate(new Date());
const nextWeek = addDays(today, 7);

/**
 * Shield review today with three topics (one covered), and the same
 * meeting again next week (the same series), without any.
 */
test.beforeEach(async ({ request }) => {
  const data = structuredClone(SEED) as typeof SEED & {
    meetings: Record<string, unknown>;
  };
  const shield = data.meetings['e-1'] as (typeof SEED.meetings)['e-1'] & {
    topics?: unknown;
  };
  shield.date = today;
  shield.topics = [
    { id: 't-power', title: 'Power budget', done: true, outcome: 'Approved' },
    { id: 't-ridge', title: 'North ridge', done: false, outcome: '' },
    { id: 't-probe', title: 'Probe droid sightings', done: false, outcome: '' },
  ];
  data.meetings['e-5'] = { ...shield, id: 'e-5', date: nextWeek, topics: [] };
  await request.post('/api/import', { data });
});

test('a meeting’s page: its facts, agenda, topics and notes', async ({
  page,
}) => {
  await openLive(page, '/meetings');
  await page
    .locator('[data-meeting-id="e-1"]')
    .getByRole('link', { name: 'Shield review', exact: true })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);
  await expect(page).toHaveTitle('Shield review · Datapad');
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', { level: 1, name: 'Shield review' }),
  ).toBeVisible();
  // Under Meetings in the nav.
  const nav = isMobile(page)
    ? page.getByRole('navigation', { name: 'Sections' })
    : page.getByRole('complementary', { name: 'Datapad' });
  await expect(
    nav.getByRole('link', { name: /^Meetings/ }).first(),
  ).toHaveAttribute('aria-current', 'page');

  await expect(
    main.getByRole('link', { name: 'Echo Base relocation' }),
  ).toBeVisible();
  const details = main.getByRole('list', { name: 'Details' });
  await expect(details).toContainText(
    `${formatDay(today, today)} · 14:00–15:00`,
  );
  await expect(details).toContainText('Leia Organa');
  await expect(details).toContainText('Han Solo');
  await expect(
    details.getByRole('link', { name: /Join or open/ }),
  ).toHaveAttribute('href', 'https://example.com/meet/shield');
  await expect(main).toContainText('Power budget and the north ridge.');

  await expect(
    main
      .getByRole('list', { name: 'Topics for “Shield review”' })
      .locator('[data-topic-title]'),
  ).toHaveText(['Power budget', 'North ridge', 'Probe droid sightings']);
  await expect(
    main.getByRole('region', { name: 'Notes', exact: true }),
  ).toContainText('Bring the power budget');

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Back returns to the list.
  await page.goBack();
  await expect(page).toHaveURL(/\/meetings$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Meetings' }),
  ).toBeVisible();
});

test('previous and next in the series, and Carry forward', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings/e-1');
  const series = page.getByRole('navigation', { name: 'This series' });
  await expect(series.getByRole('link', { name: /^Previous/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Carry forward' }).click();
  await expect(
    page.getByText(`Carried 2 topics to ${formatDay(nextWeek, today)}`),
  ).toBeVisible();
  await expect(
    page.getByRole('main').locator('[data-topic-outcome]'),
  ).toHaveText(['Approved', 'Carried forward', 'Carried forward']);
  // Nothing left to carry.
  await expect(page.getByRole('button', { name: 'Carry forward' })).toHaveCount(
    0,
  );

  await series
    .getByRole('link', { name: `Next: ${formatDay(nextWeek, today)}` })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-5$/);
  const main = page.getByRole('main');
  await expect(
    main
      .getByRole('list', { name: 'Topics for “Shield review”' })
      .locator('[data-topic-title]'),
  ).toHaveText(['North ridge', 'Probe droid sightings']);
  await expect(main.locator('[data-topic-carried]')).toHaveText([
    `carried forward from ${formatDay(today, today)}`,
    `carried forward from ${formatDay(today, today)}`,
  ]);
  await expectNoSidewaysScroll(page);

  await series
    .getByRole('link', { name: `Previous: ${formatDay(today, today)}` })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-1$/);

  await expectSaved(page);
  expect(
    (await stored(request)).meetings['e-5']?.topics?.map((t) => t.title),
  ).toEqual(['North ridge', 'Probe droid sightings']);
});

test('Edit opens the panel; Delete asks, keeps the notes, goes to Meetings', async ({
  page,
  request,
}) => {
  await openLive(page, '/meetings/e-1');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit Shield review' });
  await form.getByLabel('Title').fill('Shield and ridge review');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Shield and ridge review' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Shield and ridge review · Datapad');

  // The header's (each note has a Delete too).
  await page
    .getByRole('button', { name: 'Delete', exact: true })
    .first()
    .click();
  const ask = page.getByRole('alertdialog');
  await expect(ask).toContainText('Its note is kept.');
  await expect(ask.getByRole('button', { name: 'Keep it' })).toBeFocused();
  await ask.getByRole('button', { name: 'Delete meeting' }).click();
  await expect(page).toHaveURL(/\/meetings$/);
  await expect(
    page.getByText('Deleted “Shield and ridge review”'),
  ).toBeVisible();

  await expectSaved(page);
  const data = await stored(request);
  expect(data.meetings['e-1']).toBeUndefined();
  expect(data.notes['n-2']).toBeDefined();
});

test('a meeting that is not there says so', async ({ page }) => {
  await openLive(page, '/meetings/nope');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Not found' }),
  ).toBeVisible();
  await expect(page.getByText('There is no meeting here.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to Meetings' }).click();
  await expect(page).toHaveURL(/\/meetings$/);
});

test('search opens a meeting’s page', async ({ page }) => {
  await openLive(page, '/');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Medal');
  await page
    .getByRole('group', { name: 'Meetings' })
    .getByRole('option', { name: /Medal ceremony/ })
    .click();
  await expect(page).toHaveURL(/\/meetings\/e-3$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Medal ceremony' }),
  ).toBeVisible();
});
