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
    page.getByText(/^Last backup: (just now|\d+ min ago)\.$/),
  ).toBeVisible();
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

test('a failed backup, and an overdue one, show in warn', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 60 * 60_000).toISOString();
  const day = (at: string) => at.slice(0, 10);
  // What the object answers after nights that went wrong: an R2 outage
  // cannot be staged against the local bucket, so the list is routed.
  let list: object = {};
  await page.route('**/api/backups', (route) => route.fulfill({ json: list }));
  const old = hoursAgo(80);
  list = {
    backups: [{ day: day(old), bytes: 2048, at: old }],
    hour: 3,
    timeZone: 'America/New_York',
    // Minutes, not hours: "2 h ago" is "yesterday" just after midnight.
    failedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  };
  await openLive(page, '/settings/data');
  const failed = page.getByText(
    /^Last backup: .+\. The latest attempt failed 2 min ago and is retried on its own\.$/,
  );
  await expect(failed).toBeVisible();
  await expect(failed).toHaveClass(/text-warn/);
  await expectAccessible(page);

  // No failure on record, but nothing for three days: still worth a look.
  list = { ...list, failedAt: undefined };
  await page.reload();
  const overdue = page.getByText(/^Last backup: [^.]+\.$/);
  await expect(overdue).toBeVisible();
  await expect(overdue).toHaveClass(/text-warn/);
});
