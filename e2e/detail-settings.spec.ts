import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  openLive,
  recapSeed,
  test,
} from './fixtures';

/**
 * Meeting mode's settings (#313), set in Settings → Today since #343:
 * hide covered topics and done action items, and hide its sections.
 * `recapSeed()`'s Ridge patrol debrief (`e-7`) has 2 of 3 topics covered.
 */

interface Stored {
  settings: {
    user?: { pages?: Record<string, Record<string, unknown>> };
  };
}

async function stored(request: APIRequestContext, page: string) {
  const file = (await (await request.get('/api/export.json')).json()) as Stored;
  return file.settings.user?.pages?.[page] ?? null;
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: recapSeed() });
});

/** Pick `option` of the segmented `legend` in a group of Settings. */
async function choose(
  page: Page,
  card: string,
  legend: string,
  option: string,
) {
  const group = page
    .getByRole('region', { name: card })
    .getByRole('group', { name: legend });
  await group
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: option }) })
    .click();
  await expect(group.getByRole('radio', { name: option })).toBeChecked();
}

const topics = (page: Page) => page.getByRole('region', { name: /^Topics/ });

test('the meeting page hides covered topics as Settings says', async ({
  page,
  request,
}) => {
  await openLive(page, '/settings/today');
  const group = page.getByRole('region', { name: 'Meeting mode' });
  // Its sections keep meeting mode's own order: no moves.
  await expect(
    group.getByRole('list', { name: 'Meeting mode sections' }),
  ).toBeVisible();
  await expect(group.getByRole('button', { name: /^Move / })).toHaveCount(0);
  await choose(page, 'Meeting mode', 'Covered topics', 'Hide');
  await expect
    .poll(() => stored(request, 'meeting'))
    .toEqual({ filters: { covered: 'hide' } });
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  await page.goto('/meetings/e-7');
  const section = topics(page);
  // Only the uncovered one; the count still counts all three.
  await expect(section).toContainText('2 of 3 topics');
  await expect(
    section.getByRole('checkbox', { name: /^Covered:/ }),
  ).toHaveCount(1);
  await expect(section).not.toContainText('Probe droid');

  // Cover the last: it goes, and one line says they all are.
  const check = page.getByRole('checkbox', {
    name: 'Covered: “Wampa sightings”',
  });
  await section.locator('label', { has: check }).click();
  await expect(section).toContainText('All 3 topics covered');
  await expect(section.getByRole('checkbox')).toHaveCount(0);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // The meeting's panel shows them all.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const panel = page.getByRole('dialog', {
    name: 'Edit Ridge patrol debrief',
  });
  await expect(panel.getByRole('checkbox', { name: /^Covered:/ })).toHaveCount(
    3,
  );
});

test('meeting mode hides done action items and the series links', async ({
  page,
  request,
}) => {
  await request.post('/api/import', {
    data: {
      settings: {
        user: {
          defaultOrg: '',
          pages: {
            meeting: {
              filters: { doneActions: 'hide' },
              hidden: ['series'],
              order: ['notes', 'topics', 'actions', 'series'],
            },
          },
        },
      },
    },
  });
  await openLive(page, '/meetings/e-7');
  // Meeting mode keeps its own layout (#336): the saved order no longer
  // applies, but hiding does. No series links.
  for (const name of [/^Topics/, /^Notes$/, /^Action items/]) {
    await expect(
      page.getByRole('main').getByRole('heading', { level: 2, name }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole('navigation', { name: 'This series' }),
  ).toHaveCount(0);

  // Close its one action item: it goes, and the line says so.
  const actions = page.getByRole('region', { name: /^Action items/ });
  await expect(actions).toContainText('Map the ice caves');
  const close = page.getByRole('checkbox', {
    name: 'Close “Map the ice caves”',
  });
  await actions.locator('label', { has: close }).click();
  await expect(actions).toContainText('The one action item is done');
  await expect(actions).not.toContainText('Map the ice caves');
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
});
