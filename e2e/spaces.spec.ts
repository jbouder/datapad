import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  openLive,
  openPreferences,
  SEED,
  syncStatus,
  test,
} from './fixtures';

const switcher = (page: Page) => page.getByRole('button', { name: /^Space: / });

/** The switcher: the rail's on desktop, the account menu on a phone. */
async function openSwitcher(page: Page) {
  if (isMobile(page)) {
    await openPreferences(page);
  } else {
    await switcher(page).click();
    await expect(page.getByRole('menu')).toBeVisible();
  }
}

async function switchTo(page: Page, name: string) {
  await openSwitcher(page);
  await page.getByRole('menuitemradio', { name }).click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
}

const seeded = (page: Page) =>
  page.getByText('2 projects · 5 open tasks', { exact: false });

test('make a space, work in it, and switch back and forth', async ({
  page,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/');
  await expect(seeded(page)).toBeVisible();
  if (!isMobile(page)) await expect(switcher(page)).toHaveText('Main');

  // New space… from the switcher (the account menu on a phone).
  await openSwitcher(page);
  await expect(
    page.getByRole('menuitemradio', { name: 'Main' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expectAccessible(page);
  await page.getByRole('menuitem', { name: 'New space…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New space' });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await expectAccessible(page);
  // A taken name is refused before it is sent.
  await name.fill('main');
  await name.press('Enter');
  await expect(
    dialog.getByText('There is already a space called main'),
  ).toBeVisible();
  await name.fill('Personal');
  await name.press('Enter');
  await expect(dialog).toBeHidden();

  // The new space is open, empty, and says so in the title.
  if (!isMobile(page)) await expect(switcher(page)).toHaveText('Personal');
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await expect(
    page.getByText('Nothing open. Add a task above or open a project.'),
  ).toBeVisible();
  await expect(seeded(page)).toBeHidden();
  await expect(page).toHaveTitle('Focus · Personal · Datapad');
  if (isMobile(page)) await expectNoSidewaysScroll(page);

  const input = page.getByRole('textbox', { name: 'Add a task' });
  await input.fill('Water the moisture vaporators');
  await input.press('Enter');
  const task = page.getByText('Water the moisture vaporators');
  await expect(task).toBeVisible();
  await expectSaved(page);
  // Its count, as the Focus summary has it (sections may load collapsed).
  const personal = page.getByText('0 projects · 1 open task');

  // Back to Main: its data, not Personal's.
  await switchTo(page, 'Main');
  await expect(seeded(page)).toBeVisible();
  await expect(task).toHaveCount(0);
  await expect(page).toHaveTitle('Focus · Main · Datapad');

  // And to Personal again: the task is still there.
  await switchTo(page, 'Personal');
  await expect(personal).toBeVisible();
  await expect(seeded(page)).toBeHidden();

  // This device remembers the open space.
  await page.reload();
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await expect(personal).toBeVisible();
  await expect(page).toHaveTitle('Focus · Personal · Datapad');

  // ⌘K switches too.
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Search' }).click();
  } else {
    await page.keyboard.press('ControlOrMeta+k');
  }
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox').fill('switch to');
  await expect(
    palette.getByRole('option', { name: 'Switch to Personal' }),
  ).toHaveCount(0);
  await palette.getByRole('option', { name: 'Switch to Main' }).click();
  await expect(palette).toBeHidden();
  await expect(seeded(page)).toBeVisible();
  await expect(task).toHaveCount(0);
  if (isMobile(page)) await expectNoSidewaysScroll(page);
});

test('switching away from a project lands on Focus; sections stay', async ({
  page,
  request,
}) => {
  await request.post('/api/spaces/create', { data: { name: 'Personal' } });
  await request.post('/api/import', { data: SEED });
  await openLive(page, '/projects/p-echo');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Echo Base relocation' }),
  ).toBeVisible();
  await switchTo(page, 'Personal');
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('Focus · Personal · Datapad');

  await page.goto('/tasks');
  await expect(syncStatus(page)).toHaveAttribute('data-status', 'live');
  await switchTo(page, 'Main');
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page).toHaveTitle('Tasks · Main · Datapad');
});

test('an unknown remembered space opens the first one', async ({
  page,
  context,
  request,
}) => {
  await request.post('/api/import', { data: SEED });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('datapad:space', 'gone');
    }
  });
  await openLive(page, '/');
  await expect(seeded(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('datapad:space'))).toBe(
    'main',
  );
});

test('when the open space is deleted elsewhere, the first one opens', async ({
  page,
  request,
}) => {
  test.slow();
  await request.post('/api/import', { data: SEED });
  const made = await request.post('/api/spaces/create', {
    data: { name: 'Personal' },
  });
  const { space } = (await made.json()) as { space: { id: string } };
  await page.addInitScript((id) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('datapad:space', id);
    }
  }, space.id);
  await openLive(page, '/');
  await expect(page).toHaveTitle('Focus · Personal · Datapad');
  await expect(seeded(page)).toHaveCount(0);

  const issued = await request.get(`/api/erase-token?space=${space.id}`);
  const { token } = (await issued.json()) as { token: string };
  const deleted = await request.post('/api/spaces/delete', {
    data: { id: space.id, token },
  });
  expect(deleted.ok()).toBe(true);

  // The close reaches the page late through the local preview's proxy.
  await expect(seeded(page)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveTitle('Focus · Datapad');
  expect(await page.evaluate(() => localStorage.getItem('datapad:space'))).toBe(
    'main',
  );
});
