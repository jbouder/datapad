import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  expectSaved,
  isMobile,
  openLive,
  openPreferences,
  SEED,
  test,
} from './fixtures';

interface StoredItem {
  id: string;
  boardId: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text: string;
}

async function storedItems(
  request: APIRequestContext,
): Promise<Record<string, StoredItem>> {
  const data = (await (await request.get('/api/export.json')).json()) as {
    boardItems?: Record<string, StoredItem>;
  };
  return data.boardItems ?? {};
}

const sticky = (
  id: string,
  boardId: string,
  x: number,
  y: number,
  text: string,
  z = 0,
) => ({
  id,
  boardId,
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

/** The seed, with two stickies on Echo Base's board and one on the space's. */
function seeded() {
  const seed = structuredClone(SEED) as typeof SEED & {
    boardItems: Record<string, unknown>;
  };
  seed.boardItems = {
    'b-power': sticky('b-power', 'p-echo', 0, 0, 'Power budget'),
    'b-doors': sticky('b-doors', 'p-echo', 240, 0, 'Hangar doors', 1),
    'b-space': sticky('b-space', 'general', 0, 0, 'Quarterly themes'),
  };
  return seed;
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: seeded() });
});

const board = (page: Page) => page.getByRole('application');
const item = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const zoomLabel = (page: Page) => page.locator('[data-zoom]');

async function zoomOf(page: Page): Promise<number> {
  return Number(await zoomLabel(page).getAttribute('data-zoom')) / 100;
}

/** The centre of a locator's box on the page. */
async function centreOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A point on empty board, `fx, fy` of the way across and down. */
async function emptyPoint(page: Page, fx: number, fy: number) {
  const box = await board(page).boundingBox();
  if (!box) throw new Error('No board');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/**
 * Drag from `from` to `to`: the mouse on desktop, one finger on the phone
 * (real touch events, so the board sees `pointerType: touch`).
 */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  if (!isMobile(page)) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, {
      steps: 4,
    });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number }[],
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
    });
  await touch('touchStart', [from]);
  for (let i = 1; i <= 6; i += 1) {
    await touch('touchMove', [
      {
        x: from.x + ((to.x - from.x) * i) / 6,
        y: from.y + ((to.y - from.y) * i) / 6,
      },
    ]);
  }
  await touch('touchEnd', []);
  await cdp.detach();
}

/** Two fingers spreading apart around `at`, from `d0` to `d1` apart. */
async function pinchOut(
  page: Page,
  at: { x: number; y: number },
  d0: number,
  d1: number,
) {
  const cdp = await page.context().newCDPSession(page);
  const points = (d: number) => [
    { x: at.x - d / 2, y: at.y, id: 0 },
    { x: at.x + d / 2, y: at.y, id: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: points(d0),
  });
  for (let i = 1; i <= 6; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(d0 + ((d1 - d0) * i) / 6),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

/** Nothing on the page scrolls: the board takes what the bars leave. */
async function expectNoPageScroll(page: Page) {
  await expectNoSidewaysScroll(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('opens from the project page, the rail or account menu, and ⌘K', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo');
  const section = page.getByRole('heading', { name: /^Whiteboard/ });
  await expect(section).toBeVisible();
  await page.getByRole('link', { name: 'Open whiteboard' }).click();
  await expect(page).toHaveURL(/\/projects\/p-echo\/whiteboard$/);
  await expect(
    page.getByRole('application', {
      name: 'Whiteboard for Echo Base relocation',
    }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Whiteboard',
  );
  await expect(item(page, 'b-power')).toHaveAccessibleName(
    'Sticky note: Power budget',
  );
  await expect(item(page, 'b-space')).toHaveCount(0);
  await expectNoPageScroll(page);
  await expectAccessible(page);

  // Its own way back to the project.
  await page
    .getByRole('link', { name: 'Back to Echo Base relocation' })
    .click();
  await expect(page).toHaveURL(/\/projects\/p-echo$/);

  // The space's board: the rail on desktop, the account menu on a phone.
  if (isMobile(page)) {
    await expect(
      page.getByRole('complementary').getByRole('link', { name: 'Whiteboard' }),
    ).toBeHidden();
    await openPreferences(page);
    await page.getByRole('menuitem', { name: 'Whiteboard' }).click();
  } else {
    await page
      .getByRole('complementary', { name: 'Datapad' })
      .getByRole('link', { name: 'Whiteboard' })
      .click();
  }
  await expect(page).toHaveURL(/\/whiteboard$/);
  await expect(
    page.getByRole('application', { name: 'Space whiteboard' }),
  ).toBeVisible();
  // The space's board is its own: only its sticky.
  await expect(item(page, 'b-space')).toBeVisible();
  await expect(item(page, 'b-power')).toHaveCount(0);
  await expectNoPageScroll(page);

  // ⌘K: on a project, its board.
  await page.goto('/projects/p-falcon');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('open whiteboard');
  await page.getByRole('option', { name: 'Open whiteboard' }).click();
  await expect(page).toHaveURL(/\/projects\/p-falcon\/whiteboard$/);
});

test('add a sticky and text, edit in place, Esc cancels', async ({
  page,
  request,
}) => {
  await openLive(page, '/whiteboard');
  const tools = page.getByRole('toolbar', { name: 'Whiteboard tools' });
  await tools.getByRole('button', { name: 'Sticky note' }).click();
  await expect(
    tools.getByRole('button', { name: 'Sticky note' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // Green, then a click on empty board places it and opens its editor.
  await tools.getByRole('button', { name: 'Green color' }).click();
  const spot = await emptyPoint(page, 0.75, 0.75);
  await page.mouse.click(spot.x, spot.y);
  const editor = page.getByRole('textbox', { name: 'Sticky note text' });
  await expect(editor).toBeFocused();
  await expectAccessible(page);
  await editor.fill('Hire a quartermaster');
  await editor.press('ControlOrMeta+Enter');
  await expect(editor).toHaveCount(0);
  const added = page.getByRole('button', {
    name: 'Sticky note: Hire a quartermaster',
  });
  await expect(added).toBeVisible();
  // Back to Select once placed.
  await expect(tools.getByRole('button', { name: 'Select' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectSaved(page);
  const made = Object.values(await storedItems(request)).find(
    (b) => b.text === 'Hire a quartermaster',
  );
  expect(made).toMatchObject({
    boardId: 'general',
    kind: 'sticky',
    color: 'ok',
    w: 200,
    h: 200,
  });

  // Double-click edits; Esc leaves it as it was.
  await added.dblclick();
  await expect(editor).toHaveValue('Hire a quartermaster');
  await editor.fill('Never mind');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(added).toBeVisible();

  // Blur saves: Enter opens the editor on the selected sticky.
  await added.focus();
  await page.keyboard.press('Enter');
  await editor.fill('Hire two quartermasters');
  await page.getByRole('heading', { level: 1 }).click();
  await expect(
    page.getByRole('button', { name: 'Sticky note: Hire two quartermasters' }),
  ).toBeVisible();

  // Text from the keyboard: T, then Enter places it in the middle.
  await board(page).focus();
  await page.keyboard.press('t');
  await expect(tools.getByRole('button', { name: 'Text' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Enter');
  const textEditor = page.getByRole('textbox', { name: 'Text text' });
  await expect(textEditor).toBeFocused();
  await textEditor.fill('Hoth, week one');
  await textEditor.press('ControlOrMeta+Enter');
  await expect(
    page.getByRole('button', { name: 'Text: Hoth, week one' }),
  ).toBeVisible();
  await expectSaved(page);
  const text = Object.values(await storedItems(request)).find(
    (b) => b.kind === 'text',
  );
  expect(text?.text).toBe('Hoth, week one');
  // Auto-sized: wider than tall, and not the sticky's box.
  expect(text?.w).toBeGreaterThan(text?.h ?? 0);

  // Empty text is no item: T, Enter, Esc leaves nothing behind.
  await board(page).focus();
  await page.keyboard.press('t');
  await page.keyboard.press('Enter');
  await expect(textEditor).toBeFocused();
  await textEditor.press('Escape');
  await expectSaved(page);
  expect(
    Object.values(await storedItems(request)).filter((b) => b.kind === 'text'),
  ).toHaveLength(1);
});

test('move with the keyboard and the pointer, select with a marquee', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  const power = item(page, 'b-power');
  await power.click();
  await expect(power).toHaveAttribute('data-selected');
  await expect(
    page.getByRole('status').filter({ hasText: 'Selected' }),
  ).toHaveText('Selected Sticky note: Power budget');
  // Arrows nudge by 1, shift by 10.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expectSaved(page);
  expect((await storedItems(request))['b-power']).toMatchObject({
    x: 1,
    y: 10,
  });

  // A drag moves it (one op on release), whatever the zoom.
  const zoom = await zoomOf(page);
  const from = await centreOf(power);
  await drag(page, from, { x: from.x + 60, y: from.y + 40 });
  await expectSaved(page);
  const moved = (await storedItems(request))['b-power'];
  expect(Math.abs((moved?.x ?? 0) - (1 + 60 / zoom))).toBeLessThanOrEqual(2);
  expect(Math.abs((moved?.y ?? 0) - (10 + 40 / zoom))).toBeLessThanOrEqual(2);
  // The other sticky stayed.
  expect((await storedItems(request))['b-doors']).toMatchObject({
    x: 240,
    y: 0,
  });

  // Tab reaches the items in drawing order, each named.
  await item(page, 'b-power').focus();
  await page.keyboard.press('Tab');
  await expect(item(page, 'b-doors')).toBeFocused();
  await expect(item(page, 'b-doors')).toHaveAttribute('data-selected');

  if (isMobile(page)) {
    // One finger on empty board pans: the view moves, the items do not.
    const before = await centreOf(power);
    const start = await emptyPoint(page, 0.2, 0.12);
    await drag(page, start, { x: start.x - 50, y: start.y - 80 });
    const after = await centreOf(power);
    expect(Math.round(after.x - before.x)).toBe(-50);
    expect(Math.round(after.y - before.y)).toBe(-80);
    await expectSaved(page);
    expect((await storedItems(request))['b-power']).toMatchObject({
      x: moved?.x,
      y: moved?.y,
    });
  } else {
    // A marquee from empty board selects what it touches.
    const a = await centreOf(power);
    const b = await centreOf(item(page, 'b-doors'));
    const top = (await board(page).boundingBox())?.y ?? 0;
    await drag(page, { x: a.x - 150, y: top + 8 }, { x: b.x, y: b.y });
    await expect(power).toHaveAttribute('data-selected');
    await expect(item(page, 'b-doors')).toHaveAttribute('data-selected');
    await expect(
      page.getByRole('status').filter({ hasText: 'selected' }),
    ).toHaveText('2 items selected');
    // Esc clears it.
    await page.keyboard.press('Escape');
    await expect(power).not.toHaveAttribute('data-selected');
  }
});

test('resize from a corner handle', async ({ page, request }) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  const power = item(page, 'b-power');
  await power.click();
  const box = await power.boundingBox();
  if (!box) throw new Error('No sticky');
  const zoom = await zoomOf(page);
  // The south-east handle sits on the sticky's corner (the ring is 4px out).
  const corner = { x: box.x + box.width - 4, y: box.y + box.height - 4 };
  await drag(page, corner, { x: corner.x + 50, y: corner.y + 30 });
  await expectSaved(page);
  const resized = (await storedItems(request))['b-power'];
  expect(Math.abs((resized?.w ?? 0) - (200 + 50 / zoom))).toBeLessThanOrEqual(
    2,
  );
  expect(Math.abs((resized?.h ?? 0) - (200 + 30 / zoom))).toBeLessThanOrEqual(
    2,
  );
  expect(resized).toMatchObject({ x: 0, y: 0 });
});

test('zoom and fit; the viewport survives a reload', async ({ page }) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  const fitted = await zoomOf(page);
  const zoom = page.getByRole('group', { name: 'Zoom' });
  await zoom.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoomLabel(page)).toHaveAttribute(
    'data-zoom',
    String(Math.round(fitted * 125)),
  );
  await zoom.getByRole('button', { name: /reset to 100%/ }).click();
  await expect(zoomLabel(page)).toHaveAttribute('data-zoom', '100');

  if (isMobile(page)) {
    // Two fingers spreading zoom in around them.
    await pinchOut(page, await emptyPoint(page, 0.5, 0.5), 100, 200);
    await expect(zoomLabel(page)).toHaveAttribute('data-zoom', '200');
  } else {
    // Ctrl+wheel zooms around the pointer: the point under it stays.
    const power = item(page, 'b-power');
    const before = await power.boundingBox();
    const at = await centreOf(power);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await expect.poll(async () => zoomOf(page)).toBeGreaterThan(1);
    const after = await power.boundingBox();
    const c = await centreOf(power);
    expect(Math.abs(c.x - at.x)).toBeLessThanOrEqual(2);
    expect(after?.width ?? 0).toBeGreaterThan(before?.width ?? 0);
    // A plain wheel pans.
    await page.mouse.wheel(0, 100);
    await expect
      .poll(async () => (await centreOf(power)).y)
      .toBeLessThan(c.y - 50);
  }

  await zoom.getByRole('button', { name: 'Fit' }).click();
  await expect(zoomLabel(page)).toHaveAttribute(
    'data-zoom',
    String(Math.round(fitted * 100)),
  );
  // In, then remembered across a reload (on this device, for this board).
  await zoom.getByRole('button', { name: 'Zoom in' }).click();
  await zoom.getByRole('button', { name: 'Zoom in' }).click();
  const remembered = await zoomLabel(page).getAttribute('data-zoom');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('datapad:board-view:p-echo');
        return raw ? String(Math.round(JSON.parse(raw).zoom * 100)) : null;
      }),
    )
    .toBe(remembered);
  await page.reload();
  await expect(zoomLabel(page)).toHaveAttribute('data-zoom', remembered ?? '');
  // The space's board has a viewport of its own.
  await page.goto('/whiteboard');
  await expect(zoomLabel(page)).not.toHaveAttribute(
    'data-zoom',
    remembered ?? '',
  );
});

test('delete with Undo', async ({ page, request }) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  await item(page, 'b-doors').click();
  await page.keyboard.press('Delete');
  await expect(item(page, 'b-doors')).toHaveCount(0);
  await expect(page.getByText('Deleted sticky note')).toBeVisible();
  await expectSaved(page);
  expect((await storedItems(request))['b-doors']).toBeUndefined();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(item(page, 'b-doors')).toBeVisible();
  await expectSaved(page);
  expect((await storedItems(request))['b-doors']).toMatchObject({
    x: 240,
    y: 0,
    text: 'Hangar doors',
  });

  // Several at once, by Backspace.
  await board(page).focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(page.getByText('Deleted 2 items')).toBeVisible();
  await expect(page.locator('[data-item-id]')).toHaveCount(0);
});

test("another device's moves and colors arrive live", async ({
  page,
  context,
  request,
}) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  const other = await context.newPage();
  await openLive(other, '/projects/p-echo/whiteboard');
  await item(other, 'b-power').click();
  await other.keyboard.press('Shift+ArrowRight');
  await expectSaved(other);
  await expect(item(page, 'b-power')).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, 10, 0)',
  );
  expect((await storedItems(request))['b-power']).toMatchObject({ x: 10 });
  // Recolor from the keyboard: 5 is red.
  await other.keyboard.press('5');
  await expect(item(page, 'b-power')).toHaveAttribute('data-color', 'danger');
  await other.close();
});
