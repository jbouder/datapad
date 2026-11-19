import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  noteAction,
  noteRow,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * Pinned notes at the top of a room (#377). The seed's Standup note
 * (n-1) is pinned in Echo Base relocation and mentions Chewbacca; the
 * Shield review prep note (n-2) is in the same project, not pinned.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

async function stored(
  request: APIRequestContext,
): Promise<{ notes: Record<string, { pinned: boolean }> }> {
  return (await request.get('/api/export.json')).json();
}

const pinnedNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Pinned notes' });
const opened = (page: Page, name: string | RegExp) =>
  page.getByRole('region', {
    name: typeof name === 'string' ? `Pinned note: ${name}` : name,
  });
const menuTrigger = (page: Page) =>
  pinnedNav(page).getByRole('button', { name: /^Pinned/ });

/**
 * Open a pinned note from the tab row: its link when it fits, or the
 * Pinned menu's item when it does not.
 */
async function openPinned(page: Page, name: string | RegExp) {
  const link = pinnedNav(page).getByRole('link', { name });
  if (await link.isVisible()) {
    await link.click();
    return;
  }
  await menuTrigger(page).click();
  await page.getByRole('menuitem', { name }).click();
}

/** How many pinned notes the row offers: links plus the menu's items. */
async function pinnedCount(page: Page): Promise<number> {
  const links = await pinnedNav(page).getByRole('link').count();
  if ((await menuTrigger(page).count()) === 0) return links;
  await menuTrigger(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
  const items = await page.getByRole('menuitem').count();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  return links + items;
}

test('pin a note, open it from the Whiteboard tab, close it and unpin it', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo');
  const tabs = page.getByRole('navigation', {
    name: 'Echo Base relocation room',
  });
  // The pinned Standup note sits after the tabs.
  await expect(pinnedNav(page).getByRole('link')).toHaveText(['Standup']);

  // Pin the prep note from its row: the row shows it live.
  const stream = page.getByRole('list', { name: 'Stream' });
  await noteAction(noteRow(stream, 'Prep: Shield review'), 'Pin');
  await expectSaved(page);
  expect((await stored(request)).notes['n-2']?.pinned).toBe(true);
  expect(await pinnedCount(page)).toBe(2);

  // On the Whiteboard tab, Standup opens at the top; the board stays.
  await tabs.getByRole('link', { name: 'Whiteboard' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo\/whiteboard$/);
  await openPinned(page, 'Standup');
  await expect(page).toHaveURL(/\/projects\/p-echo\/whiteboard\?note=n-1$/);
  const note = opened(page, 'Standup');
  await expect(note).toBeVisible();
  await expect(note).toBeFocused();
  // The title shows once, in the bar: the note's own heading is left out.
  await expect(note.getByRole('heading', { level: 4 })).toHaveCount(0);
  await expect(note.getByText('Standup', { exact: true })).toHaveCount(1);
  await expect(note.getByText('Tauntauns fed')).toBeVisible();
  await expect(note.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(note.getByRole('button', { name: 'Unpin' })).toBeVisible();
  await expect(
    page.getByRole('application', {
      name: 'Whiteboard for Echo Base relocation',
    }),
  ).toBeVisible();
  // The row marks it open (on a phone, both are under the Pinned menu).
  const standupLink = pinnedNav(page).getByRole('link', { name: 'Standup' });
  if (await standupLink.count()) {
    await expect(standupLink).toHaveAttribute('aria-current', 'true');
  }
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Back closes it, on the same tab.
  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/p-echo\/whiteboard$/);
  await expect(note).toHaveCount(0);

  // Esc closes it too, and focus goes back to its link (or the menu).
  await openPinned(page, 'Standup');
  await expect(note).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(note).toHaveCount(0);
  await expect(page).toHaveURL(/\/projects\/p-echo\/whiteboard$/);
  await expect(
    (await standupLink.count()) ? standupLink : menuTrigger(page),
  ).toBeFocused();

  // Unpin from the open note: it leaves the row, with Undo.
  await openPinned(page, /Prep: Shield review/);
  const prep = opened(page, /Pinned note: Prep: Shield review/);
  await expect(prep).toBeVisible();
  await prep.getByRole('button', { name: 'Unpin' }).click();
  await expect(prep).toHaveCount(0);
  await expect(page.getByText(/^Unpinned “Prep: Shield review/)).toBeVisible();
  await expectSaved(page);
  expect((await stored(request)).notes['n-2']?.pinned).toBe(false);
  expect(await pinnedCount(page)).toBe(1);
});

test('edit a pinned note in place, and unpin it from its row', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo/plan');
  await openPinned(page, 'Standup');
  await expect(page).toHaveURL(/\/projects\/p-echo\/plan\?note=n-1$/);
  const note = opened(page, 'Standup');
  // The checkboxes save in place.
  await note.getByRole('checkbox', { name: 'Check the heaters' }).check();
  await expectSaved(page);
  expect((await stored(request)).notes['n-1']).toMatchObject({
    pinned: true,
  });
  // Edit opens the editor in place; Cancel keeps it open, unchanged.
  await note.getByRole('button', { name: 'Edit' }).click();
  await expect(note.getByRole('button', { name: 'Save note' })).toBeVisible();
  await note.getByRole('button', { name: 'Cancel' }).click();
  await expect(note.getByRole('button', { name: 'Save note' })).toHaveCount(0);
  await expect(note).toBeVisible();

  // Unpin from the row on the Stream: the tab row empties live.
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: 'Echo Base relocation room' })
    .getByRole('link', { name: 'Stream' })
    .click();
  const stream = page.getByRole('list', { name: 'Stream' });
  await noteAction(noteRow(stream, 'Standup'), 'Unpin');
  await expect(pinnedNav(page)).toHaveCount(0);
});

test('a person’s room shows the pinned notes that mention them', async ({
  page,
}) => {
  await openLive(page, '/people/u-chewie');
  await expect(pinnedNav(page).getByRole('link')).toHaveText(['Standup']);
  await openPinned(page, 'Standup');
  await expect(page).toHaveURL(/\/people\/u-chewie\?note=n-1$/);
  const note = opened(page, 'Standup');
  await expect(note).toBeVisible();
  // The stream's row stays as it was: the note opened at the top.
  await expect(note).toBeFocused();
  await expectAccessible(page);
  await note.getByRole('button', { name: 'Close pinned note' }).click();
  await expect(note).toHaveCount(0);
  await expect(page).toHaveURL(/\/people\/u-chewie$/);

  // Han is in no pinned note: no row.
  await openLive(page, '/people/u-han');
  await expect(pinnedNav(page)).toHaveCount(0);
});

test('more pins than fit go under the Pinned menu, and nothing scrolls sideways', async ({
  page,
  request,
}) => {
  const seed = structuredClone(SEED);
  const notes = seed.notes as Record<string, Record<string, unknown>>;
  const base = notes['n-1'] as Record<string, unknown>;
  for (let i = 1; i <= 8; i++) {
    notes[`n-pin-${i}`] = {
      ...base,
      id: `n-pin-${i}`,
      body: `Runbook part ${i} for the hangar crew`,
      pinned: true,
      createdAt: `2026-10-2${Math.min(i, 9)}T10:00:00.000Z`,
      editedAt: undefined,
    };
  }
  const res = await request.post('/api/import', { data: seed });
  expect(res.ok(), await res.text()).toBe(true);
  await openLive(page, '/projects/p-echo');
  await expect(menuTrigger(page)).toBeVisible();
  expect(await pinnedCount(page)).toBe(9);
  await expectNoSidewaysScroll(page);

  // One from the menu opens like the rest; the menu shows it is open.
  await menuTrigger(page).click();
  const last = page.getByRole('menuitem', { name: /Runbook part 8/ });
  await last.click();
  await expect(page).toHaveURL(/\?note=n-pin-8$/);
  await expect(opened(page, /Runbook part 8/)).toBeVisible();
  await expectAccessible(page);
});

test('a new project starts with a pinned Notepad to write in', async ({
  page,
  request,
}) => {
  await openLive(page);
  const capture = page.getByRole('combobox', { name: 'Capture' });
  await capture.fill('/project Hangar Ops');
  await capture.press('Enter');
  await expectSaved(page);
  const data = (await (await request.get('/api/export.json')).json()) as {
    projects: Record<string, { id: string; name: string }>;
  };
  const id = Object.values(data.projects).find(
    (p) => p.name === 'Hangar Ops',
  )?.id;
  await openLive(page, `/projects/${id}`);
  await expect(pinnedNav(page).getByRole('link')).toHaveText(['Notepad']);
  await openPinned(page, 'Notepad');
  const note = opened(page, 'Notepad');
  await note
    .getByRole('button', { name: 'Nothing here yet. Write something.' })
    .click();
  await expect(note.getByRole('textbox')).toBeVisible();
  await expectAccessible(page);
});
