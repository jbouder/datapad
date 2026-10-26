import { addDays, localDate } from '../shared/dates';
import { expect, expectAccessible, openLive, SEED, test } from './fixtures';

/** A week of activity, a few days back from today, on the seed. */
function seeded() {
  const seed = structuredClone(SEED) as typeof SEED & {
    decisions: Record<string, unknown>;
  };
  const today = localDate(new Date());
  const at = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(10, 0, 0, 0);
    return d.toISOString();
  };
  // Everything in the seed happened long ago, unless set below.
  for (const t of Object.values(seed.tasks)) {
    Object.assign(t, { createdAt: at(60), updatedAt: at(60) });
  }
  for (const key of Object.keys(seed.activity)) {
    (seed.activity as Record<string, unknown>)[key] = { events: [] };
  }
  for (const e of Object.values(seed.meetings)) {
    (e as { date: string }).date = addDays(today, -60);
  }
  Object.assign(seed.tasks['t-1'], {
    status: 'done',
    completedAt: at(1),
    createdAt: at(30),
  });
  Object.assign(seed.tasks['t-2'], {
    status: 'done',
    completedAt: at(2),
    createdAt: at(30),
  });
  Object.assign(seed.tasks['t-3'], { createdAt: at(3) });
  // A close from last month stays out.
  Object.assign(seed.tasks['t-5'], { status: 'done', completedAt: at(40) });
  for (const n of Object.values(seed.notes)) {
    (n as { createdAt: string }).createdAt = at(60);
  }
  seed.notes['n-1'].createdAt = at(2);
  seed.decisions = {
    d1: {
      id: 'd1',
      projectId: 'p-echo',
      title: 'Move the base to Hoth',
      status: 'decided',
      decidedAt: addDays(today, -1),
      createdAt: at(10),
      updatedAt: at(1),
    },
  };
  seed.activity['p-echo'] = {
    events: [
      { t: at(1), text: 'Health set to red' },
      { t: at(50), text: 'Status changed to paused' },
    ],
  };
  return seed;
}

test('the last seven days, per project, copied as Markdown', async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await request.post('/api/import', { data: seeded() });
  await openLive(page, '/digest');
  const digest = page.getByRole('region', { name: 'Digest', exact: true });
  await expect(digest).toContainText(
    '2 tasks closed, 1 added, 1 note, 1 decision.',
  );
  const echo = page.getByRole('heading', { name: 'Echo Base relocation' });
  await expect(echo).toBeVisible();
  await expect(digest).toContainText('Health set to red');
  await expect(digest).toContainText('Decided: Move the base to Hoth');
  await expect(digest).not.toContainText('Status changed to paused');
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Copy as Markdown' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^## Week of /);
  expect(copied).toContain('### Echo Base relocation');

  // A week further back: the old close is not in it, and Next comes back.
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(page).toHaveURL(/\?to=\d{4}-\d{2}-\d{2}$/);
  await expect(digest).not.toContainText('Move the base to Hoth');
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page).toHaveURL(/\/digest$/);
  await expect(page.getByRole('button', { name: 'Next week' })).toBeDisabled();
});

test('Save as note keeps it in General', async ({ page, request }) => {
  await request.post('/api/import', { data: seeded() });
  await openLive(page, '/digest');
  await page.getByRole('button', { name: 'Save as note' }).click();
  await expect(
    page.getByText('Saved the digest as a note in General'),
  ).toBeVisible();
  const data = await (await request.get('/api/export.json')).json();
  const notes = Object.values(
    data.notes as Record<string, { body: string; projectId: string | null }>,
  );
  expect(
    notes.find((n) => n.body.startsWith('## Week of '))?.projectId,
  ).toBeNull();
});
