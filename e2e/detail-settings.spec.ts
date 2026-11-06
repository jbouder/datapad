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
 * The meeting and list pages' settings (#313), set in Settings → Pages:
 * hide covered topics and done action items, hide and reorder the
 * meeting page's sections, and show a list's done items collapsed,
 * expanded or hidden. `recapSeed()`'s Ridge patrol debrief (`e-7`) has 2 of 3
 * topics covered; Evacuation checklist has one of four items done.
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

/** Pick `option` of the segmented `legend` in a page's Settings card. */
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
  await openLive(page, '/settings/pages');
  const card = page.getByRole('region', { name: 'Meeting page' });
  await expect(card.getByText('Defaults', { exact: true })).toBeVisible();
  await choose(page, 'Meeting page', 'Covered topics', 'Hide');
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

test('the meeting page hides done action items and orders its sections', async ({
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
  // Notes first, then Topics and Action items; no series links.
  await expect(
    page.getByRole('main').getByRole('heading', { level: 2 }),
  ).toHaveText([/^Notes/, /^Topics/, /^Action items/]);
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

test('the list page hides its done items, keeping the count', async ({
  page,
}) => {
  await openLive(page, '/settings/pages');
  await choose(page, 'List page', 'Done items', 'Hidden');

  await page.goto('/lists/l-evac');
  await expect(page.getByText('1 done', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Done \(/ })).toHaveCount(0);
  await expect(page.getByText('Charge the ion cannon')).toHaveCount(0);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Expanded: under Done (1), open.
  await page.goto('/settings/pages');
  await choose(page, 'List page', 'Done items', 'Expanded');
  await page.goto('/lists/l-evac');
  const done = page.getByRole('button', { name: /^Done \(1\)/ });
  await expect(done).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('checkbox', { name: 'Done: “Charge the ion cannon”' }),
  ).toBeChecked();
});
