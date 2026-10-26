import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectSaved,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * On-device summaries. Loading the real model would download a gigabyte or
 * so, so only the opt-in and unsupported states use the real WebLLM path
 * (and the fixtures abort anything that leaves localhost regardless). The
 * rest swap in the e2e build's scripted model (`summary-runtime.ts`).
 */

interface Stored {
  notes: Record<
    string,
    { body: string; projectId: string | null; meetingId: string | null }
  >;
  activity: Record<string, { events: { text: string }[] }>;
}

async function stored(request: APIRequestContext): Promise<Stored> {
  return (await request.get('/api/export.json')).json();
}

/** Every request that tried to leave localhost. */
function outbound(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') {
      urls.push(request.url());
    }
  });
  return urls;
}

/** The scripted model: these chunks, this far apart. */
async function fakeModel(page: Page, chunks: string[], delayMs = 20) {
  await page.addInitScript(
    ([chunks, delayMs]) => {
      (window as { __datapadFakeModel?: unknown }).__datapadFakeModel = {
        chunks,
        delayMs,
      };
    },
    [chunks, delayMs] as const,
  );
}

function panel(page: Page, item: string) {
  return page.getByRole('dialog', { name: `Summary · ${item}` });
}

async function summarizeProject(page: Page) {
  await openLive(page, '/projects/p-echo');
  await page.getByRole('button', { name: 'Summarize', exact: true }).click();
  return panel(page, 'Echo Base relocation');
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('asks before downloading anything, and sends nothing', async ({
  page,
}) => {
  // Headless Chromium may have no WebGPU; pretend it does, so the real
  // consent step shows.
  await page.addInitScript(() => {
    if (!('gpu' in navigator)) {
      Object.defineProperty(Navigator.prototype, 'gpu', {
        value: {},
        configurable: true,
      });
    }
  });
  const left = outbound(page);
  const dialog = await summarizeProject(page);

  await expect(dialog.getByRole('radio')).toHaveCount(3);
  await expect(
    dialog.getByRole('radio', { name: /Qwen3 1\.7B/ }),
  ).toBeChecked();
  await expect(
    dialog.getByRole('button', { name: 'Download Qwen3 1.7B and summarize' }),
  ).toBeVisible();
  await expect(dialog).toContainText('It sees the download, never your data.');
  await expectAccessible(page);
  expect(left).toEqual([]);
});

test('says so when the browser has no WebGPU, and never loads', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as { gpu?: unknown }).gpu;
  });
  const left = outbound(page);
  const dialog = await summarizeProject(page);
  await expect(dialog).toContainText(
    'Summaries are not supported in this browser.',
  );
  await expect(dialog.getByRole('button', { name: /^Download/ })).toHaveCount(
    0,
  );
  expect(left).toEqual([]);
});

test('streams a summary, copies it and saves it as a note', async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeModel(page, [
    'The relocation is on track. ',
    '\n\n- Shields due soon\n',
    '- Ask @Leia Organa',
  ]);
  const dialog = await summarizeProject(page);

  await dialog
    .getByRole('button', { name: 'Download Qwen3 1.7B and summarize' })
    .click();
  await expect(dialog.getByText('Shields due soon')).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('Done.');
  await expect(dialog.getByRole('button', { name: 'Stop' })).toBeDisabled();

  await dialog.getByRole('button', { name: 'Copy' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'The relocation is on track.',
  );

  await dialog.getByRole('button', { name: 'Save as note' }).click();
  await expect(dialog.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expectSaved(page);
  const data = await stored(request);
  const note = Object.values(data.notes).find((n) =>
    n.body.startsWith('Summary of Echo Base relocation'),
  );
  expect(note?.projectId).toBe('p-echo');
  expect(note?.body).toContain('- Shields due soon');
  // The name went back to a mention token.
  expect(note?.body).toMatch(/Ask @\{[^}]+\}/);
  expect(data.activity['p-echo']?.events[0]?.text).toBe(
    'Saved a summary as a note',
  );

  // The model stays loaded: the next summary starts at once.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Summarize note' }).first().click();
  const second = page.getByRole('dialog', { name: /^Summary · note of / });
  await expect(second.getByText('Shields due soon')).toBeVisible();
});

test('Stop keeps what was written and says Stopped.', async ({ page }) => {
  await fakeModel(
    page,
    ['First words. ', ...Array.from({ length: 50 }, (_, i) => `more ${i} `)],
    150,
  );
  const dialog = await summarizeProject(page);
  await dialog
    .getByRole('button', { name: 'Download Qwen3 1.7B and summarize' })
    .click();
  await expect(dialog.getByText('First words.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop' }).click();
  await expect(dialog.getByText('Stopped.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('First words.')).toBeVisible();
  await expect(dialog).not.toContainText('more 40');
  await expect(
    dialog.getByRole('button', { name: 'Save as note' }),
  ).toBeEnabled();
});

test('an event summary saves as a note linked to the event', async ({
  page,
  request,
}) => {
  await fakeModel(page, ['Review went fine.']);
  await openLive(page, '/events?view=list');
  const title = 'Shield review';
  await page
    .locator('[data-event-id]')
    .filter({ hasText: title })
    .first()
    .getByRole('button', { name: `More for “${title}”` })
    .click();
  await page.getByRole('menuitem', { name: 'Summarize' }).click();
  const dialog = panel(page, title);
  await dialog
    .getByRole('button', { name: 'Download Qwen3 1.7B and summarize' })
    .click();
  await expect(dialog.getByText('Review went fine.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save as note' }).click();
  await expectSaved(page);
  const note = Object.values((await stored(request)).notes).find((n) =>
    n.body.startsWith('Summary of Shield review'),
  );
  expect(note).toMatchObject({ projectId: 'p-echo', meetingId: 'e-1' });
});

test('Settings picks the model and removes the download', async ({ page }) => {
  await fakeModel(page, ['ok']);
  await openLive(page, '/settings/summaries');
  await expect(
    page.getByRole('status').filter({ hasText: 'not downloaded' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove downloaded model' }),
  ).toBeDisabled();
  await page.getByText('Qwen3 4B', { exact: true }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: /Qwen3 4B/ })).toBeChecked();
  await expectAccessible(page);
});
