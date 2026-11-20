import type { APIRequestContext, Page } from '@playwright/test';
import { addDays, longDay } from '../shared/dates';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  openLive,
  SEED,
  test,
  today,
} from './fixtures';

/**
 * Today (#331): the day as a timeline, what is due, Next up, the Scratch
 * card and the three lanes of open loops. The seed has Leia Organa marked
 * as me, today's Shield review (2–3 PM), her shield generator (3 days
 * late), the tauntaun vet and the docking permit (no one's), Chewbacca's
 * hangar doors and Han's motivator (waiting on them).
 */

const lane = (page: Page, name: string) =>
  page
    .getByRole('complementary', { name: 'Open loops' })
    .getByRole('list', { name });
const laneButton = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}`) });
const timeline = (page: Page) => page.getByRole('list', { name: 'Timeline' });

interface Stored {
  settings: { user?: { pages?: Record<string, unknown> } };
}

async function expectStored(request: APIRequestContext, expected: unknown) {
  await expect
    .poll(async () => {
      const file = (await (
        await request.get('/api/export.json')
      ).json()) as Stored;
      return file.settings.user?.pages?.focus ?? null;
    })
    .toEqual(expected);
}

/** The seed with an untimed meeting today: always Next up. */
function withStandup() {
  const s = structuredClone(SEED);
  (s.meetings as Record<string, unknown>)['e-standup'] = {
    id: 'e-standup',
    projectId: 'p-echo',
    title: 'Hangar standup',
    date: today(),
    time: '',
    end: '',
    attendees: ['u-han'],
    link: '',
    note: '',
    createdAt: s.meetings['e-1']?.createdAt,
    updatedAt: s.meetings['e-1']?.updatedAt,
  };
  return s;
}

test('Today: the day, Next up, what is due, the timeline and the loops', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: withStandup() });
  await openLive(page);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    longDay(today(), today()),
  );
  await expect(page.locator('[data-day-line]')).toHaveText(
    '2 meetings, 1 due, 2 waiting on others, 0 to decide',
  );

  // Next up: the untimed standup, which never ends today.
  const next = page.getByRole('region', { name: 'Next up' });
  await expect(next).toContainText('Hangar standup');
  await expect(next).toContainText('Today, All day · Echo Base relocation');
  await expect(
    next.getByRole('link', { name: 'Enter meeting' }),
  ).toHaveAttribute('href', '/meetings/e-standup');

  // Due today or late: Leia's shield generator, 3 days late.
  await expect(
    page.getByRole('list', { name: 'Due', exact: true }),
  ).toContainText('Confirm shield generator delivery');

  // The timeline: the untimed meeting first, then the Shield review.
  const meetings = timeline(page).locator('[data-entry="meeting"]');
  await expect(meetings).toHaveCount(2);
  await expect(meetings.nth(0)).toContainText('All day');
  await expect(meetings.nth(0)).toContainText('Hangar standup');
  await expect(meetings.nth(1)).toContainText('Shield review');
  await expect(timeline(page).locator('[data-now]')).toHaveCount(1);

  // The lanes: mine (and no one's), waiting by person, nothing to decide.
  await expect(lane(page, 'Mine').getByRole('listitem')).toHaveText([
    /Confirm shield generator delivery/,
    /Book the tauntaun vet/,
    /Renew the docking permit/,
  ]);
  await expect(
    lane(page, 'Waiting on Chewbacca').getByRole('listitem'),
  ).toHaveText([/Insulate the hangar doors/]);
  await expect(
    lane(page, 'Waiting on Han Solo').getByRole('listitem'),
  ).toHaveText([/Find a replacement motivator/]);
  await expect(page.getByText('Nothing to decide.')).toBeVisible();
  await expect(page.locator('[data-scratch-card]')).toHaveAttribute(
    'href',
    '/scratch',
  );

  // A loop's room and person link to their rooms.
  await expect(
    lane(page, 'Mine')
      .getByRole('listitem')
      .first()
      .getByRole('link', { name: 'Echo Base relocation' }),
  ).toHaveAttribute('href', '/projects/p-echo');

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // A row opens the task panel.
  await lane(page, 'Mine')
    .getByRole('button', { name: 'Book the tauntaun vet' })
    .click();
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Title' }),
  ).toHaveValue('Book the tauntaun vet');
});

test('Today shows no Scratch card while Scratch is empty', async ({ page }) => {
  await openLive(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    longDay(today(), today()),
  );
  await expect(page.locator('[data-scratch-card]')).toHaveCount(0);
});

test('a save that moves a loop to another lane keeps focus on it', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page);
  await lane(page, 'Mine')
    .getByRole('button', { name: 'Book the tauntaun vet' })
    .click();
  const panel = page.getByRole('dialog', { name: 'Task' });
  const who = panel.getByRole('combobox', { name: 'Assignee' });
  await who.click();
  await who.fill('han');
  await page.getByRole('option', { name: /^Han Solo/ }).click();
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  // Assigned to Han, it waits on him now: focus follows it there.
  await expect(
    lane(page, 'Waiting on Han Solo').getByRole('button', {
      name: 'Book the tauntaun vet',
    }),
  ).toBeFocused();
});

test('step through the days and back to today', async ({ page, request }) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page);
  const title = page.getByRole('heading', { level: 1 });

  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(title).toHaveText(longDay(addDays(today(), 1), today()));
  await expect(page.getByText('Looking ahead')).toBeVisible();
  await expect(page.locator('[data-timeline-empty]')).toHaveText(
    'Nothing on this day.',
  );
  await expect(page.getByRole('region', { name: 'Next up' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(title).toHaveText(longDay(addDays(today(), -1), today()));
  await expect(page.getByText('Looking back')).toBeVisible();
  await expect(timeline(page).locator('[data-now]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(title).toHaveText(longDay(today(), today()));
  await expect(
    timeline(page).locator('[data-entry="meeting"]').filter({
      hasText: 'Shield review',
    }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('closing a loop moves it out at once; Undo brings it back', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page);
  const mine = lane(page, 'Mine');
  await expect(mine.getByRole('listitem')).toHaveCount(3);

  await mine
    .locator('label')
    .filter({
      has: page.getByRole('checkbox', {
        name: 'Close “Book the tauntaun vet”',
      }),
    })
    .click();
  await expect(mine.getByRole('listitem')).toHaveCount(2);
  await expect(mine).not.toContainText('Book the tauntaun vet');
  await expect(laneButton(page, 'Mine')).toContainText('2');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(mine.getByRole('listitem')).toHaveCount(3);
  await expect(mine).toContainText('Book the tauntaun vet');
});

test('Settings → Today: what Mine shows, and the lanes hidden and moved', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/settings/today');
  await expect(page).toHaveTitle('Today · Settings · Datapad');
  await page.getByRole('combobox', { name: 'Mine shows' }).click();
  await page.getByRole('option', { name: 'Only assigned to me' }).click();
  const editor = page.getByRole('list', { name: 'Today lanes' });
  await editor.getByRole('switch', { name: 'Show Waiting on' }).click();
  await editor.getByRole('button', { name: 'Move To decide up' }).click();
  await expectStored(request, {
    filters: { who: 'mine' },
    hidden: ['waiting'],
    order: ['mine', 'decide', 'waiting'],
  });
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  await openLive(page);
  // Only Leia's own: the no one's tasks are left out.
  await expect(lane(page, 'Mine').getByRole('listitem')).toHaveText([
    /Confirm shield generator delivery/,
  ]);
  await expect(laneButton(page, 'Waiting on')).toHaveCount(0);
  await expect(laneButton(page, 'To decide')).toBeVisible();
});

test('Settings → Today starts the week on Sunday; Reset puts Monday back, with Undo (#343)', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/today');
  const start = page.getByRole('group', { name: 'Week starts on' });
  await expect(start.getByRole('radio', { name: 'Monday' })).toBeChecked();
  await start
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Sunday' }) })
    .click();
  await expect(start.getByRole('radio', { name: 'Sunday' })).toBeChecked();
  await expectStored(request, { filters: { weekStart: 'sun' } });

  await openLive(page, '/?view=week');
  const first = page
    .getByRole('list', { name: 'Week' })
    .locator('[data-week-day]')
    .first();
  await expect(first.getByRole('button')).toContainText('Sun');

  await openLive(page, '/settings/today');
  const reset = page.getByRole('button', { name: 'Reset to defaults' });
  await reset.click();
  await expect(start.getByRole('radio', { name: 'Monday' })).toBeChecked();
  await expect(reset).toBeDisabled();
  await expectStored(request, null);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(start.getByRole('radio', { name: 'Sunday' })).toBeChecked();
  await expectStored(request, { filters: { weekStart: 'sun' } });
  await expectAccessible(page);
});

test('Today lists the open high-priority tasks not already due', async ({
  page,
  request,
}) => {
  const s = structuredClone(SEED);
  const tasks = s.tasks as Record<string, Record<string, unknown>>;
  tasks['t-high'] = {
    ...tasks['t-1'],
    id: 't-high',
    title: 'Reroute power to the deflector',
    due: '',
    links: [],
  };
  await request.post('/api/import', { data: s });
  await openLive(page);

  const high = page.getByRole('list', { name: 'High priority' });
  await expect(high.getByRole('listitem')).toHaveCount(1);
  await expect(high).toContainText('Reroute power to the deflector');
  // The late shield generator is high too, but shows once, under Due.
  await expect(high).not.toContainText('Confirm shield generator delivery');
  await expect(
    page.getByRole('list', { name: 'Due', exact: true }),
  ).toContainText('Confirm shield generator delivery');

  // Only on today.
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(high).toBeHidden();
  await expectAccessible(page);
});
