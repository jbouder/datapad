import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { LIMITS } from '../shared/limits';
import {
  expect,
  expectAccessible,
  expectSaved,
  isMobile,
  openLive,
  SEED,
  test,
} from './fixtures';

interface StoredItem {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  color: string;
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

/** The one stored item of a kind (the test drew exactly one). */
async function onlyOf(request: APIRequestContext, kind: string) {
  const all = Object.values(await stored(request)).filter(
    (b) => b.kind === kind,
  );
  expect(all).toHaveLength(1);
  return all[0] as StoredItem;
}

const sticky = (id: string, x: number, text: string, z: number) => ({
  id,
  boardId: 'p-echo',
  kind: 'sticky',
  x,
  y: 0,
  w: 200,
  h: 200,
  z,
  color: 'warn',
  text,
  points: [],
});

/** The seed, with two stickies side by side on Echo Base's board. */
function seeded() {
  const seed = structuredClone(SEED) as typeof SEED & {
    boardItems: Record<string, unknown>;
  };
  seed.boardItems = {
    'b-power': sticky('b-power', 0, 'Power budget', 0),
    'b-doors': sticky('b-doors', 300, 'Hangar doors', 1),
  };
  return seed;
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: seeded() });
});

const board = (page: Page) => page.getByRole('application');
const item = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const tools = (page: Page) =>
  page.getByRole('toolbar', { name: 'Whiteboard tools' });
const editBar = (page: Page) => page.getByRole('toolbar', { name: 'Edit' });

async function zoomOf(page: Page): Promise<number> {
  return (
    Number(await page.locator('[data-zoom]').getAttribute('data-zoom')) / 100
  );
}

async function centreOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A point on the board, `fx, fy` of the way across and down. */
async function boardPoint(page: Page, fx: number, fy: number) {
  const box = await board(page).boundingBox();
  if (!box) throw new Error('No board');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/**
 * A stroke through `points`: the mouse on desktop (shift held if asked),
 * one finger on the phone (real touch events, `pointerType: touch`).
 */
async function stroke(
  page: Page,
  points: { x: number; y: number }[],
  { shift = false } = {},
) {
  const [first, ...rest] = points;
  if (!first) return;
  if (!isMobile(page)) {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    let last = first;
    for (const p of rest) {
      await page.mouse.move(p.x, p.y, { steps: 4 });
      last = p;
    }
    await page.mouse.move(last.x, last.y);
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    at: { x: number; y: number }[],
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: at.map((p, id) => ({ x: p.x, y: p.y, id })),
    });
  await touch('touchStart', [first]);
  let from = first;
  for (const p of rest) {
    for (let i = 1; i <= 4; i += 1) {
      await touch('touchMove', [
        {
          x: from.x + ((p.x - from.x) * i) / 4,
          y: from.y + ((p.y - from.y) * i) / 4,
        },
      ]);
    }
    from = p;
  }
  await touch('touchEnd', []);
  await cdp.detach();
}

/** Picks a tool: its key on desktop, a tap on its button on the phone. */
async function pick(page: Page, name: string, key: string) {
  const button = tools(page).getByRole('button', { name, exact: true });
  if (isMobile(page)) await button.tap();
  else {
    await board(page).focus();
    await page.keyboard.press(key);
  }
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** Undo or redo: the keys on desktop, the Edit bar's buttons on the phone. */
async function step(page: Page, which: 'Undo' | 'Redo') {
  if (isMobile(page)) {
    await editBar(page).getByRole('button', { name: which }).tap();
  } else {
    await page.keyboard.press(
      which === 'Undo' ? 'ControlOrMeta+z' : 'ControlOrMeta+Shift+z',
    );
  }
}

/** Whether a board point lies on a sticky's border (within a unit). */
function onBorder(
  p: { x: number; y: number },
  b: { x: number; y: number; w: number; h: number },
) {
  const inX = p.x >= b.x - 1 && p.x <= b.x + b.w + 1;
  const inY = p.y >= b.y - 1 && p.y <= b.y + b.h + 1;
  const near = (a: number, c: number) => Math.abs(a - c) <= 1;
  return (
    (inY && (near(p.x, b.x) || near(p.x, b.x + b.w))) ||
    (inX && (near(p.y, b.y) || near(p.y, b.y + b.h)))
  );
}

function endsOf(a: StoredItem) {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = a.points;
  return [
    { x: a.x + x0, y: a.y + y0 },
    { x: a.x + x1, y: a.y + y1 },
  ] as const;
}

test('draw a rect, label it and undo it', async ({ page, request }) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  await pick(page, 'Rectangle', 'r');
  const zoom = await zoomOf(page);
  const from = await boardPoint(page, 0.2, 0.68);
  const to = { x: from.x + 120, y: from.y + 60 };
  // On desktop shift makes it a square.
  await stroke(page, [from, to], { shift: !isMobile(page) });
  await expectSaved(page);
  const rect = await onlyOf(request, 'rect');
  const side = 120 / zoom;
  expect(Math.abs(rect.w - side)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect.h - (isMobile(page) ? 60 / zoom : side))).toBeLessThan(
    2,
  );
  // Drawn, it is selected, and the tool is back to Select.
  await expect(item(page, rect.id)).toHaveAttribute('data-selected');
  await expect(
    tools(page).getByRole('button', { name: 'Select' }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Its label is edited in place, like a sticky's.
  await item(page, rect.id).focus();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Rectangle text' });
  await editor.fill('Hangar');
  await editor.press('ControlOrMeta+Enter');
  await expect(item(page, rect.id)).toHaveAccessibleName('Rectangle: Hangar');
  await expectAccessible(page);

  // Undo takes back the label, then the rect; redo puts both back.
  await step(page, 'Undo');
  await expect(item(page, rect.id)).toHaveAccessibleName('Rectangle');
  await step(page, 'Undo');
  await expect(item(page, rect.id)).toHaveCount(0);
  await expectSaved(page);
  expect((await stored(request))[rect.id]).toBeUndefined();
  await step(page, 'Redo');
  await step(page, 'Redo');
  await expect(item(page, rect.id)).toHaveAccessibleName('Rectangle: Hangar');
  await expectSaved(page);
  expect((await stored(request))[rect.id]).toMatchObject({
    x: rect.x,
    y: rect.y,
    text: 'Hangar',
  });
  await expect(
    editBar(page).getByRole('button', { name: 'Redo' }),
  ).toBeDisabled();
});

test('an arrow attaches to stickies and follows them', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  await pick(page, 'Arrow', 'a');
  // From empty board below the stickies to the middle of Hangar doors.
  const from = await boardPoint(page, 0.25, 0.7);
  const doors = await centreOf(item(page, 'b-doors'));
  await stroke(page, [from, doors]);
  await expectSaved(page);
  let arrow = await onlyOf(request, 'arrow');
  let [start, end] = endsOf(arrow);
  // The end snapped to the sticky's nearest edge; the start stayed put.
  expect(onBorder(end, { x: 300, y: 0, w: 200, h: 200 })).toBe(true);
  expect(onBorder(start, { x: 0, y: 0, w: 200, h: 200 })).toBe(false);
  await expect(item(page, arrow.id)).toHaveAttribute('data-selected');

  // Drag the start onto Power budget: it holds on to that edge too.
  const power = await centreOf(item(page, 'b-power'));
  await stroke(page, [from, { x: power.x - 20, y: power.y + 10 }]);
  await expectSaved(page);
  arrow = await onlyOf(request, 'arrow');
  [start, end] = endsOf(arrow);
  expect(onBorder(start, { x: 0, y: 0, w: 200, h: 200 })).toBe(true);
  await expectAccessible(page);

  // Move Hangar doors: the arrow's end goes with it, its start stays.
  const zoom = await zoomOf(page);
  const grab = await centreOf(item(page, 'b-doors'));
  await stroke(page, [grab, { x: grab.x + 40, y: grab.y + 60 }]);
  await expectSaved(page);
  const all = await stored(request);
  const moved = all['b-doors'];
  expect(Math.abs((moved?.y ?? 0) - 60 / zoom)).toBeLessThanOrEqual(2);
  const after = endsOf(all[arrow.id] as StoredItem);
  expect(after[0].x).toBeCloseTo(start.x, 1);
  expect(after[0].y).toBeCloseTo(start.y, 1);
  expect(after[1].x - end.x).toBeCloseTo((moved?.x ?? 0) - 300, 1);
  expect(after[1].y - end.y).toBeCloseTo(moved?.y ?? 0, 1);
  // One undo puts the sticky and the arrow back together.
  await step(page, 'Undo');
  await expectSaved(page);
  const undone = await stored(request);
  expect(undone['b-doors']).toMatchObject({ x: 300, y: 0 });
  expect(undone[arrow.id]?.points).toEqual(arrow.points);
});

test('draw ink, erase it, and undo the eraser', async ({ page, request }) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  await pick(page, 'Pen', 'p');
  const a = await boardPoint(page, 0.15, 0.68);
  const zig = [
    a,
    { x: a.x + 30, y: a.y + 25 },
    { x: a.x + 60, y: a.y - 5 },
    { x: a.x + 90, y: a.y + 30 },
    { x: a.x + 120, y: a.y },
  ];
  await stroke(page, zig);
  await expectSaved(page);
  const ink = await onlyOf(request, 'ink');
  expect(ink.points.length).toBeGreaterThanOrEqual(4);
  expect(ink.points.length).toBeLessThanOrEqual(LIMITS.inkPointsMax);
  // Drawn with round joins and caps.
  const path = item(page, ink.id).locator('path.board-ink');
  await expect(path).toHaveCSS('stroke-linejoin', 'round');
  await expect(path).toHaveCSS('stroke-linecap', 'round');
  // The pen stays in hand.
  await expect(
    tools(page).getByRole('button', { name: 'Pen' }),
  ).toHaveAttribute('aria-pressed', 'true');

  // The same width on screen at any zoom.
  const width = await path.evaluate((el) => getComputedStyle(el).strokeWidth);
  await page
    .getByRole('group', { name: 'Zoom' })
    .getByRole('button', { name: 'Zoom in' })
    .click();
  await expect(path).toHaveCSS('stroke-width', width);
  await expect(path).toHaveCSS('vector-effect', 'non-scaling-stroke');

  // The eraser deletes what it crosses, in one op when it lifts.
  await pick(page, 'Eraser', 'e');
  const box = await item(page, ink.id).boundingBox();
  if (!box) throw new Error('No stroke');
  const mid = box.x + box.width / 2;
  await stroke(page, [
    { x: mid, y: box.y - 30 },
    { x: mid, y: box.y + box.height + 30 },
  ]);
  await expect(item(page, ink.id)).toHaveCount(0);
  await expectSaved(page);
  expect((await stored(request))[ink.id]).toBeUndefined();
  // The stickies were not strokes: they stay.
  await expect(item(page, 'b-power')).toBeVisible();

  await step(page, 'Undo');
  await expect(item(page, ink.id)).toBeVisible();
  await expectSaved(page);
  expect((await stored(request))[ink.id]?.points).toEqual(ink.points);
});

test('bring to front and send to back, undone and redone', async ({
  page,
  request,
}) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  const z = async () => {
    const all = await stored(request);
    return {
      power: all['b-power']?.z ?? 0,
      doors: all['b-doors']?.z ?? 0,
    };
  };
  await item(page, 'b-power').click();
  // The selection's menu.
  await editBar(page).getByRole('button', { name: 'Selection' }).click();
  await expectAccessible(page);
  await page.getByRole('menuitem', { name: /Bring to front/ }).click();
  await expectSaved(page);
  let order = await z();
  expect(order.power).toBeGreaterThan(order.doors);
  // Power budget now draws after Hangar doors.
  await expect(page.locator('[data-item-id]').last()).toHaveAttribute(
    'data-item-id',
    'b-power',
  );

  await step(page, 'Undo');
  await expectSaved(page);
  order = await z();
  expect(order.power).toBeLessThan(order.doors);
  await step(page, 'Redo');
  await expectSaved(page);
  order = await z();
  expect(order.power).toBeGreaterThan(order.doors);

  // `[` sends it back, `]` brings it forward (from the keyboard).
  await item(page, 'b-power').focus();
  await page.keyboard.press('[');
  await expectSaved(page);
  order = await z();
  expect(order.power).toBeLessThan(order.doors);
  await page.keyboard.press(']');
  await expectSaved(page);
  order = await z();
  expect(order.power).toBeGreaterThan(order.doors);

  // A move is undone and redone too, through the normal ops.
  const grab = await centreOf(item(page, 'b-doors'));
  await stroke(page, [grab, { x: grab.x + 30, y: grab.y + 30 }]);
  await expectSaved(page);
  const moved = (await stored(request))['b-doors'];
  expect(moved?.x).not.toBe(300);
  await step(page, 'Undo');
  await expectSaved(page);
  expect((await stored(request))['b-doors']).toMatchObject({ x: 300, y: 0 });
  await step(page, 'Redo');
  await expectSaved(page);
  expect((await stored(request))['b-doors']).toMatchObject({
    x: moved?.x,
    y: moved?.y,
  });

  // Leaving the board forgets its steps.
  await page.goto('/projects/p-echo');
  await page.getByRole('link', { name: 'Open whiteboard' }).click();
  await expect(
    editBar(page).getByRole('button', { name: 'Undo' }),
  ).toBeDisabled();
});
