import type { Page } from '@playwright/test';
import { expect, isMobile, openLive, SEED, test } from './fixtures';

/**
 * ⌘K finds the words on whiteboards (stickies, text, rect labels) under
 * Whiteboard; a result opens the board with the item selected and
 * centred (`?item=<id>`, dropped once it has been used).
 */

const sticky = (
  id: string,
  boardId: string,
  x: number,
  y: number,
  text: string,
) => ({
  id,
  boardId,
  kind: 'sticky',
  x,
  y,
  w: 200,
  h: 200,
  z: 0,
  color: 'warn',
  text,
  points: [],
});

function seeded() {
  const seed = structuredClone(SEED) as typeof SEED & {
    boardItems: Record<string, unknown>;
  };
  seed.boardItems = {
    'b-power': sticky('b-power', 'p-echo', 0, 0, 'Power budget'),
    // Far from the rest: opening it has to move the view.
    'b-far': sticky(
      'b-far',
      'p-echo',
      4000,
      3000,
      'Reactor coolant\nCheck the loop',
    ),
    'b-space': sticky('b-space', 'general', 0, 0, 'Quarterly themes'),
  };
  return seed;
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: seeded() });
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search' });

async function searchFor(page: Page, query: string) {
  await page.getByRole('button', { name: 'Search' }).click();
  await palette(page).getByRole('combobox').fill(query);
  return palette(page).getByRole('group', { name: 'Whiteboard' });
}

async function expectCentred(page: Page, id: string) {
  const board = await page.getByRole('application').boundingBox();
  const item = await page.locator(`[data-item-id="${id}"]`).boundingBox();
  if (!board || !item) throw new Error('Not on screen');
  expect(
    Math.abs(item.x + item.width / 2 - (board.x + board.width / 2)),
  ).toBeLessThan(4);
  expect(
    Math.abs(item.y + item.height / 2 - (board.y + board.height / 2)),
  ).toBeLessThan(4);
}

test('a sticky found with ⌘K opens its board, selected and centred', async ({
  page,
}) => {
  await openLive(page);
  const results = await searchFor(page, 'coolant');
  await expect(results.getByRole('option')).toHaveCount(1);
  const option = results.getByRole('option');
  await expect(option).toContainText('Reactor coolant');
  if (!isMobile(page))
    await expect(option).toContainText('Echo Base relocation');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/projects\/p-echo\/whiteboard$/);
  const far = page.locator('[data-item-id="b-far"]');
  await expect(far).toHaveAttribute('data-selected');
  await expect(far).toBeFocused();
  await expectCentred(page, 'b-far');
});

test('the space’s board is a result too', async ({ page }) => {
  await openLive(page, '/projects/p-echo');
  const results = await searchFor(page, 'quarterly');
  const option = results.getByRole('option');
  await expect(option).toContainText('Quarterly themes');
  if (!isMobile(page)) await expect(option).toContainText('Space whiteboard');
  await option.click();
  await expect(page).toHaveURL(/\/whiteboard$/);
  await expect(page.locator('[data-item-id="b-space"]')).toHaveAttribute(
    'data-selected',
  );
  await expectCentred(page, 'b-space');
});

test('an item that is gone just opens its board', async ({ page }) => {
  await openLive(page, '/projects/p-echo/whiteboard?item=nope');
  await expect(page).toHaveURL(/\/projects\/p-echo\/whiteboard$/);
  await expect(page.locator('[data-item-id="b-power"]')).toBeVisible();
  await expect(page.locator('[data-selected]')).toHaveCount(0);
});
