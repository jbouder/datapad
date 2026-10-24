import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  openLive,
  SEED,
  SEED_COUNTS,
  test,
} from './fixtures';

/**
 * Settings → Data → Backups against the local R2 bucket. Opening the app
 * is the "next request" after a missed night, so the first connection
 * writes today's backup.
 */

test('lists the backup, then counts, confirms and restores it', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/');
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/backups')).json()).backups.length,
    )
    .toBe(1);

  await openLive(page, '/settings/data');
  const list = page.getByRole('list', { name: 'Backups' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText(/Every night at 3:00 AM E[SD]T/)).toBeVisible();
  await expect(
    list.getByRole('link', { name: /^Download the backup of / }),
  ).toHaveAttribute('href', /^\/api\/backups\/\d{4}-\d{2}-\d{2}\.json$/);
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  await list.getByRole('button', { name: /^Restore the backup of / }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`${SEED_COUNTS.projects} projects`);
  await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Restored /)).toBeVisible();
});

test('says so when there are none yet', async ({ page }) => {
  await openLive(page, '/settings/data');
  await expect(
    page.getByText('No backups yet. The first one runs tonight.'),
  ).toBeVisible();
});
