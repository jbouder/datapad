import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectSaved,
  openLive,
  openNotes,
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

test('a failed download says why and can be tried again', async ({ page }) => {
  await page.addInitScript(() => {
    (window as { __datapadFakeModel?: unknown }).__datapadFakeModel = {
      chunks: ['Back on track.'],
      failLoad: 'Failed to fetch',
    };
  });
  const dialog = await summarizeProject(page);
  await dialog
    .getByRole('button', { name: 'Download Qwen3 1.7B and summarize' })
    .click();
  await expect(dialog).toContainText(
    'The download failed. Check the connection, or try another model.',
  );
  await expect(
    dialog.getByRole('button', { name: 'Pick another model' }),
  ).toBeVisible();
  await expectAccessible(page);

  // The connection is back: Try again loads and summarizes.
  await page.evaluate(() => {
    const fake = (window as { __datapadFakeModel?: { failLoad?: string } })
      .__datapadFakeModel;
    if (fake) delete fake.failLoad;
  });
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByText('Back on track.')).toBeVisible();
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

test('a meeting summary saves as a note linked to the meeting', async ({
  page,
  request,
}) => {
  await fakeModel(page, ['Review went fine.']);
  await openLive(page, '/meetings?view=list');
  const title = 'Shield review';
  await page
    .locator('[data-meeting-id]')
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

/**
 * Every place that offers Summarize, by name: how many it shows on each.
 * The task panel opens from the project page; a meeting row's is in its
 * More menu.
 */
async function summarizeOffers(page: Page): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const summarize = page.getByRole('button', {
    name: 'Summarize',
    exact: true,
  });

  await openLive(page, '/projects/p-echo');
  counts.project = await summarize.count();
  await page.locator('[data-task-id] [data-task-title]').first().click();
  const taskPanel = page.getByRole('dialog');
  await expect(taskPanel).toBeVisible();
  counts.taskPanel = await taskPanel
    .getByRole('button', { name: 'Summarize', exact: true })
    .count();
  await page.keyboard.press('Escape');

  await openLive(page, '/tasks/t-2');
  counts.taskPage = await summarize.count();

  await openLive(page, '/meetings/e-1');
  counts.meetingPage = await summarize.count();

  await openLive(page, '/meetings?view=list');
  await page
    .locator('[data-meeting-id]')
    .filter({ hasText: 'Shield review' })
    .first()
    .getByRole('button', { name: 'More for “Shield review”' })
    .click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  counts.meetingRow = await page
    .getByRole('menuitem', { name: 'Summarize' })
    .count();
  await page.keyboard.press('Escape');

  // List, with one note open as its full card.
  await openNotes(page, '', ['n-3']);
  await expect(
    page.getByRole('button', { name: 'Edit note' }).first(),
  ).toBeVisible();
  counts.notes = await page
    .getByRole('button', { name: 'Summarize note' })
    .count();

  await openLive(page, '/digest');
  counts.digest = await summarize.count();
  return counts;
}

test('Settings turns summaries off on this device, and back on', async ({
  page,
}) => {
  await fakeModel(page, ['ok']);
  const loaded = () =>
    page.evaluate(
      () =>
        (window as { __datapadFakeModel?: { cached?: boolean } })
          .__datapadFakeModel?.cached === true,
    );

  // On by default: every place offers it.
  const on = await summarizeOffers(page);
  for (const [where, count] of Object.entries(on)) {
    expect(count, where).toBeGreaterThan(0);
  }

  await openLive(page, '/settings/summaries');
  const toggle = page.getByRole('switch', { name: /Summaries/ });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('Off on this device')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Qwen3/ })).toHaveCount(0);
  await expectAccessible(page);

  // Remembered on this device; nothing offers Summarize; nothing loads.
  await page.reload();
  await expect(
    page.getByRole('switch', { name: /Summaries/ }),
  ).not.toBeChecked();
  const off = await summarizeOffers(page);
  for (const [where, count] of Object.entries(off)) {
    expect(count, where).toBe(0);
  }
  expect(await loaded()).toBe(false);

  // Help says how to turn them back on.
  await openLive(page, '/help');
  await expect(
    page.getByText('Turn the same switch back on to bring Summarize back.'),
  ).toBeVisible();

  // Back on: Summarize returns and works.
  await openLive(page, '/settings/summaries');
  await page.getByRole('switch', { name: /Summaries/ }).click();
  await expect(
    page.getByRole('radio', { name: /Qwen3/ }).first(),
  ).toBeAttached();
  const dialog = await summarizeProject(page);
  await dialog
    .getByRole('button', { name: 'Download Qwen3 1.7B and summarize' })
    .click();
  await expect(dialog.getByText('ok')).toBeVisible();
});
