import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isMobile,
  noteAction,
  openLive,
  openNoteRow,
  SEED,
  seedTime,
  settle,
  test,
} from './fixtures';

const pick = async (page: Page, name: string) => {
  const group = page.getByRole('group', { name: 'Layout (press v to cycle)' });
  await group
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .click();
  await expect(group.getByRole('radio', { name })).toBeChecked();
};

/** Where an element sits on the page (not the viewport). */
/**
 * Where a card sits, once its own entrance (`.enter`: 8px up, after a
 * stagger delay) is over, so a card still waiting to arrive is not read
 * 8px low.
 */
async function place(page: Page, id: string) {
  return card(page, id).evaluate(async (el) => {
    // Reading layout starts any pending transition, so it can be awaited.
    el.getBoundingClientRect();
    await Promise.all(
      el.getAnimations().map((a) => a.finished.catch(() => undefined)),
    );
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height };
  });
}

function card(page: Page, id: string) {
  return page.locator(`article[data-note-id="${id}"]`);
}

/** The List's rows (#274: the compact note row). */
function listRows(page: Page) {
  return page.getByRole('main').locator('li[data-note-id]');
}

test.beforeEach(async ({ request }) => {
  const seed = structuredClone(SEED);
  seed.notes['n-3'].body = `## Next quarter\n${Array.from(
    { length: 14 },
    (_, i) => `- idea ${i + 1}`,
  ).join('\n')}`;
  await request.post('/api/import', { data: seed });
});

test('switch to Grid, expand a note, edit it in place, collapse', async ({
  page,
}) => {
  await openLive(page, '/notes');
  await pick(page, 'Grid');
  await expect(page).toHaveURL(/view=grid/);
  const grid = page.getByRole('list', { name: 'Notes' });
  await expect(grid).toBeVisible();

  // Pinned first; compact cards have no footer and clamp long notes.
  await expect(grid.locator('article').first()).toHaveAttribute(
    'data-note-id',
    'n-1',
  );
  await expect(
    card(page, 'n-3').getByRole('button', { name: 'Edit note' }),
  ).toHaveCount(0);
  await expect(card(page, 'n-3').getByText('idea 14')).not.toBeInViewport();

  await settle(page);
  // Polled until two reads agree: the grid may still be entering.
  let neighbor = await place(page, 'n-2');
  await expect
    .poll(async () => {
      const last = neighbor;
      neighbor = await place(page, 'n-2');
      return neighbor.y === last.y && neighbor.x === last.x;
    })
    .toBe(true);
  await card(page, 'n-3').getByRole('button', { name: 'Expand note' }).click();
  const open = card(page, 'n-3');
  await expect(
    open.getByRole('button', { name: 'Collapse note' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(open.getByText('idea 14')).toBeVisible();
  // Opening covers; it does not push the other cards around.
  await settle(page);
  await expect.poll(() => place(page, 'n-2')).toEqual(neighbor);

  await open.getByRole('button', { name: 'Edit note' }).click();
  const editor = open.getByRole('combobox', { name: 'Edit note' });
  await editor.fill('## Next quarter\nFewer moons.');
  await open.getByRole('button', { name: 'Save note' }).click();
  await expect(open.locator('h4')).toHaveText('Next quarter');
  await expect(open).toContainText('Fewer moons.');

  await page.keyboard.press('Escape');
  await expect(
    card(page, 'n-3').getByRole('button', { name: 'Expand note' }),
  ).toBeFocused();
  await expect(
    card(page, 'n-3').getByRole('button', { name: 'Edit note' }),
  ).toHaveCount(0);

  // Clicking a compact card opens it too.
  await card(page, 'n-2').getByText('Bring the power budget').click();
  await expect(
    card(page, 'n-2').getByRole('button', { name: 'Collapse note' }),
  ).toBeVisible();
});

test('filters apply to the Grid as well', async ({ page }) => {
  await openLive(page, '/notes?view=grid&pinned=1');
  await expect(
    page.getByRole('list', { name: 'Notes' }).locator('article'),
  ).toHaveCount(1);
  await pick(page, 'List');
  await expect(listRows(page)).toHaveCount(1);
});

test('List and Grid, List the default; the Notepad has its own page (#261)', async ({
  page,
}) => {
  await openLive(page, '/notes');
  const group = page.getByRole('group', { name: 'Layout (press v to cycle)' });
  await expect(group.getByRole('radio')).toHaveCount(2);
  await expect(group.getByRole('radio').first()).toHaveAccessibleName('List');
  await expect(group.getByRole('radio', { name: 'List' })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Notepad' })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Find' })).toBeVisible();
  await page.locator('body').press('v');
  await expect(group.getByRole('radio', { name: 'Grid' })).toBeChecked();
  await page.locator('body').press('v');
  await expect(group.getByRole('radio', { name: 'List' })).toBeChecked();
});

test('an old Feed address reads as List', async ({ page }) => {
  await openLive(page, '/notes?view=feed');
  await expect(page.getByRole('radio', { name: 'List' })).toBeChecked();
  await expect(listRows(page)).toHaveCount(3);
});

test('List: compact note rows under day headings, each opening in place', async ({
  page,
}) => {
  await openLive(page, '/notes?view=list');
  const rows = listRows(page);
  // Newest first; Yavin's note is in an archived project.
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Prep: Shield review');
  await expect(
    rows.nth(0).getByRole('link', { name: 'Echo Base relocation' }),
  ).toBeVisible();
  await expect(
    rows.nth(0).getByRole('link', { name: 'Meeting: Shield review' }),
  ).toBeVisible();
  await expect(rows.nth(1)).toContainText('Standup');
  await expect(rows.nth(1)).toContainText('Pinned');
  await expect(rows.nth(2)).toContainText('Next quarter');
  await expect(rows.nth(2)).toContainText('General');
  // Under day headings, each list named by its day.
  const days = page.getByRole('main').getByRole('heading', { level: 2 });
  expect(await days.count()).toBeGreaterThan(0);
  await expect(
    page.getByRole('list', { name: (await days.first().textContent()) ?? '' }),
  ).toBeVisible();
  // Compact: no card, a closed row at most about three text lines, and
  // the long note's later lines out of sight.
  await expect(page.locator('article[data-note-id]')).toHaveCount(0);
  await expect(rows.nth(2)).not.toContainText('idea 14');
  if (!isMobile(page)) {
    const box = await rows.nth(1).boundingBox();
    expect(box?.height ?? 0).toBeLessThan(100);
  }

  const standup = rows.nth(1);
  const toggle = standup.getByRole('button', { name: /^Note from / });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(
    standup.getByRole('checkbox', { name: 'Check the heaters' }),
  ).toBeVisible();
  await noteAction(standup, 'Edit');
  await expect(
    standup.getByRole('combobox', { name: 'Edit note' }),
  ).toBeVisible();
  await standup.getByRole('button', { name: 'Cancel' }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(
    standup.getByRole('checkbox', { name: 'Check the heaters' }),
  ).toHaveCount(0);
  await expectNoSidewaysScroll(page);
});

test('a link to one note opens it in the List', async ({ page }) => {
  await openLive(page, '/notes?note=n-3');
  await expect(page.getByRole('radio', { name: 'List' })).toBeChecked();
  const row = page.locator('li[data-note-id="n-3"]');
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('data-highlighted');
  await expect(
    row.getByRole('button', { name: /^Note from / }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByText('idea 14')).toBeVisible();
});

test('Grid: masonry columns in reading order, one column on a phone', async ({
  page,
  request,
}) => {
  // Notes of different heights, so the columns come out uneven.
  const notes: Record<string, unknown> = {};
  for (const [i, lines] of [3, 1, 6, 2, 1].entries()) {
    const id = `n-extra-${i}`;
    notes[id] = {
      id,
      projectId: null,
      body: Array.from(
        { length: lines },
        (_, l) => `Extra ${i} line ${l}`,
      ).join('\n'),
      pinned: false,
      meetingId: null,
      phase: null,
      createdAt: seedTime(`2026-10-1${i}T08:00:00.000Z`),
    };
  }
  await request.post('/api/import', {
    data: { exportedAt: seedTime('2026-10-27T08:00:00.000Z'), notes },
  });
  await openLive(page, '/notes?view=grid');
  const items = page
    .getByRole('list', { name: 'Notes' })
    .locator(':scope > li');
  await expect(items).toHaveCount(8);
  await settle(page);
  const boxes = await items.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), h: r.height };
    }),
  );
  // Each card starts no higher than the one before it in the DOM, and on
  // the same line, further right: left to right, top to bottom.
  for (let i = 1; i < boxes.length; i++) {
    const [a, b] = [boxes[i - 1], boxes[i]];
    expect(b?.y ?? 0).toBeGreaterThanOrEqual(a?.y ?? 0);
    if (b?.y === a?.y) expect(b?.x ?? 0).toBeGreaterThan(a?.x ?? 0);
  }
  const columns = new Set(boxes.map((b) => b.x));
  if (isMobile(page)) {
    expect(columns.size).toBe(1);
  } else {
    expect(columns.size).toBeGreaterThan(1);
  }
  // No holes: within a column, each card sits one gap under the last.
  for (const x of columns) {
    const column = boxes.filter((b) => b.x === x).sort((a, b) => a.y - b.y);
    for (let i = 1; i < column.length; i++) {
      const [above, below] = [column[i - 1], column[i]];
      expect(
        Math.abs((below?.y ?? 0) - ((above?.y ?? 0) + (above?.h ?? 0)) - 12),
      ).toBeLessThanOrEqual(1);
    }
  }
  await expectNoSidewaysScroll(page);
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ theme, reducedMotion: 'reduce' });

    test('the list and an open row are axe clean', async ({ page }) => {
      await openLive(page, '/notes?view=list');
      await expectAccessible(page);
      await openNoteRow(page.locator('li[data-note-id="n-3"]'));
      await expectAccessible(page);
    });

    test('the grid and an open card are axe clean', async ({ page }) => {
      await openLive(page, '/notes?view=grid');
      await expectAccessible(page);
      await card(page, 'n-3')
        .getByRole('button', { name: 'Expand note' })
        .click();
      await expectAccessible(page);
    });
  });
}
