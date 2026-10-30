import type { APIRequestContext } from '@playwright/test';
import {
  chooseFilter,
  expect,
  expectAccessible,
  expectSaved,
  openLive,
  SEED,
  test,
} from './fixtures';

interface Stored {
  projects: Record<string, { health?: string }>;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('set health in the header; the card says it in words and color', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const health = page.getByRole('group', { name: 'Health' });
  // Never set in the seed: it reads as None.
  await expect(health.getByRole('radio', { name: 'None' })).toBeChecked();
  await health.getByText('Red', { exact: true }).click();
  await expect(health.getByRole('radio', { name: 'Red' })).toBeChecked();
  await expectSaved(page);
  const data = await stored(request);
  expect(data.projects['p-echo']?.health).toBe('red');
  expect(data.activity['p-echo']?.events[0]?.text).toBe('Health set to red');

  await openLive(page, '/projects');
  const card = page
    .getByRole('main')
    .getByRole('link', { name: /Echo Base relocation/ });
  await expect(card).toContainText('Red health');
  await expectAccessible(page);

  // Filter: only Red.
  await chooseFilter(page, 'Health', 'Red');
  await expect(page).toHaveURL(/health=red/);
  await expect(
    page.getByRole('main').getByRole('link', { name: /Echo Base relocation/ }),
  ).toBeVisible();
  await chooseFilter(page, 'Health', 'Green');
  await expect(page.getByText('None match these filters.')).toBeVisible();
});

test('the project form sets health too', async ({ page, request }) => {
  await openLive(page, '/projects/p-falcon');
  await page.getByRole('button', { name: 'Edit' }).click();
  const panel = page.getByRole('dialog');
  await panel
    .getByRole('group', { name: 'Health' })
    .getByText('Yellow')
    .click();
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toBeHidden();
  await expectSaved(page);
  expect((await stored(request)).projects['p-falcon']?.health).toBe('yellow');
  await expect(
    page
      .getByRole('group', { name: 'Health' })
      .getByRole('radio', { name: 'Yellow' }),
  ).toBeChecked();
});
