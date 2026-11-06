import type { APIRequestContext, Page } from '@playwright/test';
import { addDays } from '../shared/dates';
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
 * The project page's Show past (#320): a toggle in the Meetings header
 * puts the past meetings after the upcoming ones in one list, by month,
 * newest first, remembered with the page and set in Settings → Pages too.
 */

/** The seed, with Echo Base given one more upcoming and two past meetings. */
async function seed(request: APIRequestContext) {
  const shield = SEED.meetings['e-1'];
  const extra = (id: string, title: string, days: number) => ({
    ...shield,
    id,
    title,
    date: addDays(today(), days),
    topics: [],
  });
  await request.post('/api/import', {
    data: {
      ...SEED,
      meetings: {
        ...SEED.meetings,
        'e-next': extra('e-next', 'Evacuation plan', 40),
        'e-drill': extra('e-drill', 'Evacuation drill', -5),
        'e-old': extra('e-old', 'Ridge survey kickoff', -40),
      },
    },
  });
}

const meetings = (page: Page) =>
  page.getByRole('region', { name: /^Meetings/ }).first();
const showPast = (page: Page) =>
  meetings(page).getByRole('button', { name: 'Show past' });
/** The meeting titles in the Meetings section, top to bottom. */
const titles = (page: Page) =>
  meetings(page).locator('[data-meeting-id] a[href^="/meetings/"]');

/** Wait until the server has saved `expected` as the project page's. */
async function expectStored(request: APIRequestContext, expected: unknown) {
  await expect
    .poll(async () => {
      const file = await (await request.get('/api/export.json')).json();
      return file.settings.user?.pages?.project ?? null;
    })
    .toEqual(expected);
}

test('Show past puts past meetings after the upcoming ones, and is remembered', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/projects/p-echo');
  const toggle = showPast(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Off: upcoming only, and no Past disclosure inside Meetings.
  await expect(titles(page)).toHaveText(['Shield review', 'Evacuation plan']);
  await expect(
    meetings(page).getByRole('button', { name: /^Past/ }),
  ).toHaveCount(0);

  // On: one list, upcoming soonest first, then past newest first.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(titles(page)).toHaveText([
    'Shield review',
    'Evacuation plan',
    'Evacuation drill',
    'Ridge survey kickoff',
  ]);
  // Each past month under its own heading, after the upcoming ones.
  await expect(meetings(page).locator('[data-past-month]')).toHaveCount(2);
  await expect(
    meetings(page).getByRole('button', { name: /^Past/ }),
  ).toHaveCount(0);
  // The count stays the upcoming count.
  await expect(
    meetings(page).getByRole('heading', { level: 2 }).first(),
  ).toContainText('2');
  await expectStored(request, { filters: { past: 'show' } });
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // It survives a reload, and the address never carries it.
  await openLive(page, '/projects/p-echo');
  await expect(showPast(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(titles(page)).toHaveCount(4);
  expect(new URL(page.url()).search).toBe('');

  // Off again hides them.
  await showPast(page).click();
  await expect(showPast(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(titles(page)).toHaveText(['Shield review', 'Evacuation plan']);
  await expectStored(request, null);
});

test('Show past is in Settings → Pages; Meetings shows is gone', async ({
  page,
  request,
}) => {
  await seed(request);
  await openLive(page, '/settings/pages');
  const card = page.getByRole('region', { name: 'Project page', exact: true });
  await expect(card.getByRole('group', { name: 'Meetings shows' })).toHaveCount(
    0,
  );
  const group = card.getByRole('group', { name: 'Past meetings' });
  await expect(group.getByRole('radio', { name: 'Hide' })).toBeChecked();
  await group
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Show' }) })
    .click();
  await expect(group.getByRole('radio', { name: 'Show' })).toBeChecked();
  await expectStored(request, { filters: { past: 'show' } });

  await openLive(page, '/projects/p-echo');
  await expect(showPast(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(titles(page)).toHaveCount(4);
  await expectNoSidewaysScroll(page);
});

test('nothing coming up: the empty line, then the past ones with Show past', async ({
  page,
  request,
}) => {
  // Echo Base's one meeting moved into the past.
  const shield = SEED.meetings['e-1'];
  await request.post('/api/import', {
    data: {
      ...SEED,
      meetings: {
        ...SEED.meetings,
        'e-1': { ...shield, date: addDays(today(), -5) },
      },
    },
  });
  await openLive(page, '/projects/p-echo');
  const empty = meetings(page).getByText('Nothing coming up on this project.');
  await expect(empty).toBeVisible();
  await expect(titles(page)).toHaveCount(0);
  await showPast(page).click();
  await expect(empty).toBeVisible();
  await expect(titles(page)).toHaveText(['Shield review']);
});

test('a saved Meetings shows reads as Hide', async ({ page, request }) => {
  await seed(request);
  await request.post('/api/import', {
    data: {
      settings: {
        user: {
          defaultOrg: '',
          pages: { project: { filters: { meetings: 'upcoming' } } },
        },
      },
    },
  });
  await expectStored(request, { filters: { meetings: 'upcoming' } });
  await openLive(page, '/projects/p-echo');
  await expect(showPast(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(titles(page)).toHaveText(['Shield review', 'Evacuation plan']);
});
