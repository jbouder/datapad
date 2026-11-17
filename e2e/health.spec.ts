import type { APIRequestContext } from '@playwright/test';
import {
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

test('set health on the Plan; the card says it in words and color', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo/plan');
  const health = page.getByRole('group', { name: 'Health' });
  // Never set in the seed: it reads as None.
  await expect(health.getByRole('radio', { name: 'None' })).toBeChecked();
  await health.getByText('Red', { exact: true }).click();
  await expect(health.getByRole('radio', { name: 'Red' })).toBeChecked();
  await expectSaved(page);
  const data = await stored(request);
  expect(data.projects['p-echo']?.health).toBe('red');
  expect(data.activity['p-echo']?.events[0]?.text).toBe('Health set to red');

  // All's project row says it in words.
  await openLive(page, '/all?kind=project');
  await expect(
    page.getByRole('list', { name: 'Items' }).getByRole('listitem').filter({
      hasText: 'Echo Base relocation',
    }),
  ).toContainText('Red health');
  await expectAccessible(page);
});

test('the project form sets health too', async ({ page, request }) => {
  await openLive(page, '/projects/p-falcon/plan');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
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
