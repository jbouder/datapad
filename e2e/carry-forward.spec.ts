import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, formatDay } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

interface StoredTopic {
  id: string;
  title: string;
  done: boolean;
  outcome: string;
  carriedFrom?: string;
}

interface Stored {
  meetings: Record<
    string,
    { id: string; title: string; date: string; topics?: StoredTopic[] }
  >;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

const nextWeek = () => addDays(today(), 7);

const TOPICS = [
  { id: 't-power', title: 'Power budget', done: true, outcome: 'Approved' },
  { id: 't-ridge', title: 'North ridge', done: false, outcome: '' },
  { id: 't-probe', title: 'Probe droid sightings', done: false, outcome: '' },
];

/**
 * Shield review today (Leia and Han, on Echo Base) with three topics, one
 * covered. With `next`, the same meeting again next week, without topics.
 */
async function seed(request: APIRequestContext, next = false) {
  const data = structuredClone(SEED) as typeof SEED & {
    meetings: Record<string, unknown>;
  };
  const shield = data.meetings['e-1'] as (typeof SEED.meetings)['e-1'] & {
    topics?: unknown;
  };
  shield.date = today();
  shield.topics = TOPICS;
  if (next) {
    data.meetings['e-5'] = {
      ...shield,
      id: 'e-5',
      date: nextWeek(),
      topics: [],
    };
  }
  await request.post('/api/import', { data });
}

function meetingRow(page: Page, id: string) {
  return page.locator(`[data-meeting-id="${id}"]`);
}

test('a new meeting in the series carries the uncovered topics', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: 'Add meeting' }).click();
  const form = page.getByRole('dialog', { name: 'New meeting' });
  // Any case, any spacing; the attendees make it the same series.
  await form.getByLabel('Title').fill('  shield REVIEW ');
  await form.getByLabel('Date').fill('+7d');
  await form.getByLabel('Date').press('Tab');
  const carry = form.getByRole('checkbox', {
    name: `Carry forward 2 topics from ${formatDay(today(), today())}`,
  });
  await expect(carry).toHaveCount(0);
  await form.getByText('Leia Organa').click();
  await form.getByText('Han Solo').click();
  await expect(carry).toBeChecked();
  await expect(form).toContainText('North ridge · Probe droid sightings');
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  await form.getByRole('button', { name: 'Add topic' }).click();
  await form.getByRole('textbox', { name: 'Add a topic' }).fill('Hangar doors');
  await form.getByRole('textbox', { name: 'Add a topic' }).press('Enter');
  await form.getByRole('button', { name: 'Add meeting' }).click();
  await expect(form).toBeHidden();

  await expectSaved(page);
  const data = await stored(request);
  const added = Object.values(data.meetings).find(
    (m) => m.date === nextWeek() && m.id !== 'e-1',
  );
  expect(added?.topics?.map(({ id: _, ...t }) => t)).toEqual([
    {
      title: 'North ridge',
      done: false,
      outcome: '',
      carriedFrom: today(),
    },
    {
      title: 'Probe droid sightings',
      done: false,
      outcome: '',
      carriedFrom: today(),
    },
    { title: 'Hangar doors', done: false, outcome: '' },
  ]);
  // New ids; the earlier meeting is left as it was.
  expect(added?.topics?.some((t) => t.id.startsWith('t-'))).toBe(false);
  expect(data.meetings['e-1']?.topics).toEqual(TOPICS);
  expect(
    data.activity['p-echo']?.events.slice(0, 3).map((e) => e.text),
  ).toEqual([
    'Added topic "Hangar doors" to "shield REVIEW"',
    'Carried topic "Probe droid sightings" forward to "shield REVIEW"',
    'Carried topic "North ridge" forward to "shield REVIEW"',
  ]);

  // The carried ones say where they came from, on its page.
  await meetingRow(page, added?.id ?? '')
    .getByRole('link', { name: 'shield REVIEW', exact: true })
    .click();
  const list = page.getByRole('list', { name: 'Topics for “shield REVIEW”' });
  await expect(list.locator('[data-topic-carried]')).toHaveText([
    `carried forward from ${formatDay(today(), today())}`,
    `carried forward from ${formatDay(today(), today())}`,
  ]);
  await expectNoSidewaysScroll(page);
});

test('unchecked, a new meeting starts without them', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: 'Add meeting' }).click();
  const form = page.getByRole('dialog', { name: 'New meeting' });
  await form.getByLabel('Title').fill('Shield review');
  await form.getByLabel('Date').fill('+7d');
  await form.getByLabel('Date').press('Tab');
  await form.getByText('Leia Organa').click();
  await form.getByText('Han Solo').click();
  await form.getByRole('checkbox', { name: /^Carry forward 2 topics/ }).click();
  await form.getByRole('button', { name: 'Add meeting' }).click();
  await expect(form).toBeHidden();

  await expectSaved(page);
  const data = await stored(request);
  const added = Object.values(data.meetings).find(
    (m) => m.date === nextWeek() && m.id !== 'e-1',
  );
  expect(added).toBeDefined();
  expect(added?.topics ?? []).toEqual([]);
});

test('Carry forward moves them to the next meeting, and Undo takes it back', async ({
  page,
  request,
}) => {
  await seed(request, true);
  await openLive(page, '/meetings');
  const menu = () =>
    meetingRow(page, 'e-1')
      .getByRole('button', { name: 'More for “Shield review”' })
      .first();

  // The next one has nothing to carry on.
  await meetingRow(page, 'e-5')
    .getByRole('button', { name: 'More for “Shield review”' })
    .first()
    .click();
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Carry forward' }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');

  await menu().click();
  await page.getByRole('menuitem', { name: 'Carry forward' }).click();
  await expect(
    page.getByText(`Carried 2 topics to ${formatDay(nextWeek(), today())}`),
  ).toBeVisible();

  await expect(
    meetingRow(page, 'e-1').locator('[data-topic-count]'),
  ).toHaveText('3 of 3 topics');
  await expect(
    meetingRow(page, 'e-5').locator('[data-topic-count]'),
  ).toHaveText('0 of 2 topics');
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  await expectSaved(page);
  let data = await stored(request);
  expect(
    data.meetings['e-5']?.topics?.map((t) => [t.title, t.carriedFrom]),
  ).toEqual([
    ['North ridge', today()],
    ['Probe droid sightings', today()],
  ]);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(
    meetingRow(page, 'e-1').locator('[data-topic-count]'),
  ).toHaveText('1 of 3 topics');
  await expect(
    meetingRow(page, 'e-5').locator('[data-topic-count]'),
  ).toHaveCount(0);
  await expectSaved(page);
  data = await stored(request);
  expect(data.meetings['e-1']?.topics).toEqual(TOPICS);
  expect(data.meetings['e-5']?.topics).toEqual([]);

  // Carrying is offered again.
  await menu().click();
  await expect(
    page.getByRole('menuitem', { name: 'Carry forward' }),
  ).toBeVisible();
});
