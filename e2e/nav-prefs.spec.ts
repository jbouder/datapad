import type { Page, WebSocketRoute } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isMobile,
  openLive,
  SEED,
  syncStatus,
  test,
} from './fixtures';

/** The visible section links: the rail's on desktop, the tab bar's on phones. */
function sections(page: Page) {
  return page
    .getByRole('navigation', { name: 'Sections' })
    .filter({ visible: true })
    .first()
    .locator('ul')
    .first()
    .getByRole('link');
}

const row = (page: Page, label: string) =>
  page.locator(`[data-section-row="${label.toLowerCase()}"]`);

test('hiding and reordering sections follows into the rail and the tab bar, after a reload and on another device', async ({
  page,
  request,
  browser,
  email,
  baseURL,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/settings/navigation');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Navigation' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Reset to default' }),
  ).toBeDisabled();
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Hide Meetings; move Notes up, past it, and then Tasks.
  await page.getByRole('switch', { name: 'Show Meetings' }).click();
  await expect(row(page, 'Meetings')).toContainText('Hidden');
  const up = page.getByRole('button', { name: 'Move Notes up' });
  await up.click();
  await expect(up).toBeFocused();
  await up.click();
  await expect(sections(page)).toHaveText([
    /Focus/,
    /Projects/,
    /Notes/,
    /Tasks/,
  ]);
  if (isMobile(page)) {
    // Four even columns, each still a 44px target.
    const boxes = await Promise.all(
      (await sections(page).all()).map((l) => l.boundingBox()),
    );
    for (const box of boxes) {
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs((box?.width ?? 0) - (boxes[0]?.width ?? 0))).toBeLessThan(
        2,
      );
    }
  }
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // The same after a reload.
  await page.reload();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await expect(sections(page)).toHaveText([
    /Focus/,
    /Projects/,
    /Notes/,
    /Tasks/,
  ]);

  // A hidden section still opens from its address and ⌘K, and nothing in
  // the nav is marked current there.
  await page.goto('/meetings');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Meetings' }),
  ).toBeVisible();
  await expect(sections(page).and(page.locator('[aria-current]'))).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('Go to Meetings');
  await palette.getByRole('option', { name: /Go to Meetings/ }).click();
  await expect(page).toHaveURL(/\/meetings$/);

  // Another device: a fresh browser context, signed in as the same address.
  const other = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
    extraHTTPHeaders: { 'x-dev-access-email': email },
  });
  await other.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.abort('blockedbyclient'),
  );
  const second = await other.newPage();
  await openLive(second, '/');
  await expect(sections(second)).toHaveText([
    /Focus/,
    /Projects/,
    /Notes/,
    /Tasks/,
  ]);
  await other.close();
});

test('the last section stays, and Reset puts the default back with Undo', async ({
  page,
}) => {
  await openLive(page, '/settings/navigation');
  for (const label of ['Focus', 'Projects', 'Tasks', 'Meetings']) {
    await page.getByRole('switch', { name: `Show ${label}` }).click();
  }
  await expect(page.getByRole('switch', { name: 'Show Notes' })).toBeDisabled();
  await expect(sections(page)).toHaveText([/Notes/]);
  await expectNoSidewaysScroll(page);

  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect(sections(page)).toHaveText([
    /Focus/,
    /Projects/,
    /Tasks/,
    /Meetings/,
    /Notes/,
  ]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(sections(page)).toHaveText([/Notes/]);

  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Focus' }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('the rail extras can be hidden', async ({ page, request }) => {
  test.skip(isMobile(page), 'The rail is desktop only.');
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/settings/navigation');
  const rail = page.getByRole('complementary', { name: 'Datapad' });
  await expect(
    rail.getByRole('region', { name: 'Active projects' }),
  ).toBeVisible();
  await expect(rail.getByRole('link', { name: 'Weekly digest' })).toBeVisible();
  await expect(rail.getByRole('link', { name: /Archived/ })).toBeVisible();

  for (const label of ['Active projects', 'Weekly digest', 'Archived']) {
    await page.getByRole('switch', { name: `Show ${label}` }).click();
  }
  await expect(
    rail.getByRole('region', { name: 'Active projects' }),
  ).toHaveCount(0);
  await expect(rail.getByRole('link', { name: 'Weekly digest' })).toHaveCount(
    0,
  );
  await expect(rail.getByRole('link', { name: /Archived/ })).toHaveCount(0);
  // Still reachable by address.
  await page.goto('/digest');
  await expect(
    page.getByRole('heading', { level: 1, name: /digest/i }),
  ).toBeVisible();
});

test('the sync status sits at the foot of the rail (the top bar on phones); the digest above Archived', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  let live: WebSocketRoute | null = null;
  await page.routeWebSocket('**/ws', (ws) => {
    live = ws;
    ws.connectToServer();
  });
  await openLive(page, '/');
  const rail = page.getByRole('complementary', { name: 'Datapad' });
  const status = isMobile(page)
    ? page.getByRole('banner').locator('[data-status]')
    : rail.locator('footer [data-status]');
  await expect(status).toBeVisible();
  await expect(page.locator('[data-status]:visible')).toHaveCount(1);
  const dot = status.locator('[data-dot]');

  const input = page.getByRole('textbox', { name: 'Add a task' });
  await input.fill('Count the probe droids');
  await input.press('Enter');
  await expect(status).toContainText('Saved');
  await expect(dot).toHaveClass(/bg-ok/);
  // Phones show only the dot (the word is for screen readers); desktop
  // shows the word beside it.
  const width = async () => (await status.boundingBox())?.width ?? 0;
  if (isMobile(page)) expect(await width()).toBeLessThan(16);
  else expect(await width()).toBeGreaterThan(30);

  if (!isMobile(page)) {
    // The digest sits under Active projects, above Archived, in the nav.
    const nav = rail.getByRole('navigation');
    const links = await nav.getByRole('link').allInnerTexts();
    const names = links.map((t) => t.split('\n')[0].trim());
    const digestAt = names.indexOf('Weekly digest');
    expect(digestAt).toBeGreaterThan(names.indexOf('Falcon hyperdrive refit'));
    expect(digestAt).toBeGreaterThan(names.indexOf('Echo Base relocation'));
    expect(digestAt).toBe(names.indexOf('Archived') - 1);
    const digest = nav.getByRole('link', { name: 'Weekly digest' });
    await digest.click();
    await expect(page).toHaveURL(/\/digest$/);
    await expect(digest).toHaveAttribute('aria-current', 'page');
  }
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // The socket drops: Offline, in words as well as the dot.
  await page.routeWebSocket('**/ws', (ws) => ws.close());
  await (live as WebSocketRoute | null)?.close();
  await expect(status).toHaveAttribute('data-status', 'offline');
  await expect(dot).toHaveClass(/bg-destructive/);
  await expect(status).toContainText('Offline');
  // The word shows at every width.
  await expect.poll(width).toBeGreaterThan(40);
  await expectAccessible(page);
});
