import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectSaved,
  moreAction,
  moreActions,
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
 *
 * A room's Summarize (#339) writes in a card under its state line, and
 * meeting mode's in a card under its header; the task panel and a meeting
 * row keep the summary panel.
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

/** What the scripted model was last sent, as JSON. */
async function lastRequest(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify(
      (window as { __datapadFakeModel?: { lastRequest?: unknown } })
        .__datapadFakeModel?.lastRequest,
    ),
  );
}

function panel(page: Page, item: string) {
  return page.getByRole('dialog', { name: `Summary · ${item}` });
}

function card(page: Page, item: string) {
  return page.getByRole('region', { name: `Summary · ${item}` });
}

function summarizeButton(page: Page) {
  return page.getByRole('button', { name: 'Summarize', exact: true });
}

/** The project room's Summarize, and its card. */
async function summarizeProject(page: Page): Promise<Locator> {
  await openLive(page, '/projects/p-echo');
  await summarizeButton(page).click();
  return card(page, 'Echo Base relocation');
}

async function download(where: Locator) {
  await where
    .getByRole('button', { name: 'Download Qwen3 1.7B and summarize' })
    .click();
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
  const room = await summarizeProject(page);

  await expect(room.getByRole('radio')).toHaveCount(3);
  await expect(room.getByRole('radio', { name: /Qwen3 1\.7B/ })).toBeChecked();
  await expect(
    room.getByRole('button', { name: 'Download Qwen3 1.7B and summarize' }),
  ).toBeVisible();
  await expect(room).toContainText('It sees the download, never your data.');
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
  const room = await summarizeProject(page);
  await expect(room).toContainText(
    'Summaries are not supported in this browser.',
  );
  await expect(room.getByRole('button', { name: /^Download/ })).toHaveCount(0);
  expect(left).toEqual([]);
});

test('a project room’s summary sits under the state line and saves to the room', async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeModel(page, [
    'The relocation is on track. ',
    'Shields are due soon; ask @Leia Organa.',
  ]);
  const left = outbound(page);
  const room = await summarizeProject(page);
  // Under the header's state line, inside the header.
  await expect(page.locator('header').filter({ has: room })).toHaveCount(1);

  await download(room);
  await expect(room.getByText('The relocation is on track.')).toBeVisible();
  await expect(room.getByRole('status')).toHaveText('Done.');
  // It was shown what the room shows.
  const sent = await lastRequest(page);
  expect(sent).toContain('Project: Echo Base relocation');
  expect(sent).toContain('State: ');
  expect(sent).toContain('Mine (');
  expect(sent).toContain('The last 14 days, newest first');
  await expectAccessible(page);

  await room.getByRole('button', { name: 'Save as note' }).click();
  await expect(room.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expectSaved(page);
  const data = await stored(request);
  const note = Object.values(data.notes).find((n) =>
    n.body.startsWith('Summary of Echo Base relocation'),
  );
  expect(note?.projectId).toBe('p-echo');
  expect(note?.meetingId).toBeNull();
  // The name went back to a mention token.
  expect(note?.body).toMatch(/ask @\{[^}]+\}/);
  expect(data.activity['p-echo']?.events[0]?.text).toBe(
    'Saved a summary as a note',
  );

  await room.getByRole('button', { name: 'Dismiss the summary' }).click();
  await expect(page.locator('[data-summary]')).toHaveCount(0);

  // The model stays loaded: the task panel's summary starts at once.
  await page
    .getByRole('complementary', { name: 'Open loops' })
    .locator('[data-loop] [data-task-title]')
    .first()
    .click();
  const taskPanel = page.getByRole('dialog');
  await taskPanel
    .getByRole('button', { name: 'Summarize', exact: true })
    .click();
  const summary = page.getByRole('dialog', { name: /^Summary · / });
  await expect(summary.getByText('The relocation is on track.')).toBeVisible();
  await summary.getByRole('button', { name: 'Copy' }).click();
  await expect(summary.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'The relocation is on track.',
  );
  expect(left).toEqual([]);
});

test('a person room’s summary saves as a note that mentions them', async ({
  page,
  request,
}) => {
  await fakeModel(page, ['Han owes you the parts.']);
  await openLive(page, '/people/u-han');
  await summarizeButton(page).click();
  const room = card(page, 'Han Solo');
  await download(room);
  await expect(room.getByText('Han owes you the parts.')).toBeVisible();
  const sent = await lastRequest(page);
  expect(sent).toContain('Person: Han Solo');
  expect(sent).toContain('They owe you (');
  expect(sent).toContain('Topics to discuss (');

  await room.getByRole('button', { name: 'Save as note' }).click();
  await expectSaved(page);
  const note = Object.values((await stored(request)).notes).find((n) =>
    n.body.startsWith('Summary of @{u-han}'),
  );
  expect(note).toMatchObject({ projectId: null, meetingId: null });
  // It mentions them, so it is in their stream.
  await expect(
    page
      .getByRole('list', { name: 'Stream' })
      .locator('li[data-note-id]')
      .filter({ hasText: 'Summary of @Han Solo' }),
  ).toHaveCount(1);
});

test('a failed download says why and can be tried again', async ({ page }) => {
  await page.addInitScript(() => {
    (window as { __datapadFakeModel?: unknown }).__datapadFakeModel = {
      chunks: ['Back on track.'],
      failLoad: 'Failed to fetch',
    };
  });
  const room = await summarizeProject(page);
  await download(room);
  await expect(room).toContainText(
    'The download failed. Check the connection, or try another model.',
  );
  await expect(
    room.getByRole('button', { name: 'Pick another model' }),
  ).toBeVisible();
  await expectAccessible(page);

  // The connection is back: Try again loads and summarizes.
  await page.evaluate(() => {
    const fake = (window as { __datapadFakeModel?: { failLoad?: string } })
      .__datapadFakeModel;
    if (fake) delete fake.failLoad;
  });
  await room.getByRole('button', { name: 'Try again' }).click();
  await expect(room.getByText('Back on track.')).toBeVisible();
});

test('Stop keeps what was written and says Stopped.', async ({ page }) => {
  await fakeModel(
    page,
    ['First words. ', ...Array.from({ length: 50 }, (_, i) => `more ${i} `)],
    150,
  );
  const room = await summarizeProject(page);
  await download(room);
  await expect(room.getByText('First words.')).toBeVisible();
  await room.getByRole('button', { name: 'Stop' }).click();
  await expect(room.getByText('Stopped.', { exact: true })).toBeVisible();
  await expect(room.getByText('First words.')).toBeVisible();
  await expect(room).not.toContainText('more 40');
  await expect(
    room.getByRole('button', { name: 'Save as note' }),
  ).toBeEnabled();
  await expect(room.getByRole('button', { name: 'Regenerate' })).toBeEnabled();
});

test('meeting mode’s recap saves as a note on the meeting', async ({
  page,
  request,
}) => {
  await fakeModel(page, ['Review went fine.\n\n- Power budget approved']);
  await openLive(page, '/meetings/e-1');
  await moreAction(page, 'Summarize');
  const recap = card(page, 'Shield review');
  await download(recap);
  await expect(recap.getByText('Review went fine.')).toBeVisible();
  const sent = await lastRequest(page);
  expect(sent).toContain('short recap of one meeting');
  expect(sent).toContain('Meeting: Shield review');
  await expectAccessible(page);

  await recap.getByRole('button', { name: 'Save as note' }).click();
  await expectSaved(page);
  const data = await stored(request);
  const note = Object.values(data.notes).find((n) =>
    n.body.startsWith('Summary of Shield review'),
  );
  expect(note).toMatchObject({ projectId: 'p-echo', meetingId: 'e-1' });
  expect(data.activity['p-echo']?.events[0]?.text).toBe(
    'Saved a summary as a note',
  );
});

test('a meeting row’s summary still opens in the panel', async ({ page }) => {
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
  await download(dialog);
  await expect(dialog.getByText('Review went fine.')).toBeVisible();
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

test('a note offers no Summarize of its own', async ({ page }) => {
  await openNotes(page, '', ['n-3']);
  await page
    .locator('li[data-note-id="n-3"]')
    .getByRole('button', { name: /^More for note from / })
    .click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Summarize' })).toHaveCount(
    0,
  );
});

/**
 * Every place that offers Summarize, by name: how many it shows on each.
 * A room's is in its header; the task panel opens from a project room's
 * lanes; meeting mode's and a meeting row's are in their More menus.
 */
async function summarizeOffers(page: Page): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  const inMore = async () =>
    (await moreActions(page)).filter((n) => n === 'Summarize').length;

  await openLive(page, '/projects/p-echo');
  counts.projectRoom = await summarizeButton(page).count();
  await page
    .getByRole('complementary', { name: 'Open loops' })
    .locator('[data-loop] [data-task-title]')
    .first()
    .click();
  const taskPanel = page.getByRole('dialog');
  await expect(taskPanel).toBeVisible();
  counts.taskPanel = await taskPanel
    .getByRole('button', { name: 'Summarize', exact: true })
    .count();
  await page.keyboard.press('Escape');

  await openLive(page, '/people/u-han');
  counts.personRoom = await summarizeButton(page).count();

  await openLive(page, '/meetings/e-1');
  counts.meetingMode = await inMore();

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
  const room = await summarizeProject(page);
  await download(room);
  await expect(room.getByText('ok', { exact: true })).toBeVisible();
});
