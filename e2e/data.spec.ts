import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, SEED, test } from './fixtures';

async function importFile(page: Page, name: string, contents: unknown) {
  await page.goto('/settings/data');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import…' }).click();
  await (await chooser).setFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    ),
  });
}

test('import the seed, confirm, and see it everywhere', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-status]').first()).toHaveAttribute(
    'data-status',
    'live',
  );
  await importFile(page, 'ledger-2026-10-23.json', SEED);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(
    'Import 3 projects, 7 tasks, 4 notes, 4 events, 4 people; same ids are replaced',
  );
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Imported 3 projects/)).toBeVisible();
  await expect(page.getByText('You have 3 projects, 7 tasks')).toBeVisible();
  // Archived projects and their tasks stay out of Focus.
  await page
    .getByRole('link', { name: /^Focus/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByText('2 projects · 5 open tasks')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Open tasks' })).toContainText(
    'Confirm shield generator delivery',
  );
});

test('a malformed file is refused with its first problem, and nothing is written', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-status]').first()).toHaveAttribute(
    'data-status',
    'live',
  );
  const broken = {
    ...SEED,
    tasks: { ...SEED.tasks, 't-2': { ...SEED.tasks['t-2'], due: 'soon' } },
  };
  await importFile(page, 'broken.json', broken);
  await expect(
    page.getByText(
      'Not imported. tasks › t-2 › due: Due: Use a date like 2026-10-31',
    ),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();

  await importFile(page, 'notes.txt', 'not json at all');
  await expect(page.getByText('notes.txt is not JSON')).toBeVisible();

  const stored = await (await request.get('/api/export.json')).json();
  expect(stored.tasks).toEqual({});
});

test('export downloads every document as datapad-<date>.json', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await page.goto('/');
  await expect(page.getByText('2 projects · 5 open tasks')).toBeVisible();
  await page.goto('/settings/data');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^datapad-\d{4}-\d{2}-\d{2}\.json$/);
  const saved = JSON.parse(await readFile(await file.path(), 'utf8'));
  const { exportedAt, ...documents } = saved;
  const { exportedAt: _, ...seed } = SEED;
  expect(Date.parse(exportedAt)).not.toBeNaN();
  expect(documents).toEqual({ ...seed, settings: {} });
});
