import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * All's layouts, saved views and bulk actions (#338): each kind's
 * layouts, remembered per kind; a view saved, renamed, pinned and
 * deleted; tasks selected and completed in one change, undone in one.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

const layout = (page: Page) =>
  page.getByRole('group', { name: 'Layout (press v to cycle)' });

async function pick(page: Page, name: string) {
  await layout(page)
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .click();
  await expect(layout(page).getByRole('radio', { name })).toBeChecked();
}

const views = (page: Page) => page.getByRole('region', { name: 'Saved views' });

test.describe('layouts', () => {
  test.use({ reducedMotion: 'reduce' });

  test('tasks: list, table and board, remembered', async ({ page }) => {
    await openLive(page, '/all');
    // Several kinds are a list: no switcher.
    await expect(layout(page)).toHaveCount(0);

    await openLive(page, '/all?kind=task');
    await expect(
      layout(page).getByRole('radio', { name: 'List' }),
    ).toBeChecked();
    await expect(layout(page).getByRole('radio')).toHaveCount(3);

    await pick(page, 'Table');
    await expect(page).toHaveURL(/\/all\?kind=task&view=table$/);
    if (!isMobile(page)) {
      await expect(
        page.getByRole('table').getByRole('button', {
          name: 'Renew the docking permit',
        }),
      ).toBeVisible();
    }
    await expectAccessible(page);
    await expectNoSidewaysScroll(page);

    await pick(page, 'Board');
    await expect(page).toHaveURL(/\/all\?kind=task&view=board$/);
    const board = page.getByRole('region', { name: 'Tasks board' });
    await expect(
      board.getByRole('region', { name: 'Open', exact: true }),
    ).toBeVisible();
    await expect(
      board.getByRole('region', { name: 'Done', exact: true }),
    ).toBeVisible();
    await expectAccessible(page);
    await expectNoSidewaysScroll(page);

    // By priority: a column per priority, in the address.
    await page
      .getByRole('group', { name: 'Columns' })
      .getByText('Priority', { exact: true })
      .click();
    await expect(page).toHaveURL(/view=board&board=priority$/);
    await expect(
      board.getByRole('region', { name: 'High', exact: true }),
    ).toBeVisible();
    await expectAccessible(page);

    // The board is remembered for tasks: a bare address opens on it.
    await page.waitForTimeout(700);
    await openLive(page, '/all?kind=task');
    await expect(
      layout(page).getByRole('radio', { name: 'Board' }),
    ).toBeChecked();
    // And it is All's default in Settings → All.
    await openLive(page, '/settings/all');
    await expect(
      page
        .getByRole('group', { name: 'Tasks layout' })
        .getByRole('radio', { name: 'Board' }),
    ).toBeChecked();
  });

  test('meetings: a calendar', async ({ page }) => {
    await openLive(page, '/all?kind=meeting&status=all');
    await expect(layout(page).getByRole('radio')).toHaveCount(2);
    await pick(page, 'Calendar');
    await expect(page).toHaveURL(/view=calendar/);
    await expect(
      page.getByRole('region', { name: /Meetings calendar/ }).first(),
    ).toBeVisible();
    await expectAccessible(page);
    await expectNoSidewaysScroll(page);
  });

  test('projects: cards and a timeline', async ({ page }) => {
    await openLive(page, '/all?kind=project');
    await pick(page, 'Cards');
    await expect(page).toHaveURL(/\/all\?kind=project&view=cards$/);
    await expect(
      page.getByRole('link', { name: /Echo Base relocation/ }).first(),
    ).toBeVisible();
    await expectAccessible(page);
    await expectNoSidewaysScroll(page);
    await pick(page, 'Timeline');
    await expect(page).toHaveURL(/view=timeline$/);
    await expectAccessible(page);
    await expectNoSidewaysScroll(page);
  });
});

test('save a view, open it, rename, pin and delete it', async ({ page }) => {
  await openLive(page, '/all?kind=task&room=p-echo');
  await views(page).getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save view' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Echo tasks');
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await expect(dialog).toBeHidden();
  const chip = views(page).getByRole('link', { name: 'Echo tasks' });
  await expect(chip).toHaveAttribute('aria-current', 'page');
  // What is saved is already shown: nothing more to save.
  await expect(
    views(page).getByRole('button', { name: 'Save view' }),
  ).toBeDisabled();
  await expectAccessible(page);

  // Elsewhere, the chip goes back to it; a reload keeps it (synced).
  await openLive(page, '/all');
  await expect(chip).not.toHaveAttribute('aria-current', 'page');
  await chip.click();
  await expect(page).toHaveURL(/\/all\?kind=task&room=p-echo&view=list$/);
  await expect(
    page.getByRole('list', { name: 'Items' }).locator('[data-task-id]'),
  ).toHaveCount(3);

  // Rename.
  await views(page)
    .getByRole('button', { name: 'Options for Echo tasks' })
    .click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename view' });
  await rename.getByRole('textbox', { name: 'Name' }).fill('Base tasks');
  await rename.getByRole('button', { name: 'Rename' }).click();
  const renamed = views(page).getByRole('link', { name: 'Base tasks' });
  await expect(renamed).toBeVisible();

  // Pin it to the rail, like a room.
  await views(page)
    .getByRole('button', { name: 'Options for Base tasks' })
    .click();
  await page.getByRole('menuitem', { name: 'Pin to the rail' }).click();
  if (!isMobile(page)) {
    const rail = page
      .getByRole('complementary', { name: 'Datapad' })
      .getByRole('region', { name: 'Rooms' });
    await expect(
      rail.getByRole('link', { name: 'Base tasks' }),
    ).toHaveAttribute('aria-current', 'page');
    await openLive(page, '/all');
    await rail.getByRole('link', { name: 'Base tasks' }).click();
    await expect(page).toHaveURL(/\/all\?kind=task&room=p-echo&view=list$/);
  }
  await openLive(page, '/settings/rooms');
  await expect(
    page
      .getByRole('list', { name: 'Pinned rooms' })
      .getByRole('link', { name: 'Base tasks' }),
  ).toBeVisible();

  // Delete, then Undo.
  await openLive(page, '/all');
  await views(page)
    .getByRole('button', { name: 'Options for Base tasks' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(views(page).getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(
    views(page).getByRole('link', { name: 'Base tasks' }),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('select tasks, complete them in one change, undo in one', async ({
  page,
}) => {
  await openLive(page, '/all?kind=task&room=p-echo');
  const items = page.getByRole('list', { name: 'Items' });
  await expect(items.locator('[data-task-id]')).toHaveCount(3);
  await items
    .getByRole('checkbox', { name: 'Select “Book the tauntaun vet”' })
    .click();
  await items
    .getByRole('checkbox', { name: 'Select “Insulate the hangar doors”' })
    .click();
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
  await expect(bar.getByRole('status')).toHaveText('2 tasks selected');
  await expectAccessible(page);

  await bar.getByRole('button', { name: 'Complete' }).click();
  await expect(bar).toBeHidden();
  await expect(page.getByText('Completed 2 tasks')).toBeVisible();
  await expect(items.locator('[data-task-id]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(items.locator('[data-task-id]')).toHaveCount(3);

  // Mark to decide: the To decide filter finds them.
  await items
    .getByRole('checkbox', { name: 'Select “Book the tauntaun vet”' })
    .click();
  await bar.getByRole('button', { name: 'To decide' }).click();
  await expect(page.getByText('Marked 1 task to decide')).toBeVisible();
  await openLive(page, '/all?kind=task&decide=1');
  await expect(items).toContainText('Book the tauntaun vet');
});

test('Esc clears the selection', async ({ page }) => {
  await openLive(page, '/all?kind=task');
  await page
    .getByRole('checkbox', { name: 'Select “Renew the docking permit”' })
    .first()
    .click();
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
  await expect(bar.getByRole('status')).toHaveText('1 task selected');
  // Not from the select box, which takes keys of its own.
  await page.getByRole('heading', { level: 1, name: 'All' }).click();
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
});
