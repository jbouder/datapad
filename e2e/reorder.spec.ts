import type { Page } from '@playwright/test';
import {
  expect,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

const titles = (page: Page) =>
  page.getByRole('list', { name: 'Open tasks' }).locator('[data-task-title]');

const ORIGINAL = [
  'Confirm shield generator delivery',
  'Insulate the hangar doors',
  'Book the tauntaun vet',
];

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: SEED });
});

test('drag a row onto another to insert before it; it persists', async ({
  page,
  request,
}) => {
  test.skip(isMobile(page), 'Drag is the desktop path.');
  await openLive(page, '/projects/p-echo');
  await expect(titles(page)).toHaveText(ORIGINAL);
  const rows = page.getByRole('list', { name: 'Open tasks' }).locator('li');
  const source = rows.nth(2);
  const target = rows.nth(0);
  const handle = source.locator('[title="Drag to reorder"]');
  // Each step waits for the list to catch up: the handle arms the row on
  // pointerdown, the drag marks it, and only then does the row under the
  // pointer take the drop. Under load the browser can miss the start of a
  // native drag, so the press and first move are tried again until it
  // takes.
  await expect(async () => {
    await handle.hover();
    await page.mouse.down();
    try {
      await expect(source).toHaveAttribute('draggable', 'true', {
        timeout: 1000,
      });
      const from = await handle.boundingBox();
      if (!from) throw new Error('No handle');
      await page.mouse.move(from.x + from.width / 2, from.y - 4, {
        steps: 4,
      });
      await expect(source).toHaveClass(/opacity-50/, { timeout: 1000 });
    } catch (error) {
      await page.mouse.up();
      throw error;
    }
  }).toPass({ timeout: 15_000 });
  const to = await target.boundingBox();
  if (!to) throw new Error('No rows');
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await expect(target).toHaveAttribute('data-drop-before', '');
  await page.mouse.up();
  await expect(titles(page)).toHaveText([
    'Book the tauntaun vet',
    'Confirm shield generator delivery',
    'Insulate the hangar doors',
  ]);
  await expectSaved(page);
  await page.reload();
  await expect(titles(page)).toHaveText([
    'Book the tauntaun vet',
    'Confirm shield generator delivery',
    'Insulate the hangar doors',
  ]);
  // Reordering is not logged.
  const data = await (await request.get('/api/export.json')).json();
  expect(data.activity['p-echo'].events).toEqual(
    SEED.activity['p-echo'].events,
  );
});

test('Alt+arrows move the focused row and say where it went', async ({
  page,
}) => {
  test.skip(isMobile(page), 'Keyboard reorder is checked on desktop.');
  await openLive(page, '/projects/p-echo');
  await page
    .getByRole('checkbox', {
      name: 'Close “Confirm shield generator delivery”',
    })
    .focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(titles(page)).toHaveText([
    'Insulate the hangar doors',
    'Confirm shield generator delivery',
    'Book the tauntaun vet',
  ]);
  await expect(
    page.getByRole('status').filter({ hasText: 'Moved' }),
  ).toHaveText('Moved “Confirm shield generator delivery” to position 2 of 3');
  // Focus stays with the row, so it can keep going.
  await expect(
    page.getByRole('checkbox', {
      name: 'Close “Confirm shield generator delivery”',
    }),
  ).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(titles(page).last()).toHaveText(
    'Confirm shield generator delivery',
  );
  await page.keyboard.press('Alt+ArrowUp');
  await expect(titles(page).nth(1)).toHaveText(
    'Confirm shield generator delivery',
  );
});

test('the row menu moves to the top', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  await page
    .getByRole('button', { name: 'More for “Book the tauntaun vet”' })
    .click();
  await page.getByRole('menuitem', { name: 'Move to top' }).click();
  await expect(titles(page).first()).toHaveText('Book the tauntaun vet');
});

test('on touch, a long press on the handle gives up / down controls', async ({
  page,
}) => {
  test.skip(!isMobile(page), 'Long-press is the touch path.');
  await openLive(page, '/projects/p-echo');
  const handle = page
    .getByRole('list', { name: 'Open tasks' })
    .locator('li')
    .first()
    .locator('[title="Drag to reorder"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error('No handle');
  // Hold for longer than the long-press delay.
  await handle.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    isPrimary: true,
  });
  await page.waitForTimeout(600);
  await handle.dispatchEvent('pointerup', {
    pointerType: 'touch',
    isPrimary: true,
  });
  await expect(
    page.getByRole('button', { name: 'Done reordering' }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Move “Confirm shield generator delivery” down',
    })
    .click();
  await expect(titles(page).nth(1)).toHaveText(
    'Confirm shield generator delivery',
  );
  await page.getByRole('button', { name: 'Done reordering' }).click();
  await expect(
    page.getByRole('button', { name: /^Move “.*” down$/ }),
  ).toHaveCount(0);
});
