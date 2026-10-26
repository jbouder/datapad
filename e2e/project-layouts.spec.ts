import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

const pick = async (page: Page, name: string) => {
  const group = page.getByRole('group', { name: 'Layout (press v to cycle)' });
  await group
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .click();
  await expect(group.getByRole('radio', { name })).toBeChecked();
};

const MORE = {
  'p-hoth': {
    ...SEED.projects['p-echo'],
    id: 'p-hoth',
    name: 'Hoth comms array',
    targetDate: '2026-11-02',
    priority: 'low',
    milestones: [],
  },
};

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', {
    data: { ...SEED, projects: { ...SEED.projects, ...MORE } },
  });
});

test('switch to Table and sort by target date; the sort is shared with Cards', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'The table is the desktop layout.');
  await openLive(page, '/projects?status=all');
  await pick(page, 'Table');
  await expect(page).toHaveURL(/view=table/);
  const table = page.getByRole('table', { name: 'Projects' });
  const target = table.getByRole('columnheader', { name: /Target/ });
  await target.getByRole('button').click();
  await expect(page).toHaveURL(/sort=target/);
  await expect(target).toHaveAttribute('aria-sort', 'ascending');
  // Soonest first, undated last.
  await expect(table.locator('tbody tr td:nth-child(1)')).toHaveText([
    'Hoth comms array',
    'Echo Base relocation',
    'Falcon hyperdrive refit',
  ]);
  await pick(page, 'Cards');
  await expect(
    page.getByRole('list', { name: 'Projects' }).getByRole('link'),
  ).toHaveText([
    /Hoth comms array/,
    /Echo Base relocation/,
    /Falcon hyperdrive refit/,
  ]);

  // Inline status change from the table.
  await pick(page, 'Table');
  await table.getByRole('button', { name: 'Status: Paused, change' }).click();
  await page.getByRole('menuitemradio', { name: 'Active' }).click();
  await expectSaved(page);
  const data = await (await request.get('/api/export.json')).json();
  expect(data.projects['p-falcon'].status).toBe('active');
});

test('open a project from a milestone on the timeline', async ({ page }) => {
  await openLive(page, '/projects?view=timeline');
  await page.locator('button[data-label^="Base operational"]').click();
  await expect(page).toHaveURL(/\/projects\/p-echo\?milestone=e-2$/);
});

test('the archive has the same layouts', async ({ page }) => {
  await openLive(page, '/archive?view=timeline');
  await expect(
    page.getByRole('list', { name: 'Archived projects, as a list' }),
  ).toContainText('Yavin IV retrospective');
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ theme, reducedMotion: 'reduce' });
    for (const view of ['cards', 'table', 'timeline']) {
      test(`${view} is axe clean`, async ({ page }) => {
        await openLive(page, `/projects?status=all&view=${view}`);
        await expectAccessible(page);
      });
    }
  });
}
