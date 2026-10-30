import type { APIRequestContext, Page } from '@playwright/test';
import { BRIEF_PROMPT, briefLabel } from '../shared/summaries';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  openLive,
  recapSeed,
  test,
  today,
} from './fixtures';

/**
 * Focus's Brief me (#259) over `recapSeed()`, with the e2e build's
 * scripted model in place of WebLLM, as `summaries.spec.ts` does
 * (`summary-runtime.ts`): nothing is downloaded.
 */

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

/** What the model was last sent. */
function lastRequest(page: Page) {
  return page.evaluate(
    () =>
      (
        window as {
          __datapadFakeModel?: {
            lastRequest?: { messages: { role: string; content: string }[] };
          };
        }
      ).__datapadFakeModel?.lastRequest,
  );
}

const button = (page: Page) =>
  page.getByRole('button', { name: 'Brief me', exact: true });
const card = (page: Page) =>
  page.getByRole('region', { name: briefLabel(today()) });

/** Brief me, then agree to the (scripted) download. */
async function brief(page: Page) {
  await button(page).click();
  await card(page)
    .getByRole('button', { name: 'Download Qwen3 1.7B and summarize' })
    .click();
}

async function notes(request: APIRequestContext) {
  const data = (await (await request.get('/api/export.json')).json()) as {
    notes: Record<string, { body: string; projectId: string | null }>;
  };
  return Object.values(data.notes);
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: recapSeed() });
});

test('hidden when summaries are off on this device; Focus is unchanged', async ({
  page,
}) => {
  await fakeModel(page, ['Unused.']);
  await page.addInitScript(() => {
    localStorage.setItem('datapad:summaries', 'off');
  });
  await openLive(page);
  await expect(page.locator('[data-recap]')).toBeVisible();
  await expect(button(page)).toHaveCount(0);
  await expect(page.locator('[data-brief]')).toHaveCount(0);
});

test('hidden where the browser cannot run the model', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as { gpu?: unknown }).gpu;
  });
  await openLive(page);
  await expect(page.locator('[data-recap]')).toBeVisible();
  await expect(button(page)).toHaveCount(0);
});

test('streams a brief of yesterday and today from Focus’s facts', async ({
  page,
}) => {
  await fakeModel(page, [
    'Yesterday you closed 1 task on Echo Base relocation. ',
    '\n\nToday there is 1 meeting, the Shield review.',
    '\n\n- Ask @Leia Organa about the generator',
  ]);
  await openLive(page);
  await brief(page);
  const region = card(page);
  await expect(region.getByText('the Shield review.')).toBeVisible();
  await expect(region.getByRole('status')).toHaveText('Done.');
  // The text is announced politely once it settles.
  await expect(region.locator('[data-brief-text]')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  await expect(region.locator('[data-brief-text]')).toHaveAttribute(
    'aria-busy',
    'false',
  );

  const sent = await lastRequest(page);
  expect(sent?.messages[0]).toEqual({ role: 'system', content: BRIEF_PROMPT });
  const context = sent?.messages[1]?.content ?? '';
  expect(context).toContain('- Order thermal blankets (Echo Base relocation)');
  expect(context).toContain('Ridge patrol debrief');
  expect(context).toContain('Shield review');
  expect(context).not.toContain('Write the Yavin report');

  // It sits on top of the sections and replaces none of them.
  await expect(page.locator('[data-recap]')).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});

test('the assignee filter narrows what it is sent', async ({ page }) => {
  await fakeModel(page, ['Only yours.']);
  await openLive(page, '/?who=mine');
  await brief(page);
  await expect(card(page).getByText('Only yours.')).toBeVisible();
  const context = (await lastRequest(page))?.messages[1]?.content ?? '';
  expect(context).toContain('Tasks are narrowed to my own tasks.');
});

test('Stop keeps what was written; Regenerate writes it again', async ({
  page,
}) => {
  await fakeModel(
    page,
    ['First words. ', ...Array.from({ length: 50 }, (_, i) => `more ${i} `)],
    150,
  );
  await openLive(page);
  await brief(page);
  const region = card(page);
  await expect(region.getByText('First words.')).toBeVisible();
  await expect(region.locator('[data-brief-text]')).toHaveAttribute(
    'aria-busy',
    'true',
  );
  await region.getByRole('button', { name: 'Stop' }).click();
  await expect(region.getByText('Stopped.', { exact: true })).toBeVisible();
  await expect(region).not.toContainText('more 40');

  await page.evaluate(() => {
    const fake = (window as { __datapadFakeModel?: { chunks: string[] } })
      .__datapadFakeModel;
    if (fake) fake.chunks = ['A fresh brief.'];
  });
  await region.getByRole('button', { name: 'Regenerate' }).click();
  await expect(region.getByText('A fresh brief.')).toBeVisible();
  await expect(region).not.toContainText('First words.');
});

test('saves as a General note, is kept for the day, and dismisses', async ({
  page,
  request,
}) => {
  await fakeModel(page, ['A quiet day. ', 'Ask @Leia Organa first.']);
  await openLive(page);
  await brief(page);
  const region = card(page);
  await expect(region.getByRole('status')).toHaveText('Done.');

  await region.getByRole('button', { name: 'Save as note' }).click();
  await expect(region.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expectSaved(page);
  const note = (await notes(request)).find((n) =>
    n.body.startsWith(briefLabel(today())),
  );
  expect(note?.projectId).toBeNull();
  expect(note?.body).toContain('A quiet day.');
  // The name went back to a mention token.
  expect(note?.body).toMatch(/Ask @\{[^}]+\} first\./);

  // Back on Focus the same day: still there, with nothing run again.
  await openLive(page, '/tasks');
  await openLive(page);
  await expect(card(page).getByText('A quiet day.')).toBeVisible();
  await expect(card(page).getByRole('status')).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('datapad:brief')),
  ).toContain(`"day":"${today()}"`);

  // Dismissed, it stays gone.
  await card(page).getByRole('button', { name: 'Dismiss the brief' }).click();
  await expect(page.locator('[data-brief]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-recap]')).toBeVisible();
  await expect(page.locator('[data-brief]')).toHaveCount(0);
  await expect(button(page)).toBeVisible();
});

test('a brief kept from another day is not shown', async ({ page }) => {
  await fakeModel(page, ['Unused.']);
  await page.addInitScript(() => {
    localStorage.setItem(
      'datapad:brief',
      JSON.stringify({ day: '2000-01-01', text: 'An old brief.' }),
    );
  });
  await openLive(page);
  await expect(page.locator('[data-recap]')).toBeVisible();
  await expect(page.locator('[data-brief]')).toHaveCount(0);
});

test('works from the keyboard', async ({ page }) => {
  await fakeModel(page, ['Keyboard brief.']);
  await openLive(page);
  await button(page).focus();
  await page.keyboard.press('Enter');
  const download = card(page).getByRole('button', {
    name: 'Download Qwen3 1.7B and summarize',
  });
  await download.focus();
  await page.keyboard.press('Enter');
  await expect(card(page).getByText('Keyboard brief.')).toBeVisible();
  const dismiss = card(page).getByRole('button', {
    name: 'Dismiss the brief',
  });
  await dismiss.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-brief]')).toHaveCount(0);
});

test('Brief me is as tall as the layout switcher beside it', async ({
  page,
}) => {
  await fakeModel(page, ['Unused.']);
  await openLive(page);
  await expect(button(page)).toBeVisible();
  const switcher = page.getByRole('group', { name: /^Layout/ });
  const height = async (l: typeof switcher) =>
    Math.round((await l.boundingBox())?.height ?? 0);
  // 44px on touch, 32 on desktop: the switcher's frame no longer adds 2.
  await expect.poll(() => height(switcher)).toBe(isMobile(page) ? 44 : 32);
  expect(await height(button(page))).toBe(await height(switcher));
});
