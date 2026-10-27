import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, expectAccessible, openLive, SEED, test } from './fixtures';

/**
 * The board's menu: Download as PNG and Download as SVG. The SVG stands
 * alone (the theme's colors resolved, text as SVG text), so it is opened
 * here on its own and checked against the board it came from.
 */

const item = (
  id: string,
  kind: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  text: string,
  points: number[] = [],
  z = 0,
) => ({ id, boardId: 'p-echo', kind, x, y, w, h, z, color, text, points });

function seeded() {
  const seed = structuredClone(SEED) as typeof SEED & {
    boardItems: Record<string, unknown>;
  };
  const items = [
    item('b-power', 'sticky', 0, 0, 200, 200, 'warn', 'Power budget'),
    item('b-doors', 'sticky', 260, 0, 200, 200, 'ok', 'Hangar doors', [], 1),
    item('b-bay', 'rect', 0, 260, 460, 120, 'accent', 'Hangar bay', [], 2),
    item('b-link', 'arrow', 200, 100, 60, 0, 'neutral', '', [0, 0, 60, 0], 3),
    item(
      'b-ink',
      'ink',
      40,
      400,
      120,
      30,
      'danger',
      '',
      [0, 0, 60, 30, 120, 0],
    ),
  ];
  seed.boardItems = Object.fromEntries(items.map((b) => [b.id, b]));
  return seed;
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/import', { data: seeded() });
});

const menu = (page: Page) => page.getByRole('button', { name: 'Board menu' });

async function download(page: Page, entry: 'PNG' | 'SVG') {
  await menu(page).click();
  const file = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: `Download as ${entry}` }).click();
  return file;
}

/** A CSS color as `[r, g, b]`, as the page paints it. */
function rgbOf(page: Page, css: string) {
  return page.evaluate((value) => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('No canvas');
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, css);
}

async function expectSameColor(page: Page, a: string, b: string) {
  const [x, y] = [await rgbOf(page, a), await rgbOf(page, b)];
  for (let i = 0; i < 3; i += 1) {
    expect(Math.abs((x[i] ?? 0) - (y[i] ?? 0))).toBeLessThanOrEqual(2);
  }
}

test('Download as SVG names the file after the board and stands alone', async ({
  page,
}) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  await expect(page.locator('[data-item-id="b-power"]')).toBeVisible();
  // The colors the board draws with, in this theme.
  const board = await page.evaluate(() => {
    const fill = (selector: string, prop: 'fill' | 'stroke') =>
      getComputedStyle(document.querySelector(selector) as Element)[prop];
    return {
      sticky: fill('[data-item-id="b-power"] .board-sticky-body', 'fill'),
      rect: fill('[data-item-id="b-bay"] .board-rect-body', 'stroke'),
      background: getComputedStyle(
        document.querySelector('.board-surface') as Element,
      ).backgroundColor,
    };
  });

  await menu(page).click();
  await expectAccessible(page);
  await page.keyboard.press('Escape');

  const file = await download(page, 'SVG');
  expect(file.suggestedFilename()).toBe('echo-base-relocation-whiteboard.svg');
  const svg = await readFile(await file.path(), 'utf8');
  expect(svg).toContain('Power budget');
  expect(svg).toContain('Hangar bay');
  expect(svg).not.toContain('var(');
  expect(svg).not.toContain('foreignObject');

  // Opened on its own, it shows the board's words in the board's colors.
  await page
    .context()
    .route('**/exported.svg', (route) =>
      route.fulfill({ body: svg, contentType: 'image/svg+xml' }),
    );
  const standalone = await page.context().newPage();
  await standalone.goto('/exported.svg');
  await expect(
    standalone.locator('text').filter({ hasText: 'Power budget' }),
  ).toBeVisible();
  await expect(
    standalone.locator('text').filter({ hasText: 'Hangar doors' }),
  ).toBeVisible();
  const exported = await standalone.evaluate(() => {
    const [background, sticky] = [...document.querySelectorAll('rect')];
    const bay = [...document.querySelectorAll('rect')].find(
      (r) => r.getAttribute('stroke-width') === '2',
    );
    return {
      background: background?.getAttribute('fill') ?? '',
      sticky: sticky?.getAttribute('fill') ?? '',
      rect: bay?.getAttribute('stroke') ?? '',
    };
  });
  expect(exported.sticky).toMatch(/^#[0-9a-f]{6}$/);
  await expectSameColor(page, exported.sticky, board.sticky);
  await expectSameColor(page, exported.rect, board.rect);
  await expectSameColor(page, exported.background, board.background);
  await standalone.close();
});

test('Download as PNG draws the board at 2×', async ({ page }) => {
  await openLive(page, '/projects/p-echo/whiteboard');
  await expect(page.locator('[data-item-id="b-power"]')).toBeVisible();
  const svgFile = await download(page, 'SVG');
  const svg = await readFile(await svgFile.path(), 'utf8');
  const width = Number(/ width="(\d+)"/.exec(svg)?.[1]);
  const height = Number(/ height="(\d+)"/.exec(svg)?.[1]);

  const file = await download(page, 'PNG');
  expect(file.suggestedFilename()).toBe('echo-base-relocation-whiteboard.png');
  const png = await readFile(await file.path());
  // The signature, then IHDR's width and height.
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(width * 2);
  expect(png.readUInt32BE(20)).toBe(height * 2);
});

test('an empty board has nothing to download', async ({ page }) => {
  await openLive(page, '/whiteboard');
  await menu(page).click();
  await expect(
    page.getByRole('menuitem', { name: 'Download as PNG' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('menuitem', { name: 'Download as SVG' }),
  ).toBeDisabled();
});
