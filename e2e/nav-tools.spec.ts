import type { Page } from '@playwright/test';
import {
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

/**
 * The Tools (#261): Notepad, Whiteboard and Weekly digest, under the
 * sections in the rail; on a phone, in the account menu unless Phone puts
 * them on the tab bar.
 */

/** Settings → Navigation's Tools rows. */
const settingsRows = (page: Page) =>
  page.getByRole('list', { name: 'Tools' }).getByRole('listitem');

/** The rail's Tools links (desktop). */
const railTools = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Datapad' })
    .getByRole('region', { name: 'Tools' })
    .getByRole('link');

/** The tab bar's links (phones). */
const tabs = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Sections' })
    .filter({ visible: true })
    .first()
    .getByRole('link');

/** The tools the account menu offers, in order (closing it again). */
async function menuTools(page: Page): Promise<string[]> {
  await openPreferences(page);
  const names = await page
    .getByRole('menuitem')
    .filter({ hasText: /^(Notepad|Whiteboard|Weekly digest)$/ })
    .allInnerTexts();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  return names.map((n) => n.trim());
}

/** Where the shown tools are: the rail's on desktop, the menu's on phones. */
async function shownTools(page: Page): Promise<string[]> {
  if (isMobile(page)) return menuTools(page);
  return (await railTools(page).allInnerTexts()).map((n) => n.trim());
}

test('the Tools show in the rail (the account menu on a phone), reorder and hide, after a reload', async ({
  page,
}) => {
  // No projects: the Weekly digest shows all the same.
  await openLive(page, '/settings/navigation');
  await expect(settingsRows(page)).toHaveText([
    /Notepad/,
    /Whiteboard/,
    /Weekly digest/,
  ]);
  for (const label of ['Notepad', 'Whiteboard', 'Weekly digest']) {
    await expect(
      page.getByRole('switch', { name: `Show ${label}`, exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole('switch', { name: `${label} on the phone` }),
    ).not.toBeChecked();
  }
  expect(await shownTools(page)).toEqual([
    'Notepad',
    'Whiteboard',
    'Weekly digest',
  ]);
  if (isMobile(page)) {
    // The tab bar holds the sections only, by default.
    await expect(tabs(page)).toHaveText([
      /Focus/,
      /Projects/,
      /Tasks/,
      /Meetings/,
      /Notes/,
    ]);
  } else {
    // On desktop the account menu has none of them.
    expect(await menuTools(page)).toEqual([]);
  }
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // Move the Weekly digest to the top; hide the Notepad.
  const up = page.getByRole('button', { name: 'Move Weekly digest up' });
  await up.click();
  await expect(up).toBeFocused();
  await up.click();
  await expect(up).toBeDisabled();
  await page.getByRole('switch', { name: 'Show Notepad', exact: true }).click();
  await expect(settingsRows(page)).toHaveText([
    /Weekly digest/,
    /Notepad\s*Hidden/,
    /Whiteboard/,
  ]);
  await expect(
    page.getByRole('switch', { name: 'Notepad on the phone' }),
  ).toBeDisabled();
  await expect
    .poll(() => shownTools(page))
    .toEqual(['Weekly digest', 'Whiteboard']);
  await expectAccessible(page);

  // The same after a reload.
  await page.reload();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  expect(await shownTools(page)).toEqual(['Weekly digest', 'Whiteboard']);

  // A hidden tool still opens from its address and ⌘K, and the rail marks
  // nothing current there.
  await page.goto('/notepad');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Notepad' }),
  ).toBeVisible();
  if (!isMobile(page)) {
    await expect(
      page
        .getByRole('complementary', { name: 'Datapad' })
        .locator('[aria-current]'),
    ).toHaveCount(0);
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Search' }).click();
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('Go to Notepad');
  await palette.getByRole('option', { name: /Go to Notepad/ }).click();
  await expect(page).toHaveURL(/\/notepad$/);

  // With every tool hidden, the heading goes too.
  await page.goto('/settings/navigation');
  for (const label of ['Whiteboard', 'Weekly digest']) {
    await page
      .getByRole('switch', { name: `Show ${label}`, exact: true })
      .click();
  }
  await expect.poll(() => shownTools(page)).toEqual([]);
  if (!isMobile(page)) {
    await expect(
      page
        .getByRole('complementary', { name: 'Datapad' })
        .getByRole('heading', { name: 'Tools' }),
    ).toHaveCount(0);
  }

  // Reset puts them back.
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect
    .poll(() => shownTools(page))
    .toEqual(['Notepad', 'Whiteboard', 'Weekly digest']);
});

test('Phone puts a tool on the tab bar after the sections, six at most; the rest stay in the account menu', async ({
  page,
  request,
}) => {
  test.skip(!isMobile(page), 'The tab bar is the phone’s.');
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/settings/navigation');
  const phone = (label: string) =>
    page.getByRole('switch', { name: `${label} on the phone` });

  await phone('Whiteboard').click();
  await expect(phone('Whiteboard')).toBeChecked();
  await expect(tabs(page)).toHaveText([
    /Focus/,
    /Projects/,
    /Tasks/,
    /Meetings/,
    /Notes/,
    /Whiteboard/,
  ]);
  expect(await menuTools(page)).toEqual(['Notepad', 'Weekly digest']);
  // Six columns: another tool cannot join, and the hint says why.
  await expect(phone('Notepad')).toBeDisabled();
  await expect(phone('Notepad')).toHaveAccessibleDescription(/6 at most/);

  // Take Notes off the phone: the Notepad fits, in the tools' order.
  await phone('Notes').click();
  await phone('Notepad').click();
  await expect(tabs(page)).toHaveText([
    /Focus/,
    /Projects/,
    /Tasks/,
    /Meetings/,
    /Notepad/,
    /Whiteboard/,
  ]);
  expect(await menuTools(page)).toEqual(['Weekly digest']);
  // Six even columns, each still a 44px target.
  const boxes = await Promise.all(
    (await tabs(page).all()).map((l) => l.boundingBox()),
  );
  for (const box of boxes) {
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(Math.abs((box?.width ?? 0) - (boxes[0]?.width ?? 0))).toBeLessThan(
      2,
    );
  }
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  // It stays after a reload, and the tab opens the space's board.
  await page.reload();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  const board = tabs(page).filter({ hasText: 'Whiteboard' });
  await board.click();
  await expect(page).toHaveURL(/\/whiteboard$/);
  await expect(board).toHaveAttribute('aria-current', 'page');

  // Hiding a tool takes it off the phone too, and Phone goes grey.
  await page.goto('/settings/navigation');
  await page
    .getByRole('switch', { name: 'Show Whiteboard', exact: true })
    .click();
  await expect(phone('Whiteboard')).toBeDisabled();
  await expect(phone('Whiteboard')).not.toBeChecked();
  await expect(board).toHaveCount(0);
  expect(await menuTools(page)).toEqual(['Weekly digest']);
});

test('settings from before the Tools carry over: a hidden Whiteboard, the digest switched off', async ({
  page,
  request,
}) => {
  await request.post('/api/import', {
    data: {
      settings: {
        user: {
          defaultOrg: '',
          nav: {
            order: [
              'focus',
              'projects',
              'tasks',
              'meetings',
              'notes',
              'whiteboard',
            ],
            hidden: ['whiteboard'],
            extras: { digest: false },
          },
        },
      },
    },
  });
  await openLive(page, '/settings/navigation');
  await expect(settingsRows(page)).toHaveText([
    /Notepad/,
    /Whiteboard\s*Hidden/,
    /Weekly digest\s*Hidden/,
  ]);
  expect(await shownTools(page)).toEqual(['Notepad']);

  // A section change keeps them as they were.
  await page.getByRole('switch', { name: 'Show Meetings' }).click();
  await page.reload();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await expect(settingsRows(page)).toHaveText([
    /Notepad/,
    /Whiteboard\s*Hidden/,
    /Weekly digest\s*Hidden/,
  ]);
  expect(await shownTools(page)).toEqual(['Notepad']);
  await expectAccessible(page);
});
