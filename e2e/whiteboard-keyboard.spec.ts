import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

/**
 * The whiteboard without a pointer (#222): place an item in the middle of
 * the view, resize it, draw an arrow between two items and re-aim its
 * ends, each announced and undone with ⌘Z.
 */

interface StoredItem {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  points: number[];
}

async function stored(
  request: APIRequestContext,
): Promise<Record<string, StoredItem>> {
  const data = (await (await request.get('/api/export.json')).json()) as {
    boardItems?: Record<string, StoredItem>;
  };
  return data.boardItems ?? {};
}

async function ofKind(request: APIRequestContext, kind: string) {
  return Object.values(await stored(request)).filter((b) => b.kind === kind);
}

const sticky = (id: string, x: number, y: number, text: string, z: number) => ({
  id,
  boardId: 'p-echo',
  kind: 'sticky',
  x,
  y,
  w: 200,
  h: 200,
  z,
  color: 'warn',
  text,
  points: [],
});

/** Three stickies on Echo Base's board: two side by side, one below. */
function seeded() {
  const seed = structuredClone(SEED) as typeof SEED & {
    boardItems: Record<string, unknown>;
  };
  seed.boardItems = {
    'b-power': sticky('b-power', 0, 0, 'Power budget', 0),
    'b-doors': sticky('b-doors', 300, 0, 'Hangar doors', 1),
    'b-crew': sticky('b-crew', 0, 300, 'Crew rota', 2),
  };
  return seed;
}

test.beforeEach(async ({ page, request }) => {
  test.skip(isMobile(page), 'The keyboard ways; touch has its own.');
  await request.post('/api/import', { data: seeded() });
});

const board = (page: Page) => page.getByRole('application');
const item = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const status = (page: Page) => page.locator('[data-board-status]');
const hint = (page: Page) => page.locator('[data-board-hint]');

async function centreOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function endsOf(a: StoredItem) {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = a.points;
  return [
    { x: a.x + x0, y: a.y + y0 },
    { x: a.x + x1, y: a.y + y1 },
  ] as const;
}

function near(p: { x: number; y: number }, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 1);
  expect(p.y).toBeCloseTo(y, 1);
}

test('place a sticky and a rectangle in the middle with Enter', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  await board(page).focus();
  await page.keyboard.press('s');
  await expect(status(page)).toContainText('press Enter for the middle');
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Sticky note text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Shield generator');
  await editor.press('ControlOrMeta+Enter');
  const added = page.getByRole('button', {
    name: 'Sticky note: Shield generator',
  });
  await expect(added).toBeFocused();
  await expect(added).toHaveAttribute('data-selected');
  // In the middle of the view.
  const at = await centreOf(added);
  const middle = await centreOf(board(page));
  expect(Math.abs(at.x - middle.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(at.y - middle.y)).toBeLessThanOrEqual(2);
  await expectSaved(page);
  expect(await ofKind(request, 'sticky')).toHaveLength(4);

  // A rectangle from the keyboard is ready to label too.
  await board(page).focus();
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  const label = page.getByRole('textbox', { name: 'Rectangle text' });
  await expect(label).toBeFocused();
  await expect(status(page)).toHaveText('Added rectangle');
  await label.press('Escape');
  await expect(page.locator('[data-kind="rect"]')).toBeFocused();
  await expectSaved(page);
  expect(await ofKind(request, 'rect')).toHaveLength(1);

  // ⌘Z takes the rectangle back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(status(page)).toHaveText('Undone');
  await expectSaved(page);
  expect(await ofKind(request, 'rect')).toHaveLength(0);
});

test('resize with Alt and the arrow keys', async ({ page, request }) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  const url = page.url();
  await item(page, 'b-power').focus();
  await expect(item(page, 'b-power')).toHaveAttribute('data-selected');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(status(page)).toHaveText('201 wide, 200 high');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(status(page)).toHaveText('201 wide, 210 high');
  await page.keyboard.press('Alt+Shift+ArrowLeft');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(status(page)).toHaveText('191 wide, 209 high');
  await expectSaved(page);
  expect((await stored(request))['b-power']).toMatchObject({
    x: 0,
    y: 0,
    w: 191,
    h: 209,
  });
  // Alt+← is not the browser's Back here.
  expect(page.url()).toBe(url);

  // Each press is a step ⌘Z takes back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(status(page)).toHaveText('Undone');
  await expectSaved(page);
  expect((await stored(request))['b-power']).toMatchObject({ w: 191, h: 210 });

  // It stops at the smallest size.
  for (let i = 0; i < 17; i += 1) {
    await page.keyboard.press('Alt+Shift+ArrowLeft');
    // A socket may send 20 ops a second (LIMITS.opsPerSecond).
    await page.waitForTimeout(60);
  }
  await expect(status(page)).toHaveText('As small as it goes');
  await expectSaved(page);
  await expect.poll(async () => (await stored(request))['b-power']?.w).toBe(40);
});

test('draw an arrow between two items, or cancel it', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  // With nothing selected, it says how to start.
  await board(page).focus();
  await page.keyboard.press('a');
  await page.keyboard.press('Enter');
  await expect(status(page)).toContainText(
    'Select the sticky note, text or rectangle the arrow starts from',
  );

  // From Power budget: A, Enter, Tab to Hangar doors, Escape: nothing.
  await item(page, 'b-power').focus();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(
    'Drawing an arrow from Sticky note: Power budget. Tab to the item it points to, then press Enter to draw it, or Escape to cancel',
  );
  await expect(hint(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(item(page, 'b-doors')).toBeFocused();
  await expect(item(page, 'b-doors')).toHaveAttribute('data-target');
  // The selection stays where the arrow starts.
  await expect(item(page, 'b-power')).toHaveAttribute('data-selected');
  await expect(item(page, 'b-doors')).not.toHaveAttribute('data-selected');
  await page.keyboard.press('Escape');
  await expect(status(page)).toHaveText('Arrow cancelled');
  await expect(hint(page)).toHaveCount(0);
  await expect(item(page, 'b-power')).toBeFocused();
  await expectSaved(page);
  expect(await ofKind(request, 'arrow')).toHaveLength(0);

  // Again, and this time Tab on past Hangar doors to Crew rota and back.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(status(page)).toHaveText(
    'To Sticky note: Crew rota. Enter draws the arrow, Escape cancels',
  );
  await page.keyboard.press('Shift+Tab');
  await expect(item(page, 'b-doors')).toBeFocused();
  await expectAccessible(page);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(
    'Drew an arrow from Sticky note: Power budget to Sticky note: Hangar doors',
  );
  await expectSaved(page);
  const [arrow] = await ofKind(request, 'arrow');
  if (!arrow) throw new Error('No arrow');
  const [start, end] = endsOf(arrow);
  // Facing edges, attached: it follows Hangar doors when that moves.
  near(start, 200, 100);
  near(end, 300, 100);
  await expect(item(page, arrow.id)).toBeFocused();
  await expect(item(page, arrow.id)).toHaveAttribute('data-selected');

  await item(page, 'b-doors').focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expectSaved(page);
  const followed = (await stored(request))[arrow.id];
  if (!followed) throw new Error('No arrow');
  near(endsOf(followed)[1], 300, 110);

  // ⌘Z twice: the move, then the arrow.
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expectSaved(page);
  expect(await ofKind(request, 'arrow')).toHaveLength(0);
});

test('re-aim an arrow’s ends from the keyboard', async ({ page, request }) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  await item(page, 'b-power').focus();
  await page.keyboard.press('a');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expectSaved(page);
  const [arrow] = await ofKind(request, 'arrow');
  if (!arrow) throw new Error('No arrow');
  const line = item(page, arrow.id);
  await expect(line).toBeFocused();

  // Enter re-aims the head: Tab past Hangar doors to Crew rota.
  await page.keyboard.press('Enter');
  await expect(status(page)).toContainText('Re-aiming the arrow’s head');
  await expect(hint(page)).toContainText('Re-aiming the head');
  await page.keyboard.press('Tab');
  await expect(item(page, 'b-crew')).toBeFocused();
  await expectAccessible(page);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(
    'The arrow’s head points to Sticky note: Crew rota',
  );
  await expect(line).toBeFocused();
  await expectSaved(page);
  let now = (await stored(request))[arrow.id] as StoredItem;
  // On Crew rota's top edge, toward the tail at (200, 100).
  near(endsOf(now)[0], 200, 100);
  near(endsOf(now)[1], 100 + 100 / 3, 300);

  // Shift+Enter re-aims the tail; the arrow keys move it off Power budget.
  await page.keyboard.press('Shift+Enter');
  await expect(status(page)).toContainText('Re-aiming the arrow’s tail');
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Moved the arrow’s tail');
  await expectSaved(page);
  now = (await stored(request))[arrow.id] as StoredItem;
  near(endsOf(now)[0], 201, 160);

  // Escape leaves it be.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(status(page)).toHaveText('Re-aiming cancelled');
  await expect(line).toBeFocused();
  await expectSaved(page);
  expect((await stored(request))[arrow.id]?.points).toEqual(now.points);

  // ⌘Z puts the tail back on Power budget.
  await page.keyboard.press('ControlOrMeta+z');
  await expectSaved(page);
  near(endsOf((await stored(request))[arrow.id] as StoredItem)[0], 200, 100);
});
