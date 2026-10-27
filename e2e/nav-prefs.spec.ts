import type { Page, WebSocketRoute } from '@playwright/test';
import {
  addFromTopBar,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isMobile,
  openLive,
  openPreferences,
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

/** The top bar's + button: "Add" with a menu, or the one action it does. */
const plus = (page: Page, name = 'Add') =>
  page.getByRole('banner').getByRole('button', { name, exact: true });

/** What the + menu offers, in order (closing it again). */
async function plusMenu(page: Page) {
  await plus(page).click();
  const items = page.getByRole('menu').getByRole('menuitem');
  await expect(items.first()).toBeVisible();
  // Each item's own words, without the shortcut beside them.
  const names = await items.evaluateAll((els) =>
    els.map((el) =>
      [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join('')
        .trim(),
    ),
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  return names;
}

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
    ...(isMobile(page) ? [] : [/Whiteboard/]),
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
    ...(isMobile(page) ? [] : [/Whiteboard/]),
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
    ...(isMobile(page) ? [] : [/Whiteboard/]),
  ]);
  await other.close();
});

test('the last section stays, and Reset puts the default back with Undo', async ({
  page,
}) => {
  await openLive(page, '/settings/navigation');
  for (const label of [
    'Focus',
    'Projects',
    'Tasks',
    'Meetings',
    'Whiteboard',
  ]) {
    await page
      .getByRole('switch', { name: `Show ${label}`, exact: true })
      .click();
  }
  await expect(
    page.getByRole('switch', { name: 'Show Notes', exact: true }),
  ).toBeDisabled();
  await expect(sections(page)).toHaveText([/Notes/]);
  await expectNoSidewaysScroll(page);

  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect(sections(page)).toHaveText([
    /Focus/,
    /Projects/,
    /Tasks/,
    /Meetings/,
    /Notes/,
    ...(isMobile(page) ? [] : [/Whiteboard/]),
  ]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(sections(page)).toHaveText([/Notes/]);

  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Focus' }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('the Whiteboard is in the rail, not the tab bar, until Phone puts it there', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/settings/navigation');
  const phone = page.getByRole('switch', {
    name: 'Whiteboard on the phone',
  });
  await expect(phone).not.toBeChecked();
  // Every other section is on the phone.
  for (const label of ['Focus', 'Projects', 'Tasks', 'Meetings', 'Notes']) {
    await expect(
      page.getByRole('switch', { name: `${label} on the phone` }),
    ).toBeChecked();
  }
  const board = sections(page).filter({ hasText: 'Whiteboard' });
  await expect(board).toHaveCount(isMobile(page) ? 0 : 1);
  // The account menu has it on a phone, where the tab bar does not.
  const menuBoard = page.getByRole('menuitem', { name: 'Whiteboard' });
  await openPreferences(page);
  await expect(menuBoard).toHaveCount(isMobile(page) ? 1 : 0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await phone.click();
  await expect(phone).toBeChecked();
  await expect(sections(page)).toHaveText([
    /Focus/,
    /Projects/,
    /Tasks/,
    /Meetings/,
    /Notes/,
    /Whiteboard/,
  ]);
  if (isMobile(page)) {
    // Six even columns, each still a 44px target.
    const boxes = await Promise.all(
      (await sections(page).all()).map((l) => l.boundingBox()),
    );
    for (const box of boxes) {
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(Math.abs((box?.width ?? 0) - (boxes[0]?.width ?? 0))).toBeLessThan(
        2,
      );
    }
    await openPreferences(page);
    await expect(menuBoard).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // It stays after a reload, and opens the space's board from the tab bar.
  await page.reload();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await board.click();
  await expect(page).toHaveURL(/\/whiteboard$/);
  await expect(board).toHaveAttribute('aria-current', 'page');

  // Hiding the section takes it off the phone too, and Phone goes grey.
  await page.goto('/settings/navigation');
  await page
    .getByRole('switch', { name: 'Show Whiteboard', exact: true })
    .click();
  await expect(phone).toBeDisabled();
  await expect(board).toHaveCount(0);
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
  // Phones show only the dot (the word is for screen readers), centred in
  // a 44px slot so it spaces like the icons beside it; desktop shows the
  // word beside it.
  const width = async () => (await status.boundingBox())?.width ?? 0;
  if (isMobile(page)) {
    const box = await status.boundingBox();
    const dotBox = await dot.boundingBox();
    expect(box?.width).toBeCloseTo(44, 0);
    expect(
      (dotBox?.x ?? 0) + (dotBox?.width ?? 0) / 2 - (box?.x ?? 0),
    ).toBeCloseTo(22, 0);
    const word = await status.getByText('Saved').boundingBox();
    expect(word?.width ?? 0).toBeLessThanOrEqual(1);
  } else expect(await width()).toBeGreaterThan(30);

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
  await expect.poll(width).toBeGreaterThan(isMobile(page) ? 50 : 40);
  await expectAccessible(page);
});

test('the + menu offers what Quick add shows, in its order, after a reload and on another device', async ({
  page,
  request,
  browser,
  email,
  baseURL,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/settings/navigation');
  const group = page.getByRole('list', { name: 'Quick add' });
  await expect(group.getByRole('listitem')).toHaveText([
    /Add task/,
    /Write a note/,
    /Add meeting\s*Hidden/,
    /Add project\s*Hidden/,
  ]);
  expect(await plusMenu(page)).toEqual(['Add task', 'Write a note']);

  // Show Add meeting and move it to the top; show Add project.
  await page.getByRole('switch', { name: 'Show Add meeting' }).click();
  const up = page.getByRole('button', { name: 'Move Add meeting up' });
  await up.click();
  await expect(up).toBeFocused();
  await up.click();
  await page.getByRole('switch', { name: 'Show Add project' }).click();
  await expect
    .poll(() => plusMenu(page))
    .toEqual(['Add meeting', 'Add task', 'Write a note', 'Add project']);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // The same after a reload.
  await page.reload();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  expect(await plusMenu(page)).toEqual([
    'Add meeting',
    'Add task',
    'Write a note',
    'Add project',
  ]);

  // Add meeting starts in the project you are on; Add project opens its form.
  await page.goto('/projects/p-echo');
  await addFromTopBar(page, 'Add meeting');
  const meeting = page.getByRole('dialog', { name: 'New meeting' });
  await expect(meeting.getByRole('combobox', { name: 'Project' })).toHaveValue(
    'Echo Base relocation',
  );
  await page.keyboard.press('Escape');
  await expect(meeting).toHaveCount(0);
  await addFromTopBar(page, 'Add project');
  await expect(page.getByRole('dialog', { name: 'New project' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New project' })).toHaveCount(
    0,
  );
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

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
  expect(await plusMenu(second)).toEqual([
    'Add meeting',
    'Add task',
    'Write a note',
    'Add project',
  ]);
  await other.close();
});

test('with one action shown, + does it directly; hidden ones still work; Reset puts the menu back with Undo', async ({
  page,
}) => {
  await openLive(page, '/settings/navigation');
  await page.getByRole('switch', { name: 'Show Write a note' }).click();
  await expect(
    page.getByRole('switch', { name: 'Show Add task' }),
  ).toBeDisabled();

  // No menu: + is Add task, by name and by tooltip.
  await expect(plus(page)).toHaveCount(0);
  const add = plus(page, 'Add task');
  await expect(add).toBeVisible();
  if (!isMobile(page)) {
    await add.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
      'Add task',
    );
  }
  await add.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const task = page.getByRole('dialog', { name: 'New task' });
  await expect(task).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(task).toHaveCount(0);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Write a note is hidden from +, not from its shortcut or ⌘K.
  if (!isMobile(page)) {
    await page.keyboard.press('Shift+N');
    const note = page.getByRole('dialog', { name: 'New note' });
    await expect(note).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(note).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('New note');
  await palette.getByRole('option', { name: /New note/ }).click();
  await expect(page.getByRole('dialog', { name: 'New note' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Add meeting is hidden by default, and in ⌘K too.
  await page.getByRole('button', { name: 'Search' }).click();
  await palette.getByRole('combobox').fill('New meeting');
  await palette.getByRole('option', { name: /New meeting/ }).click();
  await expect(page.getByRole('dialog', { name: 'New meeting' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New meeting' })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: 'Reset to default' }).click();
  expect(await plusMenu(page)).toEqual(['Add task', 'Write a note']);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(plus(page, 'Add task')).toBeVisible();
});
